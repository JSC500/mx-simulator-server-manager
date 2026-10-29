'use strict';
// Race results saved by the bridge script in each server's results folder

let races = [];
let current = null;
let detail = null;

initSidebar({
  page: 'results',
  onServers(r) {
    const select = $('server-filter'), value = select.value;
    const html = '<option value="">All servers</option>' + r.servers.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    if (select.dataset.html === html) return;
    select.dataset.html = html;
    select.innerHTML = html;
    select.value = value;
  },
});

$('demo').innerHTML = `${icon('demo')}Download demo`;
$('csv').innerHTML = `${icon('download')}Export CSV`;

async function loadRaces() {
  const server = $('server-filter').value;
  try {
    races = await api('GET', '/api/results' + (server ? `?server=${enc(server)}` : ''));
  } catch (e) {
    toast(e.message, true);
    races = [];
  }
  renderList();
  if (!current || !races.some(r => key(r) === key(current))) {
    if (races.length) pick(races[0]);
    else $('detail').hidden = true;
  }
}
loadRaces();

const key = r => `${r.server}/${r.id}`;

function filtered() {
  const q = $('search').value.trim().toLowerCase();
  return races.filter(r => !q
    || (r.track.name || r.track.dir || '').toLowerCase().includes(q)
    || r.names.some(n => String(n).toLowerCase().includes(q)));
}

function renderList() {
  const list = filtered();
  $('count').textContent = plural(list.length, 'race').toUpperCase();
  $('races').innerHTML = list.length ? list.map(r => `
    <button class="race" type="button" data-key="${esc(key(r))}" aria-current="${current && key(current) === key(r)}">
      <span class="race-top"><b>${esc(r.track.name || r.track.dir)}</b><span class="mono muted" style="font-size:12px">${esc(fmtWhen(r.end))}</span></span>
      <span class="muted" style="font-size:13px">${esc(r.serverName)} · ${plural(r.riders, 'rider')} · won by ${esc(r.winner || '—')}</span>
    </button>`).join('')
    : `<div class="empty">${races.length ? 'No race matches.' : 'No races yet. Each race is saved here when it ends.'}</div>`;
}

async function pick(race) {
  current = race;
  renderList();
  try {
    detail = await api('GET', `/api/results/${enc(race.server)}/${enc(race.id)}`);
    renderDetail();
  } catch (e) {
    toast(e.message, true);
  }
}

// Total = race time at the last finished lap; lap times are the differences between laps
function rows() {
  const riders = detail.riders;
  const lead = riders[0] || { laps: [] };
  const leadTotal = lead.laps[lead.laps.length - 1];
  let bestTime = Infinity, bestRow = -1;
  const out = riders.map((r, i) => {
    const laps = r.laps.map((t, k) => t - (k ? r.laps[k - 1] : 0));
    const best = laps.length ? Math.min(...laps) : null;
    if (best !== null && best < bestTime) { bestTime = best; bestRow = i; }
    const total = r.laps.length ? r.laps[r.laps.length - 1] : null;
    let gap = '—';
    if (i > 0 && total !== null) {
      const down = lead.laps.length - r.laps.length;
      gap = down > 0 ? `+${plural(down, 'lap')}` : `+${((total - leadTotal) / TICS).toFixed(3)}`;
    } else if (i > 0) {
      gap = 'no lap';
    }
    return { pos: i + 1, name: r.name, uid: r.uid, bike: r.bike, laps: r.laps.length, total: total !== null ? fmtLap(total) : '—', best: best !== null ? fmtLap(best) : '—', gap };
  });
  if (bestRow >= 0) out[bestRow].isBest = true;
  return out;
}

function renderDetail() {
  const d = detail, laps = d.finishTime > 0 ? `${Math.round(d.finishTime / TICS / 60)} min + ${plural(d.finishLaps, 'lap')}` : plural(d.finishLaps, 'lap');
  $('detail').hidden = false;
  $('race-kicker').textContent = `Race result · ${d.serverName}`;
  $('race-title').textContent = d.track.name || d.track.dir;
  $('race-meta').textContent = `${fmtDate(d.end)} · ${laps} · ${plural(d.riders.length, 'rider')}`;
  $('demo').hidden = !d.hasDemo;
  $('demo').href = `/api/results/${enc(d.server)}/${enc(d.id)}/demo`;
  $('rows').innerHTML = rows().map(x => `
    <tr class="${x.pos === 1 ? 'first' : ''}">
      <td><span class="place${x.pos <= 3 ? ' top' : ''}">${x.pos}</span></td>
      <td style="font-weight:600">${esc(x.name)}</td>
      <td class="mono">${x.uid || '—'}</td>
      <td class="muted">${esc(x.bike)}</td>
      <td class="mono">${x.laps}</td>
      <td class="mono">${x.total}</td>
      <td class="mono${x.isBest ? ' best' : ''}">${x.best}</td>
      <td class="mono muted">${esc(x.gap)}</td>
    </tr>`).join('');
}

function exportCsv() {
  const cell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const lines = [['Pos', 'Rider', 'UID', 'Bike', 'Laps', 'Total', 'Best lap', 'Gap']]
    .concat(rows().map(x => [x.pos, x.name, x.uid, x.bike, x.laps, x.total, x.best, x.gap]))
    .map(l => l.map(cell).join(','));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
  a.download = `${(detail.track.dir || 'race').replace(/[^\w-]+/g, '')}-${detail.id}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('races').addEventListener('click', e => {
  const b = e.target.closest('[data-key]');
  if (b) pick(races.find(r => key(r) === b.dataset.key));
});
$('search').addEventListener('input', renderList);
$('server-filter').addEventListener('change', loadRaces);
$('csv').addEventListener('click', exportCsv);
