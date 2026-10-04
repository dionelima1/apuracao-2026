'use strict';

/* ---------- Configuração ---------- */
const BASE = 'https://resultados.tse.jus.br/oficial/ele2026';
const qs = new URLSearchParams(location.search);
const TURNO = qs.get('turno') === '2' ? 2 : 1;
const SIM = qs.has('simular');
const ELE = TURNO === 1 ? { fed: '6257', est: '6259' } : { fed: '6258', est: '6260' };
const CARGOS = {
  pres: { nome: 'Presidente', ele: 'fed', cd: '0001', nacional: true },
  gov: { nome: 'Governador', ele: 'est', cd: '0003' },
  sen: { nome: 'Senador', ele: 'est', cd: '0005' },
};
if (TURNO === 2) delete CARGOS.sen;

const REFRESH_MS = 15000;
const PAISES_MS = 60000;
const TIMEOUT_MS = 12000;

const UFS = {
  ac: 'Acre', al: 'Alagoas', ap: 'Amapá', am: 'Amazonas', ba: 'Bahia', ce: 'Ceará', df: 'Distrito Federal',
  es: 'Espírito Santo', go: 'Goiás', ma: 'Maranhão', mt: 'Mato Grosso', ms: 'Mato Grosso do Sul',
  mg: 'Minas Gerais', pa: 'Pará', pb: 'Paraíba', pr: 'Paraná', pe: 'Pernambuco', pi: 'Piauí',
  rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte', rs: 'Rio Grande do Sul', ro: 'Rondônia', rr: 'Roraima',
  sc: 'Santa Catarina', sp: 'São Paulo', se: 'Sergipe', to: 'Tocantins',
};
// Posição [coluna, linha] de cada estado no mapa em mosaico
const TILES = {
  rr: [3, 1], ap: [5, 1],
  am: [2, 2], pa: [4, 2], ma: [5, 2], ce: [6, 2], rn: [7, 2],
  ac: [1, 3], ro: [2, 3], mt: [3, 3], to: [4, 3], pi: [5, 3], pe: [6, 3], pb: [7, 3],
  ms: [3, 4], go: [4, 4], df: [5, 4], ba: [6, 4], al: [7, 4],
  pr: [3, 5], sp: [4, 5], mg: [5, 5], es: [6, 5], se: [7, 5],
  sc: [3, 6], rj: [5, 6],
  rs: [3, 7], zz: [6, 7],
};
const PARTY_COLORS = {
  '13': '#ef4444', '22': '#3b82f6', '55': '#f59e0b', '30': '#f97316', '70': '#06b6d4', '27': '#a855f7',
  '21': '#be123c', '16': '#fb7185', '80': '#f472b6', '35': '#22c55e', '14': '#eab308', '29': '#9f1239',
  '15': '#10b981', '10': '#6366f1', '44': '#0ea5e9', '12': '#84cc16', '40': '#fbbf24', '45': '#38bdf8',
  '20': '#8b5cf6', '11': '#2563eb', '50': '#facc15', '18': '#14b8a6', '25': '#64748b', '77': '#d946ef',
  '23': '#ec4899', '19': '#0891b2', '36': '#a3e635', '33': '#fb923c', '28': '#c084fc', '90': '#f43f5e',
};
const FALLBACK = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#2dd4bf', '#fb923c', '#e879f9', '#4ade80', '#38bdf8'];

/* ---------- Utilidades ---------- */
const $ = s => document.querySelector(s);
const nf = new Intl.NumberFormat('pt-BR');
const pf = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = x => +String(x ?? '0').replace(',', '.') || 0;
const pad6 = s => String(s).padStart(6, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const title = s => String(s ?? '').toLowerCase().replace(/(^|[\s\-/(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

function colorOf(c) {
  if (PARTY_COLORS[c.n?.slice(0, 2)]) return PARTY_COLORS[c.n.slice(0, 2)];
  let h = 0; for (const ch of String(c.sq)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}
const eleOf = k => ELE[CARGOS[k].ele];
const urlDados = (k, uf, mun = '') => `${BASE}/${eleOf(k)}/dados/${uf}/${uf}${mun}-c${CARGOS[k].cd}-e${pad6(eleOf(k))}-u.json`;
const urlFoto = (k, uf, sq) => `${BASE}/${eleOf(k)}/fotos/${k === 'pres' ? 'br' : uf}/${sq}.jpeg`;
const urlMun = () => `${BASE}/${ELE.fed}/config/mun-e${pad6(ELE.fed)}-cm.json`;

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const j = i++; out[j] = await fn(items[j], j); }
  }));
  return out;
}

async function getJSON(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ---------- Parse dos arquivos do TSE ---------- */
function parse(d) {
  const c = d.carg?.[0] || {};
  const cands = [];
  for (const a of c.agr || []) for (const p of a.par || []) for (const k of p.cand || []) {
    cands.push({
      n: k.n, sq: k.sqcand, nm: k.nmu || k.nm, full: k.nm, sg: p.sg, com: a.com, seq: +k.seq || 0,
      vap: +k.vap || 0, pvap: num(k.pvapn || k.pvap), st: k.st || '', e: k.e === 's',
      vs: (k.vs || []).map(v => v.nmu || v.nm), vsTp: k.vs?.[0]?.tp,
    });
  }
  const s = d.s || {}, e = d.e || {}, v = d.v || {};
  const tot = {
    st: +s.st || 0, ts: +s.ts || 0, pst: num(s.pstn || s.pst),
    te: +e.te || 0, c: +e.c || 0, pc: num(e.pcn || e.pc), a: +e.a || 0, pa: num(e.pan || e.pa),
    vv: +v.vv || 0, pvv: num(v.pvvn || v.pvv), vb: +v.vb || 0, pvb: num(v.pvbn || v.pvb),
    vn: +v.tvn || 0, pvn: num(v.ptvnn || v.ptvn),
  };
  return finalize({ cands, tot, nv: +c.nv || 1, dg: d.dg, hg: d.hg, tf: d.tf === 's' });
}
function finalize(p) {
  p.cands.sort((a, b) => b.vap - a.vap || a.seq - b.seq || a.nm.localeCompare(b.nm));
  return p;
}
function aggregate(list) {
  list = list.filter(Boolean);
  const by = new Map();
  const tot = { st: 0, ts: 0, te: 0, c: 0, a: 0, vv: 0, vb: 0, vn: 0 };
  for (const p of list) {
    for (const k in tot) tot[k] += p.tot[k];
    for (const c of p.cands) { const x = by.get(c.sq) || { ...c, vap: 0 }; x.vap += c.vap; by.set(c.sq, x); }
  }
  const pct = (a, b) => b ? a / b * 100 : 0;
  const cands = [...by.values()];
  cands.forEach(c => c.pvap = pct(c.vap, tot.vv));
  Object.assign(tot, {
    pst: pct(tot.st, tot.ts), pc: pct(tot.c, tot.te), pa: pct(tot.a, tot.te),
    pvv: pct(tot.vv, tot.c), pvb: pct(tot.vb, tot.c), pvn: pct(tot.vn, tot.c),
  });
  const last = list.reduce((m, p) => (!m || (p.dg + p.hg) > (m.dg + m.hg)) ? p : m, null);
  return finalize({ cands, tot, nv: list[0]?.nv || 1, dg: last?.dg, hg: last?.hg, tf: false });
}

/* Modo simulação (?simular=1): números fictícios e neutros para testar a interface antes da apuração */
const T0 = Date.now();
function hash(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; }
function simular(p, key) {
  const prog = Math.min(1, 0.04 + (Date.now() - T0) / 240000);
  const te = p.tot.te || 50000, c = Math.round(te * 0.8 * prog), vv = Math.round(c * 0.92);
  // o último fator faz cada candidato subir ou cair ao longo da apuração, para testar o gráfico de evolução
  const w = p.cands.map(x => Math.pow(hash(x.sq) * 0.85 + hash(x.sq + key) * 0.3, 4) * (1 + (hash(x.sq + 'tend') - 0.5) * 1.4 * prog));
  const sw = w.reduce((a, b) => a + b, 0) || 1;
  p.cands.forEach((x, i) => { x.vap = Math.round(vv * w[i] / sw); x.pvap = vv ? x.vap / vv * 100 : 0; });
  Object.assign(p.tot, {
    pst: prog * 100, st: Math.round(p.tot.ts * prog), c, pc: c / te * 100, a: Math.round(te * prog) - c,
    pa: 20, vv, pvv: 92, vb: Math.round(c * 0.03), pvb: 3, vn: c - vv - Math.round(c * 0.03), pvn: 5,
  });
  const now = new Date();
  p.dg = now.toLocaleDateString('pt-BR'); p.hg = now.toLocaleTimeString('pt-BR');
  return finalize(p);
}

/* ---------- Camada de dados: cache + deduplicação + tolerância a falhas ---------- */
const cache = new Map();
const inflight = new Map();
const health = { okAt: 0, fails: 0 };

function load(url, maxAge = REFRESH_MS - 1500) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < maxAge) return Promise.resolve(hit.p);
  if (inflight.has(url)) return inflight.get(url);
  const pr = (async () => {
    try {
      let p = parse(await getJSON(url));
      if (SIM) p = simular(p, url);
      cache.set(url, { p, at: Date.now() });
      health.okAt = Date.now(); health.fails = 0;
      return p;
    } catch (err) {
      health.fails++;
      if (hit) return hit.p; // mantém o último dado bom na tela
      throw err;
    } finally { inflight.delete(url); }
  })();
  inflight.set(url, pr);
  return pr;
}

