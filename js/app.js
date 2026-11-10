/* ==========================================================================
   Réception chantier – Lampadaires solaires
   Application 100 % locale (aucun serveur) : fiches stockées dans le navigateur
   (IndexedDB), export/import JSON, PDF généré côté client.
   ========================================================================== */

/* ---------- CONFIGURATION (à modifier librement) ---------- */
const CONFIG = {
  titrePdf: "PV – Points non conformes (Réserves)",
  titrePdfSans: "PV de réception – Sans réserve",
  poseurs: ["ELECTROMONTAGE", "SPIE", "BOUYGUES", "INEO", "MAC²"],
  controleurs: ["Tony Diniz", "Quentin Gobbato", "Virgil Delbrel"],
  categories: ["Lanterne / LED", "Mât / Crosse", "Fondation / Massif", "Batterie", "Panneau solaire", "Câblage / Raccordement", "Aplomb / Orientation", "Propreté / Finitions", "Autre"],
  gravites: ["Mineure", "Majeure", "Bloquante"],
  photoMaxPx: 2048,      // taille max des photos conservées (côté le plus long) : c'est celle envoyée sur Drive
  photoQualite: 0.85,    // qualité JPEG
  pdfPhotoPx: 900,       // taille des photos intégrées au PDF (garde le PDF léger)

  /* Texte du PV « Pas de réserves ». Variables : {controleur} {poseur} {commune} {projet} {adresse} {date} */
  texteSansReserve: [
    "Je soussigné(e) {controleur}, en ma qualité de Chargé de projet - Éclairage public et efficacité énergétique pour Fonroche Lighting, atteste avoir procédé, le {date}, à la réception des travaux d’installation de lampadaires solaires réalisés par l’entreprise {poseur} sur le chantier désigné ci-dessus.",
    "À l’issue de cette visite de chantier, aucune non-conformité n’a été relevée. Les travaux contrôlés sont conformes aux exigences attendues.",
    "En conséquence, le chantier est réceptionné sans réserve.",
    "Fait à {commune}, le {date},",
  ],

  /* Google Drive : colle ici l'ID client OAuth (voir README). Laisser vide pour désactiver. */
  googleClientId: "185689198095-f4brt5lu6i1lmt676qf5uq6ima6oark3.apps.googleusercontent.com",
  driveRootFolder: "FL One Check – Photos",
  driveLinkInPdf: false, // true = ajoute dans le PDF un lien vers le dossier Drive (visible uniquement par les personnes ayant accès au dossier)
};

/* ---------- Utilitaires ---------- */
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => new Date().toISOString().slice(0, 10);
const clone = (o) => JSON.parse(JSON.stringify(o));

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ---------- Stockage IndexedDB ---------- */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("fl-one-check", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("sheets", { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction("sheets", mode);
      const out = fn(t.objectStore("sheets"));
      t.oncomplete = () => res(out && out.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    all: () => tx("readonly", (s) => s.getAll()),
    put: (v) => tx("readwrite", (s) => s.put(v)),
    del: (id) => tx("readwrite", (s) => s.delete(id)),
  };
})();

/* ---------- Modèle ---------- */
function newSheet() {
  return {
    id: uid(), projet: "", commune: "", adresse: "", date: today(),
    poseurSel: "", poseurNom: "", chef: "", controleurSel: "", controleurNom: "",
    points: [], signatures: { controleur: "", entreprise: "", client: "" },
    drive: null, // { folderId, folderUrl, files: { empreinte_photo: idFichierDrive } }
    updated: Date.now(),
  };
}
function newPoint() {
  return { id: uid(), nb: "", obs: "", categorie: "", gravite: "", lat: "", lng: "", reprise: today(), photos: [] };
}
const poseurLabel = (s) => (s.poseurSel === "__autre" ? s.poseurNom : s.poseurSel) || "";
const controleurLabel = (s) => (s.controleurSel === "__autre" ? s.controleurNom : s.controleurSel) || "";

let sheets = [];
let cur = newSheet();
let dirty = false;

/* ---------- Sauvegarde ---------- */
let saveTimer;
function touch() {
  dirty = true;
  cur.updated = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 700);
}
async function saveNow(showToast = false) {
  clearTimeout(saveTimer);
  try {
    await DB.put(cur);
    dirty = false;
    sheets = await DB.all();
    renderList();
    if (showToast) toast("Fiche sauvegardée ✔");
  } catch (e) {
    console.error(e);
    toast("⚠️ Sauvegarde impossible (stockage plein ou bloqué)");
  }
}

