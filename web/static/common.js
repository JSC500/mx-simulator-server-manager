'use strict';
// Shared by every page: icons, API calls, formatting and the sidebar

// 24×24 pixel icons, drawn as rectangles
const ICONS = {
  plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',
  trophy: 'M6 3h12v2H6z M6 5h2v6H6z M16 5h2v6h-2z M8 11h2v2H8z M14 11h2v2h-2z M10 13h4v4h-4z M7 17h10v4H7z M3 5h3v2H3z M3 7h2v2H3z M18 5h3v2h-3z M19 7h2v2h-2z',
  folder: 'M3 5h7v2H3z M10 7h11v2H10z M3 7h2v12H3z M19 9h2v10h-2z M3 19h18v2H3z',
  person: 'M9 3h6v2H9z M7 5h2v4H7z M15 5h2v4h-2z M9 9h6v2H9z M5 13h14v2H5z M3 15h2v6H3z M19 15h2v6h-2z',
  flag: 'M5 3h2v18H5z M7 4h12v8H7z',
  sliders: 'M3 6h18v2H3z M3 16h18v2H3z M6 4h4v6H6z M14 14h4v6h-4z',
  restart: 'M6 5h9v2H6z M4 7h2v10H4z M6 17h12v2H6z M18 11h2v6h-2z M15 3h2v2h-2z M15 7h2v2h-2z M17 5h2v2h-2z',
  stop: 'M6 6h12v12H6z',
  play: 'M8 4h2v16H8z M10 6h2v12h-2z M12 8h2v8h-2z M14 10h2v4h-2z',
  offline: 'M4 3h16v2H4z M4 9h16v2H4z M4 5h2v4H4z M18 5h2v4h-2z M4 13h16v2H4z M4 19h16v2H4z M4 15h2v4H4z M18 15h2v4h-2z M8 6h2v2H8z M8 16h2v2H8z',
  clock: 'M7 3h10v2H7z M5 5h2v2H5z M17 5h2v2h-2z M3 7h2v10H3z M19 7h2v10h-2z M5 17h2v2H5z M17 17h2v2h-2z M7 19h10v2H7z M11 7h2v6h-2z M13 11h3v2h-3z',
  skip: 'M3 6h2v12H3z M5 8h2v8H5z M7 10h2v4H7z M11 6h2v12h-2z M13 8h2v8h-2z M15 10h2v4h-2z M19 6h2v12h-2z',
  drop: 'M11 3h2v2h-2z M9 5h6v2H9z M7 7h10v4H7z M5 11h14v6H5z M7 17h10v2H7z M9 19h6v2H9z',
  send: 'M3 11h13v2H3z M12 7h2v2h-2z M14 9h2v2h-2z M16 11h2v2h-2z M14 13h2v2h-2z M12 15h2v2h-2z M18 11h2v2h-2z',
  jump: 'M9 6h2v2H9z M11 8h2v2h-2z M13 10h2v4h-2z M11 14h2v2h-2z M9 16h2v2H9z',
  search: 'M5 3h8v2H5z M3 5h2v8H3z M13 5h2v8h-2z M5 13h8v2H5z M15 15h2v2h-2z M17 17h2v2h-2z M19 19h2v2h-2z',
  reserve: 'M6 3h12v2H6z M6 5h2v16H6z M16 5h2v16h-2z M8 17h2v2H8z M10 15h4v2h-4z M14 17h2v2h-2z',
  mute: 'M3 9h4v6H3z M7 7h2v10H7z M9 5h2v14H9z M14 9h2v2h-2z M18 9h2v2h-2z M16 11h2v2h-2z M14 13h2v2h-2z M18 13h2v2h-2z',
  kick: 'M3 3h10v2H3z M3 5h2v14H3z M3 19h10v2H3z M11 5h2v4h-2z M11 15h2v4h-2z M9 11h10v2H9z M15 7h2v2h-2z M17 9h2v2h-2z M19 11h2v2h-2z M17 13h2v2h-2z M15 15h2v2h-2z',
  ban: 'M7 3h10v2H7z M5 5h2v2H5z M17 5h2v2h-2z M3 7h2v10H3z M19 7h2v10h-2z M5 17h2v2H5z M17 17h2v2h-2z M7 19h10v2H7z M15 7h2v2h-2z M13 9h2v2h-2z M11 11h2v2h-2z M9 13h2v2H9z M7 15h2v2H7z',
  close: 'M5 5h2v2H5z M7 7h2v2H7z M9 9h2v2H9z M11 11h2v2h-2z M13 13h2v2h-2z M15 15h2v2h-2z M17 17h2v2h-2z M17 5h2v2h-2z M15 7h2v2h-2z M13 9h2v2h-2z M9 13h2v2H9z M7 15h2v2H7z M5 17h2v2H5z',
  x: 'M7 7h2v2H7z M9 9h2v2H9z M11 11h2v2h-2z M13 13h2v2h-2z M15 15h2v2h-2z M15 7h2v2h-2z M13 9h2v2h-2z M9 13h2v2H9z M7 15h2v2H7z',
  up: 'M11 6h2v12h-2z M9 8h2v2H9z M7 10h2v2H7z M13 8h2v2h-2z M15 10h2v2h-2z',
  down: 'M11 6h2v12h-2z M9 14h2v2H9z M7 12h2v2H7z M13 14h2v2h-2z M15 12h2v2h-2z',
  trash: 'M4 5h16v2H4z M9 3h6v2H9z M6 7h2v14H6z M16 7h2v14h-2z M8 19h8v2H8z M11 9h2v8h-2z',
  download: 'M11 3h2v12h-2z M9 11h2v2H9z M7 9h2v2H7z M13 11h2v2h-2z M15 9h2v2h-2z M3 15h2v4H3z M19 15h2v4h-2z M3 19h18v2H3z',
  upload: 'M11 4h2v12h-2z M9 6h2v2H9z M7 8h2v2H7z M13 6h2v2h-2z M15 8h2v2h-2z M3 16h2v4H3z M19 16h2v4h-2z M3 20h18v2H3z',
  demo: 'M3 6h14v2H3z M3 8h2v8H3z M15 8h2v8h-2z M3 16h14v2H3z M17 10h2v4h-2z M19 8h2v8h-2z',
  eye: 'M7 7h10v2H7z M5 9h2v2H5z M17 9h2v2h-2z M3 11h2v2H3z M19 11h2v2h-2z M5 13h2v2H5z M17 13h2v2h-2z M7 15h10v2H7z M10 10h4v4h-4z',
  eyeOff: 'M7 7h10v2H7z M5 9h2v2H5z M17 9h2v2h-2z M3 11h2v2H3z M19 11h2v2h-2z M5 13h2v2H5z M17 13h2v2h-2z M7 15h10v2H7z M3 3h2v2H3z M5 5h2v2H5z M9 9h2v2H9z M11 11h2v2h-2z M13 13h2v2h-2z M17 17h2v2h-2z M19 19h2v2h-2z',
};

