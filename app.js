import { firebaseConfig } from './firebase-config.js';

const FB_BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
const CATS = ['Mat', 'Strøm', 'Vann', 'Husleie', 'Vask', 'Internett', 'Transport', 'Annet'];
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const monthOf = (ds) => ds.slice(0, 7);
const nf = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (o) => nf.format(o / 100);
const monthDate = (m) => new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1);
const monthLabel = (m) => monthDate(m).toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' });
const monthName = (m) => monthDate(m).toLocaleDateString('nb-NO', { month: 'long' });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const shiftMonth = (m, d) => { const dt = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + d, 1); return dt.getFullYear() + '-' + pad(dt.getMonth() + 1); };
const dayLabel = (ds) => { const p = ds.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' }); };
const roundAbs = (x) => Math.sign(x) * Math.round(Math.abs(x));
const standalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const CHEV_L = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>';
const CHEV_R = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
const X_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function parseAmount(raw) {
  let s = String(raw).replace(/[\s ]/g, '').replace(/kr|dkk/gi, '');
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const ore = Math.round(parseFloat(s) * 100);
  return (ore > 0 && ore < 1e9) ? ore : null;
}

/* ---------- delekode ---------- */
function newCode() {
  let out = '';
  const buf = new Uint8Array(64);
  crypto.getRandomValues(buf);
  for (const b of buf) {
    if (b < 248) { out += ALPHA[b % 31]; if (out.length === 20) break; }
  }
  return out;
}
const formatCode = (c) => (c || '').match(/.{1,4}/g)?.join('-') || '';
function normalizeCode(s) {
  const c = String(s || '').toLowerCase().replace(/[\s-]/g, '');
  return /^[a-hj-km-np-z2-9]{20}$/.test(c) ? c : null;
}

/* ---------- lokal konfigurasjon (per enhet) ---------- */
const CFG_KEY = 'faelleskassen-cfg-v1';
let cfg = { hid: null, me: null, joined: false };
try { const r = localStorage.getItem(CFG_KEY); if (r) cfg = Object.assign(cfg, JSON.parse(r)); } catch (e) { /* ingen lagring */ }
const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* ingen lagring */ } };
const configured = () => !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

const state = {
  mode: 'init', canWrite: true, online: navigator.onLine, error: '',
  people: {}, expenses: {}, settlements: {},
  month: monthOf(todayStr()), tab: 'utgifter', loaded: { people: false },
  confirmClose: false, confirmReopen: false, shareAfter: false
};
let store = null;
let sheet = null;

const toMap = (s) => { const o = {}; s.docs.forEach((d) => { o[d.id] = Object.assign({}, d.data(), { id: d.id }); }); return o; };

/* ---------- lagring: Firestore ---------- */
async function makeCloudStore(hid) {
  const [appM, fs] = await Promise.all([import(FB_BASE + 'firebase-app.js'), import(FB_BASE + 'firebase-firestore.js')]);
  const app = appM.initializeApp(firebaseConfig);
  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (e) {
    db = fs.getFirestore(app);
  }
  const col = (n) => fs.collection(db, 'households', hid, n);
  const ref = (n, id) => fs.doc(db, 'households', hid, n, id);
  // Skrivinger lagres lokalt med en gang og sendes når det er nett, så vi venter ikke på serveren.
  const guard = (p) => {
    p.catch((e) => toast(e && e.code === 'permission-denied' ? 'Databasen avviste lagringen. Sjekk reglene (guiden, steg 2).' : 'Kunne ikke lagre. Prøv igjen.'));
    return Promise.resolve();
  };
  const onErr = (e) => { state.error = (e && e.code === 'permission-denied') ? 'rules' : 'net'; render(); };
  return {
    mode: 'cloud',
    start() {
      fs.onSnapshot(col('people'), { includeMetadataChanges: true }, (s) => {
        state.people = toMap(s);
        if (!s.metadata.fromCache || !s.empty) state.loaded.people = true;
        state.error = '';
        afterPeople();
        render();
      }, onErr);
      fs.onSnapshot(col('expenses'), (s) => { state.expenses = toMap(s); render(); }, onErr);
      fs.onSnapshot(col('settlements'), (s) => { state.settlements = toMap(s); render(); }, onErr);
    },
    addExpense: (o) => guard(fs.setDoc(fs.doc(col('expenses')), o)),
    setExpense: (id, o) => guard(fs.setDoc(ref('expenses', id), o)),
    deleteExpense: (id) => guard(fs.deleteDoc(ref('expenses', id))),
    setPerson: (id, o) => guard(fs.setDoc(ref('people', id), o)),
    setSettlement: (m, o) => guard(fs.setDoc(ref('settlements', m), o)),
    updateSettlement: (m, p) => guard(fs.updateDoc(ref('settlements', m), p)),
    deleteSettlement: (m) => guard(fs.deleteDoc(ref('settlements', m)))
  };
}

