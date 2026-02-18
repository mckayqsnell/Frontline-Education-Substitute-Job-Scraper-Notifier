/**
 * Dashboard Frontend
 *
 * Fetches /api/stats, /api/heartbeat, and /api/logs every 30 seconds.
 * Renders live status, today's numbers, charts, errors, and logs.
 * Ticks relative timestamps every second so the UI feels alive.
 */

const REFRESH_INTERVAL = 30_000; // 30 seconds
const STALE_THRESHOLD = 120_000; // 2 minutes — if heartbeat older than this, daemon is stuck

let historyChart = null;
let recentChart = null;

// Cached values for live-ticking relative times
let cachedLastCheckTime = null;
let cachedUpSince = null;
let cachedHeartbeatPid = null;
let secondsUntilRefresh = 30;

// ---- Helpers ----

function formatTime(isoOrTs) {
  if (!isoOrTs) return '—';
  const d = new Date(isoOrTs);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatRelative(isoOrTs) {
  if (!isoOrTs) return '—';
  const ms = Date.now() - new Date(isoOrTs).getTime();
  if (ms < 0) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

function $(id) { return document.getElementById(id); }

// ---- Status Badge ----

function updateStatusBadge(heartbeat) {
  const badge = $('status-badge');

  if (!heartbeat || heartbeat.error) {
    badge.className = 'badge badge-stopped';
    badge.textContent = 'Stopped';
    return;
  }

  const age = Date.now() - heartbeat.timestamp;

  if (age > STALE_THRESHOLD) {
    badge.className = 'badge badge-stopped';
    badge.textContent = 'Stale';
    return;
  }

  if (heartbeat.status === 'sleeping') {
    badge.className = 'badge badge-sleeping';
    badge.textContent = 'Sleeping';
    return;
  }

  badge.className = 'badge badge-running';
  badge.textContent = 'Running';
}

// ---- Live Status ----

function updateLiveStatus(stats, heartbeat) {
  const status = stats?.currentStatus || {};
  cachedLastCheckTime = status.lastCheckTime || null;
  cachedUpSince = status.upSince || null;
  cachedHeartbeatPid = heartbeat?.pid || null;

  $('last-check').textContent = cachedLastCheckTime ? formatRelative(cachedLastCheckTime) : '—';
  $('check-duration').textContent = status.lastCheckDurationMs ? `${status.lastCheckDurationMs}ms` : '—';
  $('up-since').textContent = cachedUpSince ? formatRelative(cachedUpSince) : '—';
  $('pid').textContent = cachedHeartbeatPid || '—';
}

/** Tick the relative timestamps every second without re-fetching */
function tickLiveStatus() {
  if (cachedLastCheckTime) {
    $('last-check').textContent = formatRelative(cachedLastCheckTime);
  }
  if (cachedUpSince) {
    $('up-since').textContent = formatRelative(cachedUpSince);
  }
}

// ---- Today's Numbers ----

function updateTodayStats(stats) {
  const today = stats?.todayStats || {};
  $('total-checks').textContent = today.totalChecks ?? '—';
  $('jobs-seen').textContent = today.totalJobsSeen ?? '—';
  $('jobs-matched').textContent = today.totalJobsMatched ?? '—';
  $('jobs-notified').textContent = today.totalJobsNotified ?? '—';
  $('total-errors').textContent = today.totalErrors ?? '0';
}

// ---- Chart Theme ----

const chartGrid = '#1e2230';
const chartTick = '#6b7394';

// ---- History Chart (30 days) ----

function updateHistoryChart(stats) {
  const history = [...(stats?.history || [])];

  // Include today's running stats as the latest data point
  if (stats?.todayStats) {
    history.push({
      date: stats.todayStats.date + ' (today)',
      totalJobsSeen: stats.todayStats.totalJobsSeen,
      totalJobsMatched: stats.todayStats.totalJobsMatched,
      totalJobsNotified: stats.todayStats.totalJobsNotified,
      bookingActions: stats.bookingActions || {},
    });
  }

  if (history.length === 0) return;

  const labels = history.map(h => h.date);
  const jobsSeen = history.map(h => h.totalJobsSeen);
  const jobsMatched = history.map(h => h.totalJobsMatched);
  const jobsNotified = history.map(h => h.totalJobsNotified);
  const booked = history.map(h => (h.bookingActions?.booked || 0) + (h.bookingActions?.autoBooked || 0));
  const failed = history.map(h => h.bookingActions?.failed || 0);

  const data = {
    labels,
    datasets: [
      { label: 'Jobs Seen', data: jobsSeen, borderColor: '#4fc3f7', backgroundColor: 'rgba(79,195,247,0.08)', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#4fc3f7' },
      { label: 'Matched', data: jobsMatched, borderColor: '#ffeb3b', backgroundColor: 'rgba(255,235,59,0.08)', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#ffeb3b' },
      { label: 'Notified', data: jobsNotified, borderColor: '#ffa726', backgroundColor: 'rgba(255,167,38,0.08)', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#ffa726' },
      { label: 'Booked', data: booked, borderColor: '#00e676', backgroundColor: 'rgba(0,230,118,0.08)', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#00e676' },
      { label: 'Failed', data: failed, borderColor: '#ff5252', backgroundColor: 'rgba(255,82,82,0.08)', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#ff5252' },
    ],
  };

  const opts = {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: chartTick, usePointStyle: true, padding: 20 } } },
    scales: {
      x: { ticks: { color: chartTick }, grid: { color: chartGrid } },
      y: { ticks: { color: chartTick }, grid: { color: chartGrid }, beginAtZero: true },
    },
  };

  if (historyChart) {
    historyChart.data = data;
    historyChart.update();
  } else {
    historyChart = new Chart($('history-chart'), { type: 'line', data, options: opts });
  }
}

// ---- Recent Checks Chart (last 50) ----

function updateRecentChart(stats) {
  const allChecks = stats?.recentChecks || [];
  if (allChecks.length === 0) return;

  // Only show the last 50 checks for readability
  const checks = allChecks.slice(-50);

  const labels = checks.map(c => formatTime(c.timestamp));
  const jobsSeen = checks.map(c => c.jobsSeen);
  const jobsMatched = checks.map(c => (c.jobsMatched || 0) - (c.uncertainMatched || 0));
  const uncertainMatched = checks.map(c => c.uncertainMatched || 0);

  const data = {
    labels,
    datasets: [
      { label: 'Jobs Seen', data: jobsSeen, backgroundColor: 'rgba(79,195,247,0.5)', borderColor: 'rgba(79,195,247,0.8)', borderWidth: 1, borderRadius: 2 },
      { label: 'Matched', data: jobsMatched, backgroundColor: 'rgba(0,230,118,0.8)', borderColor: '#00e676', borderWidth: 1, borderRadius: 2 },
      { label: 'Uncertain', data: uncertainMatched, backgroundColor: 'rgba(255,235,59,0.85)', borderColor: '#ffeb3b', borderWidth: 1, borderRadius: 2 },
    ],
  };

  const opts = {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: chartTick, usePointStyle: true, padding: 20 } } },
    scales: {
      x: { ticks: { color: chartTick, maxTicksLimit: 15 }, grid: { color: chartGrid } },
      y: { ticks: { color: chartTick }, grid: { color: chartGrid }, beginAtZero: true },
    },
  };

  if (recentChart) {
    recentChart.data = data;
    recentChart.update();
  } else {
    recentChart = new Chart($('recent-chart'), { type: 'bar', data, options: opts });
  }
}

// ---- Booking Actions ----

function updateBookingActions(stats) {
  const actions = stats?.bookingActions || {};
  $('action-auto-booked').textContent = actions.autoBooked ?? 0;
  $('action-booked').textContent = actions.booked ?? 0;
  $('action-ignored').textContent = actions.ignored ?? 0;
  $('action-expired').textContent = actions.expired ?? 0;
  $('action-failed').textContent = actions.failed ?? 0;
  $('action-uncertain-booked').textContent = actions.uncertainBooked ?? 0;
  $('action-uncertain-ignored').textContent = actions.uncertainIgnored ?? 0;
  $('action-uncertain-expired').textContent = actions.uncertainExpired ?? 0;
}

// ---- Errors List (newest first) ----

function updateErrors(stats) {
  const errors = stats?.recentErrors || [];
  const el = $('errors-list');

  if (errors.length === 0) {
    el.innerHTML = '<p class="muted">No errors</p>';
    return;
  }

  // Reverse so newest errors appear at the top
  el.innerHTML = [...errors].reverse().map(e => `
    <div class="error-item">
      <div class="error-time">${formatTime(e.timestamp)} ${e.recovered ? '(recovered)' : ''}</div>
      <div>${e.message}</div>
    </div>
  `).join('');
}

// ---- Logs (newest first) ----

async function updateLogs() {
  try {
    const res = await fetch('/api/logs?lines=100');
    const text = await res.text();
    const el = $('logs-output');
    // Reverse lines so newest logs appear at the top
    const lines = text.split('\n').filter(l => l.trim());
    el.textContent = lines.reverse().join('\n');
  } catch {
    $('logs-output').textContent = 'Failed to fetch logs.';
  }
}

// ---- Main Refresh ----

async function refresh() {
  try {
    const [statsRes, heartbeatRes] = await Promise.all([
      fetch('/api/stats'),
      fetch('/api/heartbeat'),
    ]);

    const stats = await statsRes.json();
    const heartbeat = await heartbeatRes.json();

    updateStatusBadge(heartbeat);
    updateLiveStatus(stats, heartbeat);
    updateTodayStats(stats);
    updateBookingActions(stats);
    updateHistoryChart(stats);
    updateRecentChart(stats);
    updateErrors(stats);
  } catch (err) {
    $('status-badge').className = 'badge badge-stopped';
    $('status-badge').textContent = 'Error';
    console.error('Dashboard refresh failed:', err);
  }

  await updateLogs();
  secondsUntilRefresh = REFRESH_INTERVAL / 1000;
}

// ---- 1-second tick (updates relative times + countdown) ----

function tick() {
  tickLiveStatus();
  secondsUntilRefresh = Math.max(0, secondsUntilRefresh - 1);
  const timer = $('refresh-timer');
  if (timer) timer.textContent = `Refresh in ${secondsUntilRefresh}s`;
}

// Initial load + intervals
refresh();
setInterval(refresh, REFRESH_INTERVAL);
setInterval(tick, 1000);