/* ---------- Liste des fiches ---------- */
function sheetTitle(s) {
  const t = [s.commune, s.projet].filter(Boolean).join(" – ");
  return t || "Fiche sans titre";
}
function renderList() {
  const ul = $("#fichesList");
  ul.replaceChildren();
  const list = [...sheets].sort((a, b) => b.updated - a.updated);
  $("#fichesCount").textContent = list.length;
  if (!list.length) ul.append(el("li", { class: "empty" }, "Aucune fiche enregistrée pour l’instant."));
  for (const s of list) {
    const meta = [s.date, poseurLabel(s), `${s.points.length} point(s)`].filter(Boolean).join(" · ");
    ul.append(el("li", { class: s.id === cur.id ? "active" : "", onclick: () => openSheet(s.id) },
      el("div", {}, el("strong", {}, sheetTitle(s)), el("div", { class: "meta" }, meta))));
  }
}
async function openSheet(id) {
  if (dirty) await saveNow();
  const s = sheets.find((x) => x.id === id);
  if (!s) return;
  cur = clone(s);
  renderAll();
}

/* ---------- Formulaire infos chantier ---------- */
function fillSelect(sel, items, current) {
  sel.replaceChildren(el("option", { value: "" }, "— Sélectionner —"));
  for (const it of items) sel.append(el("option", { value: it }, it));
  sel.append(el("option", { value: "__autre" }, "Autre…"));
  sel.value = items.includes(current) || current === "__autre" ? current : "";
}
function renderInfos() {
  for (const k of ["projet", "commune", "adresse", "date", "chef", "poseurNom", "controleurNom"]) $("#" + k).value = cur[k] || "";
  fillSelect($("#poseurSel"), CONFIG.poseurs, cur.poseurSel);
  fillSelect($("#controleurSel"), CONFIG.controleurs, cur.controleurSel);
  $("#poseurNomWrap").hidden = cur.poseurSel !== "__autre";
  $("#controleurNomWrap").hidden = cur.controleurSel !== "__autre";
}
function bindInfos() {
  for (const k of ["projet", "commune", "adresse", "date", "chef", "poseurNom", "controleurNom"]) {
    $("#" + k).addEventListener("input", (e) => { cur[k] = e.target.value; touch(); renderSynthese(); });
  }
  $("#poseurSel").addEventListener("change", (e) => {
    cur.poseurSel = e.target.value;
    $("#poseurNomWrap").hidden = cur.poseurSel !== "__autre";
    touch();
  });
  $("#controleurSel").addEventListener("change", (e) => {
    cur.controleurSel = e.target.value;
    $("#controleurNomWrap").hidden = cur.controleurSel !== "__autre";
    touch();
  });
}

/* ---------- Points non conformes ---------- */
function renderPoints() {
  const box = $("#points");
  box.replaceChildren();
  if (!cur.points.length) box.append(el("p", { class: "hint" }, "Aucun point non conforme. Utilise « Ajouter un point non conforme »."));
  cur.points.forEach((p, i) => box.append(pointCard(p, i)));
}

