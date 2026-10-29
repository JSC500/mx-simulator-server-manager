'use strict';
// Add server dialog

let mode = 'defaults';
$('add-title').innerHTML = `${icon('plus')}<span>Add server</span>`;
$('close').innerHTML = icon('close');
$('password-wrap').insertAdjacentHTML('beforeend', passwordToggle());

async function init() {
  try {
    const r = await api('GET', '/api/servers');
    const [from, to] = r.ports;
    $('port').min = from;
    $('port').max = to;
    if (r.nextPort) {
      $('port').value = r.nextPort;
    } else {
      $('port-hint').textContent = `All ports from ${from} to ${to} are taken. Raise MX_PORTS in docker-compose.yml to add more.`;
    }
    $('copy-from').innerHTML = r.servers.map(s => `<option value="${esc(s.id)}">${esc(s.name)} (${s.port})</option>`).join('');
  } catch (e) {
    toast(e.message, true);
  }
}
init();

document.querySelector('[role=radiogroup]').addEventListener('click', e => {
  const opt = e.target.closest('[data-mode]');
  if (!opt) return;
  mode = opt.dataset.mode;
  for (const o of document.querySelectorAll('[data-mode]')) o.setAttribute('aria-checked', o === opt);
  $('copy-from').hidden = mode !== 'copy';
});

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  $('create').disabled = true;
  try {
    const s = await api('POST', '/api/servers', {
      name: $('name').value,
      port: Number($('port').value),
      maxClients: $('max-clients').value ? Number($('max-clients').value) : null,
      copyFrom: mode === 'copy' ? $('copy-from').value : null,
      password: $('password').value,
      start: $('start').checked,
    });
    location.href = `/?server=${enc(s.id)}`;
  } catch (err) {
    toast(err.message, true);
    $('create').disabled = false;
  }
});
