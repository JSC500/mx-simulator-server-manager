'use strict';
// Settings dialog: edits serverargs.txt and bans.txt through the API

const id = qs.get('server');
const TABS = [['general', 'General'], ['race', 'Race rules'], ['tracks', 'Tracks'], ['people', 'People'], ['advanced', 'Advanced']];
// "rotation" was the Tracks tab's old name
const asked = qs.get('tab') === 'rotation' ? 'tracks' : qs.get('tab');
let tab = TABS.some(([t]) => t === asked) ? asked : 'general';
let model = null;
let library = [];

const back = `/?server=${enc(id || '')}`;
$('close').href = back;
$('close').innerHTML = icon('close');
$('cancel').href = back;

async function init() {
  try {
    [model, library] = await Promise.all([api('GET', `/api/servers/${enc(id)}/settings`), api('GET', '/api/tracks')]);
  } catch (e) {
    $('panel').textContent = e.message;
    return;
  }
  $('dlg-title').innerHTML = `${icon('sliders')}<span>Settings · ${esc(model.name)}</span>`;
  document.title = `Settings · ${model.name} · MX Simulator Server Manager`;
  const running = model.status === 'running';
  $('save').innerHTML = running ? `${icon('restart')}Apply &amp; restart` : 'Save';
  $('foot-hint').textContent = running
    ? 'Restarting disconnects everyone for a few seconds.'
    : `UDP port ${model.port}. Applies the next time the server starts.`;
  renderTabs();
  renderPanel();
}
init();

// Reads and writes nested values like "settings.rotation.2.laps"
function get(path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), model);
}
function set(path, value) {
  const keys = path.split('.'), last = keys.pop();
  keys.reduce((o, k) => o[k], model)[last] = value;
}

function renderTabs() {
  $('tabs').innerHTML = TABS.map(([t, label]) =>
    `<button class="tab" type="button" role="tab" data-tab="${t}" aria-selected="${t === tab}">${label}</button>`).join('');
}

function input(path, kind, attrs = '') {
  const v = get(path);
  const type = kind === 'password' ? 'password' : kind === 'text' ? 'text' : 'number';
  const mono = kind === 'text' ? '' : ' mono';
  const el = `<input class="field${mono}" type="${type}" data-bind="${path}" data-kind="${kind}" value="${esc(v ?? '')}" ${attrs}>`;
  return kind === 'password' ? `<span class="pw">${el}${passwordToggle()}</span>` : el;
}

function field(label, path, kind, hint = '', attrs = '') {
  return `<label class="lbl">${label}${input(path, kind, attrs)}${hint ? `<small>${hint}</small>` : ''}</label>`;
}

function check(path, label, hint, inverted = false) {
  const on = inverted ? !get(path) : !!get(path);
  return `<label class="box check"><input type="checkbox" data-bind="${path}" data-kind="${inverted ? 'notbool' : 'bool'}"${on ? ' checked' : ''}>
    <span class="stack-sm" style="gap:2px"><b>${label}</b><small class="hint">${hint}</small></span></label>`;
}