function pointCard(p, i) {
  const upd = (k) => (e) => { p[k] = e.target.value; touch(); renderSynthese(); };
  const opt = (items, v) => [el("option", { value: "" }, "—"), ...items.map((x) => el("option", { value: x, selected: x === v }, x))];

  const photosBox = el("div", { class: "photos" });
  const drawPhotos = () => {
    photosBox.replaceChildren();
    p.photos.forEach((src, pi) => photosBox.append(
      el("div", { class: "photo" },
        el("img", { src, alt: "Photo " + (pi + 1) }),
        el("button", { type: "button", title: "Supprimer la photo", onclick: () => { p.photos.splice(pi, 1); drawPhotos(); touch(); renderSynthese(); } }, "✕"))));
  };
  drawPhotos();

  const fileGallery = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
  const fileCamera = el("input", { type: "file", accept: "image/*", capture: "environment", hidden: true });
  const onFiles = async (e) => {
    for (const f of e.target.files) {
      try { p.photos.push(await compressImage(f)); } catch { toast("Image illisible : " + f.name); }
    }
    e.target.value = "";
    drawPhotos(); touch(); renderSynthese();
  };
  fileGallery.addEventListener("change", onFiles);
  fileCamera.addEventListener("change", onFiles);

  const latlng = el("input", { type: "text", inputmode: "decimal", placeholder: "ex. 44.12278, 0.65839", value: p.lat !== "" && p.lng !== "" ? `${p.lat}, ${p.lng}` : "" });
  latlng.addEventListener("input", () => {
    const m = latlng.value.match(/(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)/);
    if (m) { p.lat = m[1].replace(",", "."); p.lng = m[2].replace(",", "."); } else { p.lat = ""; p.lng = ""; }
    touch(); renderSynthese();
  });
  const gpsBtn = el("button", { type: "button", onclick: () => {
    if (!navigator.geolocation) return toast("Géolocalisation non disponible");
    gpsBtn.disabled = true;
    navigator.geolocation.getCurrentPosition((pos) => {
      p.lat = pos.coords.latitude.toFixed(6);
      p.lng = pos.coords.longitude.toFixed(6);
      latlng.value = `${p.lat}, ${p.lng}`;
      gpsBtn.disabled = false; touch(); renderSynthese(); toast("Position enregistrée 📍");
    }, (err) => { gpsBtn.disabled = false; toast("Position refusée ou indisponible"); }, { enableHighAccuracy: true, timeout: 15000 });
  } }, "📍 Ma position");

  const title = el("strong", {}, `Point n°${i + 1}${p.nb ? " – " + p.nb : ""}`);
  const nbInput = el("input", { type: "text", value: p.nb, placeholder: "ex. Lampadaire 12 / Goulens" });
  nbInput.addEventListener("input", (e) => { p.nb = e.target.value; title.textContent = `Point n°${i + 1}${p.nb ? " – " + p.nb : ""}`; touch(); renderSynthese(); });

  const obs = el("textarea", { placeholder: "Décris la non-conformité…" }, p.obs);
  obs.addEventListener("input", upd("obs"));
  const cat = el("select", {}, ...opt(CONFIG.categories, p.categorie)); cat.addEventListener("change", upd("categorie"));
  const gra = el("select", {}, ...opt(CONFIG.gravites, p.gravite)); gra.addEventListener("change", upd("gravite"));
  const rep = el("input", { type: "date", value: p.reprise }); rep.addEventListener("input", upd("reprise"));

  return el("article", { class: "point" },
    el("div", { class: "point-head" }, title,
      el("button", { type: "button", class: "small danger", onclick: () => {
        if (!confirm("Supprimer ce point non conforme ?")) return;
        cur.points.splice(i, 1); touch(); renderPoints(); renderSynthese();
      } }, "🗑️ Supprimer")),
    el("div", { class: "grid" },
      el("label", {}, "N° / Nom du point", nbInput),
      el("label", {}, "Catégorie", cat),
      el("label", {}, "Gravité", gra),
      el("label", {}, "Date de reprise", rep),
      el("label", { class: "full" }, "Non-conformité / Observation", obs),
      el("label", { class: "full" }, "Localisation GPS (lat, long)", el("div", { class: "gps-row" }, latlng, gpsBtn)),
      el("div", { class: "full" }, el("div", { class: "btns" },
        el("button", { type: "button", onclick: () => fileCamera.click() }, "📷 Prendre une photo"),
        el("button", { type: "button", onclick: () => fileGallery.click() }, "🖼️ Ajouter des photos"),
        fileCamera, fileGallery), photosBox)));
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, CONFIG.photoMaxPx / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", CONFIG.photoQualite));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image")); };
    img.src = url;
  });
}

/* ---------- Synthèse ---------- */
function renderSynthese() {
  const box = $("#synthese");
  box.replaceChildren();
  const pts = cur.points;
  const stat = (n, label) => el("div", { class: "stat" }, el("b", {}, String(n)), el("span", {}, label));
  box.append(
    stat(pts.length, "point(s) non conforme(s)"),
    stat(pts.reduce((a, p) => a + p.photos.length, 0), "photo(s)"),
    stat(pts.filter((p) => p.lat !== "" && p.lng !== "").length, "point(s) géolocalisé(s)"),
    stat(pts.filter((p) => !p.obs.trim()).length, "sans observation"),
  );
  const count = (key, items) => {
    const m = new Map();
    for (const p of pts) if (p[key]) m.set(p[key], (m.get(p[key]) || 0) + 1);
    return [...m.entries()];
  };
  for (const [key, label] of [["gravite", "Par gravité"], ["categorie", "Par catégorie"]]) {
    const rows = count(key);
    if (rows.length) box.append(el("div", { class: "stat wide" }, el("span", {}, label), el("ul", {}, rows.map(([k, n]) => el("li", {}, `${k} : ${n}`)))));
  }
}

