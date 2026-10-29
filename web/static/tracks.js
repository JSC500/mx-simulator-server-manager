'use strict';
// Track library: the shared /data/trackinfo folder

let tracks = [];

initSidebar({ page: 'tracks' });
$('drop-icon').innerHTML = icon('upload', 48);
$('search-wrap').insertAdjacentHTML('afterbegin', icon('search'));

async function load() {
  try {
    tracks = await api('GET', '/api/tracks');
  } catch (e) {
    toast(e.message, true);
  }
  render();
}
load();

function render() {
  const q = $('search').value.trim().toLowerCase();
  const list = tracks.filter(t => !q || t.name.toLowerCase().includes(q) || t.file.toLowerCase().includes(q));
  $('total').textContent = `${list.length} of ${tracks.length}`;
  $('rows').innerHTML = list.map(t => {
    const used = t.usedBy.length > 0;
    return `
      <tr>
        <td style="font-weight:600">${esc(t.name)}</td>
        <td class="mono muted" style="font-size:13px">${esc(t.file)}</td>
        <td class="muted" style="font-size:14px">${used ? esc(t.usedBy.join(', ')) : '—'}</td>
        <td><div class="row-actions">
          <a class="ibtn" href="/api/tracks/${enc(t.file)}" download aria-label="Download ${esc(t.file)}" title="Download">${icon('download')}</a>
          <button class="ibtn${used ? '' : ' ibtn-dng'}" type="button" data-file="${esc(t.file)}" aria-label="Delete ${esc(t.file)}"
            title="${used ? 'Remove it from every server’s tracks first' : 'Delete'}"${used ? ' disabled' : ''}>${icon('trash')}</button>
        </div></td>
      </tr>`;
  }).join('');
  $('empty').hidden = list.length > 0;
  $('empty').textContent = tracks.length ? `No track matches “${q}”.` : 'No trackinfo files yet. Upload one above.';
}

async function upload(files) {
  let done = 0;
  for (const file of files) {
    try {
      await api('PUT', `/api/tracks/${enc(file.name)}`, file);
      done++;
    } catch (e) {
      toast(e.message, true);
    }
  }
  if (done) toast(`Uploaded ${plural(done, 'file')}. Add them to a server in Settings → Tracks.`);
  load();
}

$('file').addEventListener('change', e => {
  upload([...e.target.files]);
  e.target.value = '';
});

const drop = $('drop');
drop.addEventListener('dragover', e => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => {
  e.preventDefault();
  drop.classList.remove('over');
  upload([...e.dataTransfer.files]);
});

$('rows').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-file]');
  if (!btn || !confirm(`Delete ${btn.dataset.file}?`)) return;
  try {
    await api('DELETE', `/api/tracks/${enc(btn.dataset.file)}`);
    toast(`Deleted ${btn.dataset.file}`);
  } catch (err) {
    toast(err.message, true);
  }
  load();
});

$('search').addEventListener('input', render);
