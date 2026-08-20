// content/where2shop.js — injecté sur l'app Where2Shop
//
// Deux rôles :
//   1. synchroniser le panier (localStorage) vers chrome.storage.local ;
//   2. servir de pont entre la page et l'extension — signaler sa présence, et
//      relayer l'ordre « ouvre ce magasin avec mon panier ».
//
// Le pont existe parce que le site n'avait aucun moyen de parler à l'extension
// sur ordinateur : son bouton « Shop at Coles » émettait OPEN_STORE vers
// window.ReactNativeWebView, le pont de l'application mobile, absent d'un
// navigateur de bureau. Le message ne partait donc nulle part et l'acheteur
// recevait la consigne de recopier sa liste à la main, extension installée ou
// non — alors que le remplissage automatique fonctionnait, à deux clics de là,
// dans le popup (constaté le 2026-08-19).

const BASKET_KEY = "basket_v1";

// ── 1. Synchronisation du panier ──────────────────────────────────────────────
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

// ── 2. Pont page ↔ extension ──────────────────────────────────────────────────
// Le DOM est partagé entre la page et le script de contenu (contrairement aux
// variables JS, qui vivent dans des mondes isolés) : un attribut sur <html> est
// donc le canal le plus simple pour que la page sache que l'extension est là.
document.documentElement.dataset.w2sExtension = chrome.runtime.getManifest().version;

window.addEventListener("message", event => {
  // N'accepter que les messages émis par cette page elle-même : window.message
  // est audible par n'importe quelle iframe.
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.w2s !== "page" || msg.type !== "OPEN_STORE") return;

  chrome.runtime.sendMessage(
    {
      type: "OPEN_STORE",
      store: msg.store,
      items: msg.items ?? [],
      missingItems: msg.missingItems ?? [],
    },
    res => {
      // La page attend une réponse pour savoir si elle doit retomber sur la
      // copie manuelle ; un échec silencieux la laisserait sans rien.
      window.postMessage(
        { w2s: "extension", type: "OPEN_STORE_RESULT", ok: !!(res && res.ok) },
        window.location.origin
      );
    }
  );
});

// Sync immédiat + polling
syncBasket();
setInterval(syncBasket, 2000);
