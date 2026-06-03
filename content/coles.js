// content/coles.js — injecté sur coles.com.au
// Pour l'instant : navigation vers le panier après avoir affiché les items à ajouter.
// L'auto-add Coles sera implémenté dans une prochaine version (API plus complexe).

async function run() {
  const data = await chrome.storage.local.get("pending_cart");
  const pending = data.pending_cart;

  if (!pending || pending.store !== "coles") return;
  if (Date.now() - pending.ts > 600_000) {
    chrome.storage.local.remove("pending_cart");
    return;
  }

  chrome.storage.local.remove("pending_cart");

  const items = pending.items;
  if (!items?.length) return;

  // Afficher un résumé des items à ajouter manuellement
  const el = document.createElement("div");
  el.innerHTML = `
    <div style="
      position:fixed;top:16px;right:16px;z-index:999999;
      background:#fff;border-radius:12px;padding:16px;width:300px;
      box-shadow:0 8px 32px rgba(0,0,0,.2);font-family:-apple-system,sans-serif;
      border-left:4px solid #e01a22;
    ">
      <div style="font-size:14px;font-weight:700;color:#1a1917;margin-bottom:8px;">
        W<span style="color:#e01a22;">2</span>S — ${items.length} item${items.length > 1 ? "s" : ""} to add
      </div>
      <div style="font-size:11px;color:#888;margin-bottom:10px;">
        Auto-add for Coles coming soon.<br>Please add these items manually:
      </div>
      <ul style="margin:0;padding:0 0 0 14px;font-size:12px;color:#333;display:flex;flex-direction:column;gap:3px;">
        ${items.map(it => `<li>${it.qty > 1 ? `${it.qty}× ` : ""}${it.name}</li>`).join("")}
      </ul>
      <button onclick="this.closest('div').parentElement.remove()" style="
        margin-top:12px;width:100%;padding:8px;background:#e01a22;color:#fff;
        border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;
      ">Got it</button>
    </div>
  `;
  document.body.appendChild(el);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", run);
} else {
  run();
}
