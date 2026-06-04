// content/coles.js — injecté sur coles.com.au

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

function logItem(name, ok) {
  const el = document.getElementById("w2s-log");
  if (!el) return;
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;align-items:center;";
  row.innerHTML = `
    <span style="color:${ok ? "#e01a22" : "#888"};font-weight:700;flex-shrink:0;">${ok ? "✓" : "✗"}</span>
    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>`;
  el.appendChild(row);
  el.scrollTop = el.scrollHeight;
}

function setProgress(done, total) {
  const bar = document.getElementById("w2s-bar");
  if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
}

// ── Coles BFF API ─────────────────────────────────────────────────────────────
// Endpoint vérifié via DevTools : PATCH /api/bff/trolley/store/{storeId}
// Le storeId vient du cookie fulfillmentStoreId (ex: "0298")
// Headers requis : ocp-apim-subscription-key (statique), cusp-* (depuis cookies)

const OCP_KEY     = "eae83861d1cd4de6bb9cd8a2cd6f041e";
const DSCH_CHANNEL = "coles.online.1site.desktop";

function buildHeaders() {
  // Cookie names verified via DevTools — update if Coles renames them
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

// Récupère l'état actuel du trolley pour extraire slotId / slotCutOffTime
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
  // productId doit être un entier (pas une string) — l'API Coles retourne 200 mais
  // n'ajoute rien si c'est une string ou si type:"ADD" est absent.
  const pid = parseInt(item.product_id, 10);
  const body = {
    ageGateVerified: false,
    swapBehaviour:   false,
    items: [{ actions: [{ type: "ADD", quantity: item.qty, productId: pid }] }],
  };
  // Inclure les infos de slot si disponibles (évite une erreur 422 quand un slot est déjà réservé)
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
      console.warn("[W2S] Incapsula intercept — visite coles.com.au manuellement d'abord");
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
          console.warn(`[W2S] ✗ ${item.name} (id=${pid}) → 200 mais FAILED: [${err.errorCode}] ${err.message}`);
          return { ok: false, errorCode: err.errorCode, message: err.message };
        }
        if (actioned.length > 0) {
          console.log(`[W2S] ✓ ${item.name} (id=${pid}) → ajouté (actionedItems=${actioned.length})`);
        } else {
          console.log(`[W2S] ✓ ${item.name} (id=${pid}) → 200 OK`, text.slice(0, 300));
        }
      } catch {
        console.log(`[W2S] ✓ ${item.name} (id=${pid}) → ${res.status} (réponse non-JSON)`);
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
  const data = await chrome.storage.local.get("pending_cart");
  const pending = data.pending_cart;
  if (!pending || pending.store !== "coles") return;
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

  // Dump all cookie names to spot mismatches in cusp-* cookie lookups
  const allCookieNames = document.cookie.split(";").map(c => c.trim().split("=")[0]).filter(Boolean);
  console.log("[W2S Coles] All cookie names:", allCookieNames.join(", "));

  const storeId = getCookie("fulfillmentStoreId") || "0298";
  const shoppingMethod = getCookie("shopping-method") ?? "unknown";
  console.log(`[W2S] Coles: storeId=${storeId} | shopping-method=${shoppingMethod} | ${items.length} items | fulfillmentStoreId cookie ${getCookie("fulfillmentStoreId") ? "✓" : "✗ MISSING (using fallback 0298)"}`);

  setStatus("Fetching trolley state…");
  const trolley = await fetchTrolleyState(storeId);
  if (trolley) {
    const keys = Object.keys(trolley);
    console.log("[W2S] trolley state keys:", keys.join(", "));
    console.log("[W2S] trolley slotId:", trolley.slotId ?? "none", "| items count:", (trolley.items ?? []).length);
  } else {
    console.warn("[W2S] trolley state: GET failed (null) — proceeding without slot info");
  }

  let successes = 0;
  let incapsulaBlocked = false;

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
      // 200 OK mais failedItems — afficher l'erreur Coles dans le log
      logItem(`${item.name} — ${result.message ?? result.errorCode ?? "unavailable"}`, false);
    } else {
      logItem(item.name, false);
    }
    setProgress(i + 1, items.length);
    await sleep(300);
  }

  setStatus("");
  const doneEl = document.getElementById("w2s-done");
  if (!doneEl) return;

  const errors = items.length - successes;

  if (incapsulaBlocked) {
    doneEl.style.color = "#888";
    doneEl.style.textAlign = "left";
    doneEl.style.fontSize = "12px";
    doneEl.style.fontWeight = "400";
    doneEl.innerHTML = `
      <div style="font-weight:700;font-size:13px;color:#e01a22;margin-bottom:6px;">
        ⚠ Accès bloqué par Coles
      </div>
      <div style="font-size:11px;color:#555;margin-bottom:10px;line-height:1.5;">
        Ouvrez <strong>coles.com.au</strong> dans un onglet normal,<br>
        puis revenez dans l'extension et cliquez <strong>Shop →</strong> à nouveau.
      </div>
      <div style="font-weight:700;font-size:12px;color:#1a1917;margin-bottom:6px;">Liste à ajouter manuellement :</div>
      <ul style="margin:0;padding:0 0 0 16px;display:flex;flex-direction:column;gap:3px;font-size:12px;">
        ${items.map(it => `<li>${it.qty > 1 ? `${it.qty}× ` : ""}${it.name}</li>`).join("")}
      </ul>
    `;
  } else if (errors === items.length) {
    doneEl.style.color = "#888";
    doneEl.style.textAlign = "left";
    doneEl.style.fontSize = "12px";
    doneEl.style.fontWeight = "400";
    doneEl.innerHTML = `
      <div style="font-weight:700;font-size:13px;color:#1a1917;margin-bottom:8px;">
        Add these items manually:
      </div>
      <ul style="margin:0;padding:0 0 0 16px;display:flex;flex-direction:column;gap:3px;">
        ${items.map(it => `<li>${it.qty > 1 ? `${it.qty}× ` : ""}${it.name}</li>`).join("")}
      </ul>
      <div style="margin-top:12px;font-size:11px;color:#888;">
        ⚙ F12 → Network → chercher la requête PATCH /api/bff/trolley/…
      </div>
    `;
  } else {
    doneEl.style.color = errors > 0 ? "#d97706" : "#e01a22";
    doneEl.innerHTML = `✓ ${successes} item${successes > 1 ? "s" : ""} added —
      <a href="/checkout/cart" style="color:inherit;font-weight:700;text-decoration:underline;"
         onclick="document.getElementById('w2s-overlay').remove()">View Cart →</a>`;
  }
  doneEl.style.display = "block";
}

run().catch(err => console.error("[W2S] coles.js crashed:", err));