/* ---------- Histórico da apuração (gravado neste navegador a cada parcial do TSE) ----------
   Ponto: [hora TSE, seções totalizadas, % apurado × 100, % de cada candidato × 100 na ordem de `sq`] */
const HIST_KEY = `apu26-evo-v1-t${TURNO}`;
const HIST_MAX = 300;
let hist = {}, histDirty = false;
if (!SIM) try { const h = JSON.parse(localStorage.getItem(HIST_KEY)); if (h && typeof h === 'object') hist = h; } catch { }

function record(key, p) {
  const t = p?.tot;
  if (!t?.st || !p.cands.length) return;
  const h = hist[key] || (hist[key] = { sq: [], pts: [] });
  const pts = h.pts;
  while (pts.length && pts[pts.length - 1][1] > t.st) pts.pop(); // correção do TSE: descarta o que ficou à frente
  const by = new Map(p.cands.map(c => [c.sq, c]));
  for (const sq of by.keys()) if (!h.sq.includes(sq)) h.sq.push(sq);
  const pst = Math.round(t.pst * 100);
  const pt = [String(p.hg || '').slice(0, 5), t.st, pst, ...h.sq.map(sq => by.has(sq) ? Math.round(by.get(sq).pvap * 100) : null)];
  const last = pts[pts.length - 1];
  if (last && (last[1] === t.st || last[2] === pst)) {
    if (last.join() === pt.join()) return;
    pts[pts.length - 1] = pt;
  } else pts.push(pt);
  if (pts.length > HIST_MAX) for (let i = pts.length - 40; i > 0; i -= 2) pts.splice(i, 1);
  histDirty = true;
}
function saveHist() {
  if (!histDirty || SIM) return;
  histDirty = false;
  try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)); } catch {
    // sem espaço: fica só com o cargo atual
    for (const k in hist) if (!k.includes(`-c${CARGOS[st.cargo].cd}-`)) delete hist[k];
    try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)); } catch { }
  }
}
function trendOf(h, sq) {
  const i = h ? h.sq.indexOf(sq) : -1;
  if (i < 0 || h.pts.length < 2) return null;
  const col = i + 3, a = h.pts.find(q => q[col] != null), b = h.pts[h.pts.length - 1];
  if (!a || a === b || b[col] == null) return null;
  return { d: (b[col] - a[col]) / 100, from: a[2] / 100 };
}
function trendHtml(t) {
  if (!t) return '';
  const k = t.d >= 0.005 ? 'up' : t.d <= -0.005 ? 'down' : 'flat';
  const txt = k === 'flat' ? '= estável' : `${k === 'up' ? '▲' : '▼'} ${fmtPct(Math.abs(t.d))} p.p.`;
  return `<span class="trend ${k}" title="Variação desde ${fmtPct(t.from)}% apurado">${txt}</span>`;
}

/* ---------- Estado (espelhado no #hash da URL) ---------- */
const st = { cargo: 'pres', uf: 'br', mun: '', pais: '', cidade: '', sel: new Set(), q: '' };
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (CARGOS[h.get('c')]) st.cargo = h.get('c');
  const uf = h.get('uf');
  if (uf && (UFS[uf] || uf === 'br' || uf === 'zz')) st.uf = uf;
  st.mun = h.get('mun') || '';
  st.pais = h.get('pais') || '';
  st.cidade = h.get('cid') || '';
  st.sel = new Set((h.get('cand') || '').split(',').filter(Boolean));
  if (!CARGOS[st.cargo].nacional && st.uf === 'zz') st.uf = 'br';
}
function writeHash() {
  const h = new URLSearchParams();
  h.set('c', st.cargo); h.set('uf', st.uf);
  if (st.mun) h.set('mun', st.mun);
  if (st.pais) h.set('pais', st.pais);
  if (st.cidade) h.set('cid', st.cidade);
  if (st.sel.size) h.set('cand', [...st.sel].join(','));
  history.replaceState(null, '', '#' + h.toString());
}