/* ---------- Signatures ---------- */
function setupSignatures() {
  document.querySelectorAll(".sig").forEach((box) => {
    const key = box.dataset.key;
    const cv = $("canvas", box);
    const ctx = cv.getContext("2d");
    let drawing = false, last = null;

    const resize = () => {
      const r = cv.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const data = cur.signatures[key];
      cv.width = Math.round(r.width * ratio);
      cv.height = Math.round(r.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111";
      if (data) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, r.width, r.height); im.src = data; }
    };
    box._resize = resize;

    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener("pointerdown", (e) => { drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(last.x, last.y, 1, 0, 6.3); ctx.stroke(); e.preventDefault(); });
    cv.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p; e.preventDefault();
    });
    const end = () => { if (!drawing) return; drawing = false; cur.signatures[key] = cv.toDataURL("image/png"); touch(); };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    $(".clear", box).addEventListener("click", () => {
      const r = cv.getBoundingClientRect();
      ctx.clearRect(0, 0, r.width, r.height);
      cur.signatures[key] = ""; touch();
    });
  });
  window.addEventListener("resize", () => document.querySelectorAll(".sig").forEach((b) => b._resize()));
}
const redrawSignatures = () => document.querySelectorAll(".sig").forEach((b) => b._resize());

/* ---------- Rendu global ---------- */
function renderAll() {
  renderInfos();
  renderPoints();
  renderSynthese();
  renderList();
  redrawSignatures();
}

/* ---------- Actions fiche ---------- */
async function actionNew() {
  if (dirty) await saveNow();
  cur = newSheet();
  renderAll();
  toast("Nouvelle fiche");
}
async function actionDup() {
  if (dirty) await saveNow();
  const c = clone(cur);
  c.id = uid();
  c.drive = null;
  c.projet = c.projet ? c.projet + " (copie)" : "";
  c.points.forEach((p) => (p.id = uid()));
  c.updated = Date.now();
  cur = c;
  await saveNow();
  renderAll();
  toast("Fiche dupliquée");
}
async function actionDelete() {
  if (!confirm("Supprimer définitivement cette fiche ?")) return;
  clearTimeout(saveTimer);
  await DB.del(cur.id);
  sheets = await DB.all();
  cur = sheets.length ? clone([...sheets].sort((a, b) => b.updated - a.updated)[0]) : newSheet();
  dirty = false;
  renderAll();
  toast("Fiche supprimée");
}
function actionClear() {
  if (!confirm("Vider la fiche courante (infos, points, signatures) ?")) return;
  const id = cur.id;
  cur = newSheet(); cur.id = id;
  touch(); renderAll();
}

const fileSafe = (s) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
function download(blob, name) {
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function actionExportJson() {
  const blob = new Blob([JSON.stringify({ app: "fl-one-check", version: 1, sheets: [cur] }, null, 1)], { type: "application/json" });
  download(blob, fileSafe(`Fiche ${sheetTitle(cur)} ${cur.date}`) + ".json");
}
async function actionImportJson(file) {
  try {
    const data = JSON.parse(await file.text());
    const arr = Array.isArray(data) ? data : data.sheets || [data];
    let n = 0;
    for (const raw of arr) {
      if (!raw || typeof raw !== "object") continue;
      const s = Object.assign(newSheet(), raw, { id: uid(), updated: Date.now() });
      s.points = (Array.isArray(raw.points) ? raw.points : []).map((p) => Object.assign(newPoint(), p, { id: uid(), photos: Array.isArray(p.photos) ? p.photos : [] }));
      s.signatures = Object.assign({ controleur: "", entreprise: "", client: "" }, raw.signatures || {});
      await DB.put(s); cur = s; n++;
    }
    if (!n) throw new Error("vide");
    sheets = await DB.all();
    dirty = false;
    renderAll();
    toast(`${n} fiche(s) importée(s) ✔`);
  } catch (e) {
    console.error(e);
    toast("⚠️ Fichier JSON invalide");
  }
}

/* ---------- PDF ---------- */
/* Réduit une photo pour le PDF (l'original haute résolution reste dans la fiche / sur Drive) */
function shrinkImage(src, maxPx) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => {
      const k = Math.min(1, maxPx / Math.max(i.naturalWidth, i.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(i.naturalWidth * k); c.height = Math.round(i.naturalHeight * k);
      c.getContext("2d").drawImage(i, 0, 0, c.width, c.height);
      res({ src: c.toDataURL("image/jpeg", 0.8), w: c.width, h: c.height });
    };
    i.onerror = () => res({ src, w: 4, h: 3 });
    i.src = src;
  });
}
const frDate = (d) => (/^\d{4}-\d\d-\d\d$/.test(d || "") ? d.split("-").reverse().join("/") : d || "");