/* ---------- lagring: bare denne enheten (når Firebase ikke er satt opp) ---------- */
function makeLocalStore() {
  const KEY = 'faelleskassen-local-v1';
  let data = { people: {}, expenses: {}, settlements: {} };
  try { const raw = localStorage.getItem(KEY); if (raw) { const p = JSON.parse(raw); data.people = p.people || {}; data.expenses = p.expenses || {}; data.settlements = p.settlements || {}; } } catch (e) { /* tom */ }
  if (!data.people.a) data.people.a = { name: 'S', joinedAt: 1 };
  if (!data.people.b) data.people.b = { name: 'F', joinedAt: 2 };
  const withId = (m) => { const o = {}; Object.keys(m).forEach((k) => { o[k] = Object.assign({}, m[k], { id: k }); }); return o; };
  const sync = () => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ingen lagring */ }
    state.people = withId(data.people); state.expenses = withId(data.expenses); state.settlements = withId(data.settlements);
    state.loaded.people = true;
    render();
  };
  const newId = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return {
    mode: 'local',
    start() { sync(); },
    addExpense(o) { data.expenses[newId()] = o; sync(); return Promise.resolve(); },
    setExpense(id, o) { data.expenses[id] = o; sync(); return Promise.resolve(); },
    deleteExpense(id) { delete data.expenses[id]; sync(); return Promise.resolve(); },
    setPerson(id, o) { data.people[id] = o; sync(); return Promise.resolve(); },
    setSettlement(m, o) { data.settlements[m] = o; sync(); return Promise.resolve(); },
    updateSettlement(m, p) { data.settlements[m] = Object.assign({}, data.settlements[m], p); sync(); return Promise.resolve(); },
    deleteSettlement(m) { delete data.settlements[m]; sync(); return Promise.resolve(); }
  };
}

/* ---------- domene ---------- */
function persons() {
  return ['a', 'b'].map((k) => state.people[k]).filter((p) => p && p.name);
}
const couple = persons;
const nameOf = (id) => { const p = state.people[id]; return (p && p.name) || 'Ukjent'; };
const colorOf = (id) => (id === 'a' ? 'var(--p1)' : id === 'b' ? 'var(--p2)' : 'var(--muted)');
const payerHtml = (id) => '<span class="payer"><i class="dot" style="background:' + colorOf(id) + '"></i><span class="payer-n">' + esc(nameOf(id)) + '</span></span>';
const namesOk = () => { const pa = state.people.a, pb = state.people.b; return !!(pa && pa.name && pb && pb.name); };

function monthData(m) {
  const ps = couple(), ids = ps.map((p) => p.id);
  const list = Object.keys(state.expenses).map((k) => state.expenses[k]).filter((e) => e.month === m);
  const totals = {}, byCat = {};
  let total = 0;
  ids.forEach((i) => { totals[i] = 0; });
  list.forEach((e) => {
    if (Object.prototype.hasOwnProperty.call(totals, e.payerId)) totals[e.payerId] += e.amountOre;
    total += e.amountOre;
    byCat[e.category] = (byCat[e.category] || 0) + e.amountOre;
  });
  return { ps, ids, list, totals, total, byCat };
}
function calcTransfer(ids, totals) {
  if (ids.length < 2) return null;
  const a = ids[0], b = ids[1], diff = totals[a] - totals[b];
  if (diff === 0) return { amountOre: 0, fromId: null, toId: null };
  const amt = Math.round(Math.abs(diff) / 2);
  return diff > 0 ? { amountOre: amt, fromId: b, toId: a } : { amountOre: amt, fromId: a, toId: b };
}
function pendingSettlements() {
  return Object.keys(state.settlements).map((m) => [m, state.settlements[m]])
    .filter((x) => x[1].amountOre > 0 && !x[1].paid)
    .sort((a, b) => b[0].localeCompare(a[0]));
}

/* ---------- visninger ---------- */
function hdrHtml() {
  const cur = monthOf(todayStr()), m = state.month;
  let left;
  if (state.tab === 'maaneder') {
    left = '<div class="mtitle">Alle måneder</div>';
  } else {
    left = '<div class="mnav"><button class="icon-btn" data-act="prev" aria-label="Forrige måned">' + CHEV_L + '</button>' +
      '<div class="mtitle cap">' + esc(monthLabel(m)) + '</div>' +
      '<button class="icon-btn" data-act="next" aria-label="Neste måned"' + (m >= cur ? ' disabled' : '') + '>' + CHEV_R + '</button></div>';
  }
  const showChip = state.mode === 'cloud' || state.mode === 'local';
  const meP = state.people[cfg.me];
  const label = meP && meP.name ? meP.name : 'Innstillinger';
  const chip = showChip ? '<button class="who" data-act="settings" aria-label="Innstillinger"><i class="dot" style="background:' + (cfg.me ? colorOf(cfg.me) : 'var(--hero-ink)') + '"></i><span>' + esc(label) + '</span></button>' : '';
  return left + chip;
}

