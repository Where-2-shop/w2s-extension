// background.js — service worker
// Reçoit l'ordre d'ouvrir le store et stocke les items à ajouter au panier

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Woolworths uniquement : Coles est bloqué par Incapsula (tab programmatique),
// Aldi n'a pas de commande en ligne — les deux passent par "Get List" dans le popup.
const STORE_URLS = {
  woolworths: "https://www.woolworths.com.au/shop/browse/fruit-veg",
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "OPEN_STORE") {
    const { store, items } = msg;
    const url = STORE_URLS[store];
    if (!url) { sendResponse({ ok: false, reason: "no_url" }); return true; }
    chrome.storage.local.set({ pending_cart: { store, items, ts: Date.now() } }, () => {
      chrome.tabs.create({ url });
    });
    sendResponse({ ok: true });
  }
  return true;
});