const panels = {
  general: () => `
    <div class="grid-2">
      ${field('Server name', 'name', 'text', 'Only used for the webapp.', 'maxlength="60"')}
      ${field('Greeting', 'settings.greeting', 'text', 'Sent to every player right after they connect.')}
      ${field('Admin password (in-game)', 'settings.password', 'password', 'Use /admin <password> command in game to become an admin.', 'autocomplete="new-password"')}
      ${field('Inactivity timeout', 'settings.inactivityTimeout', 'optint', 'Seconds before an idle player is disconnected. Default 900.', 'min="0" placeholder="900"')}
      ${field('Max clients', 'settings.maxClients', 'optint', 'Everyone connected, racers and spectators. Default 10.', 'min="1" placeholder="10"')}
      ${field('Max racers on the gate', 'settings.maxPlayers', 'optint', 'Simultaneous players in a race. Default 40.', 'min="1" placeholder="40"')}
    </div>`,

  race: () => {
    const s = model.settings, byTime = s.minutes > 0;
    return `
      <fieldset class="group">
        <legend class="sec">Default race length</legend>
        <div class="stack-sm" style="gap:6px">
          <span style="font-size:14px;font-weight:600">Race by</span>
          <div class="seg-group">
            <label class="seg"><input type="radio" name="len" value="laps" data-act="race-by"${byTime ? '' : ' checked'}> Laps</label>
            <label class="seg"><input type="radio" name="len" value="minutes" data-act="race-by"${byTime ? ' checked' : ''}> Minutes</label>
          </div>
        </div>
        ${byTime ? `<div style="width:140px">${field('Minutes', 'settings.minutes', 'int', '', 'min="1"')}</div>` : ''}
        <div style="width:${byTime ? 180 : 140}px">${field(byTime ? 'Laps after the time' : 'Laps', 'settings.laps', 'int', '', 'min="0"')}</div>
        <div style="width:220px">${field('Track change every', 'settings.trackInterval', 'int')}</div>
        <small class="hint" style="flex-basis:100%">Minutes between track changes; a negative number only changes when someone picks a track. Each track can override the race length in Tracks.</small>
      </fieldset>
      <div class="grid-auto" style="gap:20px 24px">
        ${field('Erode', 'settings.erode', 'float', 'How fast the track wears in. Usually 0 to 3; default 0.', 'min="0" max="100" step="0.1" placeholder="0"')}
        ${check('settings.noArcade', 'Arcade mode allowed', 'Unchecking adds --no-arcade.', true)}
      </div>`;
  },

  tracks: () => {
    const s = model.settings, inRotation = new Set(s.rotation.map(t => t.file));
    const name = file => (library.find(t => t.file === file) || {}).name || file.replace(/\.trackinfo$/, '');
    const available = library.filter(t => !inRotation.has(t.file));
    const rows = s.rotation.map((t, i) => `
      <tr>
        <td class="mono muted">${i + 1}</td>
        <td><div style="font-weight:600">${esc(name(t.file))}</div><div class="mono muted" style="font-size:12px">trackinfo/${esc(t.file)}</div></td>
        <td>${input(`settings.rotation.${i}.laps`, 'optint', `min="0" placeholder="${s.laps}" aria-label="Laps for ${esc(name(t.file))}" style="width:80px"`)}</td>
        <td>${input(`settings.rotation.${i}.minutes`, 'optint', `min="0" placeholder="${s.minutes || '–'}" aria-label="Minutes for ${esc(name(t.file))}" style="width:80px"`)}</td>
        <td><div class="row-actions">
          <button class="ibtn" type="button" data-act="up" data-i="${i}" aria-label="Move ${esc(name(t.file))} up"${i === 0 ? ' disabled' : ''}>${icon('up')}</button>
          <button class="ibtn" type="button" data-act="down" data-i="${i}" aria-label="Move ${esc(name(t.file))} down"${i === s.rotation.length - 1 ? ' disabled' : ''}>${icon('down')}</button>
          <button class="ibtn ibtn-dng" type="button" data-act="remove-track" data-i="${i}" aria-label="Remove ${esc(name(t.file))}">${icon('trash')}</button>
        </div></td>
      </tr>`).join('');
    return `
      <p class="muted" style="margin:0;font-size:14px;max-width:560px;line-height:1.5">Tracks play top to bottom. Laps or minutes set here apply to that track only; leave them empty to use the race defaults.</p>
      <div class="box table-wrap">
        <table>
          <thead><tr><th>#</th><th>Track</th><th>Laps</th><th>Minutes</th><th style="text-align:right">Order</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${s.rotation.length ? '' : '<div class="empty">No tracks yet. The server needs at least one.</div>'}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <label class="lbl" style="flex:1 1 280px">Add track from library
          <select class="field" id="add-track">${available.map(t => `<option value="${esc(t.file)}">${esc(t.name)} — ${esc(t.file)}</option>`).join('')}</select>
        </label>
        <button class="btn" type="button" data-act="add-track"${available.length ? '' : ' disabled'}>${icon('plus')}Add track</button>
        <a href="/tracks" style="min-height:44px;display:inline-flex;align-items:center;font-size:14px">Upload a new trackinfo →</a>
      </div>`;
  },

  people: () => {
    const s = model.settings;
    const chips = (list, what) => list.map(uid =>
      `<span class="chip">${uid}<button type="button" data-act="remove-uid" data-list="${what}" data-uid="${uid}" aria-label="Remove ${uid}">${icon('x')}</button></span>`).join('');
    const bans = model.bans.map((b, i) => `
      <tr><td class="mono">${b.uid}</td><td class="muted">${b.until ? fmtDate(b.until * 1000) : 'Permanent'}</td>
      <td style="text-align:right"><button class="ibtn ibtn-dng" type="button" data-act="lift-ban" data-i="${i}" aria-label="Lift ban for ${b.uid}" title="Lift ban">${icon('trash')}</button></td></tr>`).join('');
    const addRow = (what, label, button = 'Add') => `
      <div class="inline-add"><input class="field mono" type="number" min="1" placeholder="UID" aria-label="${label}" id="new-${what}" style="flex:1 1 120px;width:auto">
      <button class="btn" type="button" data-act="add-uid" data-list="${what}">${button}</button></div>`;
    return `
      <div class="grid-auto">
        <div class="stack">
          ${field('Admin UID', 'settings.admin', 'optint', 'Players are identified by numeric user ID. The admin also needs the in-game password.', 'min="1"')}
          <div class="stack-sm">
            <span style="font-size:14px;font-weight:600">Track marshals</span>
            <small class="hint">Can kick players, restart races and change the track.</small>
            <div class="chips">${chips(s.marshals, 'marshals')}</div>
            ${addRow('marshals', 'New marshal UID')}
          </div>
          <div class="stack-sm">
            <span style="font-size:14px;font-weight:600">Reserved slots</span>
            <label style="display:flex;align-items:center;gap:10px;font-size:14px">Slots held back ${input('settings.reservedClients', 'optint', 'min="0" placeholder="0" style="width:80px"')}</label>
            <small class="hint">Only these UIDs can take a held-back slot.</small>
            <div class="chips">${chips(s.reserve, 'reserve')}</div>
            ${addRow('reserve', 'New reserved UID')}
          </div>
        </div>
        <div class="stack-sm">
          <span style="font-size:14px;font-weight:600">Bans</span>
          <div class="box table-wrap">
            <table><thead><tr><th>UID</th><th>Until</th><th></th></tr></thead><tbody>${bans}</tbody></table>
            ${model.bans.length ? '' : '<div class="empty">Nobody is banned.</div>'}
          </div>
          ${addRow('bans', 'UID to ban', 'Ban')}
        </div>
      </div>`;
  },

  advanced: () => `
    <div class="grid-auto">
      <div class="stack" style="gap:18px">
        ${field('Max track cuts', 'settings.maxCuts', 'optint', 'After this many cuts anyone can kick the rider.', 'min="0" placeholder="No limit"')}
        <div class="grid-2" style="gap:16px">
          ${field('Off-course bias (s)', 'settings.offCourseBias', 'float', '', 'step="0.5" placeholder="10"')}
          ${field('Off-course scale (×)', 'settings.offCourseScale', 'float', '', 'step="0.1" placeholder="1.5"')}
          <small class="hint" style="grid-column:1 / -1;margin-top:-8px">Off course when slower than the leader × scale + bias.</small>
        </div>
        ${field('Max outgoing rate (bytes/s)', 'settings.rate', 'optint', '', 'min="1" placeholder="1000000"')}
        ${field('Minimum client version', 'settings.minVersion', 'optint', '', 'min="0" placeholder="Any"')}
        ${check('settings.demos', 'Save a demo of each race', 'Records with --demo-file and keeps a copy next to each result. Demos take disk space.')}
        ${model.settings.extra.length ? `<div class="stack-sm"><span class="sec">Other options, kept as written</span><pre class="code">${esc(model.settings.extra.join('\n'))}</pre></div>` : ''}
      </div>
      <div class="stack-sm" style="align-self:stretch">
        <span class="sec">Generated serverargs.txt</span>
        <pre class="code" id="preview" style="flex:1"></pre>
      </div>
    </div>`,
};