function viewLoading() { return '<div class="empty"><h3>Henter regnskapet</h3><p>Et øyeblikk.</p></div>'; }
function viewError() {
  return '<section class="card"><div class="empty"><h3>Kunne ikke laste databasen</h3><p>Sjekk nettforbindelsen og prøv igjen. Hvis feilen fortsetter, se feilsøkingen i guiden.</p><button class="btn" data-act="retry">Prøv igjen</button></div></section>';
}

function noticeHtml() {
  let h = '';
  if (state.mode === 'local') h += '<div class="note">Appen er ikke koblet til en database ennå. Utgiftene lagres bare på denne enheten. Følg guiden for å dele dem mellom dere to.</div>';
  if (state.error === 'rules') h += '<div class="note alert">Databasen avviste tilgangen. Sjekk at sikkerhetsreglene er publisert i Firebase (guiden, steg 2).</div>';
  else if (state.error === 'net') h += '<div class="note alert">Fikk ikke kontakt med databasen. Endringene dine lagres på enheten og sendes når du er på nett igjen.</div>';
  else if (!state.online && state.mode === 'cloud') h += '<div class="note">Du er uten nett. Endringene dine sendes automatisk når du er tilkoblet igjen.</div>';
  return h;
}

function pendingBanners() {
  return pendingSettlements().map((x) => {
    const m = x[0], s = x[1];
    return '<button class="banner" data-act="goto-settle" data-m="' + esc(m) + '"><span><b>' + esc(cap(monthName(m))) + '</b> er gjort opp. ' + esc(nameOf(s.fromId)) + ' skal overføre ' + fmt(s.amountOre) + ' DKK til ' + esc(nameOf(s.toId)) + '.</span><span class="go">Se oppgjør</span></button>';
  }).join('');
}

function summaryCard(d, st) {
  let h = '<section class="card"><div class="label">Brukt i ' + esc(monthName(state.month)) + (st ? ' · gjort opp' : '') + '</div>';
  h += '<div class="big num">' + fmt(d.total) + ' <span class="cur">DKK</span></div>';
  if (d.ps.length < 2) {
    h += '<div class="note">Trykk på navnet øverst og skriv inn navnene på dere to for å komme i gang.</div></section>';
    return h;
  }
  const a = d.ps[0], b = d.ps[1], ta = d.totals[a.id], tb = d.totals[b.id];
  const pa = d.total ? ta / d.total * 100 : 50;
  const c1 = d.total ? 'var(--p1)' : 'var(--surface2)', c2 = d.total ? 'var(--p2)' : 'var(--surface2)';
  h += '<div class="split-wrap" role="img" aria-label="Fordeling mellom ' + esc(a.name) + ' og ' + esc(b.name) + '"><div class="split"><span class="seg" style="width:' + pa + '%;background:' + c1 + '"></span><span class="seg" style="flex:1;background:' + c2 + '"></span></div><i class="mid"></i></div>';
  h += '<div class="legend"><div class="leg">' + payerHtml(a.id) + '<span class="num">' + fmt(ta) + '</span></div><div class="leg">' + payerHtml(b.id) + '<span class="num">' + fmt(tb) + '</span></div></div>';
  if (d.total > 0) {
    const diff = Math.abs(ta - tb);
    h += '<div class="small muted">' + (diff === 0 ? 'Likt fordelt. Den røde streken markerer halvparten.' : esc(ta > tb ? a.name : b.name) + ' har betalt ' + fmt(diff) + ' DKK mer. Den røde streken markerer halvparten.') + '</div>';
  }
  return h + '</section>';
}

function categoryCard(d) {
  const ents = Object.keys(d.byCat).map((k) => [k, d.byCat[k]]).sort((x, y) => y[1] - x[1]);
  if (!ents.length) return '';
  const max = ents[0][1];
  return '<section class="card"><div class="label">Fordelt på kategori</div><div class="cats">' +
    ents.map((e) => '<div class="cat-row"><span>' + esc(e[0]) + '</span><span class="bar"><b style="width:' + Math.max(3, e[1] / max * 100) + '%"></b></span><span class="num">' + fmt(e[1]) + '</span></div>').join('') +
    '</div></section>';
}

function listCard(d) {
  if (!d.list.length) {
    return '<section class="card"><div class="empty"><h3>Ingen utgifter i ' + esc(monthName(state.month)) + ' ennå</h3><p>Trykk «Ny utgift» og legg inn den første, for eksempel maten fra Netto.</p></div></section>';
  }
  const sorted = d.list.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  let h = '<section class="card"><div class="label">Utgifter</div>', last = '';
  sorted.forEach((e) => {
    if (e.date !== last) { if (last) h += '</div>'; h += '<h3 class="day">' + esc(dayLabel(e.date)) + '</h3><div class="list">'; last = e.date; }
    h += '<button class="row" data-act="edit" data-id="' + esc(e.id) + '"><span class="row-main"><span class="row-cat">' + esc(e.category) + '</span>' + (e.note ? '<span class="row-note">' + esc(e.note) + '</span>' : '') + '</span><span class="row-side"><span class="num">' + fmt(e.amountOre) + '</span>' + payerHtml(e.payerId) + '</span></button>';
  });
  return h + '</div></section>';
}

