(() => {
  const $ = (s) => document.querySelector(s);
  const state = { parties: [], status: null };

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, ms = 3500) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  }

  function elapsed(iso) {
    const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return { text: `${mins} min`, mins };
    return { text: `${Math.floor(mins / 60)}h ${mins % 60}m`, mins };
  }

  function renderParties() {
    const ul = $('#parties');
    $('#count').textContent = state.parties.length;
    $('#empty').classList.toggle('hidden', state.parties.length > 0);
    ul.innerHTML = state.parties.map((p) => {
      const w = elapsed(p.created_at);
      const notified = p.status === 'notified';
      const m = p.last_message;
      let statusHtml = '';
      if (notified) {
        statusHtml += `<div class="p-status"><span class="tag notified">Texted ${elapsed(p.notified_at).text} ago</span></div>`;
      }
      if (m && m.status === 'demo') {
        statusHtml += `<div class="would"><span class="tag demo">Demo</span> Would have sent: “${esc(m.body)}”</div>`;
      } else if (m && m.status === 'failed') {
        statusHtml += `<div class="would"><span class="tag failed">Failed</span> ${esc(m.error)}</div>`;
      }
      return `<li class="party ${notified ? 'notified' : ''}" data-id="${p.id}">
        <div>
          <div class="p-name">${esc(p.name || 'Guest')}${p.party_size ? ` <span style="font-weight:500;color:var(--muted)">· party of ${p.party_size}</span>` : ''}</div>
          <div class="p-meta">
            <span>${esc(p.phone_pretty)}</span>
            <span>Waiting <span class="p-wait ${w.mins >= 30 ? 'long' : ''}">${w.text}</span></span>
          </div>
          ${statusHtml}
        </div>
        <div class="actions">
          <button class="btn ready" data-act="ready">${notified ? 'Text again' : 'Table ready'}</button>
          <button class="btn ghost" data-act="seat">Seated</button>
          <button class="btn danger" data-act="remove">Remove</button>
        </div>
      </li>`;
    }).join('');
  }

  async function loadParties() {
    state.parties = await api('/api/parties');
    renderParties();
  }

  async function loadStatus() {
    state.status = await api('/api/status');
    $('#demoBanner').classList.toggle('hidden', !state.status.demo);
    $('#restaurantName').textContent = state.status.settings.restaurant_name;
  }

  $('#addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#formError').textContent = '';
    const btn = e.submitter || $('#addForm button');
    btn.disabled = true;
    try {
      const r = await api('/api/parties', {
        method: 'POST',
        body: { phone: $('#phone').value, name: $('#name').value, party_size: $('#size').value },
      });
      $('#addForm').reset();
      $('#phone').focus();
      let msg = `Added ${r.party.name || 'guest'} (${r.party.phone_pretty})`;
      if (r.message) msg += r.message.status === 'demo' ? ' · join text (demo)' : r.message.status === 'failed' ? ' · join text FAILED' : ' · join text sent';
      toast(msg);
      await loadParties();
    } catch (err) {
      $('#formError').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('#parties').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.party').dataset.id;
    const act = btn.dataset.act;
    const p = state.parties.find((x) => String(x.id) === id);
    if (act === 'remove' && !confirm(`Remove ${p?.name || 'this party'} from the waitlist?`)) return;
    btn.disabled = true;
    try {
      if (act === 'ready') {
        const r = await api(`/api/parties/${id}/ready`, { method: 'POST' });
        toast(r.message.status === 'demo' ? `Demo: would have texted ${r.party.phone_pretty}` : `Texted ${r.party.phone_pretty}`);
      } else if (act === 'seat') {
        await api(`/api/parties/${id}/seat`, { method: 'POST' });
        toast(`${p?.name || 'Party'} seated`);
      } else if (act === 'remove') {
        await api(`/api/parties/${id}`, { method: 'DELETE' });
        toast(`${p?.name || 'Party'} removed`);
      }
    } catch (err) {
      toast(err.message, 6000);
    } finally {
      await loadParties();
    }
  });

  // Tabs
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${t.dataset.view}`));
    if (t.dataset.view === 'settings') loadSettings();
  }));

  // Settings
  function updatePreview() {
    const tpl = $('#s_ready').value;
    $('#preview').textContent = tpl.replace(/\{name\}/g, 'Maria').replace(/\{restaurant\}/g, $('#s_restaurant').value || 'Your Restaurant').replace(/\{size\}/g, '4');
  }
  async function loadSettings() {
    const s = await api('/api/settings');
    $('#s_restaurant').value = s.restaurant_name;
    $('#s_ready').value = s.ready_template;
    $('#s_join').value = s.join_template;
    $('#s_join_enabled').checked = s.join_sms_enabled;
    updatePreview();
    loadMessages();
  }
  async function loadMessages() {
    const msgs = await api('/api/messages');
    $('#messages').innerHTML = msgs.length ? msgs.map((m) => `<li>
      <div>${esc(m.body)}</div>
      <div class="meta">${esc(m.kind)} → ${esc(m.to_phone)} · <span class="tag ${m.status === 'demo' ? 'demo' : m.status === 'failed' ? 'failed' : 'notified'}">${esc(m.status)}</span> · ${new Date(m.created_at).toLocaleString()}</div>
    </li>`).join('') : '<li class="meta">No texts yet.</li>';
  }
  ['#s_ready', '#s_restaurant'].forEach((s) => $(s).addEventListener('input', updatePreview));
  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: {
          restaurant_name: $('#s_restaurant').value,
          ready_template: $('#s_ready').value,
          join_template: $('#s_join').value,
          join_sms_enabled: $('#s_join_enabled').checked,
        },
      });
      $('#settingsSaved').textContent = 'Saved ✓';
      setTimeout(() => ($('#settingsSaved').textContent = ''), 2500);
      await loadStatus();
    } catch (err) {
      toast(err.message, 6000);
    }
  });

  // Phone auto-format as you type
  $('#phone').addEventListener('input', (e) => {
    let d = e.target.value.replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    if (d.length > 10) return;
    let out = d;
    if (d.length > 6) out = `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    else if (d.length > 3) out = `(${d.slice(0, 3)}) ${d.slice(3)}`;
    e.target.value = out;
  });

  loadStatus().catch(console.error);
  loadParties().catch(console.error);
  setInterval(() => loadParties().catch(() => {}), 15000); // keep wait times & multi-device lists fresh
})();