function icon(name, size = 24) {
  return `<svg class="px" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${ICONS[name]}"></path></svg>`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// The show/hide button that sits after a password input inside a .pw wrapper
function passwordToggle() {
  return `<button class="ibtn pw-toggle" type="button" aria-label="Show password" aria-pressed="false" title="Show password">${icon('eye')}</button>`;
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.pw-toggle');
  if (!btn) return;
  const input = btn.parentElement.querySelector('input');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  const label = show ? 'Hide password' : 'Show password';
  btn.setAttribute('aria-pressed', show);
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = icon(show ? 'eyeOff' : 'eye');
});

const enc = encodeURIComponent;
const qs = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body instanceof Blob) {
    opts.body = body;
    opts.headers['Content-Type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, opts);
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error((isJson && data.error) || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  let el = $('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 7000 : 3500);
}

// mxserver counts race time in 1/128 s
const TICS = 128;

function fmtClock(tics) {
  const s = Math.max(0, Math.floor(tics / TICS));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function fmtLap(tics) {
  const s = tics / TICS, m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(3)}`;
}

function fmtDate(ms) {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtWhen(ms) {
  const d = new Date(ms), today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  today.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Race progress from the bridge's numbers: {raceTime, finishLaps, finishTime, leaderLaps}
function progress(race) {
  if (!race) return null;
  const laps = race.finishLaps || 0, done = race.leaderLaps || 0;
  if (race.raceTime < 0) {
    return { label: race.finishTime > 0 ? 'TIME' : 'LAP', value: race.finishTime > 0 ? fmtClock(race.finishTime) : `– / ${laps}`, short: 'waiting', finished: false };
  }
  // Timed races run the minutes, then the laps
  if (race.finishTime > 0) {
    const left = race.finishTime - race.raceTime;
    if (left > 0) return { label: 'TIME LEFT', value: fmtClock(left), short: `${Math.ceil(left / TICS / 60)} min`, finished: false };
    return { label: 'PLUS LAPS', value: `${laps}`, short: `+${plural(laps, 'lap')}`, finished: false };
  }
  if (laps && done >= laps) return { label: 'RACE', value: 'Finished', short: 'finished', finished: true };
  const lap = Math.min(done + 1, laps), left = laps - lap;
  return { label: 'LAP', value: `${lap} / ${laps}`, short: left === 0 ? 'last lap' : plural(left, 'lap'), finished: false };
}

const STATUS = {
  running: { label: 'RUNNING', color: 'var(--ok)', filled: true },
  starting: { label: 'STARTING', color: 'var(--warn)', filled: false },
  crashed: { label: 'CRASHED', color: 'var(--danger)', filled: false },
  stopped: { label: 'STOPPED', color: 'var(--danger)', filled: false },
};

// page: 'servers' | 'results' | 'tracks'. On the dashboard, onPick switches servers without reloading.
function initSidebar({ page, selected, onPick, onServers }) {
  const nav = $('sidebar');
  const current = p => (page === p ? ' aria-current="page"' : '');
  nav.innerHTML = `
    <div class="side-group">
      <h2 class="cap">Servers</h2>
      <div id="server-list" class="stack-sm" style="gap:6px"></div>
      <a class="btn" href="/add" style="margin-top:10px">${icon('plus')}Add server</a>
    </div>
    <div class="side-group">
      <h2 class="cap">Files</h2>
      <a class="nav" href="/results"${current('results')}>${icon('trophy')}Results &amp; demos</a>
      <a class="nav" href="/tracks"${current('tracks')}>${icon('folder')}Track library</a>
    </div>`;
  const list = $('server-list');
  let servers = [];

  function render() {
    list.innerHTML = servers.map(s => {
      const st = STATUS[s.status] || STATUS.stopped;
      const prog = progress(s.race);
      const live = s.status === 'running' && s.race ? `
        <span title="Players online">${icon('person', 12)}${s.race.players}/${s.maxClients}</span>
        <span title="Race: ${esc(prog.short)}">${icon('flag', 12)}${esc(prog.short)}</span>` : '';
      return `
        <a class="srv" href="/?server=${enc(s.id)}" data-id="${esc(s.id)}" aria-current="${page === 'servers' && s.id === selected}">
          <span class="dot${st.filled ? ' filled' : ''}" style="color:${st.color}" aria-hidden="true"></span>
          <span class="srv-text">
            <span class="srv-top"><span class="srv-name">${esc(s.name)}</span><span class="srv-label" style="color:${st.color}">${st.label}</span></span>
            <span class="srv-meta"><span>:${s.port}</span>${live}</span>
          </span>
        </a>`;
    }).join('');
  }

  async function refresh() {
    try {
      const r = await api('GET', '/api/servers');
      servers = r.servers;
      render();
      if (onServers) onServers(r);
    } catch (e) {
      // The dashboard shows its own errors; the list just keeps its last state
    }
  }

  if (onPick) {
    list.addEventListener('click', e => {
      const a = e.target.closest('[data-id]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      onPick(a.dataset.id);
    });
  }

  refresh();
  setInterval(refresh, 3000);
  return {
    refresh,
    setSelected(id) { selected = id; render(); },
    get servers() { return servers; },
  };
}