/* mode : "reserves" (tableau des points non conformes) ou "sans" (PV de réception sans réserve) */
async function buildPdf(mode = "reserves", opts = {}) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PW = 210, PH = 297, M = 12, CW = PW - 2 * M;
  const ORANGE = [232, 128, 26], INK = [30, 36, 48], GREY = [110, 117, 128];
  let y = M;

  /* En-tête */
  const header = () => {
    let hh = 26;
    try { doc.addImage(window.LOGO_DATA, "PNG", M, y, 36, 36 * 345 / 480); hh = 36 * 345 / 480; } catch {}
    const x = M + 44;
    doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(14);
    doc.text(mode === "sans" ? CONFIG.titrePdfSans : CONFIG.titrePdf, x, y + 7);
    const line = (label, value, yy, x0 = x) => {
      doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...GREY);
      doc.text(label, x0, yy);
      const w = doc.getTextWidth(label + " ");
      doc.setFont("helvetica", "bold").setTextColor(...INK);
      doc.text(value || "—", x0 + w, yy);
      return x0 + w + doc.getTextWidth((value || "—") + "  ");
    };
    line("Commune :", cur.commune, y + 13);
    line("Date :", cur.date, y + 13, x + 70);
    line("Projet :", cur.projet, y + 18);
    if (cur.adresse) line("Adresse / Zone :", cur.adresse, y + 23);
    const yy = y + (cur.adresse ? 28 : 23);
    let nx = line("Poseur :", poseurLabel(cur), yy);
    if (cur.chef) nx = line("Chef d’équipe :", cur.chef, yy + 5);
    line("Contrôleur :", controleurLabel(cur), cur.chef ? yy + 10 : yy, cur.chef ? x : nx + 4);
    y += Math.max(hh, cur.chef ? 42 : 36) + 2;
    doc.setDrawColor(...INK).setLineWidth(0.5).line(M, y, PW - M, y);
    y += 6;
  };

  /* Tableau */
  const cols = [
    { k: "#", w: 8 }, { k: "Nb point", w: 26 }, { k: "Non-conformité / Observation", w: 54 },
    { k: "Photos", w: 38 }, { k: "Localisation", w: 30 }, { k: "Date de reprise", w: 22 },
  ];
  const scale = CW / cols.reduce((a, c) => a + c.w, 0);
  cols.forEach((c) => (c.w *= scale));

  const tableHead = () => {
    const h = 8;
    doc.setFillColor(243, 244, 246).rect(M, y, CW, h, "F");
    doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...INK);
    let x = M;
    for (const c of cols) { doc.text(c.k, x + 2, y + 5.3, { maxWidth: c.w - 3 }); x += c.w; }
    y += h + 1;
  };

  /* Corps du PV « sans réserve » */
  const drawSansReserve = () => {
    doc.setFillColor(46, 125, 50).roundedRect(M, y, CW, 14, 2, 2, "F");
    doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(255, 255, 255)
      .text("CHANTIER RÉCEPTIONNÉ – AUCUNE RÉSERVE", PW / 2, y + 9, { align: "center" });
    y += 24;
    const dots = "………………";
    const vars = {
      controleur: controleurLabel(cur) || dots, poseur: poseurLabel(cur) || dots,
      commune: cur.commune || dots, projet: cur.projet || "", adresse: cur.adresse || "",
      date: frDate(cur.date) || dots,
    };
    const fill = (t) => t.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    doc.setFont("helvetica", "normal").setFontSize(11).setTextColor(...INK);
    for (const para of CONFIG.texteSansReserve) {
      const lines = doc.splitTextToSize(fill(para), CW);
      doc.text(lines, M, y);
      y += lines.length * 5.5 + 5;
    }
    y += 2;
  };

  header();
  const points = mode === "sans" ? [] : cur.points;
  if (mode === "sans") drawSansReserve();
  else tableHead();

  if (mode !== "sans" && !points.length) {
    doc.setFont("helvetica", "italic").setFontSize(10).setTextColor(...GREY).text("Aucun point non conforme.", M + 2, y + 6);
    y += 12;
  }

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    /* Mise en page des cellules */
    const pad = 2;
    doc.setFont("helvetica", "bold").setFontSize(9);
    const obsLines = doc.splitTextToSize(p.obs || "—", cols[2].w - 2 * pad);
    const metaBits = [p.categorie, p.gravite && "Gravité : " + p.gravite].filter(Boolean);
    doc.setFont("helvetica", "normal").setFontSize(8);
    const metaLines = metaBits.flatMap((t) => doc.splitTextToSize(t, cols[2].w - 2 * pad));
    const nbLines = doc.splitTextToSize(p.nb || "—", cols[1].w - 2 * pad);
    const gps = p.lat !== "" && p.lng !== "" ? doc.splitTextToSize(`${p.lat} · ${p.lng}`, cols[4].w - 2 * pad) : ["—"];

    const imgW = cols[3].w - 2 * pad;
    const imgs = [];
    for (const src of p.photos) {
      const s = await shrinkImage(src, CONFIG.pdfPhotoPx);
      const h = Math.min(imgW * s.h / s.w, 40);
      imgs.push({ src: s.src, w: Math.min(imgW, h * s.w / s.h), h });
    }
    const photosH = imgs.reduce((a, im) => a + im.h + 2, 0);
    const textH = obsLines.length * 4 + (metaLines.length ? metaLines.length * 3.6 + 2 : 0) + 2 * pad;
    const rowH = Math.max(14, textH, photosH + pad, nbLines.length * 4 + 2 * pad);

    /* Saut de page (une ligne photo trop haute est tout de même posée sur une page neuve) */
    if (y + rowH > PH - M - 8 && y > 60) {
      doc.addPage(); y = M; tableHead();
    }

    /* Fond, bordures */
    doc.setDrawColor(226, 229, 234).setLineWidth(0.2);
    doc.setFillColor(255, 227, 227).rect(M + cols[0].w + cols[1].w, y, cols[2].w, rowH, "F");
    let x = M;
    for (const c of cols) { doc.rect(x, y, c.w, rowH); x += c.w; }

    /* Contenu */
    x = M;
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...INK).text(String(i + 1), x + pad, y + 5);
    x += cols[0].w;
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...INK).text(nbLines, x + pad, y + 5);
    x += cols[1].w;
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(158, 28, 28).text(obsLines, x + pad, y + 5);
    if (metaLines.length) {
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...GREY).text(metaLines, x + pad, y + 5 + obsLines.length * 4 + 2.5);
    }
    x += cols[2].w;
    let iy = y + pad;
    for (const im of imgs) {
      try { doc.addImage(im.src, "JPEG", x + pad, iy, im.w, im.h); } catch {}
      iy += im.h + 2;
    }
    x += cols[3].w;
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...GREY).text(gps, x + pad, y + 6);
    x += cols[4].w;
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...INK).text(p.reprise || "—", x + pad, y + 5);
    y += rowH + 1.5;
  }

  /* Lien vers les photos haute résolution (optionnel) */
  if (mode !== "sans" && opts.driveUrl && CONFIG.driveLinkInPdf) {
    if (y + 12 > PH - M) { doc.addPage(); y = M; }
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(0, 102, 204);
    doc.textWithLink("Photos haute résolution : ouvrir le dossier Google Drive", M, y + 5, { url: opts.driveUrl });
    y += 8;
  }

  /* Signatures */
  const sigH = 56;
  if (y + sigH + 14 > PH - M) { doc.addPage(); y = M; }
  y += 4;
  doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(...INK).text("Signatures", M, y + 5);
  y += 10;
  const bw = CW / 3;
  [["Contrôleur", "controleur"], ["Entreprise", "entreprise"], ["Client", "client"]].forEach(([label, key], i) => {
    const bx = M + i * bw;
    doc.setDrawColor(226, 229, 234).setLineWidth(0.2).rect(bx, y, bw, sigH);
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...INK).text(label, bx + 2.5, y + 5);
    doc.setDrawColor(20, 20, 20).setLineWidth(0.6).roundedRect(bx + 2.5, y + 8, bw - 5, sigH - 18, 3, 3);
    const sig = cur.signatures[key];
    if (sig) { try { doc.addImage(sig, "PNG", bx + 3.5, y + 9, bw - 7, sigH - 20); } catch {} }
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...GREY).text("Nom / Date / Signature", bx + bw / 2, y + sigH - 4, { align: "center" });
  });

  /* Pied de page */
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...GREY);
    doc.text(`Page ${i} / ${n}`, PW - M, PH - 6, { align: "right" });
  }
  return doc.output("blob");
}

