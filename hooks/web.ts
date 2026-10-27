// A página local: um servidor Node/Bun que o mod sobe com `$.process.spawn`.
// O mod manda o estado por POST /state (com token); a página recebe por SSE em /events.

const PAGE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GSD ► MANAGER</title>
<style>
:root { --bg:#0d1117; --panel:#161b22; --line:#30363d; --row:#21262d; --fg:#d0d7de; --strong:#f0f6fc; --dim:#6e7681; --muted:#8b949e;
  --green:#3fb950; --yellow:#d29922; --yellow-fg:#e3b341; --cyan:#39c5cf; --accent:#d77757; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
header { border-bottom: 1px solid var(--line); padding: 12px 16px; }
.wrap { max-width: 1200px; margin: 0 auto; }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.grow { flex-grow: 1; }
.dim { color: var(--dim); } .muted { color: var(--muted); } .small { font-size: 12px; }
.live { display: inline-flex; align-items: center; gap: 6px; color: var(--green); }
.live.off { color: var(--yellow-fg); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
main { padding: 24px 16px; display: flex; flex-direction: column; gap: 24px; }
nav { display: flex; flex-wrap: wrap; gap: 8px; }
.tab { font: inherit; cursor: pointer; display: flex; flex-direction: column; gap: 6px; min-width: 200px; min-height: 44px; padding: 10px 14px;
  background: transparent; color: var(--fg); border: 1px solid var(--line); border-radius: 6px; text-align: left; }
.tab[aria-pressed="true"] { background: var(--panel); color: var(--strong); border-color: var(--accent); }
.tab:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.meter { display: flex; align-items: center; gap: 8px; }
.meter .track { flex-grow: 1; height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; }
.meter .fill { display: block; height: 100%; background: var(--green); }
.title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 16px; }
h1 { margin: 0; font-size: 22px; color: var(--strong); }
.pct { font-size: 28px; font-weight: 700; color: var(--strong); }
.bar { display: flex; gap: 6px; height: 14px; margin-top: 12px; }
.bar span { background: var(--line); border-radius: 2px; overflow: hidden; }
.bar i { display: block; height: 100%; }
.cols { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.phases { flex: 999 1 560px; min-width: 0; border: 1px solid var(--line); border-radius: 6px; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th { color: var(--dim); font-weight: 400; text-align: left; padding: 10px 8px; }
td { padding: 10px 8px; border-top: 1px solid var(--row); vertical-align: top; }
th:first-child, td:first-child { padding-left: 14px; } th:last-child, td:last-child { padding-right: 14px; }
.c { text-align: center; padding-left: 4px; padding-right: 4px; }
.chip { display: inline-block; width: 16px; height: 16px; border-radius: 3px; vertical-align: middle; }
tr.active td { background: var(--panel); }
tr.active td.name { color: var(--strong); font-weight: 700; }
tr.plans td { border-top: 0; padding-top: 0; padding-bottom: 16px; }
.plans-grid { display: flex; flex-wrap: wrap; gap: 4px; }
.plan { min-width: 34px; padding: 2px 4px; text-align: center; font-size: 12px; border-radius: 3px; background: var(--row); color: var(--muted); }
.plan.done { background: #1f3a26; color: var(--green); }
.plan.now { background: #3d2f12; color: var(--yellow-fg); outline: 1px solid var(--yellow); }
aside { flex: 1 1 320px; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.card { border: 1px solid var(--line); border-radius: 6px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.card.doing { border-color: var(--yellow); }
h2 { margin: 0; font-size: 14px; }
.warn { color: var(--yellow-fg); }
.agent { display: flex; flex-direction: column; gap: 2px; }
.agent .head { display: flex; gap: 8px; align-items: baseline; }
.empty { color: var(--muted); padding: 48px 0; text-align: center; }
footer { color: var(--dim); font-size: 12px; border-top: 1px solid var(--line); padding-top: 12px; display: flex; flex-wrap: wrap; gap: 8px 16px; }
.break { overflow-wrap: anywhere; }
</style>
</head>
<body>
<header><div class="wrap top">
<span id="pulse" style="color: var(--green); font-size: 16px" aria-hidden="true">⠾</span>
<span class="dim">GSD ► MANAGER</span>
<span id="project" class="break"></span>
<span class="grow"></span>
<span id="session" class="dim"></span>
<span id="live" class="live off"><span class="dot"></span><span id="live-text">conectando…</span></span>
</div></header>
<main class="wrap" id="main"><div class="empty">Aguardando o painel…</div></main>
<script>
var COLOR = { done: 'var(--green)', partial: 'var(--yellow)', ready: 'var(--cyan)', blocked: 'var(--line)' };
var VERB = { 'gsd-discuss-phase': 'Discutindo', 'gsd-plan-phase': 'Planejando', 'gsd-execute-phase': 'Executando', 'gsd-verify-work': 'Verificando', 'gsd-code-review': 'Revisando' };
var data = null, view = null, receivedAt = 0, isLive = false, frame = 0;

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
function chip(mark) { var c = el('span', 'chip'); c.style.background = COLOR[mark]; c.setAttribute('aria-label', mark); return c; }
function isDone(r) { return r.status === 'Concluída'; }
function statusColor(r) { return r.e === 'done' ? 'var(--green)' : r.e === 'partial' ? 'var(--yellow)' : r.d === 'blocked' ? 'var(--dim)' : 'var(--cyan)'; }
function ago(ms) {
  var s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + 's';
  var m = Math.floor(s / 60);
  return m < 60 ? m + 'm ' + (s % 60) + 's' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
function when(iso) {
  var d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function tabs() {
  var nav = el('nav'); nav.setAttribute('aria-label', 'Workstreams');
  data.boards.forEach(function (b) {
    var t = el('button', 'tab'); t.type = 'button';
    t.setAttribute('aria-pressed', String(b.id === view));
    var name = add(el('span'), el('strong', null, b.id || 'raiz'), el('span', 'dim', ' · ' + b.version));
    var track = el('span', 'track'), fill = el('span', 'fill'); fill.style.width = b.percent + '%';
    add(track, fill);
    add(t, name, add(el('span', 'meter'), track, el('span', 'small', b.percent + '%')));
    t.onclick = function () { view = b.id; render(); };
    nav.appendChild(t);
  });
  return nav;
}

function bar(b) {
  var planned = b.rows.filter(function (r) { return r.plans > 0; });
  var avg = planned.length ? planned.reduce(function (s, r) { return s + r.plans; }, 0) / planned.length : 1;
  var box = el('div', 'bar'); box.setAttribute('aria-hidden', 'true');
  b.rows.forEach(function (r) {
    var seg = el('span'); seg.style.flex = (r.plans > 0 ? r.plans : avg) + ' 1 0';
    var ratio = isDone(r) ? 1 : r.plans > 0 ? r.summaries / r.plans : 0;
    var fill = el('i'); fill.style.width = (ratio * 100) + '%'; fill.style.background = statusColor(r);
    box.appendChild(add(seg, fill));
  });
  return box;
}

function phases(b) {
  var active = b.rows.filter(function (r) { return !isDone(r); })[0];
  var table = el('table'), head = el('tr');
  ['Fase', 'Nome', 'D', 'P', 'E', 'V', 'Planos', 'Status'].forEach(function (h, i) { head.appendChild(el('th', i >= 2 && i <= 5 ? 'c' : null, h)); });
  add(table, add(el('thead'), head));
  var body = el('tbody');
  b.rows.forEach(function (r) {
    var isActive = r === active, tr = el('tr', isActive ? 'active' : null);
    var muted = r.d === 'blocked' && !isActive;
    var num = el('td', null, (isActive ? '▶ ' : '') + r.number);
    if (isActive) { num.style.color = 'var(--yellow)'; num.style.fontWeight = '700'; }
    var status = r.status;
    if (isDone(r) && r.uatPending > 0) status = 'Concluída · UAT pendente (' + r.uatPending + ')';
    else if (isDone(r) && r.v === 'partial') status = 'Concluída · verificação pendente';
    var st = el('td', null, status); st.style.color = isDone(r) && r.v === 'partial' ? 'var(--yellow)' : statusColor(r);
    var plans = el('td', 'small', r.plans > 0 ? r.summaries + '/' + r.plans : '');
    plans.style.color = isActive ? 'var(--yellow)' : 'var(--muted)';
    add(tr, num, el('td', 'name', r.name),
      add(el('td', 'c'), chip(r.d)), add(el('td', 'c'), chip(r.p)), add(el('td', 'c'), chip(r.e)), add(el('td', 'c'), chip(r.v)),
      plans, st);
    if (muted) tr.style.color = 'var(--muted)';
    body.appendChild(tr);
    if (isActive && r.planList.length) {
      var grid = el('div', 'plans-grid'), nowTaken = false;
      r.planList.forEach(function (p) {
        var isNow = !p.isDone && !nowTaken;
        if (isNow) nowTaken = true;
        var short = p.id.split('-').slice(1).join('-') || p.id;
        var cell = el('span', 'plan' + (p.isDone ? ' done' : isNow ? ' now' : ''), (isNow ? '◆ ' : '') + short);
        cell.title = p.id + (p.isDone ? ' · com SUMMARY' : '');
        grid.appendChild(cell);
      });
      var cell = el('td'); cell.colSpan = 8;
      body.appendChild(add(el('tr', 'active plans'), add(cell, grid)));
    }
  });
  return add(el('section', 'phases'), add(table, body));
}

function activityCard() {
  var a = data.activity;
  if (!a) return null;
  var title = a.command ? (VERB[a.command] || '/' + a.command) + (a.phase ? ' fase ' + a.phase : '') : 'Em andamento';
  var card = add(el('section', 'card doing'), el('h2', 'warn', '◆ ' + title));
  a.agents.forEach(function (g) {
    var time = el('span', 'muted', ago(Date.now() - g.since)); time.dataset.since = g.since;
    card.appendChild(add(el('div', 'agent'),
      add(el('div', 'head'), el('strong', null, g.type), el('span', 'grow'), time),
      g.description ? el('div', null, g.description) : null));
  });
  if (a.command) card.appendChild(el('div', 'muted small', '/' + a.command + (a.phase ? ' ' + a.phase : '')));
  return card;
}

function pendingCard(b) {
  if (!b.pendencies.length) return null;
  var card = add(el('section', 'card'), el('h2', 'warn', '▲ ' + b.pendencies.length + (b.pendencies.length === 1 ? ' pendência' : ' pendências')));
  b.pendencies.forEach(function (p) { card.appendChild(el('div', null, p)); });
  return card;
}

function stateCard(b) {
  if (!b.stoppedAt && !b.lastUpdated) return null;
  return add(el('section', 'card'), el('h2', 'muted', 'Último registro (STATE.md)'),
    b.stoppedAt ? el('div', 'break', b.stoppedAt) : null,
    b.lastUpdated ? el('div', 'muted small', when(b.lastUpdated)) : null);
}

function render() {
  var main = document.getElementById('main');
  main.textContent = '';
  if (!data) return;
  document.getElementById('project').textContent = data.project;
  document.getElementById('session').textContent = 'sessão ' + data.session.slice(0, 8);
  if (!data.boards.length) { main.appendChild(el('div', 'empty', 'Nenhum milestone em progresso neste projeto.')); return; }
  if (!data.boards.some(function (b) { return b.id === view; })) view = data.selected;
  var b = data.boards.filter(function (x) { return x.id === view; })[0] || data.boards[0];
  document.title = 'GSD ► ' + (b.id ? b.id + ' · ' : '') + b.percent + '%';
  var head = add(el('div', 'title'), el('h1', null, b.version + ' ' + b.name),
    el('span', 'muted', b.done + ' de ' + b.total + ' fases'), el('span', 'grow'), el('span', 'pct', b.percent + '%'));
  add(main,
    data.boards.length > 1 ? tabs() : null,
    add(el('section'), head, bar(b)),
    add(el('div', 'cols'), phases(b), add(el('aside'), activityCard(), pendingCard(b), stateCard(b))),
    add(el('footer'), el('span', null, 'somente leitura'), el('span', null, location.origin), el('span', null, '/gsd-band web para desligar')));
}

function tick() {
  frame++;
  var live = document.getElementById('live');
  live.className = 'live' + (isLive ? '' : ' off');
  document.getElementById('live-text').textContent = isLive ? 'ao vivo · há ' + ago(Date.now() - receivedAt) : 'desconectado';
  document.getElementById('pulse').textContent = ['⠾', '⠷', '⠯', '⠟', '⠻', '⠽'][Math.floor(frame / 3) % 6];
  var times = document.querySelectorAll('[data-since]');
  for (var i = 0; i < times.length; i++) times[i].textContent = ago(Date.now() - Number(times[i].dataset.since));
}

var events = new EventSource('/events');
events.onmessage = function (ev) { data = JSON.parse(ev.data); receivedAt = Date.now(); isLive = true; render(); tick(); };
events.onerror = function () { isLive = false; tick(); };
setInterval(tick, 1000);
</script>
</body>
</html>
`

const SERVER_BODY = `
const http = require('node:http')
const token = process.env.GSD_BAND_TOKEN
let state = ''
let last = Date.now()
const clients = new Set()
const send = res => res.write('data: ' + state + '\\n\\n')

const server = http.createServer((req, res) => {
  const host = String(req.headers.host || '')
  if (!/^(127\\.0\\.0\\.1|localhost):\\d+$/.test(host)) return res.writeHead(403).end()
  const path = (req.url || '/').split('?')[0]
  if (req.method === 'POST' && path === '/state') {
    if (req.headers['x-gsd-band-token'] !== token) return res.writeHead(403).end()
    let body = ''
    req.on('data', chunk => { body += chunk; if (body.length > 8e6) req.destroy() })
    req.on('end', () => {
      last = Date.now()
      if (body !== state) { state = body; clients.forEach(send) }
      res.writeHead(204).end()
    })
    return
  }
  if (req.method === 'GET' && path === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    if (state) send(res)
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(PAGE)
  }
  res.writeHead(404).end()
})

const listen = port => server.listen(port, '127.0.0.1', () => console.log('PORT ' + server.address().port))
server.on('error', err => { if (err.code === 'EADDRINUSE') listen(0); else { console.error(err.message); process.exit(1) } })
listen(Number(process.env.GSD_BAND_PORT || 0))

// Sem notícia do mod por 2 minutos, a sessão acabou: encerra.
setInterval(() => {
  if (Date.now() - last > 120000) process.exit(0)
  clients.forEach(res => res.write(': ping\\n\\n'))
}, 15000)
`

/** O programa do servidor para `node -e` ou `bun -e`, com a página embutida. */
export const SERVER = `const PAGE = ${JSON.stringify(PAGE)};\n${SERVER_BODY}`
