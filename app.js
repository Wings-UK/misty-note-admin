/* MistyNote Admin — Shipping + Pulse (mobile-first) */

const SUPABASE_URL = 'https://rhmknjlxddxkfybcfgjj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobWtuamx4ZGR4a2Z5YmNmZ2pqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0MzM4OTgsImV4cCI6MjA4NTAwOTg5OH0.dNBxXmIdYAxJT-bt1WWcO62Nobt8aDLTRdnrs5g1CCI';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentSection = 'shipping';
let shipTab = 'pending';
let pulseTab = 'overview';
let marketFilter = 'open';
let pendingRequests = [];
let shippedOrders = [];
let activeRequestId = null;
let activeOrderId = null;
let resolveSelectedOpt = null;
let resolvePredCache = null;

// ── Auth ──────────────────────────────────────────────────
(async () => {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.href = 'index.html'; return; }

    const { data: staff, error: staffErr } = await sb
      .from('admin_staff').select('id').eq('user_id', session.user.id).maybeSingle();

    if (staffErr || !staff) {
      await sb.auth.signOut();
      location.href = 'index.html';
      return;
    }

    currentUser = session.user;
    document.getElementById('staff-email').textContent = session.user.email || '—';
    loadShipping();
  } catch (err) {
    console.error(err);
    document.getElementById('main').innerHTML =
      `<div class="empty"><div class="empty-icon">⚠️</div>Failed to init: ${esc(err.message)}</div>`;
  }
})();

document.getElementById('signout-btn').onclick = async () => {
  await sb.auth.signOut();
  location.href = 'index.html';
};