function renderPanel() {
  $('panel').innerHTML = panels[tab]();
  if (tab === 'advanced') updatePreview();
}

let previewTimer;
function updatePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    try {
      const r = await api('POST', `/api/servers/${enc(id)}/preview`, model.settings);
      if ($('preview')) $('preview').textContent = r.text;
    } catch (e) {
      if ($('preview')) $('preview').textContent = e.message;
    }
  }, 150);
}

$('tabs').addEventListener('click', e => {
  const t = e.target.closest('[data-tab]');
  if (!t) return;
  tab = t.dataset.tab;
  history.replaceState(null, '', `/settings?server=${enc(id)}&tab=${tab}`);
  renderTabs();
  renderPanel();
});

function onEdit(e) {
  const el = e.target;
  if (!el.dataset.bind) return;
  const kind = el.dataset.kind, raw = el.value.trim();
  let value;
  if (kind === 'bool') value = el.checked;
  else if (kind === 'notbool') value = !el.checked;
  else if (kind === 'int') value = raw === '' ? 0 : parseInt(raw, 10) || 0;
  else if (kind === 'optint') value = raw === '' ? null : Math.max(0, parseInt(raw, 10) || 0);
  else if (kind === 'float') value = raw === '' ? null : parseFloat(raw);
  else value = el.value;
  set(el.dataset.bind, value);
  if (tab === 'advanced') updatePreview();
}
$('panel').addEventListener('input', onEdit);
$('panel').addEventListener('change', onEdit);

