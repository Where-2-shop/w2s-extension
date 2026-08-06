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

// Write-back: si le popup modifie w2s_basket, on met à jour localStorage
// pour que l'app reste en sync (évite que le prochain poll écrase les edits popup)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.w2s_basket) return;
  try {
    localStorage.setItem(BASKET_KEY, JSON.stringify(changes.w2s_basket.newValue ?? []));
  } catch (e) {
    // silently ignore
  }
});

// Sync immédiat + polling
syncBasket();
setInterval(syncBasket, 2000);
