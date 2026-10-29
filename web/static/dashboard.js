'use strict';
// Live dashboard for one server: race strip, chat, rotation and players

const COLORS = ['white', 'yellow', 'green', 'cyan', 'magenta', 'red'];

let selected = qs.get('server');
let data = null;
let color = 'yellow';
let chatKey = '';
let actionsKey = '';

$('skip-btn').innerHTML = `${icon('skip')}Skip`;
$('restart-race-btn').innerHTML = `${icon('restart')}Restart race`;
$('send-btn').innerHTML = `${icon('send')}Send`;
$('player-search-wrap').insertAdjacentHTML('afterbegin', icon('search'));
$('picker').innerHTML = COLORS.map(c =>
  `<button type="button" class="sw bg-${c}" role="radio" data-color="${c}" aria-label="${c}" title="${c}"></button>`).join('');
renderColor();

const sidebar = initSidebar({
  page: 'servers',
  selected,
  onPick: pick,
  onServers(r) {
    if (!r.servers.some(s => s.id === selected) && r.servers.length) pick(r.servers[0].id);
  },
});

function pick(id) {
  if (id === selected) return;
  selected = id;
  history.replaceState(null, '', `/?server=${enc(id)}`);
  sidebar.setSelected(id);
  data = null;
  chatKey = actionsKey = '';
  $('player-search').value = '';
  load();
}

async function load() {
  if (!selected) return;
  const id = selected;
  try {
    const r = await api('GET', `/api/servers/${enc(id)}/live`);
    if (id !== selected) return;
    data = r;
    render();
  } catch (e) {
    if (id === selected) $('name').textContent = e.message;
  }
}
load();
setInterval(load, 1500);

function render() {
  const s = data.server, live = data.live;
  const st = STATUS[s.status] || STATUS.stopped;
  document.title = `${s.name} · MX Simulator Server Manager`;
  $('name').textContent = s.name;
  $('badge').hidden = false;
  $('badge').textContent = st.label;
  $('badge').style.color = st.color;
  $('address').textContent = `${location.hostname}:${s.port}`;
  $('offline-settings').href = `/settings?server=${enc(s.id)}`;
  renderActions(s);

  const up = s.status === 'running';
  $('offline').hidden = up;
  $('online').hidden = !up;
  if (!up) return renderOffline(s);

  renderHero(s, live);
  renderChat(live ? live.chat : []);
  renderRotation(live);
  renderPlayers(live ? live.players : []);
}

function renderActions(s) {
  const key = `${s.id}:${s.status}`;
  if (key === actionsKey) return;
  actionsKey = key;
  const settings = `<a class="btn" href="/settings?server=${enc(s.id)}">${icon('sliders')}Settings</a>`;
  const power = s.status === 'running' || s.status === 'starting'
    ? `<button class="btn" type="button" data-power="restart">${icon('restart')}Restart server</button>
       <button class="btn btn-dng" type="button" data-power="stop">${icon('stop')}Stop</button>`
    : `<button class="btn btn-pri" type="button" data-power="start">${icon('play')}Start server</button>`;
  $('actions').innerHTML = settings + power;
}

function renderOffline(s) {
  const crashed = s.status === 'crashed', starting = s.status === 'starting';
  $('offline-title').textContent = crashed ? 'Server keeps stopping' : starting ? 'Starting…' : 'Server offline';
  $('offline-text').textContent = crashed
    ? `${s.lastExit || 'mxserver stopped.'} It will try again in a moment. The server's output below usually says why, often a setting it doesn't accept.`
    : 'No live data while the game server is stopped. You can still change its settings; they apply the next time it starts.';
  const out = data.console.join('\n');
  $('console').hidden = !crashed || !out;
  $('console').textContent = out;
}

function trackIndex(live) {
  if (!live || !live.track.dir) return -1;
  return data.rotation.findIndex(t => t.dir === live.track.dir);
}

function rule(t) {
  return t.minutes ? `${t.minutes} min + ${plural(t.laps, 'lap')}` : plural(t.laps, 'lap');
}