function viewExpenses() {
  const m = state.month, d = monthData(m), st = state.settlements[m];
  return noticeHtml() + pendingBanners() + summaryCard(d, st) + categoryCard(d) + listCard(d);
}

function viewSettle() {
  const m = state.month, d = monthData(m), st = state.settlements[m], label = monthName(m);
  let h = noticeHtml();
  if (d.ps.length < 2) {
    return h + '<section class="card"><div class="empty"><h3>Navn mangler</h3><p>Trykk på navnet øverst og skriv inn navnene på de to som deler regnskapet.</p></div></section>';
  }
  const closed = !!st, totals = closed ? st.totals : d.totals, total = closed ? st.total : d.total;
  const ids = d.ids, t = closed ? { amountOre: st.amountOre, fromId: st.fromId, toId: st.toId } : calcTransfer(ids, totals);
  h += '<section class="hero"><div class="label">' + (closed ? 'Oppgjør for ' + esc(label) : 'Slik blir oppgjøret for ' + esc(label)) + '</div>';
  if (total === 0) {
    h += '<div class="big num">0,00 <span class="cur">DKK</span></div><div class="line">Ingen utgifter i denne måneden ennå.</div>';
  } else if (t.amountOre === 0) {
    h += '<div class="big num">Kvitt</div><div class="line">Dere har brukt like mye. Ingen overføring.</div>';
  } else {
    h += '<div class="line"><b>' + esc(nameOf(t.fromId)) + '</b> overfører</div><div class="big num">' + fmt(t.amountOre) + ' <span class="cur">DKK</span></div><div class="line">til <b>' + esc(nameOf(t.toId)) + '</b></div>';
  }
  h += '</section>';
  h += '<section class="card"><div class="label">Slik regnes det ut</div><div class="tbl"><span class="h">&nbsp;</span><span class="h">Betalt</span><span class="h">Mot lik andel</span>';
  ids.forEach((id) => {
    const paid = totals[id] || 0, delta = roundAbs(paid - total / 2);
    h += '<span>' + payerHtml(id) + '</span><span class="r num">' + fmt(paid) + '</span><span class="r num ' + (delta > 0 ? 'pos' : delta < 0 ? 'neg' : '') + '">' + (delta > 0 ? '+' : delta < 0 ? '−' : '') + fmt(Math.abs(delta)) + '</span>';
  });
  h += '</div><div class="small muted">Totalt ' + fmt(total) + ' DKK. Lik andel er ' + fmt(Math.round(total / 2)) + ' DKK hver. Den som har betalt minst overfører differansen, slik at begge har brukt like mye.</div></section>';
  if (!closed) {
    const isCur = m === monthOf(todayStr());
    h += '<section class="card">' + (isCur ? '<div class="small muted">Måneden pågår fortsatt. Gjør opp når alle utgiftene er lagt inn.</div>' : '') +
      '<button class="btn' + (state.confirmClose ? ' warnbtn' : '') + '" data-act="close-month"' + (total === 0 ? ' disabled' : '') + '>' + (state.confirmClose ? 'Trykk igjen for å bekrefte oppgjøret' : 'Gjør opp ' + esc(label)) + '</button>' +
      (state.confirmClose ? '<div class="small muted">Måneden låses for nye og endrede utgifter. Du kan åpne den igjen senere.</div>' : '') + '</section>';
  } else {
    const status = t.amountOre === 0 ? '<span class="chip-s ok">Kvitt</span>' : (st.paid ? '<span class="chip-s ok">Overført</span>' : '<span class="chip-s warn">Venter på overføring</span>');
    h += '<section class="card"><div>' + status + '</div>';
    if (t.amountOre > 0 && !st.paid) h += '<button class="btn" data-act="paid">Marker som overført</button>';
    if (t.amountOre > 0 && st.paid) h += '<button class="btn ghost" data-act="unpaid">Angre «overført»</button>';
    h += '<button class="btn ghost' + (state.confirmReopen ? ' danger' : '') + '" data-act="reopen">' + (state.confirmReopen ? 'Trykk igjen for å åpne måneden' : 'Åpne måneden igjen') + '</button></section>';
  }
  return h;
}

