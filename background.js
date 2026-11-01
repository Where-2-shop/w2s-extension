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

// La charge utile arrive notamment de la page where2shop.com.au via le pont de
// content/where2shop.js : tout script exécuté sur cette page peut l'émettre.
// On ne laisse donc passer vers les API Coles/Woolworths que des valeurs au
// format attendu (identifiant numérique, quantité entière bornée, nom texte).
const MAX_ITEMS = 200;
const MAX_QTY = 99;

function cleanQty(q) {
  const n = Math.trunc(Number(q));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_QTY);
}

function cleanName(n) {
  return typeof n === "string" ? n.slice(0, 300) : "";
}

const isObj = it => !!it && typeof it === "object";
const validId = it => /^\d{1,12}$/.test(String(it.product_id));

function cleanItems(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, MAX_ITEMS)
    .filter(it => isObj(it) && validId(it))
    .map(it => ({
      product_id: String(it.product_id),
      name: cleanName(it.name),
      qty: cleanQty(it.qty),
      substituted: it.substituted === true,
    }));
}

function cleanMissing(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, MAX_ITEMS)
    .filter(isObj)
    .map(it => ({ name: cleanName(it.name), qty: cleanQty(it.qty) }));
}

// Le script de contenu ne survit pas à la navigation qui suit ; c'est le
// contenu de pending_cart, lu au chargement de la page marchande, qui porte
// l'ordre. 10 min de péremption côté coles.js / woolworths.js.
async function openStore({ store, items, missingItems }) {
  // hasOwn : "__proto__" ou "constructor" ne doivent pas passer pour un magasin.
  if (typeof store !== "string" || !Object.prototype.hasOwnProperty.call(STORE_URLS, store)) {
    return { ok: false, reason: "no_url" };
  }
  const url = STORE_URLS[store];

  await chrome.storage.local.set({
    pending_cart: {
      store,
      items: cleanItems(items),
      // Un article à l'identifiant invalide n'est pas ajouté au panier, mais il
      // ne doit pas disparaître pour autant : il rejoint la liste « non ajoutés ».
      missingItems: cleanMissing([
        ...(Array.isArray(items) ? items.slice(0, MAX_ITEMS).filter(it => isObj(it) && !validId(it)) : []),
        ...(Array.isArray(missingItems) ? missingItems : []),
      ]),
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
