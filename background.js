// background.js — service worker
// Reçoit l'ordre d'ouvrir le store et stocke les items à ajouter au panier

const STORE_URLS = {
  woolworths: "https://www.woolworths.com.au/shop/browse/fruit-veg",
  coles:      "https://www.coles.com.au/browse/fruit-vegetables",
  aldi:       "https://www.aldi.com.au/products",
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "OPEN_STORE") {
    const { store, items } = msg;
    // Stocke les items à ajouter, le content script les lira
    chrome.storage.local.set({ pending_cart: { store, items, ts: Date.now() } }, () => {
      chrome.tabs.create({ url: STORE_URLS[store] });
    });
    sendResponse({ ok: true });
  }
  return true;
});
