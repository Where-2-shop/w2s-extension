// content/woolworths.js — injecté sur woolworths.com.au
// Lit pending_cart depuis chrome.storage et ajoute les produits au panier

const BATCH_SIZE = 5;   // items par appel API
const DELAY_MS   = 600; // délai entre batches

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Overlay de progression ─────────────────────────────────────────────────
function createOverlay(total) {
  const el = document.createElement("div");
  el.id = "w2s-overlay";
  el.innerHTML = `
    <div style="
      position:fixed;top:0;left:0;right:0;bottom:0;z-index:999999;
      background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;
      font-family:-apple-system,sans-serif;
    ">
      <div style="
        background:#fff;border-radius:16px;padding:24px;width:320px;
        box-shadow:0 20px 60px rgba(0,0,0,.3);
      ">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <span style="font-size:20px;font-weight:900;">W<span style="color:#e01a22;">2</span>S</span>
          <span style="font-size:15px;font-weight:600;color:#1a1917;">Adding to cart…</span>
        </div>
        <div id="w2s-progress-bar" style="
          height:4px;background:#f5f3ef;border-radius:2px;overflow:hidden;margin-bottom:14px;
        ">
          <div id="w2s-bar-fill" style="
            height:100%;width:0%;background:#007837;border-radius:2px;
            transition:width .3s ease;
          "></div>
        </div>
        <div id="w2s-log" style="
          font-size:12px;color:#888;max-height:160px;overflow-y:auto;
          display:flex;flex-direction:column;gap:4px;
        "></div>
        <div id="w2s-done" style="display:none;margin-top:12px;text-align:center;">
          <p style="font-size:14px;font-weight:600;color:#007837;margin:0 0 8px;">
            ✓ Done! Redirecting to cart…
          </p>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  return el;
}

function logItem(name, status) {
  const log = document.getElementById("w2s-log");
  if (!log) return;
  const line = document.createElement("div");
  line.style.cssText = "display:flex;align-items:center;gap:6px;";
  const icon = status === "ok" ? "✓" : status === "err" ? "✗" : "·";
  const color = status === "ok" ? "#007837" : status === "err" ? "#e01a22" : "#888";
  line.innerHTML = `<span style="color:${color};font-weight:700;">${icon}</span><span style="color:#333;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function setProgress(done, total) {
  const fill = document.getElementById("w2s-bar-fill");
  if (fill) fill.style.width = `${Math.round((done / total) * 100)}%`;
}

// ── Appel API Woolworths ────────────────────────────────────────────────────
async function addBatch(items) {
  // items: [{ Stockcode: number, Quantity: number }]
  const res = await fetch("/apis/ui/Basket/items", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept":       "application/json",
    },
    body: JSON.stringify({ items }),
  });
  return res.ok;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function run() {
  const data = await chrome.storage.local.get("pending_cart");
  const pending = data.pending_cart;

  // Ignorer si pas pour Woolworths ou trop vieux (>10 min)
  if (!pending || pending.store !== "woolworths") return;
  if (Date.now() - pending.ts > 600_000) {
    chrome.storage.local.remove("pending_cart");
    return;
  }

  // Consommer immédiatement pour éviter double-run
  chrome.storage.local.remove("pending_cart");

  const items = pending.items; // [{ product_id, name, qty }]
  if (!items?.length) return;

  const overlay = createOverlay(items.length);
  let done = 0;

  // Découper en batches
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const payload = batch.map(it => ({
      Stockcode: parseInt(it.product_id, 10),
      Quantity:  it.qty,
    }));

    let ok = false;
    try {
      ok = await addBatch(payload);
    } catch (_) {
      ok = false;
    }

    for (const it of batch) {
      logItem(it.name, ok ? "ok" : "err");
      done++;
      setProgress(done, items.length);
    }

    if (i + BATCH_SIZE < items.length) await sleep(DELAY_MS);
  }

  // Afficher le message final et rediriger vers le panier
  const doneEl = document.getElementById("w2s-done");
  if (doneEl) doneEl.style.display = "block";
  await sleep(1800);
  overlay.remove();
  window.location.href = "https://www.woolworths.com.au/shop/cart";
}

// Attendre que la page soit prête
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", run);
} else {
  run();
}
