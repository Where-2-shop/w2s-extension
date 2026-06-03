// content/where2shop.js — injecté sur l'app Where2Shop
// Synchronise le panier (localStorage) vers chrome.storage.local toutes les 2s

const BASKET_KEY = "basket_v1";

function syncBasket() {
  try {
    const raw = localStorage.getItem(BASKET_KEY);
    const basket = raw ? JSON.parse(raw) : [];
    chrome.storage.local.set({ w2s_basket: basket });
  } catch (e) {
    // silently ignore
  }
}

// Sync immédiat + polling
syncBasket();
setInterval(syncBasket, 2000);
