'use strict';
/* ---------- helpers & state ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY = 'nlplab.vocab.v1';
let vocab = [];                       // [{token,count}] — TID is the array index
try { vocab = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { vocab = []; }
let last = null, view = 'spell', prog = {tok: false, emb: false}, pick = 0;
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(vocab)); } catch (e) {} };
const download = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; a.click(); URL.revokeObjectURL(a.href); };
/** Split text into lowercase word / punctuation tokens. */
const words = t => t.toLowerCase().match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}]/gu) || [];

const SAMPLE_VOCAB = 'I love AI. I love learning AI. AI is learning. The cat and the bat saw a rat, a dog and a lion. The king, the queen, the prince and the princess love the apple, the banana and the car.';
const SAMPLE_SENT = 'The cat and the bat saw a rat, a dog, a lion, a king, a queen, a prince and a princess';

/* ---------- glossary (info icons) ---------- */
const GLOSS = {
  'Token': 'A small unit of text: a word, punctuation mark, character or word piece. "I love AI." → I, love, AI, .',
  'Vocabulary': 'The set of unique tokens the system knows. Example: {i, love, ai}.',
  'Token ID': 'An arbitrary whole number given to each vocabulary token (love → 1). It is a label, not a meaning.',
  'Token Frequency': 'How many times one token appears. Example: "ai" appears 4 times → frequency 4.',
  'Vocabulary Size': 'The number of different tokens. "ai ai ai love" has 4 token occurrences but vocabulary size 2.',
  'UNK Token': 'Placeholder for a token that is not in the vocabulary. "zebra" → [UNK] if never added.',
  'Subword Tokenization': 'Splits unknown words into known pieces. "learnt" → "learn" + "t". BPE and WordPiece do this.',
  'Vector': 'An ordered list of numbers, e.g. [0.2, 0, 1]. Used to compare words mathematically.',
  'Embedding': 'A vector that represents a word so similar words get similar vectors.',
  'Spelling-Based Representation': 'Vector from letters, letter pairs and length. Cat/bat/rat share "at", so they look alike.',
  'Meaning-Based Representation': 'Vector from meaning. Cat and dog are both pets/animals, so they are close, despite different spelling.',
  'Cosine Similarity': 'Angle-based similarity of two vectors: 1 = same direction, 0 = unrelated. Example: [1,0]·[1,1] → 0.71.'
};
document.addEventListener('click', e => {
  const i = e.target.closest('.info'), tip = $('#tip');
  if (i) { const k = i.dataset.t; tip.innerHTML = `<b>${k}</b><br>${GLOSS[k]}`; tip.hidden = false; }
  else tip.hidden = true;
});

