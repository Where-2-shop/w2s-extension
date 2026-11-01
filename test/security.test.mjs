// Tests de sécurité / robustesse — aucun appel réseau : chrome.* et fetch
// sont remplacés par des bouchons, et toute requête sortante du navigateur
// est bloquée (page.route).
//
// Lancer :  node --test test/
// Prérequis : Playwright + Chromium (non déclarés en dépendance du dépôt).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = p => readFileSync(`${ROOT}/${p}`, "utf8");

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function newPage() {
  const page = await browser.newPage();
  // Garde-fou : rien ne sort du navigateur de test.
  await page.route("**/*", r => r.abort());
  await page.setContent("<html><body></body></html>");
  return page;
}

// ── Scripts de contenu (Coles / Woolworths) ──────────────────────────────────
// fetchMode : "hang" = la requête ne répond jamais (sauf si annulée par signal)
//             "ok"   = 200 + JSON vide
// storageSetFails : chrome.storage.local.set rejette (contexte d'extension
//             invalidé après une mise à jour, cas courant).
// age : réponse déjà donnée à la question « 18 ans ou plus » (Coles) ; null = jamais posée.
async function runContentScript(file, store, { fetchMode, storageSetFails = false, items, age = true, run = 120_000 }) {
  const page = await newPage();
  await page.clock.install();
  await page.evaluate(({ store, fetchMode, storageSetFails, items, age }) => {
    window.__store = { pending_cart: { store, items, missingItems: [], ts: Date.now() } };
    if (age !== null) window.__store.w2s_coles_age_confirmed = age;
    window.__bodies = [];
    window.chrome = { storage: { local: {
      get: async keys => {
        const o = {};
        for (const k of [].concat(keys)) if (k in window.__store) o[k] = window.__store[k];
        return o;
      },
      // L'échec ne frappe qu'une fois l'overlay affiché, en cours de remplissage.
      set: async o => {
        if (storageSetFails && document.getElementById("w2s-overlay")) throw new Error("Extension context invalidated.");
        Object.assign(window.__store, o);
      },
      remove: async k => {
        if (storageSetFails && document.getElementById("w2s-overlay")) throw new Error("Extension context invalidated.");
        delete window.__store[k];
      },
    } } };
    // about:blank refuse document.cookie : on simule une session Coles/WW.
    Object.defineProperty(document, "cookie", {
      get: () => "XSRF-TOKEN=abc; fulfillmentStoreId=0001", configurable: true,
    });
    window.fetch = (_url, opts = {}) => new Promise((resolve, reject) => {
      if (opts.body) window.__bodies.push(JSON.parse(opts.body));
      if (fetchMode === "ok") {
        resolve({ ok: true, status: 200, text: async () => "{}", json: async () => ({}) });
        return;
      }
      opts.signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")));
    });
  }, { store, fetchMode, storageSetFails, items, age });
  await page.addScriptTag({ content: src(file) });
  await page.clock.runFor(run);
  return page;
}

const ITEMS = [{ product_id: "123", name: "Milk 2L", qty: 1 }];

for (const [file, store] of [["content/coles.js", "coles"], ["content/woolworths.js", "woolworths"]]) {
  test(`${store}: une requête panier qui ne répond jamais ne bloque pas le remplissage`, async () => {
    const page = await runContentScript(file, store, { fetchMode: "hang", items: ITEMS });
    // Terminé = récapitulatif affiché, ou overlay retiré (Woolworths le retire
    // 5 s après un échec total). Bloqué = overlay « Adding… » toujours là.
    const done = await page.evaluate(() => {
      const el = document.getElementById("w2s-done");
      return !document.getElementById("w2s-overlay") || (!!el && el.style.display !== "none");
    });
    const missed = await page.evaluate(() => document.getElementById("w2s-missed")?.innerText ?? "");
    await page.close();
    assert.ok(done, "le récapitulatif doit s'afficher malgré la requête bloquée");
    assert.match(missed, /Milk 2L/, "l'article non ajouté doit être signalé");
  });

  test(`${store}: l'overlay plein écran disparaît si le script plante`, async () => {
    const page = await runContentScript(file, store, { fetchMode: "ok", storageSetFails: true, items: ITEMS });
    const overlay = await page.evaluate(() => !!document.getElementById("w2s-overlay"));
    await page.close();
    assert.equal(overlay, false, "un plantage ne doit pas laisser la page Coles/Woolworths inutilisable");
  });

  test(`${store}: l'overlay de fin peut être fermé sans gestionnaire inline`, async () => {
    const page = await runContentScript(file, store, { fetchMode: "ok", items: ITEMS });
    const inline = await page.evaluate(() =>
      [...document.querySelectorAll("#w2s-overlay [onclick]")].length);
    const closeBtn = await page.$("#w2s-overlay-close");
    assert.equal(inline, 0, "pas d'attribut onclick (bloqué par la CSP du site, exécuté dans le monde de la page)");
    assert.ok(closeBtn, "un bouton de fermeture doit exister");
    await closeBtn.click();
    const overlay = await page.evaluate(() => !!document.getElementById("w2s-overlay"));
    await page.close();
    assert.equal(overlay, false);
  });
}

// ── Panneau latéral / popup ──────────────────────────────────────────────────
async function loadUi(dir, name, apiResponse) {
  const page = await newPage();
  const html = src(`${dir}/${name}.html`).replace(/<script src="[^"]+"><\/script>/, "");
  await page.setContent(html);
  await page.clock.install();
  await page.evaluate(({ apiResponse }) => {
    const basket = [{ qty: 1, product: { product_id: "1", store: "coles", name: "Milk", price: 2 } }];
    window.chrome = {
      storage: { local: { get: async () => ({ w2s_basket: basket }), set: async () => {} },
                 onChanged: { addListener() {} } },
      runtime: { sendMessage() {} },
      tabs: { create() {} },
    };
    window.fetch = (_url, opts = {}) => new Promise((resolve, reject) => {
      if (apiResponse) {
        resolve({ ok: true, status: 200, json: async () => apiResponse, text: async () => "" });
        return;
      }
      opts.signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")));
    });
  }, { apiResponse });
  await page.addScriptTag({ content: src(`${dir}/${name}.js`) });
  await page.clock.runFor(100);
  await page.click("#btn-compare");
  return page;
}

