// popup.js — logique du popup Where2Shop
"use strict";

const API = "https://api.where2shop.crea-dapp.com";

const STORE_LABELS = { coles: "Coles", woolworths: "Woolworths", aldi: "Aldi" };

// ── Helpers ──────────────────────────────────────────────────────────────────
function show(id)   { document.getElementById(id).classList.remove("hidden"); }
function hide(id)   { document.getElementById(id).classList.add("hidden"); }
function showOnly(id) {
  ["view-loading","view-empty","view-basket","view-comparing","view-result"]
    .forEach(v => v === id ? show(v) : hide(v));
}

// ── Render basket ─────────────────────────────────────────────────────────────
function renderBasket(basket) {
  const list = document.getElementById("items-list");
  list.innerHTML = "";
  for (const entry of basket) {
    const p = entry.product;
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `
      <span class="item-qty">${entry.qty}×</span>
      <span class="item-name" title="${p.name}">${p.name}</span>
      ${p.price != null ? `<span class="item-price">$${(p.price * entry.qty).toFixed(2)}</span>` : ""}
      <span class="store-pill store-${p.store}">${STORE_LABELS[p.store]}</span>
    `;
    list.appendChild(row);
  }
}

// ── Render result ─────────────────────────────────────────────────────────────
function renderResult(result, basket) {
  const { totals, items } = result;
  const winner = totals.cheaper;

  // Winner card
  const card = document.getElementById("winner-card");
  card.className = `winner-card ${winner ?? "tie"}`;
  if (winner) {
    card.innerHTML = `
      <div class="winner-label">Best price</div>
      <div class="winner-name ${winner}">${STORE_LABELS[winner]}</div>
      ${totals.savings > 0
        ? `<div class="winner-savings">Save <strong>$${totals.savings.toFixed(2)}</strong> vs next cheapest</div>`
        : ""}
      ${totals.winner_total > 0 && totals.winner_extra > 0
        ? `<div class="winner-savings" style="margin-top:3px;">Full shop: <strong>$${totals.winner_total.toFixed(2)}</strong></div>`
        : ""}
    `;
  } else {
    card.innerHTML = `<div class="winner-label">No clear winner</div>
      <div class="winner-name">Tie</div>`;
  }

  // Store totals
  const totalsEl = document.getElementById("store-totals");
  totalsEl.innerHTML = "";
  const stores = ["coles", "woolworths", "aldi"];
  for (const s of stores) {
    if (!totals[s]) continue;
    const row = document.createElement("div");
    row.className = `total-row ${s === winner ? "winner " + s : ""}`;
    row.innerHTML = `
      <span class="total-store">${STORE_LABELS[s]}${s === winner ? " ✓" : ""}</span>
      <span class="total-amount ${s}">$${totals[s].toFixed(2)}</span>
    `;
    totalsEl.appendChild(row);
  }

  // Shop button
  const shopBtn = document.getElementById("btn-shop");
  if (winner) {
    // Build items to add: products available at winner store, with qty
    const winnerItems = items
      .map(line => {
        const storeData = line[winner];
        if (!storeData?.product) return null;
        return {
          product_id: storeData.product.product_id,
          name:       storeData.product.name,
          qty:        line.qty,
        };
      })
      .filter(Boolean);

    shopBtn.textContent = `Shop at ${STORE_LABELS[winner]} →`;
    shopBtn.className = "btn btn-primary";
    shopBtn.style.background = winner === "coles" ? "#e01a22"
                              : winner === "woolworths" ? "#007837"
                              : "#1a3a6b";
    shopBtn.onclick = () => {
      chrome.runtime.sendMessage({ type: "OPEN_STORE", store: winner, items: winnerItems });
      window.close();
    };
  } else {
    // No winner: let user pick manually
    shopBtn.textContent = "Open Where2Shop";
    shopBtn.onclick = () => {
      chrome.tabs.create({ url: "https://app.where2shop.crea-dapp.com" });
      window.close();
    };
  }

  showOnly("view-result");
}

// ── Compare ───────────────────────────────────────────────────────────────────
async function compare(basket) {
  showOnly("view-comparing");
  try {
    const res = await fetch(`${API}/basket/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: basket.map(e => ({
          product_id: e.product.product_id,
          store:      e.product.store,
          qty:        e.qty,
        })),
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();
    renderResult(result, basket);
  } catch (err) {
    console.error("[W2S] compare error:", err);
    showOnly("view-basket"); // retour panier en cas d'erreur
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  showOnly("view-loading");

  // Lire le panier depuis chrome.storage (synchronisé par le content script)
  const data = await chrome.storage.local.get("w2s_basket");
  const basket = data.w2s_basket ?? [];

  if (!basket.length) {
    showOnly("view-empty");
    document.getElementById("btn-open-w2s").onclick = () => {
      chrome.tabs.create({ url: "https://app.where2shop.crea-dapp.com" });
      window.close();
    };
    return;
  }

  renderBasket(basket);
  showOnly("view-basket");

  document.getElementById("btn-compare").onclick = () => compare(basket);
  document.getElementById("btn-back").onclick = () => {
    showOnly("view-basket");
  };
}

init();