/* ---------- Stage 1: vocabulary ---------- */
/** Add every token of `text` to the vocabulary; repeated tokens increase the count. */
function addText(text) {
  const ts = words(text); if (!ts.length) return 0;
  const idx = new Map(vocab.map((v, i) => [v.token, i]));
  ts.forEach(t => { if (idx.has(t)) vocab[idx.get(t)].count++; else { idx.set(t, vocab.length); vocab.push({token: t, count: 1}); } });
  save(); renderVocab(); return ts.length;
}
function renderVocab() {
  const q = $('#vQ').value.trim().toLowerCase(), s = $('#vSort').value;
  const rows = vocab.map((v, i) => ({...v, tid: i})).filter(r => r.token.includes(q));
  rows.sort(s === 'alpha' ? (a, b) => a.token.localeCompare(b.token) : s === 'freq' ? (a, b) => b.count - a.count || a.tid - b.tid : (a, b) => a.tid - b.tid);
  $('#vTbl tbody').innerHTML = rows.map(r => `<tr><td>${r.tid}</td><td>${esc(r.token)}</td><td>${r.count}</td><td class="ok">Known</td><td><button class="s" data-rm="${r.tid}" title="Remove">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="m">No vocabulary yet — add text or load the sample.</td></tr>';
  const occ = vocab.reduce((s, v) => s + v.count, 0);
  $('#vStats').innerHTML = `<div>Unique tokens: <b>${vocab.length}</b></div><div>Total occurrences: <b>${occ}</b></div><div>Vocabulary size: <b>${vocab.length}</b></div>`;
  $('#p1').classList.toggle('done', vocab.length > 0);
}
$('#vAdd').onclick = () => { const t = $('#vIn').value; if (!t.trim()) return alert('Enter some text first.'); addText(t); $('#vIn').value = ''; };
$('#vOneBtn').onclick = () => { const t = $('#vOne').value.trim(); if (words(t).length !== 1) return alert('Please enter exactly one word.'); addText(t); $('#vOne').value = ''; };
$('#vSample').onclick = () => { vocab = []; addText(SAMPLE_VOCAB); };
$('#vReset').onclick = () => { vocab = []; save(); last = null; prog = {tok: false, emb: false}; ['#vIn', '#tokIn', '#vQ'].forEach(s => $(s).value = ''); $('#tokOut').innerHTML = ''; $('#tokInfo').hidden = true; $('#pipe').textContent = ''; renderVocab(); renderEmb(); progress(); };
$('#vFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  if (!/\.txt$/i.test(f.name)) return alert('Please choose a .txt file.');
  const r = new FileReader(); r.onload = () => { addText(String(r.result)); e.target.value = ''; }; r.readAsText(f);
};
$('#vCsv').onclick = () => {
  if (!vocab.length) return alert('Vocabulary is empty.');
  const cell = t => '"' + (/^[=+\-@]/.test(t) ? "'" + t : t).replace(/"/g, '""') + '"';
  download('vocabulary.csv', 'TID,Token,Count\n' + vocab.map((v, i) => `${i},${cell(v.token)},${v.count}`).join('\n'), 'text/csv');
};
$('#vQ').oninput = $('#vSort').onchange = renderVocab;
$('#vTbl').onclick = e => { const i = e.target.dataset.rm; if (i !== undefined) { vocab.splice(+i, 1); save(); renderVocab(); } };

/* ---------- Stage 2: tokenization ---------- */
/** All substrings of vocabulary words = pieces we "know" for subword splitting. */
function pieceSet() { const S = new Set(); vocab.forEach(v => { const t = v.token; for (let i = 0; i < t.length; i++) for (let j = i + 1; j <= t.length; j++) S.add(t.slice(i, j)); }); return S; }
/** Greedy longest-match split of a word into known pieces; unmatched characters become UNK. */
function split(w, S) {
  const out = []; let i = 0;
  while (i < w.length) { let j = w.length; while (j > i && !S.has(w.slice(i, j))) j--; if (j === i) { out.push({t: w[i], unk: 1}); i++; } else { out.push({t: w.slice(i, j)}); i = j; } }
  return out;
}
/** Tokenize `text` with `mode` (word|char|subword); `handle` (unk|split) decides what happens to unknown words. */
function run(text, mode, handle) {
  const m = new Map(vocab.map((v, i) => [v.token, i])), S = pieceSet(), out = [];
  const known = t => ({t, tid: m.get(t), count: vocab[m.get(t)].count, st: 'Known', why: 'Found in vocabulary.'});
  const piece = (p, from) => p.unk ? {t: p.t, st: 'UNK', why: `Character "${p.t}" never appears in any vocabulary word, so it cannot be represented.`}
    : m.has(p.t) ? known(p.t) : {t: p.t, st: 'Piece', why: `Not a vocabulary token itself, but a known piece of vocabulary words${from ? ` (part of "${from}")` : ''}; it has no Token ID.`};
  if (mode === 'char') [...text.toLowerCase().replace(/\s+/g, '')].forEach(c => out.push(piece(S.has(c) ? {t: c} : {t: c, unk: 1})));
  else words(text).forEach(w => {
    if (m.has(w)) return out.push(known(w));
    if (mode === 'subword' || handle === 'split') split(w, S).forEach(p => out.push(piece(p, w)));
    else out.push({t: w, label: '[UNK]', st: 'UNK', why: `"${w}" is not in the vocabulary. This does not mean it is wrong — the vocabulary just hasn't seen it. Add it in Stage 1 or use subword splitting.`});
  });
  return out;
}
function doTok() {
  const text = $('#tokIn').value.trim();
  if (!text) return alert('Enter a sentence first.');
  const mode = $('#mode').value, handle = document.querySelector('input[name=h]:checked').value, r = run(text, mode, handle);
  if (!r.length) return alert('No tokens found.');
  last = {text, mode, handle, r}; prog.tok = true; progress();
  const hue = (t, i) => ((t.tid !== undefined ? t.tid : i) * 47) % 360;
  const unk = r.filter(t => t.st === 'UNK').length, kn = r.length - unk, uniq = new Set(r.map(t => t.t)).size;
  const cls = {Known: 'ok', Piece: 'pc', UNK: 'bad'};
  $('#tokOut').innerHTML = `<h3>Original</h3><div class="note">${esc(text)}</div><h3>Tokens (click one)</h3><div>${r.map((t, i) => `<span class="chip ${t.st}" style="--h:${hue(t, i)}" data-i="${i}">${esc(t.label || t.t)}</span>`).join('')}</div>
  <div class="note">${r.length} tokens generated (${uniq} unique) using <b>${{word: 'word-level', char: 'character-level', subword: 'subword'}[mode]}</b> tokenization. <span class="ok">${kn} known</span> · <span class="bad">${unk} unknown (UNK)</span>${mode === 'word' ? `. Unknown words are handled by <b>${handle === 'unk' ? 'replacing with [UNK]' : 'subword splitting'}</b>` : ''}.</div>
  <div class="scroll"><table><thead><tr><th>Position</th><th>Token</th><th>Token ID</th><th>Frequency</th><th>Status</th><th>Why</th></tr></thead><tbody>${r.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t.label || t.t)}</td><td>${t.tid ?? '—'}</td><td>${t.count ?? '—'}</td><td class="${cls[t.st]}">${t.st === 'Piece' ? 'Known piece' : t.st}</td><td class="m">${esc(t.why)}</td></tr>`).join('')}</tbody></table></div>`;
  $('#tokInfo').hidden = true;
  $('#pipe').innerHTML = `<b>Pipeline:</b> text (${text.length} chars) → ${r.length} tokens → vocabulary of ${vocab.length} → ${r.filter(t => t.tid !== undefined).length} tokens with Token IDs → embeddings (Stage 3)`;
  renderEmb();
}
$('#tokGo').onclick = doTok;
$('#tokClear').onclick = () => { $('#tokIn').value = ''; $('#tokOut').innerHTML = ''; $('#tokInfo').hidden = true; last = null; live(); renderEmb(); };
$('#tokSample').onclick = () => { $('#tokIn').value = SAMPLE_SENT; live(); };
$('#tokExport').onclick = () => last ? download('tokenization.json', JSON.stringify({text: last.text, method: last.mode, unknownHandling: last.handle, tokens: last.r.map((t, i) => ({position: i + 1, token: t.t, tokenId: t.tid ?? null, frequency: t.count ?? null, status: t.st}))}, null, 2), 'application/json') : alert('Tokenize something first.');
$('#tokOut').onclick = e => {
  const c = e.target.closest('.chip'); if (!c) return; const t = last.r[+c.dataset.i], b = $('#tokInfo');
  b.hidden = false; b.innerHTML = `<b>${esc(t.t)}</b> · Token ID: ${t.tid ?? 'none'} · Frequency: ${t.count ?? 0} · Status: ${t.st}<br><span class="m">${esc(t.why)}</span>`;
};
const live = () => { const n = words($('#tokIn').value).length; $('#live').textContent = `Live count: ${n} word/punctuation tokens`; };
$('#tokIn').oninput = live;

/* ---------- Stage 3: embeddings ---------- */
// Educational concept lexicon: first tag = group. NOT a trained model.
const LEX = {cat:'animal pet small',dog:'animal pet',lion:'animal wild big',tiger:'animal wild big',bat:'animal wild small',rat:'animal small',horse:'animal big',
  king:'royalty person male',queen:'royalty person female',prince:'royalty person male young',princess:'royalty person female young',
  man:'person male',woman:'person female',boy:'person male young',girl:'person female young',apple:'food fruit',banana:'food fruit',bread:'food',rice:'food',
  car:'vehicle',bus:'vehicle big',train:'vehicle big',bike:'vehicle small',ai:'tech',computer:'tech',robot:'tech',learning:'tech',love:'emotion',happy:'emotion',sad:'emotion'};
const DIMS = [...new Set(Object.values(LEX).join(' ').split(' '))];
const semVec = w => { const t = (LEX[w] || '').split(' '); return DIMS.map(d => t.includes(d) ? 1 : 0); };
/** Spelling features: 26 letter frequencies + 64 hashed character bigrams (with ^ $ boundaries) + length. */
function spellVec(w) {
  const v = new Array(91).fill(0);
  for (const c of w) { const k = c.charCodeAt(0) - 97; if (k >= 0 && k < 26) v[k] += 1 / w.length; }
  const s = '^' + w + '$';
  for (let i = 0; i < s.length - 1; i++) { let h = 0; for (const c of s.slice(i, i + 2)) h = (h * 31 + c.charCodeAt(0)) % 64; v[26 + h] += 1 / (s.length - 1); }
  v[90] = w.length / 10; return v;
}
const bigrams = w => { const s = '^' + w + '$', o = []; for (let i = 0; i < s.length - 1; i++) o.push(s.slice(i, i + 2)); return o; };
const cos = (a, b) => { const d = a.reduce((s, x, i) => s + x * b[i], 0), n = Math.hypot(...a) * Math.hypot(...b); return n ? d / n : 0; };
/** PCA to 2D / 3D via power iteration with deflation. */
function pca(X) {
  const n = X.length, d = X[0].length, mu = X[0].map((_, j) => X.reduce((s, r) => s + r[j], 0) / n), Z = X.map(r => r.map((v, j) => v - mu[j])), C = [];
  for (let k = 0; k < 3; k++) {
    let v = Array.from({length: d}, (_, j) => Math.sin(j + 1 + k * 7));
    for (let it = 0; it < 80; it++) {
      const p = Z.map(r => r.reduce((s, x, j) => s + x * v[j], 0)); let nv = new Array(d).fill(0);
      Z.forEach((r, i) => r.forEach((x, j) => nv[j] += x * p[i]));
      C.forEach(c => { const dp = nv.reduce((s, x, j) => s + x * c[j], 0); nv = nv.map((x, j) => x - dp * c[j]); });
      const nm = Math.hypot(...nv) || 1; v = nv.map(x => x / nm);
    }
    C.push(v);
  }
  return Z.map(r => C.map(c => r.reduce((s, x, j) => s + x * c[j], 0)));
}
const wordList = () => { const src = $('#tokIn').value || vocab.map(v => v.token).join(' '); return [...new Set(src.toLowerCase().match(/\p{L}{2,}/gu) || [])].slice(0, 40); };
const PAL = ['#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#a3a3a3'];
const plot = {pts: [], v: {k: 1, x: 0, y: 0}, hover: -1, dim: '3d', auto: true, dragging: false, rot: {a: 0.6, b: 0.35}};
function renderEmb() {
  const ws = wordList(), cv = $('#cv');
  $('#tSpell').classList.toggle('on', view === 'spell'); $('#tSem').classList.toggle('on', view === 'sem');
  const keep = [$('#wa').value, $('#wb').value];
  ['#wa', '#wb'].forEach((s, i) => { $(s).innerHTML = ws.map(w => `<option>${esc(w)}</option>`).join(''); if (ws.includes(keep[i])) $(s).value = keep[i]; else if (ws[i]) $(s).value = ws[i]; });
  $('#embNote').innerHTML = view === 'spell' ? '<b>Real feature extraction:</b> letter frequencies + hashed character bigrams + length → PCA to 2D / 3D. Words sharing letter patterns (cat, bat, rat) cluster.'
    : '<b>Simplified educational approximation</b> — not a trained language model. Vectors come from a small hand-made concept lexicon (' + Object.keys(LEX).length + ' words) → PCA to 2D / 3D. Words outside the lexicon are skipped.';
  $('#embNote').innerHTML += '<br><span class="m">Reducing many dimensions to 2D or 3D can change apparent distances; use the similarity scores for exact comparison.</span>';
  const list = view === 'spell' ? ws : ws.filter(w => LEX[w]);
  const old = new Map(plot.pts.map(p => [p.w, p])); plot.pts = []; plot.hover = -1; $('#legend').innerHTML = '';
  if (list.length < 2) { $('#hov').textContent = ws.length < 2 ? 'Enter at least two words in Stage 2 (try the sample sentence).' : 'Fewer than two of your words are in the meaning lexicon.'; draw(); compare(); return; }
  const V = list.map(view === 'spell' ? spellVec : semVec), xy = pca(V), m = Math.max(...xy.flat().map(Math.abs)) || 1, cnt = {};
  list.forEach(w => cnt[w.slice(-2)] = (cnt[w.slice(-2)] || 0) + 1);
  const gOf = w => view === 'spell' ? (cnt[w.slice(-2)] > 1 ? `ends with "${w.slice(-2)}"` : 'other') : LEX[w].split(' ')[0], gs = [...new Set(list.map(gOf))];
  plot.pts = list.map((w, i) => { const o = old.get(w) || {x: 0, y: 0, z: 0}; // start from the old position so tab switches animate
    return {w, x: o.x, y: o.y, z: o.z, tx: xy[i][0] / m, ty: xy[i][1] / m, tz: xy[i][2] / m, v: V[i], g: gOf(w), c: PAL[gs.indexOf(gOf(w)) % PAL.length]}; });
  $('#legend').innerHTML = gs.map((g, i) => `<span><span class="dot" style="background:${PAL[i % PAL.length]}"></span>${esc(g)}</span>`).join(' ');
  if (!prog.emb) { prog.emb = true; progress(); }
  $('#hov').textContent = 'Hover a point to inspect it. Click points to pick words A and B. Scroll to zoom, drag to pan (2D) or rotate (3D).';
  draw(); compare();
}
/** Project a point to the screen. 3D: rotate (yaw a, pitch b) then apply perspective. Returns [x, y, scale, depth]. */
const scr = p => {
  const c = $('#cv'), v = plot.v, S = Math.min(c.width, c.height) * 0.42;
  let x = p.x, y = p.y, z = p.z || 0, s = 1;
  if (plot.dim === '3d') {
    const {a, b} = plot.rot, x1 = x * Math.cos(a) + z * Math.sin(a), z1 = -x * Math.sin(a) + z * Math.cos(a);
    y = p.y * Math.cos(b) - z1 * Math.sin(b); z = p.y * Math.sin(b) + z1 * Math.cos(b); x = x1; s = 1 / (1 - z * 0.3);
  }
  return [c.width / 2 + x * s * v.k * S + v.x, c.height / 2 - y * s * v.k * S + v.y, s, z];
};
function draw() {
  const c = $('#cv'), g = c.getContext('2d'), d3 = plot.dim === '3d'; g.clearRect(0, 0, c.width, c.height);
  g.font = '14px system-ui'; g.lineWidth = 1;
  const line = (a, b) => { const s = scr(a), e = scr(b); g.beginPath(); g.moveTo(s[0], s[1]); g.lineTo(e[0], e[1]); g.stroke(); return e; };
  if (d3) { g.strokeStyle = '#2a326099'; for (let t = -1; t <= 1; t += 0.5) { line({x: t, y: -1.1, z: -1}, {x: t, y: -1.1, z: 1}); line({x: -1, y: -1.1, z: t}, {x: 1, y: -1.1, z: t}); } } // floor grid = depth cue
  const ax = d3 ? [[1.1, 0, 0, 'Dim 1'], [0, 1.1, 0, 'Dim 2'], [0, 0, 1.1, 'Dim 3']] : [[1.1, 0, 0, 'Dimension 1 (PCA) →'], [0, 1.1, 0, '↑ Dimension 2 (PCA)']];
  g.strokeStyle = '#4b5594'; g.fillStyle = '#9aa3d0';
  ax.forEach(([x, y, z, l]) => { const e = line({x: -x, y: -y, z: -z}, {x, y, z}); g.fillText(l, e[0] + 4, e[1] - 4); });
  const A = plot.pts.find(p => p.w === $('#wa').value), B = plot.pts.find(p => p.w === $('#wb').value);
  if (A && B && A !== B) { // dashed link between the two selected words, labelled with their cosine similarity in this view
    const a = scr(A), b = scr(B); g.save(); g.setLineDash([6, 4]); g.strokeStyle = '#fbbf24'; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.restore();
    g.fillStyle = '#fbbf24'; g.fillText('cos = ' + cos(A.v, B.v).toFixed(2), (a[0] + b[0]) / 2 + 6, (a[1] + b[1]) / 2 - 6);
  }
  plot.pts.map((p, i) => [i, scr(p)]).sort((a, b) => a[1][3] - b[1][3]).forEach(([i, [x, y, s]]) => { // far points first
    const p = plot.pts[i], big = i === plot.hover || p.w === $('#wa').value || p.w === $('#wb').value, r = (big ? 9 : 6) * s, al = d3 ? Math.min(1, 0.4 + s * 0.45) : 1;
    if (d3) { const f = scr({x: p.x, y: -1.1, z: p.z}); g.globalAlpha = al * 0.3; g.strokeStyle = p.c; g.beginPath(); g.moveTo(x, y); g.lineTo(f[0], f[1]); g.stroke(); }
    g.globalAlpha = al; g.shadowColor = p.c; g.shadowBlur = 14; g.fillStyle = p.c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.shadowBlur = 0;
    g.fillStyle = '#e6e9ff'; g.fillText(p.w, x + r + 3, y + 4);
  });
  g.globalAlpha = 1;
}
/** Animation loop: eases points to their targets, auto-rotates the 3D scene (paused while dragging or hovering). */
function tick() {
  plot.pts.forEach(p => { p.x += (p.tx - p.x) * 0.1; p.y += (p.ty - p.y) * 0.1; p.z += (p.tz - p.z) * 0.1; });
  if (plot.dim === '3d' && plot.auto && !plot.dragging && plot.hover < 0) plot.rot.a += 0.006;
  draw(); requestAnimationFrame(tick);
}
$('#tAuto').onclick = () => { plot.auto = !plot.auto; $('#tAuto').textContent = plot.auto ? '⏸ Pause rotation' : '▶ Auto-rotate'; };
/** Describe the features behind a word's vector (shown on hover). */
function describe(w) {
  if (view === 'sem') return `<b>${esc(w)}</b> · concepts: ${esc(LEX[w].split(' ').join(', '))}<br><span class="m">Vector (${DIMS.length} dims): [${semVec(w).join(', ')}]</span>`;
  const f = {}; for (const c of w) f[c] = (f[c] || 0) + 1;
  return `<b>${esc(w)}</b> · length ${w.length} · letters: ${Object.entries(f).map(([c, n]) => c + '×' + n).join(' ')}<br><span class="m">character bigrams: ${esc(bigrams(w).join(' '))} (vector: 91 dims)</span>`;
}
(() => {
  const c = $('#cv'); let drag = null, moved = false;
  const pos = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
  const near = ([mx, my]) => plot.pts.findIndex(p => { const [x, y] = scr(p); return Math.hypot(x - mx, y - my) < 14; });
  c.onpointerdown = e => { plot.dragging = true; drag = pos(e); moved = false; c.setPointerCapture(e.pointerId); c.style.cursor = 'grabbing'; };
  c.onpointermove = e => { const p = pos(e);
    if (drag) { const dx = p[0] - drag[0], dy = p[1] - drag[1]; if (Math.abs(dx) + Math.abs(dy) > 2) moved = true; if (plot.dim === '3d') { plot.rot.a += dx * 0.008; plot.rot.b = Math.max(-1.5, Math.min(1.5, plot.rot.b + dy * 0.008)); } else { plot.v.x += dx; plot.v.y += dy; } drag = p; }
    else { const h = near(p); if (h !== plot.hover) { plot.hover = h; if (h >= 0) $('#hov').innerHTML = describe(plot.pts[h].w); } }
    draw(); };
  c.onpointerup = e => { c.style.cursor = 'grab'; if (!moved) { const h = near(pos(e)); if (h >= 0) { $(pick++ % 2 ? '#wb' : '#wa').value = plot.pts[h].w; compare(); draw(); } } drag = null; plot.dragging = false; };
  c.onpointerleave = () => { plot.hover = -1; };
  c.onwheel = e => { e.preventDefault(); plot.v.k = Math.min(8, Math.max(0.3, plot.v.k * Math.exp(-e.deltaY * 0.001))); draw(); };
})();
$('#resetView').onclick = () => { plot.v = {k: 1, x: 0, y: 0}; plot.rot = {a: 0.6, b: 0.35}; draw(); };
$('#tDim').onclick = () => { plot.dim = plot.dim === '2d' ? '3d' : '2d'; $('#tDim').textContent = plot.dim === '2d' ? 'Switch to 3D' : 'Switch to 2D'; plot.v = {k: 1, x: 0, y: 0}; draw(); };
$('#tSpell').onclick = () => { view = 'spell'; renderEmb(); };
$('#tSem').onclick = () => { view = 'sem'; renderEmb(); };
$('#wa').onchange = $('#wb').onchange = () => { compare(); draw(); };
/** Show spelling vs meaning similarity for the two selected words, with explanations. */
function compare() {
  const a = $('#wa').value, b = $('#wb').value; if (!a || !b) { $('#cmp').innerHTML = ''; return; }
  const sp = cos(spellVec(a), spellVec(b)), shB = bigrams(a).filter(x => bigrams(b).includes(x));
  let se = 'n/a (a word is not in the lexicon)', sx = '';
  if (LEX[a] && LEX[b]) { const A = LEX[a].split(' '), B = LEX[b].split(' '), sh = A.filter(t => B.includes(t)); se = cos(semVec(a), semVec(b)).toFixed(3); sx = sh.length ? `share concepts: ${sh.join(', ')}` : 'share no concepts in the lexicon'; }
  $('#cmp').innerHTML = `<div><b>Spelling similarity</b> (${esc(a)} vs ${esc(b)}): <b>${sp.toFixed(3)}</b><br><span class="m">${shB.length ? 'shared bigrams: ' + esc(shB.join(' ')) : 'no shared character bigrams'}</span></div><div><b>Meaning similarity:</b> <b>${se}</b><br><span class="m">${esc(sx)}</span></div><div class="m">Spelling and meaning similarity are different ideas: cat/bat look alike, cat/dog mean alike.</div>`;
}

/* ---------- progress & quiz ---------- */
function progress() { $('#p2').classList.toggle('done', prog.tok); $('#p3').classList.toggle('done', prog.emb); }
const QZ = [
  ['Vocabulary size is…', ['the total number of tokens in a text', 'the number of unique tokens', 'the sum of all frequencies'], 1],
  ['An [UNK] token means…', ['the token is not in the vocabulary', 'the word is misspelled', 'it is punctuation'], 0],
  ['Which representation puts "cat" and "dog" close together?', ['Spelling-based', 'Meaning-based', 'Token IDs'], 1],
  ['Token IDs are…', ['semantic vectors', 'arbitrary index numbers', 'frequencies'], 1]];
$('#qz').innerHTML = QZ.map((q, i) => `<p><b>${i + 1}. ${esc(q[0])}</b></p>` + q[1].map((o, j) => `<label><input type="radio" name="q${i}" value="${j}"> ${esc(o)}</label>`).join('')).join('');
$('#qGo').onclick = () => { let s = 0; QZ.forEach((q, i) => { const c = document.querySelector(`input[name=q${i}]:checked`); if (c && +c.value === q[2]) s++; }); $('#qRes').textContent = `Score: ${s} / ${QZ.length}`; };

/* ---------- init ---------- */
renderVocab(); live(); renderEmb(); progress(); tick();
