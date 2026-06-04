// content/woolworths.js — injecté sur woolworths.com.au

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Overlay ────────────────────────────────────────────────────────────────
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
        <div id="w2s-done" style="display:none;margin-top:12px;text-align:center;font-size:14px;font-weight:600;"></div>
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

function logItem(name, ok, substitute = false) {
  const el = document.getElementById("w2s-log");
  if (!el) return;
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;align-items:flex-start;";
  if (substitute) {
    row.innerHTML = `
      <span style="color:#007837;font-weight:700;flex-shrink:0;">~</span>
      <span style="font-size:11px;color:#888;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
            title="${name}">${name} <em style="font-style:italic;">(alt.)</em></span>`;
  } else {
    row.innerHTML = `
      <span style="color:${ok ? "#007837" : "#e01a22"};font-weight:700;flex-shrink:0;">${ok ? "✓" : "✗"}</span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>`;
  }
  el.appendChild(row);
  el.scrollTop = el.scrollHeight;
}

function setProgress(done, total) {
  const bar = document.getElementById("w2s-bar");
  if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
}

// ── Ajoute un item via l'API Woolworths ────────────────────────────────────
async function addItem(item, xsrf) {
  const headers = { "Content-Type": "application/json", "Accept": "application/json" };
  if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;

  try {
    const res = await fetch("/api/v3/ui/trolley/update", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        items: [{ stockcode: parseInt(item.product_id, 10), quantity: item.qty, source: "ww-sm:ext:where2shop" }],
      }),
    });
    const text = await res.text();
    if (res.ok) {
      console.log(`[W2S] ✓ ${item.name} → ${res.status}`, text.slice(0, 200));
      return true;
    }
    console.warn(`[W2S] ✗ ${item.name} → ${res.status}`, text.slice(0, 200));
  } catch (err) {
    console.error(`[W2S] error for ${item.name}:`, err.message);
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

  createOverlay();
  let successes = 0;
  let alternatives = 0;

  await sleep(1200);

  const xsrf = (document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1];
  const isGuest = !xsrf;
  console.log(`[W2S] ${items.length} items | ${isGuest ? "guest session" : "logged in"}`);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    setStatus(item.name);
    const ok = await addItem(item, xsrf ? decodeURIComponent(xsrf) : null);
    if (ok) {
      successes++;
      if (item.substituted) alternatives++;
    }
    logItem(item.name, ok, ok && item.substituted);
    setProgress(i + 1, items.length);
    await sleep(300);
  }

  setStatus("");
  const doneEl = document.getElementById("w2s-done");
  if (!doneEl) return;

  if (successes === 0) {
    doneEl.style.cssText = "color:#e01a22;font-size:13px;font-weight:600;";
    doneEl.textContent = "⚠ Could not add items. Check console (F12).";
    doneEl.style.display = "block";
    await sleep(5000);
    document.getElementById("w2s-overlay")?.remove();
  } else {
    const altNote = alternatives > 0
      ? ` · <span style="font-weight:400;color:#888;">${alternatives} alternative${alternatives > 1 ? "s" : ""}</span>`
      : "";
    doneEl.style.cssText = "text-align:left;font-size:13px;";
    doneEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <span style="font-weight:700;color:#007837;">✓ ${successes} added${altNote}</span>
        <a href="/shop/cart"
           style="font-size:12px;font-weight:700;color:#007837;text-decoration:underline;"
           onclick="document.getElementById('w2s-overlay').remove()">View Trolley →</a>
      </div>
      ${alternatives > 0 ? `
        <div style="margin-top:7px;font-size:11px;color:#aaa;line-height:1.4;">
          ~ exact product not found at Woolworths — similar item added instead.
        </div>` : ""}
    `;
    doneEl.style.display = "block";
  }
}

run().catch(err => console.error("[W2S] woolworths.js crashed:", err));