// ── Helpers ───────────────────────────────────────────────
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + type;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 3200);
}
function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}
function fmtMP(n) {
  const x = Number(n) || 0;
  return x.toFixed(2).replace(/\.00$/, '') + ' MP';
}
function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}
function toLocalInput(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function statusBadge(pred) {
  if (pred.status === 'resolved') return '<span class="badge badge-resolved">Resolved</span>';
  if (pred.status === 'open' && new Date(pred.closes_at) > Date.now())
    return '<span class="badge badge-open">Open</span>';
  return '<span class="badge badge-closed">Closed</span>';
}

// ── Section / tabs ────────────────────────────────────────
function switchSection(name) {
  currentSection = name;
  document.querySelectorAll('.section-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.section === name));
  document.querySelectorAll('.section').forEach(s =>
    s.classList.toggle('active', s.id === 'section-' + name));
  if (name === 'shipping') loadShipping();
  if (name === 'pulse') refreshPulse();
}

function setShipTab(tab) {
  shipTab = tab;
  document.querySelectorAll('#ship-tabs .sub-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  renderShipping();
}

function setPulseTab(tab) {
  pulseTab = tab;
  document.querySelectorAll('#pulse-tabs .sub-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.pulse-pane').forEach(p =>
    p.classList.toggle('active', p.id === 'pulse-' + tab));
  refreshPulse();
}

function refreshPulse() {
  if (pulseTab === 'overview') loadPulseOverview();
  if (pulseTab === 'markets') loadMarkets();
  if (pulseTab === 'resolve') loadResolveList();
  if (pulseTab === 'stakes') loadStakes();
  if (pulseTab === 'create') {
    const el = document.getElementById('c-closes');
    if (el && !el.value) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(23, 59, 0, 0);
      el.value = toLocalInput(d);
    }
  }
}

// ══════════════════════════════════════════════════════════
// SHIPPING (your existing logic)
// ══════════════════════════════════════════════════════════
async function loadShipping() {
  const content = document.getElementById('ship-content');
  content.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const [pendingRes, shippedRes] = await Promise.all([
      sb.from('pickup_requests').select('*').eq('status', 'pending').order('requested_at', { ascending: true }),
      sb.from('orders').select('*').eq('status', 'shipped').order('shipped_at', { ascending: false }).limit(50),
    ]);
    if (pendingRes.error) {
      content.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div>${esc(pendingRes.error.message)}</div>`;
      return;
    }
    if (shippedRes.error) {
      content.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div>${esc(shippedRes.error.message)}</div>`;
      return;
    }
    pendingRequests = pendingRes.data || [];
    shippedOrders = shippedRes.data || [];
    document.getElementById('count-pending').textContent = pendingRequests.length;
    document.getElementById('count-shipped').textContent = shippedOrders.length;
    renderShipping();
  } catch (err) {
    content.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div>${esc(err.message)}</div>`;
  }
}

function renderShipping() {
  const content = document.getElementById('ship-content');
  if (shipTab === 'pending') {
    if (!pendingRequests.length) {
      content.innerHTML = `<div class="empty"><div class="empty-icon">📭</div>No pending pickup requests</div>`;
      return;
    }
    content.innerHTML = pendingRequests.map(req => `
      <div class="req-card">
        <div class="req-top">
          <div>
            <div class="req-item">${esc(req.item_title || 'Order')}</div>
            <div class="req-store">${esc(req.store_name || '')}</div>
          </div>
          <div class="req-value">₦${Number(req.item_value_ngn || 0).toLocaleString()}</div>
        </div>
        <div class="req-section">
          <div class="req-label">Pickup From</div>
          <div class="req-row"><b>${esc(req.pickup_name || '—')}</b><span>${esc(req.pickup_phone || '')}</span></div>
          <div class="req-row"><span>${esc(req.pickup_address || 'No address')} · ${esc(req.pickup_state || '')}</span></div>
        </div>
        <div class="req-section">
          <div class="req-label">Deliver To</div>
          <div class="req-row"><b>${esc(req.delivery_name || '—')}</b><span>${esc(req.delivery_phone || '')}</span></div>
          <div class="req-row"><span>${esc(req.delivery_address || 'No address')} · ${esc(req.delivery_state || '')}</span></div>
        </div>
        <div class="req-meta">
          <span>⚖️ ${req.weight_kg || '—'} kg</span>
          <span>🕐 ${timeAgo(req.requested_at)}</span>
        </div>
        ${req.note ? `<div class="req-section"><div class="req-label">Note</div><div class="req-row"><span>${esc(req.note)}</span></div></div>` : ''}
        <div class="req-actions">
          <button class="btn btn-primary" style="flex:1" onclick="openShipModal('${req.id}','${req.order_id}')">🚚 Mark Shipped</button>
        </div>
      </div>`).join('');
  } else {
    if (!shippedOrders.length) {
      content.innerHTML = `<div class="empty"><div class="empty-icon">📭</div>No shipped orders yet</div>`;
      return;
    }
    content.innerHTML = shippedOrders.map(order => `
      <div class="req-card">
        <div class="req-top">
          <div>
            <div class="req-item">${esc(order.title || 'Order')}</div>
            <div class="req-store">Courier: ${esc(order.courier || '—')}${order.tracking_number ? ' · ' + esc(order.tracking_number) : ''}</div>
          </div>
          <span class="status-pill status-shipped">Shipped</span>
        </div>
        <div class="req-meta"><span>🕐 Shipped ${timeAgo(order.shipped_at)}</span></div>
        <div class="req-actions">
          <button class="btn btn-green" style="flex:1" onclick="markDelivered('${order.id}')">✅ Mark Delivered</button>
        </div>
      </div>`).join('');
  }
}

function openShipModal(requestId, orderId) {
  activeRequestId = requestId;
  activeOrderId = orderId;
  document.getElementById('modal-courier').value = '';
  document.getElementById('modal-tracking').value = '';
  document.getElementById('ship-modal').classList.add('show');
}
function closeShipModal() {
  document.getElementById('ship-modal').classList.remove('show');
  activeRequestId = null;
  activeOrderId = null;
}

async function confirmMarkShipped() {
  const courier = document.getElementById('modal-courier').value.trim();
  const tracking = document.getElementById('modal-tracking').value.trim();
  if (!courier) { alert('Enter a courier name'); return; }

  const btn = document.getElementById('modal-confirm-ship');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const autoRelease = new Date();
  autoRelease.setDate(autoRelease.getDate() + 7);

  try {
    const orderUpdate = await sb.from('orders').update({
      status: 'shipped',
      courier,
      tracking_number: tracking || null,
      shipped_at: new Date().toISOString(),
      auto_release_at: autoRelease.toISOString(),
    }).eq('id', activeOrderId).select();

    if (orderUpdate.error) {
      alert('Failed: ' + orderUpdate.error.message);
      btn.disabled = false; btn.textContent = 'Confirm'; return;
    }
    if (!orderUpdate.data?.length) {
      alert('Order update affected 0 rows — likely RLS. Not marked shipped.');
      btn.disabled = false; btn.textContent = 'Confirm'; return;
    }

    await sb.from('pickup_requests').update({ status: 'fulfilled' }).eq('id', activeRequestId).select();

    const { data: order } = await sb.from('orders').select('buyer_id,title').eq('id', activeOrderId).single();
    if (order) {
      await sb.from('notifications').insert({
        user_id: order.buyer_id,
        type: 'order_shipped',
        comment_text: `"${order.title || 'Your order'}" has been shipped via ${courier}${tracking ? ` · Tracking: ${tracking}` : ''}. Confirm delivery when it arrives.`,
        created_at: new Date().toISOString(),
      });
    }

    btn.disabled = false; btn.textContent = 'Confirm';
    closeShipModal();
    loadShipping();
    toast('Marked shipped');
  } catch (err) {
    alert('Error: ' + (err.message || 'Unknown'));
    btn.disabled = false; btn.textContent = 'Confirm';
  }
}

async function markDelivered(orderId) {
  if (!confirm('Mark delivered? This releases escrow to the seller.')) return;
  try {
    const { data: order, error: orderErr } = await sb.from('orders').select('*').eq('id', orderId).single();
    if (orderErr || !order) { alert('Order not found'); return; }

    const escrowRes = await sb.rpc('escrow_release_points', { p_order_id: order.id });
    if (escrowRes.error) {
      alert('Escrow release FAILED: ' + escrowRes.error.message);
      return;
    }

    const delUpdate = await sb.from('orders').update({
      status: 'delivered',
      delivered_at: new Date().toISOString(),
      confirmed_at: new Date().toISOString(),
    }).eq('id', orderId).select();

    if (delUpdate.error) { alert('Escrow ok, but mark delivered failed: ' + delUpdate.error.message); return; }
    if (!delUpdate.data?.length) { alert('Escrow ok, but 0 rows updated (RLS?)'); return; }

    try {
      await sb.rpc('increment_storefront_stats', { p_seller_id: order.seller_id, p_revenue: order.price_ngn || 0 });
    } catch (e) { console.warn(e); }

    await sb.from('notifications').insert({
      user_id: order.seller_id,
      type: 'order_delivered',
      comment_text: `"${order.title || 'Your order'}" was delivered. Funds released to your wallet.`,
      created_at: new Date().toISOString(),
    });

    loadShipping();
    toast('Delivered · escrow released');
  } catch (err) {
    alert('Error: ' + (err.message || 'Unknown'));
  }
}

// ══════════════════════════════════════════════════════════
// PULSE
// ══════════════════════════════════════════════════════════
async function loadPulseOverview() {
  const statsEl = document.getElementById('pulse-stats');
  const needEl = document.getElementById('pulse-needs-resolve');
  const openEl = document.getElementById('pulse-open-list');
  const now = new Date().toISOString();

  const [openRes, closedRes, resolvedRes, stakesRes] = await Promise.all([
    sb.from('predictions').select('id', { count: 'exact', head: true }).eq('status', 'open').gt('closes_at', now),
    sb.from('predictions').select('id', { count: 'exact', head: true }).eq('status', 'open').lte('closes_at', now),
    sb.from('predictions').select('id', { count: 'exact', head: true }).eq('status', 'resolved'),
    sb.from('prediction_stakes').select('amount_mp, status'),
  ]);

  const stakes = stakesRes.data || [];
  const pendingVol = stakes.filter(s => s.status === 'pending').reduce((a, s) => a + Number(s.amount_mp || 0), 0);

  statsEl.innerHTML = `
    <div class="stat-card"><div class="stat-label">Open</div><div class="stat-value accent">${openRes.count ?? 0}</div></div>
    <div class="stat-card"><div class="stat-label">To resolve</div><div class="stat-value amber">${closedRes.count ?? 0}</div></div>
    <div class="stat-card"><div class="stat-label">Resolved</div><div class="stat-value green">${resolvedRes.count ?? 0}</div></div>
    <div class="stat-card"><div class="stat-label">Pending vol</div><div class="stat-value">${fmtMP(pendingVol)}</div></div>`;

  const { data: closed } = await sb.from('predictions')
    .select('id, title, category, total_pool, stake_count, closes_at, status')
    .eq('status', 'open').lte('closes_at', now)
    .order('closes_at', { ascending: false }).limit(10);
  needEl.innerHTML = renderMarketCards(closed || [], true);

  const { data: open } = await sb.from('predictions')
    .select('id, title, category, total_pool, stake_count, closes_at, status')
    .eq('status', 'open').gt('closes_at', now)
    .order('closes_at', { ascending: true }).limit(10);
  openEl.innerHTML = renderMarketCards(open || [], false);
}

function renderMarketCards(rows, showResolve) {
  if (!rows.length) return '<div class="muted-center">Nothing here</div>';
  return rows.map(p => {
    const canResolve = p.status !== 'resolved';
    const titleJs = String(p.title || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `
    <div class="market-card" id="mcard-${p.id}">
      <div class="market-title">${esc(p.title)}</div>
      <div class="market-meta">
        ${statusBadge(p)}
        <span>${esc(p.category || '')}</span>
        <span>${fmtMP(p.total_pool)}</span>
        <span>${p.stake_count || 0} stakers</span>
        <span>${fmtTime(p.closes_at)}</span>
      </div>
      <div class="market-actions">
        ${canResolve ? `<button class="btn btn-primary btn-sm" onclick="goResolve('${p.id}')">Resolve</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="deletePrediction('${p.id}', '${titleJs}', ${Number(p.total_pool)||0}, ${Number(p.stake_count)||0})">Delete</button>
      </div>
    </div>`;
  }).join('');
}

async function deletePrediction(id, title, pool, stakeCount) {
  const hasActivity = Number(pool) > 0 || Number(stakeCount) > 0;
  const msg = hasActivity
    ? `"${title}" already has stakes/pool.\n\nPending stakes will be refunded, then the market will be permanently deleted.\n\nContinue?`
    : `Delete "${title}"?\n\nThis cannot be undone.`;
  if (!confirm(msg)) return;

  try {
    if (hasActivity) {
      // Refund any pending stakes first
      const voidRes = await sb.rpc('void_prediction', {
        p_prediction_id: id,
        p_resolved_by: currentUser?.id || null,
      });
      if (voidRes.error && !String(voidRes.error.message || '').includes('Already resolved')) {
        // If not unresolved, try continue with deletes anyway for mistaken drafts
        console.warn('void_prediction:', voidRes.error);
      }
    }

    // Remove child rows then parent (order matters if no CASCADE)
    const s1 = await sb.from('prediction_stakes').delete().eq('prediction_id', id);
    if (s1.error) {
      toast('Could not delete stakes: ' + s1.error.message, 'error');
      return;
    }
    const s2 = await sb.from('prediction_options').delete().eq('prediction_id', id);
    if (s2.error) {
      toast('Could not delete options: ' + s2.error.message, 'error');
      return;
    }
    const s3 = await sb.from('predictions').delete().eq('id', id);
    if (s3.error) {
      toast('Could not delete market: ' + s3.error.message, 'error');
      return;
    }

    toast('Market deleted');
    document.getElementById('mcard-' + id)?.remove();
    if (currentSection === 'pulse') refreshPulse();
  } catch (err) {
    toast(err.message || 'Delete failed', 'error');
  }
}

function goResolve(id) {
  setPulseTab('resolve');
  setTimeout(() => {
    const sel = document.getElementById('r-pred');
    if (sel) { sel.value = id; onResolveChange(); }
  }, 50);
}

function setMarketFilter(f) {
  marketFilter = f;
  document.querySelectorAll('#pulse-markets .chip').forEach(c =>
    c.classList.toggle('active', c.dataset.f === f));
  loadMarkets();
}

async function loadMarkets() {
  const el = document.getElementById('pulse-markets-list');
  el.innerHTML = '<div class="loading">Loading…</div>';
  const now = new Date().toISOString();
  let q = sb.from('predictions')
    .select('id, title, category, total_pool, stake_count, closes_at, status, created_at')
    .order('created_at', { ascending: false }).limit(40);
  if (marketFilter === 'open') q = q.eq('status', 'open').gt('closes_at', now);
  else if (marketFilter === 'closed') q = q.eq('status', 'open').lte('closes_at', now);
  else if (marketFilter === 'resolved') q = q.eq('status', 'resolved');

  const { data, error } = await q;
  if (error) { el.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  el.innerHTML = renderMarketCards(data || [], true);
}

// Create
function addOptRow() {
  const wrap = document.getElementById('c-options');
  const div = document.createElement('div');
  div.className = 'opt-row';
  div.innerHTML =
    '<input class="field c-opt" placeholder="Option" maxlength="80">' +
    '<input class="field c-prob" type="number" min="1" max="99" step="1" placeholder="%" value="0">';
  wrap.appendChild(div);
  const probs = [...wrap.querySelectorAll('.c-prob')];
  if (probs.length) {
    const even = Math.floor(100 / probs.length);
    let left = 100;
    probs.forEach((p, i) => {
      const v = i === probs.length - 1 ? left : even;
      p.value = v;
      left -= even;
    });
  }
  updateProbSum();
  wrap.querySelectorAll('.c-prob').forEach(el => {
    el.oninput = updateProbSum;
  });
}

function equalizeOpeningProbs() {
  const probs = [...document.querySelectorAll('#c-options .c-prob')];
  if (!probs.length) return;
  const even = Math.floor(100 / probs.length);
  let left = 100;
  probs.forEach((p, i) => {
    const v = i === probs.length - 1 ? left : even;
    p.value = v;
    left -= even;
  });
  updateProbSum();
}

function updateProbSum() {
  const el = document.getElementById('c-prob-sum');
  if (!el) return;
  const sum = [...document.querySelectorAll('#c-options .c-prob')]
    .reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
  el.textContent = 'Sum: ' + sum + '%';
  el.style.color = Math.abs(sum - 100) < 0.5 ? 'var(--green)' : 'var(--red)';
}

document.addEventListener('input', (e) => {
  if (e.target && e.target.classList && e.target.classList.contains('c-prob')) updateProbSum();
});

async function createPrediction() {
  const title = document.getElementById('c-title').value.trim();
  const description = document.getElementById('c-desc').value.trim();
  const category = document.getElementById('c-category').value;
  const closesLocal = document.getElementById('c-closes').value;
  const errEl = document.getElementById('c-error');
  const btn = document.getElementById('c-submit');
  errEl.textContent = '';

  const rows = [...document.querySelectorAll('#c-options .opt-row')].map(row => ({
    label: (row.querySelector('.c-opt')?.value || '').trim(),
    pct: parseFloat(row.querySelector('.c-prob')?.value) || 0,
  })).filter(r => r.label);

  if (!title) { errEl.textContent = 'Title required'; return; }
  if (!closesLocal) { errEl.textContent = 'Close time required'; return; }
  if (rows.length < 2) { errEl.textContent = 'Need at least 2 options'; return; }
  const pctSum = rows.reduce((s, r) => s + r.pct, 0);
  if (Math.abs(pctSum - 100) > 0.5) {
    errEl.textContent = 'Opening % must total 100 (now ' + pctSum + '). Use Equalize or fix values.';
    return;
  }
  const closes_at = new Date(closesLocal).toISOString();
  if (new Date(closes_at) <= new Date()) { errEl.textContent = 'Close time must be in the future'; return; }

  btn.disabled = true; btn.textContent = 'Publishing…';

  const { data: pred, error } = await sb.from('predictions').insert({
    title, description: description || null, category, status: 'open', closes_at,
    total_pool: 0, prize_pool: 0, stake_count: 0, view_count: 0,
  }).select().single();

  if (error) {
    btn.disabled = false; btn.textContent = 'Publish market';
    errEl.textContent = error.message; return;
  }

  const { error: optErr } = await sb.from('prediction_options').insert(
    rows.map((r) => ({
      prediction_id: pred.id,
      label: r.label,
      total_staked: 0,
      opening_prob: Math.round((r.pct / 100) * 10000) / 10000, // 0–1
    }))
  );

  btn.disabled = false; btn.textContent = 'Publish market';
  if (optErr) {
    errEl.textContent = 'Options failed: ' + optErr.message +
      (String(optErr.message).includes('opening_prob')
        ? ' — Run the SQL to add opening_prob column first.'
        : '');
    return;
  }

  toast('Market published with opening odds');
  document.getElementById('c-title').value = '';
  document.getElementById('c-desc').value = '';
  const wrap = document.getElementById('c-options');
  wrap.innerHTML =
    '<div class="opt-row"><input class="field c-opt" placeholder="Option A" maxlength="80"><input class="field c-prob" type="number" min="1" max="99" step="1" placeholder="%" value="50"></div>' +
    '<div class="opt-row"><input class="field c-opt" placeholder="Option B" maxlength="80"><input class="field c-prob" type="number" min="1" max="99" step="1" placeholder="%" value="50"></div>';
  updateProbSum();
  setPulseTab('markets');
  setMarketFilter('open');
}

// Resolve
async function loadResolveList() {
  const sel = document.getElementById('r-pred');
  const prev = sel.value;
  const { data } = await sb.from('predictions')
    .select('id, title, status, closes_at, total_pool')
    .neq('status', 'resolved').order('closes_at', { ascending: true }).limit(80);

  sel.innerHTML = '<option value="">Select…</option>' + (data || []).map(p => {
    const tag = new Date(p.closes_at) <= new Date() ? 'CLOSED' : 'OPEN';
    return `<option value="${p.id}">[${tag}] ${esc(p.title)} — ${fmtMP(p.total_pool)}</option>`;
  }).join('');
  if (prev) sel.value = prev;

  const { data: recent } = await sb.from('predictions')
    .select('id, title, resolved_at, total_pool, resolved_option_id, prediction_options(id, label)')
    .eq('status', 'resolved').order('resolved_at', { ascending: false }).limit(8);

  const recentEl = document.getElementById('r-recent');
  if (!recent?.length) recentEl.innerHTML = '<div class="muted-center">No resolved markets yet</div>';
  else recentEl.innerHTML = recent.map(p => {
    const win = (p.prediction_options || []).find(o => o.id === p.resolved_option_id);
    return `<div class="market-card">
      <div class="market-title">${esc(p.title)}</div>
      <div class="market-meta">
        <span class="badge badge-resolved">Winner: ${esc(win?.label || '—')}</span>
        <span>${fmtMP(p.total_pool)}</span>
        <span>${fmtTime(p.resolved_at)}</span>
      </div>
    </div>`;
  }).join('');
}

async function onResolveChange() {
  const id = document.getElementById('r-pred').value;
  const detail = document.getElementById('r-detail');
  resolveSelectedOpt = null;
  document.getElementById('r-submit').disabled = true;
  document.getElementById('r-void').disabled = !id;
  document.getElementById('r-error').textContent = '';
  if (!id) { detail.classList.add('hidden'); return; }

  const { data: pred, error } = await sb.from('predictions')
    .select('*, prediction_options(*)').eq('id', id).single();
  if (error || !pred) { detail.classList.add('hidden'); toast(error?.message || 'Load failed', 'error'); return; }

  resolvePredCache = pred;
  const opts = (pred.prediction_options || []).sort((a, b) => (b.total_staked || 0) - (a.total_staked || 0));
  const prize = pred.prize_pool || (Number(pred.total_pool || 0) * 0.92);

  document.getElementById('r-meta').innerHTML = `
    <strong>${esc(pred.title)}</strong><br>
    ${statusBadge(pred)} · Pool <strong>${fmtMP(pred.total_pool)}</strong>
    · Prize <strong>${fmtMP(prize)}</strong>
    · ${pred.stake_count || 0} stakers · Closes ${fmtTime(pred.closes_at)}`;

  document.getElementById('r-options').innerHTML = opts.map(o => {
    const pct = pred.total_pool > 0 ? Math.round((o.total_staked / pred.total_pool) * 100) : 0;
    return `<label class="resolve-opt" id="ropt-${o.id}">
      <input type="radio" name="win-opt" value="${o.id}" onchange="selectWinOpt('${o.id}')">
      <span style="flex:1">${esc(o.label)}</span>
      <span style="font-size:12px;color:var(--text3)">${fmtMP(o.total_staked)} · ${pct}%</span>
    </label>`;
  }).join('');
  detail.classList.remove('hidden');
}

function selectWinOpt(optId) {
  resolveSelectedOpt = optId;
  document.querySelectorAll('.resolve-opt').forEach(el => el.classList.remove('selected'));
  document.getElementById('ropt-' + optId)?.classList.add('selected');
  document.getElementById('r-submit').disabled = false;
}

async function submitResolve() {
  const predId = document.getElementById('r-pred').value;
  if (!predId || !resolveSelectedOpt) return;
  const label = resolvePredCache?.prediction_options?.find(o => o.id === resolveSelectedOpt)?.label;
  if (!confirm(`Resolve?\n\nWinner: ${label}\n\nPays winners from prize pool. Hard to undo.`)) return;

  const btn = document.getElementById('r-submit');
  const errEl = document.getElementById('r-error');
  btn.disabled = true; errEl.textContent = '';

  const { data, error } = await sb.rpc('resolve_prediction', {
    p_prediction_id: predId,
    p_winning_option_id: resolveSelectedOpt,
    p_resolved_by: currentUser.id,
  });

  btn.disabled = false;
  if (error) { errEl.textContent = error.message; toast(error.message, 'error'); return; }
  if (!data?.ok) { errEl.textContent = data?.error || 'Failed'; toast(data?.error || 'Failed', 'error'); return; }

  if (data.mode === 'refund_all') toast(`Refunded ${data.refunded_count} · ${data.total_paid} MP`);
  else toast(`Settled · ${data.winners} won, ${data.losers} lost · paid ${data.total_paid} MP`);

  document.getElementById('r-detail').classList.add('hidden');
  loadResolveList();
}

async function submitVoid() {
  const predId = document.getElementById('r-pred').value;
  if (!predId) return;
  if (!confirm('Void and refund ALL pending stakes?')) return;
  const btn = document.getElementById('r-void');
  btn.disabled = true;
  const { data, error } = await sb.rpc('void_prediction', {
    p_prediction_id: predId,
    p_resolved_by: currentUser.id,
  });
  btn.disabled = false;
  if (error || !data?.ok) { toast(error?.message || data?.error || 'Void failed', 'error'); return; }
  toast(`Voided · refunded ${data.refunded} · ${data.total} MP`);
  document.getElementById('r-detail').classList.add('hidden');
  loadResolveList();
}

// Stakes
async function loadStakes() {
  const el = document.getElementById('stakes-list');
  el.innerHTML = '<div class="loading">Loading…</div>';
  const status = document.getElementById('stakes-status').value;
  let q = sb.from('prediction_stakes').select(`
    id, amount_mp, status, actual_return, created_at, user_id,
    prediction:predictions(title), option:prediction_options(label)
  `).order('created_at', { ascending: false }).limit(60);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) { el.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  if (!data?.length) { el.innerHTML = '<div class="empty">No stakes</div>'; return; }

  el.innerHTML = data.map(s => `
    <div class="stake-card">
      <div class="stake-row">
        <strong>${esc(s.prediction?.title || '—')}</strong>
        <span class="badge badge-${esc(s.status)}">${esc(s.status)}</span>
      </div>
      <div class="stake-row">
        <span>Pick: ${esc(s.option?.label || '—')}</span>
        <span>${fmtMP(s.amount_mp)} → ${fmtMP(s.actual_return)}</span>
      </div>
      <div class="stake-muted">${fmtTime(s.created_at)} · user ${esc(String(s.user_id).slice(0, 8))}…</div>
    </div>`).join('');
}
