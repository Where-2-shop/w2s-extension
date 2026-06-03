// content/woolworths.js — injecté sur woolworths.com.au
// Stratégie DOM : navigue vers chaque produit via searchTerm et clique "Add to trolley"

const DELAY_BETWEEN_ITEMS_MS = 2000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Overlay de progression ─────────────────────────────────────────────────
function createOverlay() {
  const wrap = document.createElement("div");
  wrap.id = "w2s-overlay";
  wrap.innerHTML = `
    <div style="
      position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;
      background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    ">
      <div style="
        background:#fff;border-radius:16px;padding:24px;width:340px;
        box-shadow:0 20px 60px rgba(0,0,0,.3);
      ">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
          <span style="font-size:20px;font-weight:900;font-family:Arial Black,sans-serif;">
            W<span style="color:#e01a22;">2</span>S
          </span>
          <span style="font-size:15px;font-weight:600;color:#1a1917;">Adding to Woolworths cart…</span>
        </div>
        <div style="height:4px;background:#f0ede8;border-radius:2px;overflow:hidden;margin-bottom:14px;">
          <div id="w2s-bar" style="height:100%;width:0%;background:#007837;border-radius:2px;transition:width .3s;"></div>
        </div>
        <div id="w2s-status" style="font-size:12px;color:#888;margin-bottom:8px;"></div>
        <div id="w2s-log" style="font-size:12px;color:#555;max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;"></div>
        <div id="w2s-done" style="display:none;margin-top:12px;text-align:center;font-size:14px;font-weight:600;color:#007837;">
          ✓ Done — redirecting to cart…
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  return wrap;
}

function setStatus(text) {
  const el = document.getElementById("w2s-status");
  if (el) el.textContent = text;
}

function logItem(name, status) {
  const el = document.getElementById("w2s-log");
  if (!el) return;
  const icon  = status === "ok" ? "✓" : status === "err" ? "✗" : "·";
  const color = status === "ok" ? "#007837" : status === "err" ? "#e01a22" : "#888";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;align-items:center;";
  row.innerHTML = `<span style="color:${color};font-weight:700;flex-shrink:0;">${icon}</span>
    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>`;
  el.appendChild(row);
  el.scrollTop = el.scrollHeight;
}

function setProgress(done, total) {
  const bar = document.getElementById("w2s-bar");
  if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
}

// ── Recherche un produit par Stockcode dans les résultats de la page ────────
// Retourne le bouton "Add to trolley" du produit correspondant, ou null
function findAddButton(stockcode) {
  // Woolworths stocke le stockcode dans data-stockcode ou data-productid
  const selectors = [
    `[data-stockcode="${stockcode}"]`,
    `[data-productid="${stockcode}"]`,
    `[data-product-stockcode="${stockcode}"]`,
  ];

  for (const sel of selectors) {
    const card = document.querySelector(sel);
    if (card) {
      // Chercher le bouton add dans la carte
      const btn = card.querySelector(
        'button[aria-label*="add" i], button[aria-label*="trolley" i], ' +
        'button.add-to-cart-button, button[class*="add-to-cart"], ' +
        'button[class*="AddToCart"], button[class*="addToCart"]'
      );
      if (btn) return btn;
    }
  }

  // Fallback : chercher tous les boutons "Add to trolley" et matcher par data attribute
  const allBtns = document.querySelectorAll(
    'button[aria-label*="add" i], button[aria-label*="trolley" i]'
  );
  for (const btn of allBtns) {
    const container = btn.closest('[data-stockcode], [data-productid]');
    if (!container) continue;
    const sc = container.dataset.stockcode || container.dataset.productid;
    if (sc && String(sc) === String(stockcode)) return btn;
  }

  return null;
}

// ── Attend qu'un sélecteur apparaisse dans le DOM ─────────────────────────
function waitForSelector(selector, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) { resolve(el); return; }
    const obs = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) { obs.disconnect(); resolve(found); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); reject(new Error(`Timeout: ${selector}`)); }, timeout);
  });
}

// ── Tente d'ajouter un item via API directe (si connue) ───────────────────
async function tryApiAdd(item, xsrf) {
  // On teste plusieurs endpoints connus de Woolworths
  const endpoints = [
    { url: "/apis/ui/Basket/items",     body: { items: [{ Stockcode: parseInt(item.product_id, 10), Quantity: item.qty }] } },
    { url: "/apis/ui/Trolley/items",    body: { items: [{ Stockcode: parseInt(item.product_id, 10), Quantity: item.qty }] } },
    { url: "/api/ui/v2/Basket/items",   body: { items: [{ Stockcode: parseInt(item.product_id, 10), Quantity: item.qty }] } },
  ];

  const headers = { "Content-Type": "application/json", "Accept": "application/json" };
  if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        method: "POST", credentials: "include", headers,
        body: JSON.stringify(ep.body),
      });
      if (res.ok) {
        console.log(`[W2S] ✓ API success: ${ep.url}`);
        return true;
      }
      console.log(`[W2S] ${ep.url} → ${res.status}`);
    } catch (_) {}
  }
  return false;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function run() {
  const data = await chrome.storage.local.get("pending_cart");
  const pending = data.pending_cart;
  if (!pending || pending.store !== "woolworths") return;
  if (Date.now() - pending.ts > 600_000) { chrome.storage.local.remove("pending_cart"); return; }
  await chrome.storage.local.remove("pending_cart");

  const items = pending.items;
  if (!items?.length) return;

  if (!document.body) {
    await new Promise(res => {
      const obs = new MutationObserver(() => { if (document.body) { obs.disconnect(); res(); } });
      obs.observe(document.documentElement, { childList: true });
    });
  }

  const overlay = createOverlay();
  let done = 0, errors = 0;
  const xsrf = (document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1];

  for (const item of items) {
    setStatus(`Searching: ${item.name}`);

    // 1. Essai via API directe (rapide, silencieux)
    const apiOk = await tryApiAdd(item, xsrf ? decodeURIComponent(xsrf) : null);
    if (apiOk) {
      logItem(item.name, "ok");
      done++;
      setProgress(done, items.length);
      await sleep(400);
      continue;
    }

    // 2. Fallback : navigation vers la page de recherche + clic DOM
    const searchUrl = `/shop/search/products?searchTerm=${encodeURIComponent(item.name)}&pageNumber=1`;
    try {
      // Naviguer vers la recherche dans un iframe invisible
      // (on reste sur la même page, pas de navigation complète)
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;";
      iframe.src = searchUrl;
      document.body.appendChild(iframe);

      // Attendre que l'iframe charge suffisamment
      await sleep(3000);

      // Essayer de trouver un bouton dans l'iframe
      let iframeBtn = null;
      try {
        const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iDoc) {
          const btns = iDoc.querySelectorAll('button[aria-label*="Add" i]');
          iframeBtn = btns[0];
        }
      } catch (_) {}

      if (iframeBtn) {
        iframeBtn.click();
        await sleep(800);
        logItem(item.name, "ok");
      } else {
        errors++;
        logItem(item.name, "err");
        console.warn(`[W2S] Could not find add button for: ${item.name}`);
      }

      iframe.remove();
    } catch (err) {
      errors++;
      logItem(item.name, "err");
      console.error(`[W2S] DOM fallback failed for ${item.name}:`, err.message);
    }

    done++;
    setProgress(done, items.length);
    await sleep(DELAY_BETWEEN_ITEMS_MS);
  }

  setStatus("");
  const doneEl = document.getElementById("w2s-done");
  if (doneEl) {
    if (errors === items.length) {
      doneEl.style.color = "#e01a22";
      doneEl.innerHTML = "⚠ Could not add items automatically.<br><small>Check console (Cmd+Option+J) for endpoint info.</small>";
    } else if (errors > 0) {
      doneEl.style.color = "#d97706";
      doneEl.textContent = `⚠ ${items.length - errors}/${items.length} added`;
    } else {
      doneEl.textContent = "✓ Done — redirecting to cart…";
    }
    doneEl.style.display = "block";
  }

  await sleep(errors > 0 ? 5000 : 1800);
  overlay.remove();
  if (errors < items.length) {
    window.location.href = "https://www.woolworths.com.au/shop/cart";
  }
}

run().catch(err => console.error("[W2S] woolworths.js crashed:", err));
