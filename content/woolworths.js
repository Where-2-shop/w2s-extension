// content/woolworths.js — injecté sur woolworths.com.au

const BATCH_SIZE = 5;
const DELAY_MS   = 700;

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
        background:#fff;border-radius:16px;padding:24px;width:320px;
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

function log(name, status) {
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

// ── Helpers ────────────────────────────────────────────────────────────────
function getXsrf() {
  // Woolworths stocke le token XSRF dans un cookie lisible par JS
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ── API Woolworths ─────────────────────────────────────────────────────────
async function addBatch(batch) {
  // batch: [{ Stockcode: number, Quantity: number }]
  const xsrf = getXsrf();
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;

  try {
    const res = await fetch("/apis/ui/Basket/items", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ items: batch }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[W2S] Basket API ${res.status}:`, txt.slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error("[W2S] Basket fetch error:", err.message);
    return false;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function run() {
  const data = await chrome.storage.local.get("pending_cart");
  const pending = data.pending_cart;

  if (!pending || pending.store !== "woolworths") return;
  if (Date.now() - pending.ts > 600_000) {
    chrome.storage.local.remove("pending_cart");
    return;
  }

  // Consommer pour éviter double-run (page reload, SPA navigation…)
  await chrome.storage.local.remove("pending_cart");

  const items = pending.items;
  if (!items?.length) return;

  // Attendre que document.body soit disponible
  if (!document.body) {
    await new Promise(res => {
      const obs = new MutationObserver(() => { if (document.body) { obs.disconnect(); res(); } });
      obs.observe(document.documentElement, { childList: true });
    });
  }

  const overlay = createOverlay();
  let done = 0, errors = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const payload = batch.map(it => ({
      Stockcode: parseInt(it.product_id, 10),
      Quantity:  it.qty,
    }));

    const ok = await addBatch(payload);
    if (!ok) errors += batch.length;

    for (const it of batch) {
      log(it.name, ok ? "ok" : "err");
      done++;
      setProgress(done, items.length);
    }

    if (i + BATCH_SIZE < items.length) await sleep(DELAY_MS);
  }

  const doneEl = document.getElementById("w2s-done");
  if (doneEl) {
    if (errors === items.length) {
      // Tout a échoué — afficher l'erreur + lien console
      doneEl.style.color = "#e01a22";
      doneEl.textContent = "⚠ Cart API failed — check console (F12) for details";
    } else if (errors > 0) {
      doneEl.style.color = "#d97706";
      doneEl.textContent = `⚠ ${items.length - errors}/${items.length} added — see console for errors`;
    } else {
      doneEl.textContent = "✓ Done — redirecting to cart…";
    }
    doneEl.style.display = "block";
  }
  await sleep(errors > 0 ? 4000 : 1800);
  overlay.remove();
  if (errors < items.length) {
    window.location.href = "https://www.woolworths.com.au/shop/cart";
  }
}

run().catch(err => console.error("[W2S] woolworths.js error:", err));
