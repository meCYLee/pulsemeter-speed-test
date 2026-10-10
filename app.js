const ENDPOINTS = Object.freeze({
  download: 'https://speed.cloudflare.com/__down',
  upload: 'https://speed.cloudflare.com/__up',
});

const TEST_TIMEOUT = 20_000;
const now = () => performance.now();

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const ordered = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (ordered.length === 0) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function calculateJitter(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const deltas = samples.slice(1).map((value, index) => Math.abs(value - samples[index]));
  return median(deltas);
}

export function toMbps(bytes, durationMs) {
  if (!Number.isFinite(bytes) || !Number.isFinite(durationMs) || bytes < 0 || durationMs <= 0) return null;
  return (bytes * 8) / (durationMs * 1_000);
}

export function formatMbps(value) { return Number.isFinite(value) && value >= 0 ? value.toFixed(1) : '—'; }
export function formatMilliseconds(value) { return Number.isFinite(value) && value >= 0 ? String(Math.round(value)) : '—'; }

export function connectionGrade({ download, upload, ping }) {
  if (![download, upload, ping].every(Number.isFinite)) return '部分結果無法完成';
  if (download >= 100 && upload >= 20 && ping <= 30) return '非常優秀';
  if (download >= 10 && upload >= 2 && ping <= 120) return '表現穩定';
  return '需要留意';
}

function requestSignal() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function timedFetch(url, options = {}) {
  const request = requestSignal();
  const start = now();
  try {
    const response = await fetch(url, { cache: 'no-store', ...options, signal: request.signal });
    if (!response.ok) throw new Error(`測試端點回傳 ${response.status}`);
    const body = await response.arrayBuffer();
    return { duration: now() - start, bytes: body.byteLength };
  } finally { request.clear(); }
}

export async function measureLatency() {
  const samples = [];
  for (let index = 0; index < 4; index += 1) {
    const result = await timedFetch(`${ENDPOINTS.download}?bytes=1&cache=${Date.now()}-${index}`);
    samples.push(result.duration);
  }
  return { ping: median(samples), jitter: calculateJitter(samples) };
}

export async function measureDownload() {
  const result = await timedFetch(`${ENDPOINTS.download}?bytes=15000000&cache=${Date.now()}`);
  return toMbps(result.bytes, result.duration);
}

export async function measureUpload() {
  const payload = new Uint8Array(8_000_000);
  crypto.getRandomValues(payload.subarray(0, 65_536));
  const result = await timedFetch(`${ENDPOINTS.upload}?cache=${Date.now()}`, { method: 'POST', body: payload });
  return toMbps(payload.byteLength, result.duration);
}

function getUi() {
  return {
    button: document.querySelector('#start-test'), status: document.querySelector('#test-status'), error: document.querySelector('#test-error'),
    dial: document.querySelector('#dial-progress'), label: document.querySelector('#speed-label'), value: document.querySelector('#speed-value'), unit: document.querySelector('#speed-unit'),
    grade: document.querySelector('#connection-grade'), download: document.querySelector('#result-download'), upload: document.querySelector('#result-upload'), ping: document.querySelector('#result-ping'), jitter: document.querySelector('#result-jitter'),
  };
}

function setProgress(ui, amount, color = 'var(--cyan)') { ui.dial.style.strokeDashoffset = String(672.3 * (1 - amount)); ui.dial.style.stroke = color; }
function showError(ui, message) { ui.error.textContent = message; ui.error.hidden = false; }
function clearError(ui) { ui.error.textContent = ''; ui.error.hidden = true; }
function showPhase(ui, label, status, progress, color) { ui.label.textContent = label; ui.status.textContent = status; setProgress(ui, progress, color); }
function resetResults(ui) {
  [ui.download, ui.upload, ui.ping, ui.jitter].forEach((element) => { element.textContent = '—'; });
  ui.value.textContent = '—'; ui.unit.textContent = 'Mbps'; ui.grade.textContent = '正在準備新的測試';
}

let running = false;
export async function runSpeedTest() {
  if (running) return;
  const ui = getUi();
  running = true; clearError(ui); resetResults(ui); ui.button.disabled = true; ui.button.querySelector('span:nth-child(2)').textContent = '測速中';
  const results = { download: null, upload: null, ping: null };
  try {
    showPhase(ui, '延遲', '正在確認回應速度…', .25, 'var(--lime)');
    const latency = await measureLatency(); results.ping = latency.ping; ui.ping.textContent = formatMilliseconds(latency.ping); ui.jitter.textContent = formatMilliseconds(latency.jitter); ui.value.textContent = formatMilliseconds(latency.ping); ui.unit.textContent = 'ms';
    showPhase(ui, '下載', '正在量測下載速度…', .58, 'var(--cyan)');
    results.download = await measureDownload(); ui.download.textContent = formatMbps(results.download); ui.value.textContent = formatMbps(results.download); ui.unit.textContent = 'Mbps';
    showPhase(ui, '上傳', '正在量測上傳速度…', .85, 'var(--pink)');
    results.upload = await measureUpload(); ui.upload.textContent = formatMbps(results.upload); ui.value.textContent = formatMbps(results.upload); ui.unit.textContent = 'Mbps';
    showPhase(ui, '完成', '測試完成', 1, 'var(--violet)'); ui.grade.textContent = connectionGrade(results);
  } catch (error) {
    ui.status.textContent = '這次測試未能完成'; ui.label.textContent = '無法量測'; ui.grade.textContent = '請確認網路後再試一次';
    showError(ui, '無法連線至測試端點。請確認裝置已連上網路，或稍後再試。');
  } finally {
    running = false; ui.button.disabled = false; ui.button.querySelector('span:nth-child(2)').textContent = '重新測速';
  }
}

if (typeof document !== 'undefined') document.querySelector('#start-test')?.addEventListener('click', runSpeedTest);