/* ---------- Municípios e cidades do exterior ---------- */
let MUN = null;        // { uf: [{cd, nm}] }
let ZZ = [];           // [{cd, nm, pais}]
async function loadMunicipios() {
  try {
    const d = await getJSON(urlMun());
    MUN = {};
    for (const a of d.abr || []) MUN[a.cd] = (a.mu || []).map(m => ({ cd: m.cd, nm: m.nm })).sort((x, y) => x.nm.localeCompare(y.nm, 'pt-BR'));
    ZZ = (MUN.zz || []).map(m => ({ ...m, pais: PAISES[m.cd] || 'Outros' }));
  } catch { MUN = null; }
}
const paisesList = () => [...new Set(ZZ.map(c => c.pais))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
const citiesOf = pais => ZZ.filter(c => c.pais === pais);

/* ---------- Interface: controles ---------- */
function buildTabs() {
  $('#tabsCargo').innerHTML = Object.entries(CARGOS).map(([k, c]) =>
    `<button class="tab" role="tab" data-k="${k}" aria-selected="${k === st.cargo}">${c.nome}</button>`).join('');
}
function buildSelects() {
  const nac = CARGOS[st.cargo].nacional;
  const opts = [`<option value="br">${nac ? 'Brasil (total)' : 'Brasil · todos os estados'}</option>`];
  if (nac) opts.push('<option value="zz">Exterior · todos os países</option>');
  for (const [uf, nm] of Object.entries(UFS).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))) opts.push(`<option value="${uf}">${nm} (${uf.toUpperCase()})</option>`);
  $('#selUf').innerHTML = opts.join('');
  $('#selUf').value = st.uf;

  const showMun = MUN && UFS[st.uf];
  $('#fldMun').hidden = !showMun;
  if (showMun) {
    $('#selMun').innerHTML = '<option value="">Todo o estado</option>' + MUN[st.uf].map(m => `<option value="${m.cd}">${esc(title(m.nm))}</option>`).join('');
    $('#selMun').value = st.mun;
  }
  const showZZ = st.uf === 'zz' && ZZ.length;
  $('#fldPais').hidden = !showZZ;
  $('#fldCidade').hidden = !(showZZ && st.pais);
  if (showZZ) {
    $('#selPais').innerHTML = '<option value="">Todos os países</option>' + paisesList().map(p => `<option>${esc(p)}</option>`).join('');
    $('#selPais').value = st.pais;
    if (st.pais) {
      $('#selCidade').innerHTML = '<option value="">Todas as cidades</option>' + citiesOf(st.pais).map(c => `<option value="${c.cd}">${esc(title(c.nm))}</option>`).join('');
      $('#selCidade').value = st.cidade;
    }
  }
  $('#cardPaises').hidden = st.uf !== 'zz';
}

function changed(resetSel) {
  if (resetSel) st.sel.clear();
  writeHash();
  buildTabs(); buildSelects();
  $('#cands').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  $('#cands').dataset.key = '';
  $('#cardEvo').classList.add('loading');
  refreshNow();
}