function viewMonths() {
  const set = {}; set[monthOf(todayStr())] = 1;
  Object.keys(state.expenses).forEach((k) => { const m = state.expenses[k].month; if (m) set[m] = 1; });
  Object.keys(state.settlements).forEach((m) => { set[m] = 1; });
  const months = Object.keys(set).sort().reverse();
  let h = noticeHtml() + '<section class="card"><div class="label">Måneder</div><div>';
  months.forEach((m) => {
    const st = state.settlements[m], d = monthData(m), total = st ? st.total : d.total;
    let chip;
    if (!st) chip = '<span class="chip-s">Åpen</span>';
    else if (st.amountOre === 0) chip = '<span class="chip-s ok">Kvitt</span>';
    else if (st.paid) chip = '<span class="chip-s ok">Overført</span>';
    else chip = '<span class="chip-s warn">Venter på overføring</span>';
    h += '<button class="mrow" data-act="goto-month" data-m="' + esc(m) + '"><span class="cap">' + esc(monthLabel(m)) + '</span><span class="mrow-r"><span class="num">' + fmt(total) + ' DKK</span>' + chip + '</span></button>';
  });
  h += '</div></section>';
  if (!standalone()) {
    h += '<section class="card"><div class="label">Legg til på Hjem-skjermen</div><ol class="steps"><li>Åpne denne siden i Safari på iPhone.</li><li>Trykk på Del-ikonet nederst.</li><li>Velg «Legg til på Hjem-skjerm».</li></ol></section>';
  }
  return h;
}