$('panel').addEventListener('change', e => {
  if (e.target.dataset.act !== 'race-by') return;
  const s = model.settings;
  if (e.target.value === 'laps') {
    s.minutes = 0;
    if (!s.laps) s.laps = 5;
  } else if (!s.minutes) {
    s.minutes = 15;
    s.laps = 2;
  }
  renderPanel();
});

$('panel').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const s = model.settings, i = Number(btn.dataset.i);
  switch (btn.dataset.act) {
    case 'up':
    case 'down': {
      const j = btn.dataset.act === 'up' ? i - 1 : i + 1;
      [s.rotation[i], s.rotation[j]] = [s.rotation[j], s.rotation[i]];
      break;
    }
    case 'remove-track':
      s.rotation.splice(i, 1);
      break;
    case 'add-track':
      if ($('add-track').value) s.rotation.push({ file: $('add-track').value, laps: null, minutes: null, interval: null });
      break;
    case 'remove-uid':
      s[btn.dataset.list] = s[btn.dataset.list].filter(u => u !== Number(btn.dataset.uid));
      break;
    case 'add-uid': {
      const list = btn.dataset.list, uid = parseInt($(`new-${list}`).value, 10);
      if (!(uid > 0)) return toast('Enter a UID, the number shown next to the player’s name.', true);
      if (list === 'bans') {
        if (!model.bans.some(b => b.uid === uid)) model.bans.push({ uid, until: 0 });
      } else if (!s[list].includes(uid)) {
        s[list].push(uid);
      }
      break;
    }
    case 'lift-ban':
      model.bans.splice(i, 1);
      break;
    default:
      return;
  }
  renderPanel();
});

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const restart = model.status === 'running';
  $('save').disabled = true;
  try {
    await api('PUT', `/api/servers/${enc(id)}/settings`, { name: model.name, settings: model.settings, bans: model.bans });
    if (restart) await api('POST', `/api/servers/${enc(id)}/restart`);
    location.href = back;
  } catch (err) {
    toast(err.message, true);
    $('save').disabled = false;
  }
});
