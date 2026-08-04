// Harness for the "nothing silently disappears" guarantee: whatever the store
// does, every item that did not make it into the cart must reach the shopper.
//
// Runs the real content scripts in a real DOM with chrome.* and fetch stubbed,
// covering the three ways the list used to vanish: the store not stocking an
// item at all, the store stocking none of the basket, and the store SPA
// destroying the overlay mid-fill.
//
// Needs Playwright, which this repo doesn't depend on — run it from somewhere
// that has it:  node /path/to/extension/test/missed-items-harness.mjs
// Against the pre-fix scripts all four scenarios print "panel visible : NO".

import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const EXT = "/Users/romainlirio/Documents/where-2-shop/extension";
const wwSrc = readFileSync(`${EXT}/content/woolworths.js`, "utf8");
const colesSrc = readFileSync(`${EXT}/content/coles.js`, "utf8");

async function scenario(label, { src, store, items, missingItems, addSucceeds, destroyOverlay }) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<html><body></body></html>");
  await page.evaluate(({ items, missingItems, store, addSucceeds }) => {
    window.__store = {};
    window.chrome = {
      storage: { local: {
        get: async (keys) => {
          const out = {};
          for (const k of [].concat(keys)) if (k in window.__store) out[k] = window.__store[k];
          return out;
        },
        set: async (o) => { Object.assign(window.__store, o); },
        remove: async (k) => { delete window.__store[k]; },
      } },
    };
    window.__store.pending_cart = { store, items, missingItems, ts: Date.now() };
    window.fetch = async () => ({
      ok: addSucceeds, status: addSucceeds ? 200 : 500,
      text: async () => "{}", json: async () => ({ results: [{ failedItems: addSucceeds ? [] : ["x"] }] }),
    });
    Object.defineProperty(document, "cookie", { get: () => "XSRF-TOKEN=abc", configurable: true });
  }, { items, missingItems, store, addSucceeds });

  if (destroyOverlay) {
    await page.evaluate(() => {
      // mimic the store SPA wiping the overlay mid-fill
      setInterval(() => { document.getElementById("w2s-overlay")?.remove();
                          document.getElementById("w2s-done")?.remove(); }, 60);
    });
  }
  await page.addScriptTag({ content: src });
  await page.waitForTimeout(3500);
  const panelText = await page.evaluate(() => document.getElementById("w2s-missed")?.innerText ?? null);
  const stored = await page.evaluate(() => window.__store[Object.keys(window.__store).find(k=>k.includes("missed"))] ?? null);
  console.log(`\n### ${label}`);
  console.log("  panel visible :", panelText ? "YES" : "NO");
  if (panelText) console.log("  panel content :", panelText.replace(/\n+/g, " | ").slice(0, 130));
  console.log("  persisted     :", stored ? stored.items.map(i=>i.name).join(", ") : "none");
  await browser.close();
}

const gone = [{ name: "Bega Cheddar Cheese", qty: 1 }];
await scenario("WW — item not stocked here (add succeeds)", {
  src: wwSrc, store: "woolworths", items: [{ product_id: "1", name: "Bananas", qty: 1 }],
  missingItems: gone, addSucceeds: true, destroyOverlay: false });
await scenario("WW — store stocks NOTHING (items empty)", {
  src: wwSrc, store: "woolworths", items: [], missingItems: gone, addSucceeds: true, destroyOverlay: false });
await scenario("WW — overlay destroyed mid-fill", {
  src: wwSrc, store: "woolworths", items: [{ product_id: "1", name: "Bananas", qty: 1 }],
  missingItems: gone, addSucceeds: true, destroyOverlay: true });
await scenario("Coles — item not stocked here", {
  src: colesSrc, store: "coles", items: [{ product_id: "1", name: "Bananas", qty: 1 }],
  missingItems: gone, addSucceeds: true, destroyOverlay: false });