for (const [dir, name] of [["sidepanel", "panel"], ["popup", "popup"]]) {
  test(`${name}: la comparaison expire si l'API ne répond pas`, async () => {
    const page = await loadUi(dir, name, null);
    await page.clock.runFor(60_000);
    const errorShown = await page.evaluate(() =>
      !document.getElementById("view-error").classList.contains("hidden"));
    await page.close();
    assert.ok(errorShown, "la vue d'erreur doit remplacer le spinner infini");
  });

  test(`${name}: une réponse API malveillante n'injecte pas de HTML`, async () => {
    const page = await loadUi(dir, name, {
      totals: { cheaper: 'coles"><img id="w2s-pwn" src="x"><b class="', coles: 2, savings: 0 },
      items: [],
    });
    await page.clock.runFor(100);
    const injected = await page.evaluate(() => !!document.getElementById("w2s-pwn"));
    await page.close();
    assert.equal(injected, false, "totals.cheaper ne doit pas être interprété comme du HTML");
  });
}

// ── Service worker : validation de OPEN_STORE ────────────────────────────────
function loadBackground() {
  const calls = { set: [], tabs: [] };
  let listener;
  const chrome = {
    storage: { local: { set: async o => { calls.set.push(o); } } },
    tabs: { create: async o => { calls.tabs.push(o); } },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    runtime: { onMessage: { addListener: fn => { listener = fn; } } },
  };
  vm.runInNewContext(src("background.js"), { chrome, console, Date });
  const send = msg => new Promise(res => {
    const sync = listener(msg, { id: "self" }, res);
    if (sync !== true) res(undefined);
  });
  return { send, calls };
}

test("background: un magasin hérité du prototype est refusé", async () => {
  const { send, calls } = loadBackground();
  const res = await send({ type: "OPEN_STORE", store: "__proto__", items: [] });
  assert.equal(res?.ok, false);
  assert.equal(calls.set.length, 0, "rien ne doit être écrit dans pending_cart");
  assert.equal(calls.tabs.length, 0);
});

test("background: les articles reçus de la page sont normalisés", async () => {
  const { send, calls } = loadBackground();
  await send({
    type: "OPEN_STORE", store: "coles",
    items: [
      { product_id: "123", name: "Milk", qty: 2, substituted: true },
      { product_id: "../../api", name: "x", qty: 1 },
      { product_id: "456", name: { evil: 1 }, qty: "1e9" },
      "garbage",
    ],
    missingItems: [{ name: "<b>Bread</b>", qty: -4 }],
  });
  // JSON : les objets viennent d'un autre realm (vm), deepEqual strict les distinguerait.
  const cart = JSON.parse(JSON.stringify(calls.set[0].pending_cart));
  assert.deepEqual(cart.items, [
    { product_id: "123", name: "Milk", qty: 2, substituted: true },
    { product_id: "456", name: "", qty: 99, substituted: false },
  ]);
  // L'article à l'identifiant invalide n'est pas envoyé au marchand, mais
  // reste signalé à l'acheteur.
  assert.deepEqual(cart.missingItems, [{ name: "x", qty: 1 }, { name: "<b>Bread</b>", qty: 1 }]);
});

// ── Vérification d'âge Coles : c'est l'utilisateur qui la déclare ─────────────
const ageGateSent = page => page.evaluate(() => window.__bodies.filter(b => "ageGateVerified" in b).map(b => b.ageGateVerified));

test("coles: sans réponse enregistrée, la question est posée et rien n'est ajouté avant", async () => {
  const page = await runContentScript("content/coles.js", "coles", { fetchMode: "ok", items: ITEMS, age: null, run: 5_000 });
  assert.ok(await page.$("#w2s-age"), "question 18+ affichée");
  assert.deepEqual(await ageGateSent(page), [], "aucun article envoyé avant la réponse");
  await page.close();
});

test("coles: « I'm 18 or older » → ageGateVerified true, et la réponse est mémorisée", async () => {
  const page = await runContentScript("content/coles.js", "coles", { fetchMode: "ok", items: ITEMS, age: null, run: 5_000 });
  await page.click("#w2s-age-yes");
  await page.clock.runFor(60_000);
  assert.deepEqual(await ageGateSent(page), [true]);
  assert.equal(await page.evaluate(() => window.__store.w2s_coles_age_confirmed), true);
  await page.close();
});

test("coles: « Skip those items » → ageGateVerified false (plus jamais true par défaut)", async () => {
  const page = await runContentScript("content/coles.js", "coles", { fetchMode: "ok", items: ITEMS, age: null, run: 5_000 });
  await page.click("#w2s-age-no");
  await page.clock.runFor(60_000);
  assert.deepEqual(await ageGateSent(page), [false]);
  assert.equal(await page.evaluate(() => window.__store.w2s_coles_age_confirmed), false);
  await page.close();
});

test("coles: réponse déjà donnée → pas de question, elle est réutilisée", async () => {
  for (const age of [true, false]) {
    const page = await runContentScript("content/coles.js", "coles", { fetchMode: "ok", items: ITEMS, age });
    assert.equal(await page.$("#w2s-age"), null);
    assert.deepEqual(await ageGateSent(page), [age]);
    await page.close();
  }
});