function render() {
  $('#hdr').innerHTML = hdrHtml();
  let v;
  if (state.mode === 'init' || state.mode === 'welcome' || (state.mode === 'cloud' && !state.loaded.people && !state.error)) v = viewLoading;
  else if (state.mode === 'error') v = viewError;
  else v = { utgifter: viewExpenses, oppgjor: viewSettle, maaneder: viewMonths }[state.tab];
  $('#view').innerHTML = v();
  document.querySelectorAll('.tab').forEach((b) => {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#tab-oppgjor').classList.toggle('has-alert', pendingSettlements().length > 0);
  const ready = (state.mode === 'cloud' && state.loaded.people) || state.mode === 'local';
  $('#fab').hidden = !(ready && state.tab !== 'oppgjor');
}

/* ---------- ark (bottom sheets) ---------- */
function openSheet(html, locked) {
  const s = $('#sheet');
  s.innerHTML = html; s.hidden = false; $('#scrim').hidden = false;
  sheet.locked = !!locked;
  document.documentElement.style.overflow = 'hidden';
}
function closeSheet() {
  if (!sheet) return;
  $('#sheet').hidden = true; $('#scrim').hidden = true; $('#sheet').innerHTML = '';
  document.documentElement.style.overflow = ''; sheet = null;
}
function formErr(msg) { const e = $('#ferr'); if (e) { e.textContent = msg; e.hidden = false; } }
const sheetHead = (title, closable) => '<div class="grab"></div><div class="sheet-h"><h2>' + title + '</h2>' + (closable ? '<button class="icon-btn" data-act="sheet-close" aria-label="Lukk">' + X_ICON + '</button>' : '') + '</div>';

function expenseSheetHtml(e) {
  const ps = couple();
  const amt = e ? (e.amountOre / 100).toFixed(2).replace('.', ',') : '';
  const date = e ? e.date : (state.month === monthOf(todayStr()) ? todayStr() : state.month + '-01');
  return sheetHead(e ? 'Rediger utgift' : 'Ny utgift', true) +
    '<label class="field-l" for="f-amount">Beløp</label>' +
    '<div class="amt"><input id="f-amount" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0,00" value="' + esc(amt) + '"><span class="cur num">DKK</span></div>' +
    '<div class="prev" id="f-prev"></div>' +
    '<div class="field-l">Kategori</div><div class="chips" id="f-cats">' + CATS.map((c) => '<button type="button" class="chip" data-act="pick-cat" data-v="' + esc(c) + '" aria-pressed="' + (c === sheet.cat) + '">' + esc(c) + '</button>').join('') + '</div>' +
    '<label class="field-l" for="f-note">Notat (valgfritt)</label>' +
    '<input id="f-note" class="inp" maxlength="80" autocomplete="off" placeholder="For eksempel Netto, Føtex eller Rema 1000" value="' + esc(e ? e.note : '') + '">' +
    '<label class="field-l" for="f-date">Dato</label>' +
    '<input id="f-date" class="inp" type="date" value="' + esc(date) + '">' +
    '<div class="field-l">Betalt av</div><div class="chips" id="f-payers">' + ps.map((p) => '<button type="button" class="chip" data-act="pick-payer" data-v="' + esc(p.id) + '" aria-pressed="' + (p.id === sheet.payer) + '"><i class="dot" style="background:' + colorOf(p.id) + '"></i>' + esc(p.name) + '</button>').join('') + '</div>' +
    '<p class="ferr" id="ferr" role="alert" hidden></p>' +
    '<div class="sheet-actions"><button class="btn" id="f-save" data-act="save-expense">Lagre</button>' + (e ? '<button class="btn ghost danger" id="f-del" data-act="delete-expense">Slett utgift</button>' : '') + '</div>';
}

function openExpense(id) {
  const e = id ? state.expenses[id] : null;
  if (id && !e) return;
  const ps = couple();
  const mine = ps.some((p) => p.id === cfg.me) ? cfg.me : (ps[0] && ps[0].id);
  sheet = { type: 'expense', id: id || null, cat: e ? e.category : CATS[0], payer: e ? e.payerId : mine, confirmDel: false };
  openSheet(expenseSheetHtml(e));
  const inp = $('#f-amount');
  const upd = () => {
    const o = parseAmount(inp.value);
    $('#f-prev').textContent = inp.value.trim() === '' ? '' : (o ? '= ' + fmt(o) + ' DKK' : 'Skriv beløpet med komma, for eksempel 249,50');
  };
  inp.addEventListener('input', upd); upd();
  if (!id) setTimeout(() => { try { inp.focus(); } catch (e2) { /* ingen fokus */ } }, 60);
}

async function saveExpense() {
  if (!sheet || sheet.type !== 'expense') return;
  const ore = parseAmount($('#f-amount').value);
  const date = $('#f-date').value || todayStr();
  const note = $('#f-note').value.trim().slice(0, 80);
  if (!ore) return formErr('Skriv inn et beløp, for eksempel 249,50.');
  if (!sheet.payer) return formErr('Velg hvem som betalte.');
  const month = monthOf(date), old = sheet.id ? state.expenses[sheet.id] : null;
  if (state.settlements[month] || (old && state.settlements[old.month])) return formErr('Måneden er gjort opp. Åpne den igjen under Oppgjør for å endre utgifter.');
  const obj = { amountOre: ore, category: sheet.cat, note, date, month, payerId: sheet.payer, addedBy: cfg.me || sheet.payer, createdAt: old ? old.createdAt : Date.now() };
  const btn = $('#f-save'); btn.disabled = true;
  const id = sheet.id;
  const ok = await run(() => (id ? store.setExpense(id, obj) : store.addExpense(obj)), id ? 'Endringen er lagret' : 'Utgiften er lagret');
  if (ok) { state.month = month; closeSheet(); render(); } else if ($('#f-save')) { $('#f-save').disabled = false; }
}

async function deleteExpense() {
  if (!sheet || !sheet.id) return;
  const old = state.expenses[sheet.id];
  if (old && state.settlements[old.month]) return formErr('Måneden er gjort opp. Åpne den igjen under Oppgjør for å slette.');
  if (!sheet.confirmDel) { sheet.confirmDel = true; $('#f-del').textContent = 'Trykk igjen for å slette'; return; }
  const id = sheet.id;
  const ok = await run(() => store.deleteExpense(id), 'Utgiften er slettet');
  if (ok) { closeSheet(); render(); }
}

function nameInputs() {
  const na = state.people.a && state.people.a.name ? state.people.a.name : '';
  const nb = state.people.b && state.people.b.name ? state.people.b.name : '';
  return '<label class="field-l" for="n-a">S</label><input id="n-a" class="inp" maxlength="24" autocomplete="off" value="' + esc(na) + '">' +
    '<label class="field-l" for="n-b">F</label><input id="n-b" class="inp" maxlength="24" autocomplete="off" value="' + esc(nb) + '">';
}

function openNames(first) {
  sheet = { type: 'names' };
  openSheet(sheetHead(first ? 'Hvem deler regnskapet?' : 'Navn', !first) +
    '<div class="small muted">Navnene vises ved hver utgift og i oppgjøret.</div>' + nameInputs() +
    '<p class="ferr" id="ferr" role="alert" hidden></p><div class="sheet-actions"><button class="btn" data-act="save-names" id="n-save">Lagre</button></div>', first);
  setTimeout(() => { try { $('#n-a').focus(); } catch (e) { /* ingen fokus */ } }, 60);
}

async function saveNames() {
  if (!sheet || (sheet.type !== 'names' && sheet.type !== 'settings')) return;
  const a = $('#n-a').value.trim(), b = $('#n-b').value.trim();
  if (!a || !b) return formErr('Begge må ha et navn.');
  if (a.toLowerCase() === b.toLowerCase()) return formErr('Navnene må være ulike.');
  const btn = $('#n-save'); btn.disabled = true;
  const ok1 = await run(() => store.setPerson('a', { name: a, joinedAt: 1 }));
  const ok2 = await run(() => store.setPerson('b', { name: b, joinedAt: 2 }));
  if (ok1 && ok2) {
    // Bruk navnene med en gang. Databasen bekrefter lagringen et øyeblikk senere.
    state.people.a = { id: 'a', name: a, joinedAt: 1 };
    state.people.b = { id: 'b', name: b, joinedAt: 2 };
    closeSheet(); render(); afterPeople();
  } else { btn.disabled = false; }
}

function openMe() {
  sheet = { type: 'me' };
  openSheet(sheetHead('Hvem er du?', false) +
    '<div class="small muted">Valget gjelder bare denne telefonen. Det bestemmer hvem som er forhåndsvalgt som betaler.</div>' +
    '<div class="sheet-actions">' + ['a', 'b'].map((id) => '<button class="btn ghost" data-act="pick-me" data-v="' + id + '" style="display:flex;align-items:center;justify-content:center;gap:10px"><i class="dot" style="background:' + colorOf(id) + '"></i>' + esc(nameOf(id)) + '</button>').join('') + '</div>', true);
}

function openSettings() {
  sheet = { type: 'settings', confirmDisc: false };
  let h = sheetHead('Innstillinger', true);
  h += '<div class="field-l">Jeg er</div><div class="chips" id="s-me">' + ['a', 'b'].map((id) => '<button type="button" class="chip" data-act="set-me" data-v="' + id + '" aria-pressed="' + (cfg.me === id) + '"><i class="dot" style="background:' + colorOf(id) + '"></i>' + esc(nameOf(id)) + '</button>').join('') + '</div>';
  h += nameInputs();
  h += '<p class="ferr" id="ferr" role="alert" hidden></p><button class="btn" data-act="save-names" id="n-save">Lagre navn</button>';
  if (state.mode === 'cloud') {
    h += '<div class="field-l">Delekode</div><div class="code" id="s-code">' + esc(formatCode(cfg.hid)) + '</div>' +
      '<div class="note">Alle som har koden kan se og endre regnskapet. Del den bare med den andre.</div>' +
      '<div class="sheet-actions"><button class="btn ghost" data-act="share-invite">Del invitasjon</button><button class="btn ghost" data-act="copy-code">Kopier koden</button><button class="btn ghost danger" id="s-disc" data-act="disconnect">Koble fra denne enheten</button></div>';
  } else {
    h += '<div class="note">Appen er ikke koblet til en database. Utgiftene lagres bare på denne enheten.</div>';
  }
  openSheet(h);
}

function openWelcome(prefill) {
  sheet = { type: 'welcome' };
  const hint = (isIOS() && !standalone()) ? '<div class="note">Tips: legg appen på Hjem-skjermen først (Del-ikonet, deretter «Legg til på Hjem-skjerm») og åpne den derfra. Data i Safari og i Hjem-skjerm-appen er adskilt.</div>' : '';
  openSheet(sheetHead('Velkommen til Fælleskassen', false) +
    '<p class="small muted">Her holder dere regnskapet for felles utgifter i DKK. Én av dere starter, og den andre blir med med en delekode.</p>' + hint +
    '<button class="btn" data-act="create-household">Start et nytt regnskap</button>' +
    '<label class="field-l" for="w-code">Eller bli med med delekode</label>' +
    '<input id="w-code" class="inp" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="abcd-efgh-jkmn-pqrs-tuvw" value="' + esc(prefill || '') + '">' +
    '<p class="ferr" id="ferr" role="alert" hidden></p>' +
    '<button class="btn ghost" data-act="join-household">Bli med</button>', true);
}

function openNotFound() {
  sheet = { type: 'notfound' };
  openSheet(sheetHead('Fant ikke regnskapet', false) +
    '<p class="small muted">Det finnes ingen navn under denne koden. Sjekk at koden er riktig, og at den som startet regnskapet har lagt inn navnene først.</p>' +
    '<button class="btn" data-act="reset-code">Prøv en annen kode</button>', true);
}

function afterPeople() {
  if (state.mode !== 'cloud' && state.mode !== 'local') return;
  if (sheet && sheet.type === 'notfound' && namesOk()) closeSheet();
  if (sheet || !state.loaded.people) return;
  if (!namesOk()) { if (cfg.joined) openNotFound(); else openNames(true); return; }
  if (cfg.me !== 'a' && cfg.me !== 'b') { openMe(); return; }
  if (state.shareAfter && state.mode === 'cloud') { state.shareAfter = false; openSettings(); }
}

/* ---------- koble til ---------- */
async function connect() {
  state.mode = 'init'; render();
  try {
    store = await makeCloudStore(cfg.hid);
  } catch (e) {
    state.mode = 'error'; render(); return;
  }
  state.mode = 'cloud'; store.start(); render();
}

function createHousehold() {
  cfg = { hid: newCode(), me: null, joined: false }; saveCfg();
  state.shareAfter = true;
  closeSheet(); connect();
}
function joinHousehold() {
  const c = normalizeCode($('#w-code').value);
  if (!c) return formErr('Koden skal ha 20 tegn, for eksempel abcd-efgh-jkmn-pqrs-tuvw.');
  cfg = { hid: c, me: null, joined: true }; saveCfg();
  closeSheet(); connect();
}
function leaveHousehold() {
  cfg = { hid: null, me: null, joined: false }; saveCfg();
  location.reload();
}

async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return; } catch (e) { /* prøv reserve */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    toast(okMsg);
  } catch (e2) { toast('Kunne ikke kopiere. Marker koden og kopier den selv.'); }
}
async function shareInvite() {
  const url = location.origin + location.pathname + '#join=' + cfg.hid;
  const text = 'Bli med i Fælleskassen. Delekode: ' + formatCode(cfg.hid);
  try {
    if (navigator.share) { await navigator.share({ title: 'Fælleskassen', text, url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  copyText(text + '\n' + url, 'Invitasjonen er kopiert');
}

/* ---------- oppgjør ---------- */
async function closeMonth() {
  const m = state.month, d = monthData(m);
  if (d.ps.length < 2 || d.total === 0 || state.settlements[m]) return;
  if (!state.confirmClose) { state.confirmClose = true; render(); return; }
  const t = calcTransfer(d.ids, d.totals);
  state.confirmClose = false;
  const now = Date.now();
  await run(() => store.setSettlement(m, { month: m, closedAt: now, closedBy: cfg.me || null, totals: d.totals, total: d.total, fromId: t.fromId, toId: t.toId, amountOre: t.amountOre, paid: t.amountOre === 0, paidAt: t.amountOre === 0 ? now : null }), 'Måneden er gjort opp');
  render();
}

/* ---------- hjelpere ---------- */
async function run(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); return true; }
  catch (e) { toast('Kunne ikke lagre. Prøv igjen.'); return false; }
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3400); }
function resetConfirms() { state.confirmClose = false; state.confirmReopen = false; }

/* ---------- hendelser ---------- */
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'scrim': if (sheet && !sheet.locked) closeSheet(); return;
    case 'sheet-close': closeSheet(); return;
    case 'pick-cat':
      sheet.cat = el.dataset.v;
      document.querySelectorAll('#f-cats .chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === sheet.cat)));
      return;
    case 'pick-payer':
      sheet.payer = el.dataset.v;
      document.querySelectorAll('#f-payers .chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === sheet.payer)));
      return;
    case 'save-expense': saveExpense(); return;
    case 'delete-expense': deleteExpense(); return;
    case 'save-names': saveNames(); return;
    case 'pick-me': cfg.me = el.dataset.v; saveCfg(); closeSheet(); render(); afterPeople(); return;
    case 'set-me':
      cfg.me = el.dataset.v; saveCfg();
      document.querySelectorAll('#s-me .chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === cfg.me)));
      render(); return;
    case 'prev': state.month = shiftMonth(state.month, -1); resetConfirms(); render(); return;
    case 'next': { const n = shiftMonth(state.month, 1); if (n <= monthOf(todayStr())) { state.month = n; resetConfirms(); render(); } return; }
    case 'tab': state.tab = el.dataset.tab; resetConfirms(); render(); window.scrollTo(0, 0); return;
    case 'add': if (couple().length === 0) { openNames(false); return; } openExpense(null); return;
    case 'edit': openExpense(el.dataset.id); return;
    case 'settings': openSettings(); return;
    case 'goto-month': state.month = el.dataset.m; state.tab = 'utgifter'; resetConfirms(); render(); window.scrollTo(0, 0); return;
    case 'goto-settle': state.month = el.dataset.m; state.tab = 'oppgjor'; resetConfirms(); render(); window.scrollTo(0, 0); return;
    case 'close-month': closeMonth(); return;
    case 'paid': { const m = state.month; run(() => store.updateSettlement(m, { paid: true, paidAt: Date.now() }), 'Markert som overført'); return; }
    case 'unpaid': { const m = state.month; run(() => store.updateSettlement(m, { paid: false, paidAt: null })); return; }
    case 'reopen': {
      if (!state.confirmReopen) { state.confirmReopen = true; render(); return; }
      const m = state.month; state.confirmReopen = false;
      run(() => store.deleteSettlement(m), 'Måneden er åpnet igjen').then(render); return;
    }
    case 'create-household': createHousehold(); return;
    case 'join-household': joinHousehold(); return;
    case 'reset-code': leaveHousehold(); return;
    case 'copy-code': copyText(formatCode(cfg.hid), 'Koden er kopiert'); return;
    case 'share-invite': shareInvite(); return;
    case 'disconnect':
      if (!sheet.confirmDisc) { sheet.confirmDisc = true; $('#s-disc').textContent = 'Trykk igjen for å koble fra'; return; }
      leaveHousehold(); return;
    case 'retry': connect(); return;
    default:
  }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && sheet && !sheet.locked) closeSheet();
  if (ev.key === 'Enter' && sheet && sheet.type === 'expense' && ev.target && ev.target.id === 'f-amount') { ev.preventDefault(); saveExpense(); }
});
window.addEventListener('online', () => { state.online = true; render(); });
window.addEventListener('offline', () => { state.online = false; render(); });

/* ---------- start ---------- */
async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* appen virker uten */ });
  }
  render();
  if (!configured()) {
    store = makeLocalStore(); state.mode = 'local'; store.start(); afterPeople(); return;
  }
  const m = location.hash.match(/#join=([A-Za-z0-9-]+)/);
  const prefill = m ? m[1] : '';
  if (m) history.replaceState(null, '', location.pathname + location.search);
  if (!cfg.hid) { state.mode = 'welcome'; render(); openWelcome(prefill); return; }
  await connect();
}
boot();
