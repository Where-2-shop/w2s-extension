// content/coles.js — injecté sur coles.com.au

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function getCookie(name) {
  const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function randomUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const MISSED_KEY = "w2s_coles_missed";
const MISSED_TTL = 7_200_000; // 2h

// ── Missed items sticky panel ─────────────────────────────────────────────────
function showMissedPanel(missedItems) {
  if (document.getElementById("w2s-missed")) return;

  const panel = document.createElement("div");
  panel.id = "w2s-missed";
  panel.style.cssText = `
    position:fixed;bottom:20px;right:20px;z-index:2147483646;
    width:264px;border-radius:12px;overflow:hidden;
    box-shadow:0 8px 32px rgba(0,0,0,.22);
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  `;

  function render(collapsed) {
    panel.innerHTML = `
      <div id="w2s-missed-hdr" style="
        background:#e01a22;padding:10px 12px;
        display:flex;align-items:center;justify-content:space-between;cursor:pointer;
      ">
        <div style="display:flex;align-items:center;gap:7px;">
          <span style="font-size:13px;font-weight:900;font-family:Arial Black,sans-serif;color:#fff;">
            W<span style="color:#ffaaaa;">2</span>S
          </span>
          <span style="font-size:12px;font-weight:600;color:#fff;">
            Out of stock · ${missedItems.length} item${missedItems.length > 1 ? "s" : ""}
          </span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:10px;color:rgba(255,255,255,.75);">${collapsed ? "▲" : "▼"}</span>
          <button id="w2s-missed-close" style="
            background:none;border:none;color:rgba(255,255,255,.75);
            font-size:15px;cursor:pointer;padding:0 2px;line-height:1;
          " title="Dismiss">✕</button>
        </div>
      </div>
      ${!collapsed ? `
        <div style="background:#fff;padding:10px 12px 12px;">
          <div style="font-size:11px;color:#999;margin-bottom:7px;line-height:1.4;">
            Not added to your cart — check these in-store or find alternatives:
          </div>
          <ul style="margin:0;padding:0 0 0 14px;display:flex;flex-direction:column;gap:4px;font-size:12px;color:#333;">
            ${missedItems.map(it => `<li>${it.qty > 1 ? `${it.qty}× ` : ""}${esc(it.name)}</li>`).join("")}
          </ul>
        </div>
      ` : ""}
    `;

    panel.querySelector("#w2s-missed-hdr").onclick = e => {
      if (e.target.closest("#w2s-missed-close")) return;
      render(!collapsed);
    };
    panel.querySelector("#w2s-missed-close").onclick = e => {
      e.stopPropagation();
      chrome.storage.local.remove(MISSED_KEY);
      panel.remove();
    };
  }

  render(false);
  document.body.appendChild(panel);
}

// ── Overlay ───────────────────────────────────────────────────────────────────
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
          <span style="font-size:15px;font-weight:600;color:#1a1917;">Adding to Coles cart…</span>
        </div>
        <div style="height:4px;background:#f0ede8;border-radius:2px;overflow:hidden;margin-bottom:14px;">
          <div id="w2s-bar" style="height:100%;width:0%;background:#e01a22;border-radius:2px;transition:width .3s;"></div>
        </div>
        <div id="w2s-status" style="font-size:12px;color:#888;margin-bottom:8px;"></div>
        <div id="w2s-log" style="font-size:12px;color:#555;max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;"></div>
        <div id="w2s-done" style="display:none;margin-top:12px;"></div>
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

function logItem(name, ok) {
  const el = document.getElementById("w2s-log");
  if (!el) return;
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;align-items:center;";
  row.innerHTML = `
    <span style="color:${ok ? "#e01a22" : "#888"};font-weight:700;flex-shrink:0;">${ok ? "✓" : "✗"}</span>
    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(name)}</span>`;
  el.appendChild(row);
  el.scrollTop = el.scrollHeight;
}

function setProgress(done, total) {
  const bar = document.getElementById("w2s-bar");
  if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
}

// ── Coles BFF API ─────────────────────────────────────────────────────────────
const OCP_KEY      = "eae83861d1cd4de6bb9cd8a2cd6f041e";
const DSCH_CHANNEL = "coles.online.1site.desktop";

function buildHeaders() {
  const sessionId = getCookie("sessionId");
  const visitorId = getCookie("visitorId");
  const userId    = getCookie("dsch-ccpuserid");
  console.log("[W2S Coles] cookies → sessionId:", sessionId ? "✓" : "✗ MISSING",
    "| visitorId:", visitorId ? "✓" : "✗ MISSING",
    "| dsch-ccpuserid:", userId ? "✓" : "✗ MISSING");
  const headers = {
    "accept":                    "application/json, text/plain, */*",
    "content-type":              "application/json",
    "ocp-apim-subscription-key": OCP_KEY,
    "dsch-channel":              DSCH_CHANNEL,
    "cusp-correlation-id":       randomUUID(),
  };
  if (sessionId) headers["cusp-session-id"] = sessionId;
  if (visitorId) headers["cusp-visitor-id"] = visitorId;
  if (userId)    headers["cusp-user-id"]    = userId;
  return headers;
}

async function fetchTrolleyState(storeId) {
  try {
    const res = await fetch(`/api/bff/trolley/store/${storeId}?sortBy=recentlyAdded`, {
      method: "GET",
      credentials: "include",
      headers: buildHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[W2S] GET trolley → ${res.status}`, text.slice(0, 300));
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn("[W2S] GET trolley exception:", err.message);
    return null;
  }
}

function isIncapsulaResponse(text) {
  return text.includes("_Incapsula_Resource") || text.includes('CONTENT="noindex,nofollow"');
}

async function addItem(item, storeId, trolley) {
  // productId doit être un entier — l'API Coles retourne 200 sans rien ajouter si c'est une string
  const pid = parseInt(item.product_id, 10);
  const body = {
    ageGateVerified: false,
    swapBehaviour:   false,
    items: [{ actions: [{ type: "ADD", quantity: item.qty, productId: pid }] }],
  };
  if (trolley?.slotId)                    body.slotId                    = trolley.slotId;
  if (trolley?.slotCutOffTime)            body.slotCutOffTime            = trolley.slotCutOffTime;
  if (trolley?.reservationExpirationTime) body.reservationExpirationTime = trolley.reservationExpirationTime;

  console.log(`[W2S Coles] PATCH /api/bff/trolley/store/${storeId}`, JSON.stringify(body));

  try {
    const res = await fetch(`/api/bff/trolley/store/${storeId}`, {
      method: "PATCH",
      credentials: "include",
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });
    const text = await res.text();

    if (isIncapsulaResponse(text)) {
      console.warn("[W2S] Incapsula intercept");
      return "incapsula";
    }
    if (res.ok) {
      // L'API Coles retourne toujours 200 — vérifier results[0].failedItems
      try {
        const json = JSON.parse(text);
        const result = (json?.results ?? [])[0] ?? {};
        const failed = result.failedItems ?? [];
        const actioned = result.actionedItems ?? [];
        if (failed.length > 0) {
          const err = failed[0].error ?? {};
          console.warn(`[W2S] ✗ ${item.name} (id=${pid}) → FAILED: [${err.errorCode}] ${err.message}`);
          return { ok: false, errorCode: err.errorCode, message: err.message };
        }
        if (actioned.length > 0) {
          console.log(`[W2S] ✓ ${item.name} (id=${pid}) → ajouté`);
        } else {
          console.log(`[W2S] ✓ ${item.name} (id=${pid}) → 200 OK`, text.slice(0, 300));
        }
      } catch {
        console.log(`[W2S] ✓ ${item.name} (id=${pid}) → ${res.status} (non-JSON)`);
      }
      return true;
    }
    console.warn(`[W2S] ✗ ${item.name} (id=${pid}) → ${res.status}`, text.slice(0, 500));
  } catch (err) {
    console.error(`[W2S] error for ${item.name}:`, err.message);
  }
  return false;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function run() {
  const stored = await chrome.storage.local.get(["pending_cart", MISSED_KEY]);

  // Pas de panier en attente → juste afficher le panel des items manqués si sauvegardé
  if (!stored.pending_cart || stored.pending_cart.store !== "coles") {
    const saved = stored[MISSED_KEY];
    if (saved?.items?.length && Date.now() - saved.ts < MISSED_TTL) {
      if (!document.body) {
        await new Promise(res => {
          const obs = new MutationObserver(() => { if (document.body) { obs.disconnect(); res(); } });
          obs.observe(document.documentElement, { childList: true });
        });
      }
      showMissedPanel(saved.items);
    } else if (saved) {
      chrome.storage.local.remove(MISSED_KEY);
    }
    return;
  }

  const pending = stored.pending_cart;
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
  await sleep(1200);

  const allCookieNames = document.cookie.split(";").map(c => c.trim().split("=")[0]).filter(Boolean);
  console.log("[W2S Coles] All cookie names:", allCookieNames.join(", "));

  const storeId = getCookie("fulfillmentStoreId") || "0298";
  const shoppingMethod = getCookie("shopping-method") ?? "unknown";
  console.log(`[W2S] storeId=${storeId} | shopping-method=${shoppingMethod} | ${items.length} items`);

  setStatus("Fetching trolley state…");
  const trolley = await fetchTrolleyState(storeId);
  if (trolley) {
    console.log("[W2S] trolley slotId:", trolley.slotId ?? "none", "| items:", (trolley.items ?? []).length);
  } else {
    console.warn("[W2S] trolley GET failed — proceeding without slot info");
  }

  let successes = 0;
  let incapsulaBlocked = false;
  const failedItems = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    setStatus(item.name);
    const result = await addItem(item, storeId, trolley);

    if (result === "incapsula") {
      incapsulaBlocked = true;
      logItem(item.name, false);
      setProgress(items.length, items.length);
      break;
    } else if (result === true) {
      successes++;
      logItem(item.name, true);
    } else if (result && typeof result === "object" && !result.ok) {
      failedItems.push(item);
      logItem(`${item.name} — out of stock`, false);
    } else {
      failedItems.push(item);
      logItem(item.name, false);
    }
    setProgress(i + 1, items.length);
    await sleep(300);
  }

  // Sauvegarder les items non ajoutés — le panel réapparaîtra sur les pages suivantes
  if (failedItems.length > 0) {
    await chrome.storage.local.set({ [MISSED_KEY]: { items: failedItems, ts: Date.now() } });
  } else {
    await chrome.storage.local.remove(MISSED_KEY);
  }

  setStatus("");
  const doneEl = document.getElementById("w2s-done");
  if (!doneEl) return;

  const errors = items.length - successes;

  if (incapsulaBlocked) {
    doneEl.style.cssText = "color:#888;text-align:left;font-size:12px;font-weight:400;";
    doneEl.innerHTML = `
      <div style="font-weight:700;font-size:13px;color:#e01a22;margin-bottom:6px;">⚠ Accès bloqué par Coles</div>
      <div style="font-size:11px;color:#555;margin-bottom:10px;line-height:1.5;">
        Ouvrez <strong>coles.com.au</strong> dans un onglet normal,<br>
        puis revenez dans l'extension et cliquez <strong>Shop →</strong> à nouveau.
      </div>
      <div style="font-weight:700;font-size:12px;color:#1a1917;margin-bottom:6px;">À ajouter manuellement :</div>
      <ul style="margin:0;padding:0 0 0 16px;display:flex;flex-direction:column;gap:3px;font-size:12px;">
        ${items.map(it => `<li>${it.qty > 1 ? `${it.qty}× ` : ""}${esc(it.name)}</li>`).join("")}
      </ul>
    `;
  } else if (errors === items.length) {
    doneEl.style.cssText = "color:#888;text-align:left;font-size:12px;font-weight:400;";
    doneEl.innerHTML = `
      <div style="font-weight:700;font-size:13px;color:#1a1917;margin-bottom:8px;">Out of stock — add manually:</div>
      <ul style="margin:0;padding:0 0 0 16px;display:flex;flex-direction:column;gap:3px;font-size:12px;">
        ${items.map(it => `<li>${it.qty > 1 ? `${it.qty}× ` : ""}${esc(it.name)}</li>`).join("")}
      </ul>
    `;
  } else {
    doneEl.style.cssText = "text-align:left;font-size:13px;";
    doneEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${failedItems.length ? "10px" : "0"};">
        <span style="font-weight:700;color:#e01a22;">✓ ${successes} item${successes > 1 ? "s" : ""} added</span>
        <a href="/checkout/cart"
           style="font-size:12px;font-weight:700;color:#e01a22;text-decoration:underline;"
           onclick="document.getElementById('w2s-overlay').remove()">View Cart →</a>
      </div>
      ${failedItems.length ? `
        <div style="border-top:1px solid #f0ede8;padding-top:8px;">
          <div style="font-size:11px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">
            Out of stock · ${failedItems.length} item${failedItems.length > 1 ? "s" : ""}
          </div>
          <ul style="margin:0;padding:0 0 0 14px;display:flex;flex-direction:column;gap:3px;font-size:12px;color:#555;">
            ${failedItems.map(it => `<li>${it.qty > 1 ? `${it.qty}× ` : ""}${esc(it.name)}</li>`).join("")}
          </ul>
          <div style="margin-top:7px;font-size:11px;color:#aaa;">The list stays visible on this page ↘</div>
        </div>` : ""}
    `;

    // Afficher le panel sticky maintenant (sera aussi visible sur les pages suivantes)
    if (failedItems.length) showMissedPanel(failedItems);
  }
  doneEl.style.display = "block";
}

run().catch(err => console.error("[W2S] coles.js crashed:", err));