function bindUI() {
  $('#tabsCargo').addEventListener('click', e => {
    const b = e.target.closest('.tab'); if (!b || b.dataset.k === st.cargo) return;
    st.cargo = b.dataset.k;
    if (!CARGOS[st.cargo].nacional && st.uf === 'zz') { st.uf = 'br'; st.pais = st.cidade = ''; }
    changed(true);
  });
  $('#selUf').addEventListener('change', e => { setUf(e.target.value); });
  $('#selMun').addEventListener('change', e => { st.mun = e.target.value; changed(false); });
  $('#selPais').addEventListener('change', e => { st.pais = e.target.value; st.cidade = ''; changed(false); });
  $('#selCidade').addEventListener('change', e => { st.cidade = e.target.value; changed(false); });
  let qT;
  $('#q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { st.q = e.target.value; rerender(); }, 120); });
  $('#chips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    if (b.classList.contains('clear')) st.sel.clear();
    else st.sel.has(b.dataset.sq) ? st.sel.delete(b.dataset.sq) : st.sel.add(b.dataset.sq);
    writeHash(); rerender();
  });
  $('#map').addEventListener('click', e => {
    const t = e.target.closest('.tile'); if (!t) return;
    const uf = t.dataset.uf;
    // no celular o 1º toque mostra o detalhe; o 2º toque (ou o botão) filtra
    if (mapPtr !== 'mouse' && mapFocus !== uf && st.uf !== uf) { mapFocus = uf; renderMapDetail(); markFocus(); return; }
    mapFocus = ''; setUf(st.uf === uf ? 'br' : uf);
  });
  $('#map').addEventListener('pointerdown', e => { mapPtr = e.pointerType; });
  $('#map').addEventListener('pointerover', e => {
    const t = e.target.closest('.tile'); if (!t || e.pointerType !== 'mouse' || mapFocus === t.dataset.uf) return;
    mapFocus = t.dataset.uf; renderMapDetail(); markFocus();
  });
  $('#map').addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { mapFocus = ''; renderMapDetail(); markFocus(); } });
  $('#mapDetail').addEventListener('click', e => { const b = e.target.closest('.md-go'); if (b) { mapFocus = ''; setUf(b.dataset.uf); } });
  $('#cands').addEventListener('click', e => { const t = e.target.closest('.pano'); if (t) setUf(t.dataset.uf); });
  $('#paises').addEventListener('click', e => {
    const r = e.target.closest('.prow'); if (!r) return;
    st.pais = st.pais === r.dataset.p ? '' : r.dataset.p; st.cidade = ''; changed(false);
  });
  $('#btnRefresh').addEventListener('click', () => { cache.clear(); paisesAt = 0; refreshNow(); });
  $('#btnShare').addEventListener('click', async () => {
    const url = location.href;
    try {
      if (navigator.share && matchMedia('(pointer:coarse)').matches) await navigator.share({ title: 'Apuração 2026', url });
      else { await navigator.clipboard.writeText(url); toast('Link copiado com os filtros atuais'); }
    } catch { /* cancelado */ }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshNow(); });
  addEventListener('online', refreshNow);
  addEventListener('offline', updateLive);
  addEventListener('pagehide', saveHist);
  addEventListener('hashchange', () => { readHash(); buildTabs(); buildSelects(); refreshNow(); });
}
function setUf(uf) {
  if (uf === 'zz' && !CARGOS[st.cargo].nacional) return;
  const keepSel = CARGOS[st.cargo].nacional; // presidente: mesmo candidato em todo o país
  st.uf = uf; st.mun = ''; st.pais = ''; st.cidade = '';
  changed(!keepSel);
  scrollTo({ top: 0, behavior: 'smooth' });
}

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- Animações ---------- */
function tween(el, to, fmt, ms = 800) {
  const from = el._v ?? 0; el._v = to;
  cancelAnimationFrame(el._raf);
  if (from === to || document.hidden) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = t => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
const fmtInt = v => nf.format(Math.round(v));
const fmtPct = v => pf.format(v);

/* ---------- Render: recorte principal ---------- */
let current = null; // { p, ctx }

function matchQ(c) {
  if (!st.q) return true;
  const q = norm(st.q);
  return norm(c.nm).includes(q) || norm(c.full).includes(q) || norm(c.sg).includes(q) || c.n === st.q.trim();
}
function scopeName() {
  if (st.uf === 'br') return 'Brasil';
  if (st.uf === 'zz') {
    if (st.cidade) { const c = ZZ.find(x => x.cd === st.cidade); return `${title(c?.nm || '')} · ${st.pais}`; }
    return st.pais ? `${st.pais} (exterior)` : 'Exterior';
  }
  const m = st.mun && MUN?.[st.uf]?.find(x => x.cd === st.mun);
  return m ? `${title(m.nm)} · ${st.uf.toUpperCase()}` : UFS[st.uf];
}

function scopeKey(k = st.cargo) {
  if (st.uf === 'zz' && st.cidade) return urlDados(k, 'zz', st.cidade);
  if (st.uf === 'zz' && st.pais) return `agg-c${CARGOS[k].cd}-${st.pais}`;
  return urlDados(k, st.uf, st.mun);
}

function renderKpis(p) {
  const t = p.tot;
  $('#scopeCargo').textContent = CARGOS[st.cargo].nome + (TURNO === 2 ? ' · 2º turno' : ' · 1º turno');
  $('#scopeTitle').textContent = scopeName();
  tween($('#pst'), t.pst, fmtPct);
  $('#pstBar').style.width = Math.min(100, t.pst) + '%';
  const k = [
    ['Seções', `${nf.format(t.st)}<em>/ ${nf.format(t.ts)}</em>`],
    ['Eleitorado', nf.format(t.te)],
    ['Comparecimento', `${fmtPct(t.pc)}%`],
    ['Abstenção', `${fmtPct(t.pa)}%`],
    ['Votos válidos', nf.format(t.vv)],
    ['Brancos', `${fmtPct(t.pvb)}%`],
    ['Nulos', `${fmtPct(t.pvn)}%`],
  ];
  $('#kpis').innerHTML = k.map(([a, b]) => `<div class="kpi"><small>${a}</small><b>${b}</b></div>`).join('');
  $('#tseHora').textContent = p.dg ? `${p.dg.slice(0, 5)} ${p.hg}` : '—';
  setBanner(p);
}

function setBanner(p) {
  const b = $('#banner');
  let msg = '';
  if (SIM) msg = 'Modo simulação: os números são fictícios, gerados só para testar a página. Remova ?simular=1 do endereço para ver os dados reais.';
  else if (p && p.tot.st === 0) msg = 'A apuração ainda não começou. As urnas fecham às 17h (horário de Brasília); a página atualiza sozinha assim que o TSE divulgar os primeiros números.';
  b.hidden = !msg; b.textContent = msg;
}

function renderChips(cands) {
  const box = $('#chips');
  if (!cands) { box.innerHTML = ''; return; }
  const list = cands.filter(matchQ);
  box.innerHTML = (st.sel.size ? '<button class="chip clear">Limpar seleção</button>' : '') +
    list.map(c => `<button class="chip" data-sq="${c.sq}" aria-pressed="${st.sel.has(c.sq)}" style="--c:${colorOf(c)}"><i></i>${esc(c.nm)} · ${c.n}</button>`).join('');
}

function candEl(c, fotoUf) {
  const el = document.createElement('article');
  el.className = 'cand'; el.dataset.sq = c.sq;
  el.style.setProperty('--c', colorOf(c));
  const ini = c.nm.split(/\s+/).slice(0, 2).map(w => w[0]).join('');
  const vsLbl = c.vsTp === 's' ? '1º supl.' : 'vice';
  el.innerHTML = `
    <div class="rank"></div>
    <div class="ph"><span class="ini">${esc(ini)}</span><img loading="lazy" alt="" src="${urlFoto(st.cargo, fotoUf, c.sq)}" onerror="this.remove()"></div>
    <div class="info">
      <div class="nm"><span>${esc(c.nm)}</span><span class="badges"></span></div>
      <div class="meta">${esc(c.sg)} · ${c.n}${c.vs[0] ? ` · ${vsLbl} ${esc(title(c.vs[0]))}` : ''}${c.com && c.com !== c.sg ? ` · ${esc(c.com)}` : ''}</div>
      <div class="bar"><i></i></div>
    </div>
    <div class="nums"><div class="pct">0,00%</div><div class="votes">0 votos</div><div class="tr"></div><div class="gap"></div></div>`;
  return el;
}

function renderMain(p) {
  current = { p };
  renderKpis(p);
  renderChips(p.cands);
  const box = $('#cands');
  const key = `${st.cargo}|${st.uf}|${st.mun}|${st.pais}|${st.cidade}`;
  if (box.dataset.key !== key || box.classList.contains('panorama')) {
    box.innerHTML = ''; box.className = 'cands'; box.dataset.key = key;
  }
  const fotoUf = st.uf === 'zz' ? 'br' : st.uf;
  const leaderVap = p.cands[0]?.vap || 0;
  const started = p.tot.st > 0;
  const list = p.cands.filter(c => (!st.sel.size || st.sel.has(c.sq)) && matchQ(c));
  const maxP = Math.max(1, ...p.cands.map(c => c.pvap));
  const h = hist[scopeKey()];

  // FLIP: posições antes da reordenação
  const first = new Map();
  for (const el of box.children) if (el.dataset.sq) first.set(el.dataset.sq, el.getBoundingClientRect().top);

  const keep = new Set(list.map(c => c.sq));
  for (const el of [...box.children]) if (!keep.has(el.dataset.sq)) el.remove();

  list.forEach(c => {
    let el = box.querySelector(`.cand[data-sq="${c.sq}"]`);
    if (!el) el = candEl(c, fotoUf);
    const rank = p.cands.indexOf(c) + 1;
    el.querySelector('.rank').textContent = rank;
    el.classList.toggle('lead', started && rank <= p.nv);
    const pctEl = el.querySelector('.pct');
    if (el._last !== undefined && c.vap > el._last) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    el._last = c.vap;
    tween(pctEl, c.pvap, v => fmtPct(v) + '%');
    tween(el.querySelector('.votes'), c.vap, v => fmtInt(v) + ' votos');
    el.querySelector('.bar i').style.width = (c.pvap / maxP * 100) + '%';
    el.querySelector('.tr').innerHTML = trendHtml(trendOf(h, c.sq));
    el.querySelector('.gap').textContent = started && rank > 1 && leaderVap ? `−${nf.format(leaderVap - c.vap)} do 1º` : '';
    let badge = '';
    if (c.st && !/não eleito/i.test(c.st)) badge = `<span class="badge${/2º turno/i.test(c.st) ? ' t2' : ''}">${esc(c.st)}</span>`;
    else if (st.cargo === 'sen' && started && rank <= p.nv && !p.tf) badge = '<span class="badge vaga">Na vaga</span>';
    el.querySelector('.badges').innerHTML = badge;
    box.appendChild(el);
  });
  if (!list.length) box.innerHTML = '<div class="empty">Nenhum candidato corresponde ao filtro.</div>';

  if (!document.hidden) for (const el of box.children) {
    const f = first.get(el.dataset.sq); if (f == null) continue;
    const dy = f - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  renderEvo(p);
}

/* ---------- Gráfico de evolução: % de cada candidato × % de seções apuradas ---------- */
const EVO_TOP = 5;
const evo = { data: null, raf: 0, hi: -1, g: null };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const lerp = (a, b, k) => a + (b - a) * k;

function niceStep(range, n) {
  const raw = range / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
}
const fmtAxis = v => (Math.abs(v) < 1e-9 ? 0 : v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';

// Curva monótona (Fritsch–Carlson, como d3.curveMonotoneX): suave e sem "inventar" picos entre os pontos
function smoothPath(P) {
  const n = P.length;
  if (n < 2) return n ? `M${P[0][0]},${P[0][1]}` : '';
  const t = new Array(n), s = [];
  for (let i = 0; i < n - 1; i++) { const h = P[i + 1][0] - P[i][0]; s[i] = h ? (P[i + 1][1] - P[i][1]) / h : 0; }
  for (let i = 1; i < n - 1; i++) {
    const h0 = P[i][0] - P[i - 1][0], h1 = P[i + 1][0] - P[i][0], p = (s[i - 1] * h1 + s[i] * h0) / ((h0 + h1) || 1);
    t[i] = (Math.sign(s[i - 1]) + Math.sign(s[i])) * Math.min(Math.abs(s[i - 1]), Math.abs(s[i]), 0.5 * Math.abs(p)) || 0;
  }
  t[0] = n > 2 ? (3 * s[0] - t[1]) / 2 : s[0];
  t[n - 1] = n > 2 ? (3 * s[n - 2] - t[n - 2]) / 2 : s[0];
  let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[i + 1], dx = (x1 - x0) / 3;
    d += `C${(x0 + dx).toFixed(1)},${(y0 + dx * t[i]).toFixed(1)} ${(x1 - dx).toFixed(1)},${(y1 - dx * t[i + 1]).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

function evoDomain(xs, series) {
  const x0 = xs[0], x1 = Math.max(xs[xs.length - 1], x0 + 0.5);
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const v of s.ys) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const pad = Math.max((hi - lo) * 0.12, 0.6);
  lo = Math.max(0, lo - pad); hi = Math.min(100, hi + pad);
  const step = niceStep(hi - lo, 4);
  return { x0, x1, y0: Math.max(0, Math.floor(lo / step) * step), y1: Math.min(100, Math.ceil(hi / step) * step) };
}

function renderEvo(p) {
  const card = $('#cardEvo');
  card.classList.remove('loading');
  card.hidden = !p;
  if (!p) { evo.data = null; return; }
  const key = scopeKey(), h = hist[key], pts = h?.pts || [];
  const col = new Map((h?.sq || []).map((sq, i) => [sq, i + 3]));
  const show = p.cands.filter(c => (!st.sel.size || st.sel.has(c.sq)) && matchQ(c)).slice(0, st.sel.size ? 8 : EVO_TOP);
  const series = show.map(c => ({ c, color: colorOf(c), ys: pts.map(q => q[col.get(c.sq)] == null ? null : q[col.get(c.sq)] / 100) }));

  $('#evoLegend').innerHTML = series.map(s => `<span class="evo-key" style="--c:${s.color}"><i></i><span class="evo-nm">${esc(s.c.nm)}</span><b>${fmtPct(s.c.pvap)}%</b>${trendHtml(trendOf(h, s.c.sq))}</span>`).join('');

  const ok = pts.length >= 2 && series.length > 0;
  const empty = $('#evoEmpty');
  empty.hidden = ok;
  $('#evoPlot').classList.toggle('blank', !ok);
  if (!ok) {
    empty.textContent = !series.length ? 'Nenhum candidato corresponde ao filtro.'
      : !p.tot.st ? 'O gráfico começa assim que o TSE divulgar as primeiras parciais.'
      : `Primeira parcial registrada (${fmtPct(p.tot.pst)}% apurado). As linhas aparecem na próxima atualização do TSE — deixe a página aberta.`;
    $('#evoSvg').innerHTML = ''; $('#evoTip').hidden = true;
    $('#evoNote').textContent = '';
    evo.data = null;
    return;
  }
  const xs = pts.map(q => q[2] / 100);
  $('#evoNote').textContent = `Registrado neste navegador desde ${fmtPct(xs[0])}% apurado · ${pts.length} parciais. ${matchMedia('(pointer:coarse)').matches ? 'Toque e arraste' : 'Passe o mouse'} no gráfico para ver cada momento.`;

  const sig = key + '|' + series.map(s => s.c.sq + s.color).join(',');
  const stamp = pts[pts.length - 1].join();
  const prev = evo.data;
  if (prev && prev.sig === sig && prev.stamp === stamp && prev.n === pts.length) return; // nada novo
  const d = { sig, stamp, n: pts.length, xs, pts, series, dom: evoDomain(xs, series), last: { x: xs[xs.length - 1], ys: series.map(s => s.ys[s.ys.length - 1]) } };
  evo.data = d;
  cancelAnimationFrame(evo.raf);
  const same = prev && prev.sig === sig;
  if (!same) { evo.hi = -1; evoBuild(d); }
  const animate = same && (d.n === prev.n || d.n === prev.n + 1) && !document.hidden && !reduceMotion.matches;
  if (!animate) { evoPaint(d.dom, null, 1); return; }
  // a ponta das linhas "cresce" do último ponto até o novo, e os eixos se ajustam juntos
  const t0 = performance.now(), from = prev.last, fromDom = prev.dom;
  const step = now => {
    const k = Math.min(1, (now - t0) / 900), e = 1 - Math.pow(1 - k, 3);
    evoPaint({ x0: lerp(fromDom.x0, d.dom.x0, e), x1: lerp(fromDom.x1, d.dom.x1, e), y0: lerp(fromDom.y0, d.dom.y0, e), y1: lerp(fromDom.y1, d.dom.y1, e) }, from, e);
    if (k < 1) evo.raf = requestAnimationFrame(step);
  };
  evo.raf = requestAnimationFrame(step);
}

function evoBuild(d) {
  const rev = d.series.map((s, i) => [s, i]).reverse(); // 1º colocado desenhado por cima
  $('#evoSvg').innerHTML = `<defs><clipPath id="evoClip"><rect></rect></clipPath>${d.series.map((s, i) =>
    `<linearGradient id="evoG${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".14"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`).join('')}</defs>
    <g class="evo-grid"></g>
    <g clip-path="url(#evoClip)">
      ${rev.map(([s, i]) => `<path class="evo-area draw" data-i="${i}" fill="url(#evoG${i})"></path>`).join('')}
      ${rev.map(([s, i]) => `<path class="evo-line draw" data-i="${i}" pathLength="1" style="--c:${s.color}"></path>`).join('')}
    </g>
    <g class="evo-cross" hidden><line></line>${d.series.map((s, i) => `<circle r="4.5" data-i="${i}" style="--c:${s.color}"></circle>`).join('')}</g>
    <g class="evo-ends draw">${rev.map(([s, i]) => `<g data-i="${i}" style="--c:${s.color}"><line class="evo-lead"></line><circle class="evo-pulse" r="4"></circle><circle class="evo-dot" r="4.5"></circle><text></text></g>`).join('')}</g>`;
}

function evoPaint(dom, from, k) {
  const d = evo.data, box = $('#evoPlot'), svg = $('#evoSvg');
  const W = box.clientWidth;
  if (!d || W < 60 || !svg.firstChild) return;
  const mobile = W < 520, H = mobile ? 210 : 250;
  const m = { t: 12, r: mobile ? 50 : 58, b: 26, l: mobile ? 32 : 38 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('height', H);
  const X = x => m.l + (x - dom.x0) / ((dom.x1 - dom.x0) || 1) * pw;
  const Y = y => m.t + (1 - (y - dom.y0) / ((dom.y1 - dom.y0) || 1)) * ph;
  const r = svg.querySelector('#evoClip rect');
  r.setAttribute('x', m.l - 4); r.setAttribute('y', m.t - 6); r.setAttribute('width', pw + 8); r.setAttribute('height', ph + 12);

  // grade e eixos
  const ys = niceStep(dom.y1 - dom.y0, mobile ? 3 : 4), xsS = niceStep(dom.x1 - dom.x0, Math.max(2, Math.floor(pw / 80)));
  let g = '';
  for (let v = Math.ceil(dom.y0 / ys - 1e-9) * ys; v <= dom.y1 + 1e-9; v += ys) {
    const y = Y(v).toFixed(1);
    g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${y}" y2="${y}"></line><text x="${m.l - 8}" y="${y}" dy=".32em" text-anchor="end">${fmtAxis(v)}</text>`;
  }
  for (let v = Math.ceil(dom.x0 / xsS - 1e-9) * xsS; v <= dom.x1 + 1e-9; v += xsS) {
    const x = X(v);
    if (x < m.l + 14 || x > m.l + pw - 14) continue;
    g += `<text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle">${fmtAxis(v)}</text>`;
  }
  g += `<text class="evo-ax" x="${m.l}" y="${H - 6}">${fmtAxis(d.xs[0])}</text><text class="evo-ax" x="${m.l + pw}" y="${H - 6}" text-anchor="end">${fmtAxis(d.last.x)} apurado</text>`;
  svg.querySelector('.evo-grid').innerHTML = g;

  // linhas, áreas e pontas
  const n = d.xs.length, lx = from ? lerp(from.x, d.last.x, k) : d.last.x, bottom = m.t + ph;
  const ends = [];
  d.series.forEach((s, i) => {
    const P = [];
    for (let j = 0; j < n - 1; j++) if (s.ys[j] != null) P.push([X(d.xs[j]), Y(s.ys[j])]);
    let ly = s.ys[n - 1];
    if (from && ly != null && from.ys[i] != null) ly = lerp(from.ys[i], ly, k);
    if (ly != null) { P.push([X(lx), Y(ly)]); ends.push({ i, x: X(lx), y: Y(ly), v: ly, ly: Y(ly) }); }
    const path = smoothPath(P);
    svg.querySelector(`.evo-line[data-i="${i}"]`).setAttribute('d', path);
    svg.querySelector(`.evo-area[data-i="${i}"]`).setAttribute('d', P.length > 1 ? `${path}L${P[P.length - 1][0].toFixed(1)},${bottom}L${P[0][0].toFixed(1)},${bottom}Z` : '');
  });
  // rótulos na ponta: afastados para não se sobreporem, com linha-guia até a ponta
  ends.sort((a, b) => a.ly - b.ly);
  const gap = 15;
  for (let j = 1; j < ends.length; j++) ends[j].ly = Math.max(ends[j].ly, ends[j - 1].ly + gap);
  const over = ends.length ? ends[ends.length - 1].ly - (bottom + 4) : 0;
  if (over > 0) for (let j = ends.length - 1; j >= 0; j--) ends[j].ly = j === ends.length - 1 ? ends[j].ly - over : Math.min(ends[j].ly, ends[j + 1].ly - gap);
  const tx = m.l + pw + 12;
  for (const e of ends) {
    const el = svg.querySelector(`.evo-ends g[data-i="${e.i}"]`);
    el.querySelector('.evo-dot').setAttribute('cx', e.x); el.querySelector('.evo-dot').setAttribute('cy', e.y);
    el.querySelector('.evo-pulse').setAttribute('cx', e.x); el.querySelector('.evo-pulse').setAttribute('cy', e.y);
    const ln = el.querySelector('.evo-lead');
    ln.setAttribute('x1', e.x + 6); ln.setAttribute('y1', e.y); ln.setAttribute('x2', tx - 3); ln.setAttribute('y2', e.ly);
    const t = el.querySelector('text');
    t.setAttribute('x', tx); t.setAttribute('y', e.ly); t.setAttribute('dy', '.32em');
    t.textContent = e.v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }
  evo.g = { m, pw, ph, W, H, X, Y };
  if (evo.hi >= 0) evoHover();
}

function evoHover() {
  const d = evo.data, g = evo.g, cross = $('#evoSvg .evo-cross'), tip = $('#evoTip');
  if (!d || !g || !cross) return;
  if (evo.hi < 0) { cross.setAttribute('hidden', ''); tip.hidden = true; return; }
  const j = Math.min(evo.hi, d.n - 1), x = g.X(d.xs[j]);
  cross.removeAttribute('hidden');
  const ln = cross.querySelector('line');
  ln.setAttribute('x1', x); ln.setAttribute('x2', x); ln.setAttribute('y1', g.m.t); ln.setAttribute('y2', g.m.t + g.ph);
  d.series.forEach((s, i) => {
    const c = cross.querySelector(`circle[data-i="${i}"]`), v = s.ys[j];
    c.style.display = v == null ? 'none' : '';
    if (v != null) { c.setAttribute('cx', x); c.setAttribute('cy', g.Y(v)); }
  });
  const rows = d.series.map(s => ({ s, v: s.ys[j] })).filter(r => r.v != null).sort((a, b) => b.v - a.v);
  const hg = d.pts[j][0];
  tip.innerHTML = `<header>${fmtPct(d.xs[j])}% apurado${hg ? ` · ${esc(hg)}` : ''}</header>` +
    rows.map(r => `<div style="--c:${r.s.color}"><i></i><b>${fmtPct(r.v)}%</b><span>${esc(r.s.c.nm)}</span></div>`).join('');
  tip.hidden = false;
  const w = tip.offsetWidth;
  let left = x + 14;
  if (left + w > g.W) left = x - 14 - w;
  tip.style.left = Math.max(0, left) + 'px';
  tip.style.top = g.m.t + 'px';
}

function bindEvo() {
  const box = $('#evoPlot');
  const pick = e => {
    const d = evo.data, g = evo.g; if (!d || !g) return;
    const px = e.clientX - box.getBoundingClientRect().left;
    let best = 0, bd = Infinity;
    d.xs.forEach((x, j) => { const dd = Math.abs(g.X(x) - px); if (dd < bd) { bd = dd; best = j; } });
    evo.hi = best; evoHover();
  };
  box.addEventListener('pointermove', pick);
  box.addEventListener('pointerdown', pick);
  box.addEventListener('pointerleave', () => { evo.hi = -1; evoHover(); });
  box.addEventListener('keydown', e => {
    const d = evo.data; if (!d || !/Arrow(Left|Right)/.test(e.key)) return;
    e.preventDefault();
    evo.hi = Math.max(0, Math.min(d.n - 1, (evo.hi < 0 ? d.n - 1 : evo.hi) + (e.key === 'ArrowLeft' ? -1 : 1)));
    evoHover();
  });
  box.addEventListener('focus', () => { if (evo.data && evo.hi < 0) { evo.hi = evo.data.n - 1; evoHover(); } });
  box.addEventListener('blur', () => { evo.hi = -1; evoHover(); });
  let lastW = 0;
  new ResizeObserver(() => {
    const w = box.clientWidth;
    if (w === lastW || !evo.data) return;
    lastW = w; cancelAnimationFrame(evo.raf); evoPaint(evo.data.dom, null, 1);
  }).observe(box);
}

/* Governador/Senador com "Brasil": panorama dos 27 estados */
function renderPanorama() {
  const box = $('#cands');
  box.className = 'cands panorama'; box.dataset.key = 'pano';
  const datas = Object.keys(UFS).map(uf => [uf, mapData[st.cargo + uf]]).filter(x => x[1]);
  const agg = aggregate(datas.map(x => x[1]));
  agg.tot.pst = agg.tot.ts ? agg.tot.st / agg.tot.ts * 100 : 0;
  renderKpis(agg);
  renderChips(null);
  renderEvo(null);
  const top = CARGOS[st.cargo].cd === '0005' ? 3 : 2;
  datas.sort((a, b) => UFS[a[0]].localeCompare(UFS[b[0]], 'pt-BR'));
  box.innerHTML = datas.map(([uf, p]) => `
    <div class="pano" data-uf="${uf}">
      <div class="pano-h"><b>${UFS[uf]}</b><small>${fmtPct(p.tot.pst)}% apurado</small></div>
      ${p.cands.filter(matchQ).slice(0, top).map(c => `<div class="pano-row" style="--c:${colorOf(c)}"><i></i><span>${esc(c.nm)} <small style="color:var(--muted)">${esc(c.sg)}</small></span><b>${fmtPct(c.pvap)}%</b></div>`).join('')}
    </div>`).join('') || '<div class="empty">Carregando estados…</div>';
}

function rerender() {
  if (st.uf === 'br' && !CARGOS[st.cargo].nacional) renderPanorama();
  else if (current) renderMain(current.p);
  renderMap();
  renderPaises();
}

/* ---------- Mapa em mosaico ---------- */
const mapData = {};
function renderMap() {
  const k = st.cargo, nac = CARGOS[k].nacional;
  const single = nac && st.sel.size === 1 ? [...st.sel][0] : null;
  const tiles = Object.entries(TILES).filter(([uf]) => uf !== 'zz' || nac);
  let maxHeat = 0;
  if (single) for (const [uf] of tiles) { const c = mapData[k + uf]?.cands.find(x => x.sq === single); if (c) maxHeat = Math.max(maxHeat, c.pvap); }
  const leaders = new Map();
  $('#map').innerHTML = tiles.map(([uf, [x, y]]) => {
    const p = mapData[k + uf];
    let c = null, a = 0, label = '';
    if (p) {
      const pool = p.cands.filter(z => !st.sel.size || st.sel.has(z.sq) || !nac);
      c = single ? p.cands.find(z => z.sq === single) : pool[0];
      if (c && c.vap > 0) {
        a = single ? (maxHeat ? .15 + .75 * c.pvap / maxHeat : 0) : .25 + Math.min(.6, (c.pvap - (pool[1]?.pvap || 0)) / 40);
        label = `${c.pvap.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
        if (!single) { const id = nac ? c.sq : c.sg; const l = leaders.get(id) || { c, n: 0, lbl: nac ? c.nm : c.sg }; l.n++; leaders.set(id, l); }
      } else label = '—';
    }
    const color = c ? colorOf(c) : '#2a3550';
    const pst = p?.tot.pst || 0;
    const name = uf === 'zz' ? 'EXT' : uf.toUpperCase();
    return `<div class="tile${uf === 'zz' ? ' ext' : ''}${st.uf === uf ? ' sel' : ''}${mapFocus === uf ? ' focus' : ''}" data-uf="${uf}" style="grid-column:${x};grid-row:${y};--c:${color};--a:${a.toFixed(3)}" title="${uf === 'zz' ? 'Exterior' : UFS[uf]}${c && c.vap ? ` · ${esc(c.nm)} ${fmtPct(c.pvap)}%` : ''} · ${fmtPct(pst)}% apurado">
      <b>${name}</b><small>${esc(label)}</small><span class="tp" style="width:${pst}%"></span></div>`;
  }).join('');
  $('#mapHint').textContent = hoverOk() ? 'Passe o mouse para detalhes · clique para filtrar' : 'Toque em um estado para ver detalhes';
  $('#mapKey').innerHTML = single
    ? '<span><b>45%</b> = votos do candidato selecionado no estado</span><span><i class="k-bar"></i> = urnas apuradas</span>'
    : `<span><i class="k-tile"></i> cor = ${nac ? 'quem lidera' : 'partido que lidera'}</span><span><b>45%</b> = votos de quem lidera</span><span><i class="k-bar"></i> = urnas apuradas</span>`;
  $('#legend').innerHTML = single
    ? (() => { const c = current?.p.cands.find(x => x.sq === single); return c ? `<span style="--c:${colorOf(c)}"><i></i>${esc(c.nm)} — quanto mais forte, maior o percentual</span>` : ''; })()
    : [...leaders.values()].sort((a, b) => b.n - a.n).map(({ c, n, lbl }) => `<span style="--c:${colorOf(c)}"><i></i>${esc(lbl)} · lidera em ${n}</span>`).join('');
  renderMapDetail();
}

function markFocus() { for (const t of $('#map').children) t.classList.toggle('focus', t.dataset.uf === mapFocus); }

/* Detalhe do estado: hover no computador, toque no celular */
const hoverOk = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
let mapFocus = '', mapPtr = 'mouse';
function renderMapDetail() {
  const box = $('#mapDetail');
  const uf = mapFocus || (TILES[st.uf] ? st.uf : '');
  const p = uf && mapData[st.cargo + uf];
  if (!p) { box.innerHTML = `<div class="md-empty">${hoverOk() ? 'Passe o mouse sobre' : 'Toque em'} um estado para ver urnas apuradas e quem lidera.</div>`; return; }
  const nome = uf === 'zz' ? 'Exterior' : UFS[uf];
  const nac = CARGOS[st.cargo].nacional;
  const list = p.cands.filter(c => !nac || !st.sel.size || st.sel.has(c.sq)).slice(0, 3);
  box.innerHTML = `
    <div class="md-h"><b>${nome}</b><span><strong>${fmtPct(p.tot.pst)}%</strong> das urnas apuradas</span></div>
    <div class="md-bar"><i style="width:${Math.min(100, p.tot.pst)}%"></i></div>
    ${p.tot.st ? list.map((c, i) => `<div class="md-row" style="--c:${colorOf(c)}"><i></i><span>${i + 1}º ${esc(c.nm)} <small>${esc(c.sg)}</small></span><small>${nf.format(c.vap)} votos</small><b>${fmtPct(c.pvap)}%</b></div>`).join('')
      : '<div class="md-empty">Apuração ainda não começou neste estado.</div>'}
    ${st.uf !== uf ? `<button class="md-go" data-uf="${uf}">Abrir ${nome} completo →</button>` : ''}`;
}
async function loadMap() {
  const k = st.cargo;
  const ufs = Object.keys(UFS).concat(CARGOS[k].nacional ? ['zz'] : []);
  await pool(ufs, 7, async uf => {
    try { mapData[k + uf] = await load(urlDados(k, uf)); record(urlDados(k, uf), mapData[k + uf]); } catch { /* mantém anterior */ }
  });
}

/* ---------- Exterior por país ---------- */
const cityData = new Map();
let paisesAt = 0, paisesBusy = false;
async function loadPaises() {
  if (st.uf !== 'zz' || !ZZ.length || paisesBusy || Date.now() - paisesAt < PAISES_MS) return;
  paisesBusy = true;
  let done = 0;
  try {
    await pool(ZZ, 8, async c => {
      try { cityData.set(c.cd, await load(urlDados('pres', 'zz', c.cd), PAISES_MS - 5000)); } catch { }
      done++;
      if (done % 12 === 0) { $('#paisesProg').textContent = `carregando ${done}/${ZZ.length} cidades`; renderPaises(); }
    });
    paisesAt = Date.now();
  } finally { paisesBusy = false; }
  renderPaises();
}
function renderPaises() {
  if (st.uf !== 'zz') return;
  const single = st.sel.size === 1 ? [...st.sel][0] : null;
  const rows = paisesList().map(pais => {
    const cs = citiesOf(pais);
    const agg = aggregate(cs.map(c => cityData.get(c.cd)));
    return { pais, n: cs.length, agg };
  }).filter(r => r.agg.cands.length);
  if (!rows.length) { $('#paises').innerHTML = '<div class="empty">Carregando países…</div>'; return; }
  const score = r => single ? (r.agg.cands.find(c => c.sq === single)?.pvap || 0) : r.agg.tot.te;
  rows.sort((a, b) => score(b) - score(a) || a.pais.localeCompare(b.pais, 'pt-BR'));
  if (!paisesBusy) $('#paisesProg').textContent = `${rows.length} países · ${single ? 'ordenado pelo candidato' : 'ordenado por eleitorado'}`;
  $('#paises').innerHTML = rows.map(({ pais, n, agg }) => {
    const cs = agg.cands.filter(c => (!st.sel.size || st.sel.has(c.sq)) && matchQ(c));
    const lead = cs[0];
    return `<div class="prow${st.pais === pais ? ' sel' : ''}" data-p="${esc(pais)}">
      <div><div class="pn">${esc(pais)}</div><div class="pm">${n} cidade${n > 1 ? 's' : ''} · ${nf.format(agg.tot.te)} eleitores · ${fmtPct(agg.tot.pst)}% apurado</div></div>
      <div><div class="stack">${cs.slice(0, 5).map(c => `<i style="--c:${colorOf(c)};width:${c.pvap}%"></i>`).join('')}</div>
      <div class="pl">${lead && lead.vap ? `${esc(lead.nm)} ${fmtPct(lead.pvap)}%` : 'aguardando'}</div></div></div>`;
  }).join('');
}

/* ---------- Carga do recorte principal ---------- */
let mainSeq = 0;
async function loadMain() {
  const my = ++mainSeq, k = st.cargo, key = scopeKey();
  if (st.uf === 'br' && !CARGOS[k].nacional) { await loadMap(); if (my === mainSeq) renderPanorama(); return; }
  let p;
  if (st.uf === 'zz' && st.cidade) p = await load(urlDados(k, 'zz', st.cidade));
  else if (st.uf === 'zz' && st.pais) {
    const arr = await pool(citiesOf(st.pais), 6, c => load(urlDados(k, 'zz', c.cd)).then(x => (cityData.set(c.cd, x), x)).catch(() => null));
    p = aggregate(arr);
  } else p = await load(urlDados(k, st.uf, st.mun));
  record(key, p);
  if (my === mainSeq) renderMain(p);
}

/* ---------- Ciclo de atualização ---------- */
let timer = null, running = false;
function updateLive() {
  const el = $('#live'), t = $('#liveTxt');
  let s, txt;
  if (!navigator.onLine) { s = 'off'; txt = 'Sem internet'; }
  else if (health.fails >= 2 || (health.okAt && Date.now() - health.okAt > REFRESH_MS * 3)) { s = 'retry'; txt = 'Reconectando…'; }
  else if (health.okAt) { s = 'ok'; txt = SIM ? 'Simulação' : 'Ao vivo'; }
  else { s = 'wait'; txt = 'Conectando…'; }
  el.dataset.state = s; t.textContent = txt;
}
function startRing() {
  const r = $('#ring');
  r.classList.remove('run'); void r.getBoundingClientRect();
  r.style.setProperty('--dur', REFRESH_MS + 'ms'); r.classList.add('run');
}
async function tick() {
  clearTimeout(timer);
  if (document.hidden) return; // pausa em segundo plano; volta ao reabrir a aba
  if (running) { timer = setTimeout(tick, 1000); return; }
  running = true;
  $('#btnRefresh').classList.add('spin');
  try {
    const res = await Promise.allSettled([loadMain(), loadMap()]);
    if (res[0].status === 'rejected' && !current) {
      $('#cands').innerHTML = `<div class="empty">Não foi possível ler os dados do TSE agora (${esc(res[0].reason?.message || 'erro')}). Nova tentativa em instantes…</div>`;
    }
    renderMap();
    loadPaises(); // em paralelo, sem bloquear o ciclo
  } finally {
    running = false;
    saveHist();
    $('#btnRefresh').classList.remove('spin');
    updateLive(); startRing();
    timer = setTimeout(tick, REFRESH_MS);
  }
}
function refreshNow() { current = null; tick(); }

/* ---------- Início ---------- */
(async function init() {
  readHash();
  if (TURNO === 2) $('#sub').textContent = 'Eleições Gerais · 2º turno · dados oficiais do TSE';
  buildTabs(); buildSelects(); bindUI(); bindEvo();
  $('#cands').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  setInterval(updateLive, 5000);
  tick();
  await loadMunicipios();
  buildSelects();
  if (st.uf === 'zz') { paisesAt = 0; loadPaises(); }
})();
