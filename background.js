// background.js — service worker
// Point d'entrée unique pour « ouvrir un magasin et y déposer le panier ».
//
// Il y avait auparavant trois chemins pour la même action : Woolworths passait
// par ici, tandis que Coles était traité en ligne dans popup.js ET dans
// panel.js, chacun avec sa propre copie du couple storage.set + tabs.create.
// La duplication a coûté ce qu'elle coûte toujours : les deux copies ont
// divergé, et celle du popup a cessé de transmettre missingItems — les articles
// que le magasin ne référence pas disparaissaient donc du récapitulatif « non
// ajoutés », sans que rien ne le signale (constaté le 2026-08-19).
//
// Un commentaire affirmait ici que Coles était bloqué par Incapsula à
// l'ouverture d'onglet programmatique, ce qui justifiait son absence de la
// table. C'était faux : popup.js et panel.js faisaient exactement cet appel et
// le remplissage aboutissait. Le commentaire décrivait une panne inexistante et
// a fait conclure à tort, lors d'un audit, que le remplissage Coles ne marchait
// pas. Il est retiré.
//
// Aldi reste absent : pas de commande en ligne, l'interface propose une liste
// téléchargeable à la place.
const STORE_URLS = {
  woolworths: "https://www.woolworths.com.au/shop/browse/fruit-veg",
  coles: "https://www.coles.com.au/browse/fruit-vegetables",
};

// Le script de contenu ne survit pas à la navigation qui suit ; c'est le
// contenu de pending_cart, lu au chargement de la page marchande, qui porte
// l'ordre. 10 min de péremption côté coles.js / woolworths.js.
async function openStore({ store, items, missingItems }) {
  const url = STORE_URLS[store];
  if (!url) return { ok: false, reason: "no_url" };

  await chrome.storage.local.set({
    pending_cart: {
      store,
      items: items ?? [],
      missingItems: missingItems ?? [],
      ts: Date.now(),
    },
  });
  await chrome.tabs.create({ url });
  return { ok: true };
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "OPEN_STORE") {
    openStore(msg).then(sendResponse, err => {
      console.error("[W2S] openStore failed:", err);
      sendResponse({ ok: false, reason: "error" });
    });
    return true; // réponse asynchrone
  }
  return false;
});