const pdfName = (mode = "reserves") =>
  fileSafe(`${mode === "sans" ? "PV réception sans réserve" : "PV"} - ${poseurLabel(cur) || "Poseur"} - ${cur.commune || "Commune"}${cur.projet ? " (" + cur.projet + ")" : ""}`) + ".pdf";

async function withBusy(fn, label = "Génération du PDF…") {
  $(".busy-box").textContent = label;
  $("#busy").hidden = false;
  await new Promise((r) => setTimeout(r, 30));
  try { return await fn(); } finally { $("#busy").hidden = true; }
}

/* ---------- Google Drive (envoi des photos en haute résolution) ---------- */
/* Portée « drive.file » : l'application ne voit et ne modifie QUE les fichiers qu'elle a elle-même créés. */
const driveEnabled = () => !!CONFIG.googleClientId;
let gisPromise = null, driveToken = null, driveTokenExp = 0;

function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((res, rej) => {
    const s = el("script", { src: "https://accounts.google.com/gsi/client", async: true });
    s.onload = res;
    s.onerror = () => { gisPromise = null; rej(new Error("connexion à Google impossible (réseau ?)")); };
    document.head.append(s);
  });
  return gisPromise;
}
async function getDriveToken() {
  if (driveToken && Date.now() < driveTokenExp - 60000) return driveToken;
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleClientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (r) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        driveToken = r.access_token;
        driveTokenExp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
        resolve(driveToken);
      },
      error_callback: (e) => reject(new Error(e && e.type === "popup_closed" ? "connexion Google annulée" : "fenêtre de connexion Google bloquée ou fermée")),
    });
    client.requestAccessToken();
  });
}
async function driveApi(path, token, init = {}) {
  const r = await fetch("https://www.googleapis.com" + path, { ...init, headers: { Authorization: "Bearer " + token, ...(init.headers || {}) } });
  if (!r.ok) { const e = new Error("erreur Google Drive " + r.status); e.status = r.status; throw e; }
  return r.json();
}
const qEsc = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
async function driveFolder(token, name, parentId) {
  const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${qEsc(name)}'` + (parentId ? ` and '${parentId}' in parents` : "");
  const found = await driveApi(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, token);
  if (found.files && found.files.length) return found.files[0].id;
  const made = await driveApi("/drive/v3/files?fields=id", token, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}) }),
  });
  return made.id;
}
async function driveUpload(token, folderId, name, dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const b = "flone" + uid();
  const meta = JSON.stringify({ name, parents: [folderId], mimeType: "image/jpeg" });
  const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: image/jpeg\r\n\r\n`, blob, `\r\n--${b}--`]);
  return driveApi("/upload/drive/v3/files?uploadType=multipart&fields=id", token, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body });
}
function hashStr(s) { // empreinte courte pour savoir quelle photo est déjà sur Drive
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

async function uploadPhotosToDrive(token) {
  const all = [];
  cur.points.forEach((p, i) => p.photos.forEach((src, k) =>
    all.push({ src, name: fileSafe(`Point ${String(i + 1).padStart(2, "0")}${p.nb ? " - " + p.nb : ""} - photo ${k + 1}`) + ".jpg" })));
  const busy = $(".busy-box");
  const run = async () => {
    if (!cur.drive) cur.drive = { folderId: "", folderUrl: "", files: {} };
    if (!cur.drive.folderId) {
      const root = await driveFolder(token, CONFIG.driveRootFolder, null);
      const sub = fileSafe([cur.date, cur.commune, cur.projet].filter(Boolean).join(" - ")) || "Chantier " + cur.id;
      cur.drive.folderId = await driveFolder(token, sub, root);
      cur.drive.folderUrl = "https://drive.google.com/drive/folders/" + cur.drive.folderId;
    }
    let sent = 0;
    for (let i = 0; i < all.length; i++) {
      const h = hashStr(all[i].src);
      if (cur.drive.files[h]) continue; // déjà envoyée lors d'un export précédent
      busy.textContent = `Envoi des photos sur Google Drive… ${i + 1}/${all.length}`;
      const r = await driveUpload(token, cur.drive.folderId, all[i].name, all[i].src);
      cur.drive.files[h] = r.id; sent++;
    }
    return sent;
  };
  let sent;
  try { sent = await run(); }
  catch (e) { // dossier supprimé depuis : on repart sur un dossier neuf
    if (e.status === 404 && cur.drive) { cur.drive = null; sent = await run(); } else throw e;
  }
  touch();
  await saveNow();
  return { folderUrl: cur.drive.folderUrl, sent, total: all.length };
}

/* Ne lève jamais d'erreur : si Drive échoue, le PDF est quand même généré. */
async function exportToDrive() {
  if (!driveEnabled() || !$("#driveOpt").checked) return null;
  if (!cur.points.some((p) => p.photos.length)) return null;
  try {
    const token = await getDriveToken(); // ouvre la fenêtre Google tout de suite (action de l'utilisateur)
    const r = await withBusy(() => uploadPhotosToDrive(token), "Envoi des photos sur Google Drive…");
    toast(r.sent ? `📁 ${r.sent} photo(s) envoyée(s) sur Google Drive` : "📁 Photos déjà présentes sur Google Drive");
    return r;
  } catch (e) {
    console.error(e);
    toast("⚠️ Google Drive : " + (e.message || "échec") + " — PDF généré sans envoi");
    return null;
  }
}

async function actionPdf() {
  try {
    const drive = await exportToDrive();
    const blob = await withBusy(() => buildPdf("reserves", { driveUrl: drive && drive.folderUrl }));
    download(blob, pdfName());
  } catch (e) { console.error(e); toast("⚠️ Erreur lors de la génération du PDF"); }
}
async function actionNoReserve() {
  if (cur.points.length) {
    alert("Cette fiche contient des points non conformes : un PV « sans réserve » ne peut pas en contenir.\n\nSupprime-les, ou utilise « Exporter PDF » pour le PV avec réserves.");
    return;
  }
  if (!cur.commune.trim() && !cur.projet.trim() && !confirm("Ni la commune ni le projet ne sont renseignés. Générer quand même le PV ?")) return;
  try {
    const blob = await withBusy(() => buildPdf("sans"));
    download(blob, pdfName("sans"));
  } catch (e) { console.error(e); toast("⚠️ Erreur lors de la génération du PDF"); }
}
async function actionShare() {
  try {
    const drive = await exportToDrive();
    const blob = await withBusy(() => buildPdf("reserves", { driveUrl: drive && drive.folderUrl }));
    const file = new File([blob], pdfName(), { type: "application/pdf" });
    const text = `PV – Points non conformes\n${cur.commune || ""} ${cur.projet ? "– " + cur.projet : ""}\nDate : ${cur.date}\n${cur.points.length} point(s) non conforme(s).`;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: pdfName(), text });
      return;
    }
    /* Repli (ordinateur) : téléchargement du PDF puis ouverture d'un mail */
    download(blob, pdfName());
    toast("PDF téléchargé : joins-le à ton mail ou à WhatsApp");
    setTimeout(() => {
      location.href = `mailto:?subject=${encodeURIComponent(pdfName().replace(/\.pdf$/, ""))}&body=${encodeURIComponent(text + "\n\n(PDF en pièce jointe)")}`;
    }, 900);
  } catch (e) {
    if (e && e.name === "AbortError") return;
    console.error(e); toast("⚠️ Partage impossible");
  }
}

/* Case « Envoyer les photos sur Google Drive » (mémorisée sur l'appareil) */
function initDriveOption() {
  const box = $("#driveBox");
  if (!driveEnabled()) { $("#driveOff").hidden = false; return; }
  box.hidden = false;
  const cb = $("#driveOpt");
  try { cb.checked = localStorage.getItem("fl-drive-opt") !== "0"; } catch { cb.checked = true; }
  cb.addEventListener("change", () => { try { localStorage.setItem("fl-drive-opt", cb.checked ? "1" : "0"); } catch {} });
}

/* ---------- Démarrage ---------- */
async function init() {
  bindInfos();
  setupSignatures();
  $("#btnNew").addEventListener("click", actionNew);
  $("#btnSave").addEventListener("click", () => saveNow(true));
  $("#btnDup").addEventListener("click", actionDup);
  $("#btnDel").addEventListener("click", actionDelete);
  $("#btnExportJson").addEventListener("click", actionExportJson);
  $("#btnImportJson").addEventListener("click", () => $("#fileImport").click());
  $("#fileImport").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) actionImportJson(f); e.target.value = ""; });
  $("#btnAddPoint").addEventListener("click", () => { cur.points.push(newPoint()); touch(); renderPoints(); renderSynthese(); const last = $("#points").lastElementChild; if (last) last.scrollIntoView({ behavior: "smooth", block: "center" }); });
  $("#btnPdf").addEventListener("click", actionPdf);
  $("#btnNoReserve").addEventListener("click", actionNoReserve);
  initDriveOption();
  $("#btnShare").addEventListener("click", actionShare);
  $("#btnClear").addEventListener("click", actionClear);
  window.addEventListener("beforeunload", () => { if (dirty) saveNow(); });

  try {
    sheets = await DB.all();
    if (sheets.length) cur = clone([...sheets].sort((a, b) => b.updated - a.updated)[0]);
  } catch (e) { console.error(e); toast("⚠️ Stockage local indisponible : pense à exporter en JSON"); }
  renderAll();
}
init();