function renderHero(s, live) {
  const rot = data.rotation, idx = trackIndex(live);
  const prog = progress(live) || { label: 'LAP', value: '–', finished: false };
  const now = idx >= 0 ? rot[idx].name : live ? live.track.name || live.track.dir : '';
  const next = rot.length ? rot[(idx + 1) % rot.length] : null;

  $('hero-tag').textContent = !live ? 'WAITING FOR THE SERVER' : `${prog.finished ? 'RACE FINISHED' : 'NOW RACING'} · TRACK ${idx >= 0 ? idx + 1 : '?'} OF ${rot.length}`;
  $('hero-name').textContent = now || 'Loading track…';
  $('prog-label').innerHTML = `${icon('flag', 12)}${esc(prog.label)}`;
  $('prog-value').textContent = prog.value;
  $('race-time').textContent = live && live.raceTime >= 0 ? fmtClock(live.raceTime) : '–';
  $('player-count').textContent = `${live ? live.players.length : 0} / ${s.maxClients}`;
  $('next-track').innerHTML = next && idx >= 0 ? `${esc(next.name)} <span>${esc(rule(next))}</span>` : '–';
  $('finished').hidden = !prog.finished;
  $('finished-next').textContent = next ? next.name : 'the next track';
}

function renderChat(chat) {
  const key = chat.length ? `${chat.length}:${chat[chat.length - 1].t}` : '0';
  if (key === chatKey) return;
  chatKey = key;
  const log = $('chat-log');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  log.innerHTML = chat.length ? chat.map(c => {
    const t = new Date(c.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (!c.who) return `<div><span class="t">${t}</span> <span class="sys">${esc(c.text)}</span></div>`;
    return `<div><span class="t">${t}</span> <span class="who">${esc(c.who)}:</span> <span class="${c.color ? 'c-' + esc(c.color) : ''}">${esc(c.text)}</span></div>`;
  }).join('') : '<div class="sys">No messages since the server started.</div>';
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function renderRotation(live) {
  const idx = trackIndex(live), n = data.rotation.length;
  $('rotation').innerHTML = data.rotation.map((t, i) => {
    const tag = i === idx ? 'NOW' : idx >= 0 && i === (idx + 1) % n ? 'NEXT' : '';
    return `
      <li class="${i === idx ? 'now' : ''}">
        <span class="n">${i + 1}</span>
        <span class="name">${esc(t.name)}<span class="rule">${esc(rule(t))}</span></span>
        <span class="tag-now">${tag}</span>
        <button class="ibtn" type="button" data-act="settrack" data-track="${i}" aria-label="Jump to ${esc(t.name)}" title="Jump to this track">${icon('jump')}</button>
      </li>`;
  }).join('');
}

function renderPlayers(players) {
  const q = $('player-search').value.trim().toLowerCase();
  const sorted = players.slice().sort((a, b) => (a.place || 999) - (b.place || 999) || a.slot - b.slot);
  const shown = sorted.filter(p => !q || p.name.toLowerCase().includes(q) || String(p.uid).includes(q));
  const racing = players.filter(p => p.status === 'Player').length;
  $('players-summary').textContent = `${players.length} online · ${racing} racing · ${players.length - racing} spectating`;

  $('players').innerHTML = shown.map(p => {
    const reserved = data.reserve.includes(p.uid);
    const marshal = p.rank === 'Marshal', admin = p.rank === 'Admin', noUid = !p.uid;
    const who = `data-uid="${p.uid}" data-slot="${p.slot}" data-name="${esc(p.name)}"`;
    const toggle = (on, act, offAct, name, label, offLabel, disabled) =>
      `<button class="ibtn${on ? ' ibtn-on' : ''}" type="button" data-act="${on ? offAct : act}" ${who} aria-pressed="${on}"
        aria-label="${esc((on ? offLabel : label) + ': ' + p.name)}" title="${esc(on ? offLabel : label)}"${disabled ? ' disabled' : ''}>${icon(name)}</button>`;
    return `
      <tr>
        <td>${p.place ? `<span class="place${p.place <= 3 ? ' top' : ''}">${p.place}</span>` : '<span class="muted">—</span>'}</td>
        <td class="rider"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-weight:600"><span class="mono muted" style="font-weight:500">#${p.slot}</span> ${esc(p.name)}</span>
          ${admin ? '<span class="tag tag-admin">ADMIN</span>' : ''}
          ${marshal ? '<span class="tag tag-marshal">MARSHAL</span>' : ''}
          ${reserved ? '<span class="tag tag-reserved">RESERVED</span>' : ''}
          ${p.muted ? '<span class="tag tag-muted">MUTED</span>' : ''}
        </div></td>
        <td class="mono">${p.uid || '<span class="muted" title="Key not verified">—</span>'}</td>
        <td class="muted">${esc(p.bike)}</td>
        <td class="mono" style="${p.ping > 100 ? 'color:var(--warn);font-weight:600' : ''}">${p.ping} ms</td>
        <td>${p.status === 'Player' ? 'Racing' : 'Spectating'}</td>
        <td class="actions"><div class="row-actions">
          ${toggle(marshal, 'marshal', 'unmarshal', 'flag', 'Make marshal', 'Remove marshal', admin || noUid)}
          ${toggle(reserved, 'reserve', 'unreserve', 'reserve', 'Reserve a slot', 'Unreserve slot', noUid)}
          <button class="ibtn${p.muted ? ' ibtn-on' : ''}" type="button" data-act="mute" ${who} aria-pressed="${p.muted}"
            aria-label="${esc((p.muted ? 'Muted: ' : 'Mute ') + p.name)}" title="${p.muted ? 'Muted until they reconnect (mxserver has no unmute)' : 'Mute'}"${p.muted || noUid ? ' disabled' : ''}>${icon('mute')}</button>
          <button class="ibtn ibtn-dng" type="button" data-act="kick" ${who} aria-label="Kick ${esc(p.name)}" title="Kick">${icon('kick')}</button>
          <button class="ibtn ibtn-dng" type="button" data-act="ban" ${who} aria-label="Ban ${esc(p.name)}" title="Ban"${noUid ? ' disabled' : ''}>${icon('ban')}</button>
        </div></td>
      </tr>`;
  }).join('');

  const empty = $('players-empty');
  empty.hidden = shown.length > 0;
  empty.textContent = players.length
    ? `No player matches “${q}”.`
    : `Nobody is connected. Players join in game under Multiplayer with ${location.hostname}:${data.server.port}.`;
  renderSendTo(players);
}

function renderSendTo(players) {
  const select = $('send-to'), value = select.value;
  const options = players.slice().sort((a, b) => a.slot - b.slot)
    .map(p => `<option value="${p.slot}">${p.slot} · ${esc(p.name)}</option>`).join('');
  const html = '<option value="">All players</option>' + options;
  if (select.dataset.html === html) return;
  select.dataset.html = html;
  select.innerHTML = html;
  select.value = players.some(p => String(p.slot) === value) ? value : '';
}

function renderColor() {
  const btn = $('color-btn');
  btn.className = `ibtn bg-${color}`;
  btn.innerHTML = icon('drop');
  btn.setAttribute('aria-label', `Message color: ${color}`);
  for (const sw of $('picker').children) sw.setAttribute('aria-checked', sw.dataset.color === color);
}

async function command(body, button) {
  if (button) button.disabled = true;
  try {
    const r = await api('POST', `/api/servers/${enc(selected)}/command`, body);
    toast(`Sent: ${r.sent}`);
    setTimeout(load, 500);
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

document.addEventListener('click', async e => {
  const power = e.target.closest('[data-power]');
  if (power) {
    const action = power.dataset.power;
    if (action === 'stop' && !confirm(`Stop ${data.server.name}? Everyone on it is disconnected.`)) return;
    power.disabled = true;
    try {
      await api('POST', `/api/servers/${enc(selected)}/${action}`);
      toast({ start: 'Server starting', stop: 'Server stopped', restart: 'Server restarted, settings applied' }[action]);
    } catch (err) {
      toast(err.message, true);
    }
    actionsKey = '';
    await load();
    sidebar.refresh();
    return;
  }

  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, uid, slot, name, track } = btn.dataset;
  if (act === 'kick' && !confirm(`Kick ${name}?`)) return;
  if (act === 'ban' && !confirm(`Ban ${name} (UID ${uid}) for good? You can lift it in Settings → People.`)) return;
  if (act === 'restart' && !confirm('Restart the current race?')) return;
  command({
    action: act,
    uid: uid ? Number(uid) : undefined,
    slot: slot ? Number(slot) : undefined,
    track: track ? Number(track) : undefined,
  }, btn);
});

$('player-search').addEventListener('input', () => data && data.live && renderPlayers(data.live.players));

$('color-btn').addEventListener('click', () => {
  const open = $('picker').hidden;
  $('picker').hidden = !open;
  $('color-btn').setAttribute('aria-expanded', open);
});

$('picker').addEventListener('click', e => {
  const sw = e.target.closest('[data-color]');
  if (!sw) return;
  color = sw.dataset.color;
  renderColor();
  $('picker').hidden = true;
  $('color-btn').setAttribute('aria-expanded', 'false');
  $('message').focus();
});

$('chat-form').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('message').value.trim();
  if (!text) return;
  const to = $('send-to').value;
  const sent = await command({ action: 'say', text, color, slot: to ? Number(to) : undefined }, $('send-btn'));
  if (sent) $('message').value = '';
});
