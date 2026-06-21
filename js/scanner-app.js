import { getParticipant, recordScan, getActiveEvent, getScansForEvent } from './db.js';

/* ---------- Auth check ---------- */
if (!sessionStorage.getItem('scannerAuth')) {
  location.href = 'index.html';
}

/* ---------- Device ID ---------- */
let deviceId = localStorage.getItem('deviceId');
if (!deviceId) {
  deviceId = 'dev-' + Math.random().toString(36).slice(2, 10);
  localStorage.setItem('deviceId', deviceId);
}

/* ---------- Elements ---------- */
const video      = document.getElementById('video');
const nameEl     = document.getElementById('nameEl');
const codeEl     = document.getElementById('codeEl');
const fmtEl      = document.getElementById('fmtEl');
const swipeEl    = document.getElementById('swipe');
const swipeWarn  = document.getElementById('swipeWarn');
const redEl      = document.getElementById('redflash');
const cover      = document.getElementById('cover');
const coverMsg   = document.getElementById('coverMsg');
const startBtn   = document.getElementById('startBtn');
const modeSeg    = document.getElementById('modeSeg');
const statEl     = document.getElementById('stat');
const eventBar   = document.getElementById('eventBar');
const manualEntry = document.getElementById('manualEntry');
const manualInput = document.getElementById('manualInput');
const manualSubmit = document.getElementById('manualSubmit');

/* ---------- State ---------- */
let mode = 'auto';
let supportedFormats = [];
let detector = null;
let audioCtx = null;
let scanning = false;
let engineName = 'native';
let avgMs = 0;
const lastSeen = new Map();
const DEDUPE_MS = 2500;
const SCAN_INTERVAL_MS = 120;

const ALL_FORMATS = ['qr_code', 'code_128'];

// Confirmation (anti-misread)
const CODE_PATTERN = /^\d{8}$/;
const CONFIRM_COUNT = 2;
let candidate = null;
let candidateCount = 0;

// Event
let activeEvent = null;
let scannedBarcodes = new Set(); // barcodes already scanned for this event

/* ---------- Load active event ---------- */
async function loadEvent() {
  try {
    activeEvent = await getActiveEvent();
    if (activeEvent) {
      eventBar.textContent = activeEvent.name;
      // Load existing scans for this event to track "already scanned"
      const scans = await getScansForEvent(activeEvent.id);
      scannedBarcodes = new Set(scans.map(s => s.barcode));
    } else {
      eventBar.textContent = 'No active event';
    }
  } catch (e) {
    console.error('Failed to load event:', e);
    eventBar.textContent = 'Error loading event';
  }
}

/* ---------- Audio ---------- */
function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
function tone(freq, start, dur, gain = 0.25, type = 'sine') {
  const t0 = audioCtx.currentTime + start;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type; osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}
function soundOk() {
  if (!audioCtx) return;
  tone(180, 0.00, 0.12, 0.30, 'sine');
  tone(240, 0.10, 0.16, 0.30, 'sine');
}
function soundWarn() {
  if (!audioCtx) return;
  tone(300, 0.00, 0.15, 0.25, 'sine');
  tone(250, 0.12, 0.15, 0.25, 'sine');
}
function soundFail() {
  if (!audioCtx) return;
  tone(140, 0.00, 0.14, 0.30, 'square');
  tone(140, 0.20, 0.14, 0.30, 'square');
  tone(140, 0.40, 0.14, 0.30, 'square');
}

/* ---------- Visual feedback ---------- */
function flashOk() {
  swipeEl.classList.remove('run');
  void swipeEl.offsetWidth;
  swipeEl.classList.add('run');
}
function flashWarn() {
  swipeWarn.classList.remove('run');
  void swipeWarn.offsetWidth;
  swipeWarn.classList.add('run');
}
function flashFail() {
  redEl.classList.remove('run');
  void redEl.offsetWidth;
  redEl.classList.add('run');
}

/* ---------- Detector ---------- */
function formatsForMode() {
  if (mode === 'qr') return ['qr_code'];
  if (mode === 'code_128') return ['code_128'];
  if (mode === 'both') return ALL_FORMATS.slice();
  return supportedFormats.length ? supportedFormats.slice() : ALL_FORMATS.slice();
}
function buildDetector() {
  detector = new BarcodeDetector({ formats: formatsForMode() });
}

/* ---------- Process a barcode ---------- */
async function processBarcode(value, format) {
  const now = Date.now();
  const prev = lastSeen.get(value) || 0;
  if (now - prev < DEDUPE_MS) return;
  lastSeen.set(value, now);

  fmtEl.textContent = format.replace('_', ' ');
  codeEl.textContent = value;

  // Look up in Firestore
  const participant = await getParticipant(value);

  if (!participant) {
    nameEl.textContent = 'NOT FOUND';
    nameEl.style.color = 'var(--fail)';
    flashFail();
    soundFail();
    return;
  }

  // Check if already scanned for this event
  const alreadyScanned = scannedBarcodes.has(value);

  if (alreadyScanned) {
    nameEl.textContent = 'Already checked in — ' + participant.name;
    nameEl.style.color = 'var(--warn)';
    flashWarn();
    soundWarn();
  } else {
    nameEl.textContent = participant.name;
    nameEl.style.color = 'var(--ok)';
    flashOk();
    soundOk();
    scannedBarcodes.add(value);
  }

  // Record scan in Firestore (even if already scanned)
  if (activeEvent) {
    try {
      await recordScan(value, activeEvent.id, deviceId);
    } catch (e) {
      console.error('Failed to record scan:', e);
    }
  }
}

/* ---------- Camera scan handler ---------- */
function handleCode(value, format) {
  if (!CODE_PATTERN.test(value)) {
    candidate = null; candidateCount = 0;
    return;
  }

  if (value === candidate) {
    candidateCount++;
  } else {
    candidate = value; candidateCount = 1;
  }
  if (candidateCount < CONFIRM_COUNT) return;

  processBarcode(value, format);
}

/* ---------- Scan loop ---------- */
async function loop() {
  if (!scanning) return;
  try {
    const t0 = performance.now();
    const codes = await detector.detect(video);
    const dt = performance.now() - t0;
    avgMs = avgMs ? avgMs * 0.8 + dt * 0.2 : dt;
    statEl.textContent = engineName + ' · ' + Math.round(avgMs) + ' ms/scan';
    if (codes && codes.length) {
      const c = codes[0];
      handleCode(c.rawValue, c.format);
    }
  } catch (e) {
    // detection can throw transiently while frames aren't ready
  }
  setTimeout(loop, SCAN_INTERVAL_MS);
}

/* ---------- Camera ---------- */
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  });
  video.srcObject = stream;
  await video.play();
}

/* ---------- Mode toggle ---------- */
modeSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  mode = btn.dataset.mode;
  [...modeSeg.children].forEach(b => b.classList.toggle('active', b === btn));
  if (window.BarcodeDetector) buildDetector();
});

/* ---------- Manual entry ---------- */
manualSubmit.addEventListener('click', () => {
  const val = manualInput.value.trim();
  if (val) {
    processBarcode(val, 'manual');
    manualInput.value = '';
  }
});
manualInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const val = manualInput.value.trim();
    if (val) {
      processBarcode(val, 'manual');
      manualInput.value = '';
    }
  }
});

/* ---------- Start ---------- */
startBtn.addEventListener('click', async () => {
  try {
    initAudio();
    tone(1, 0, 0.01, 0.0001);

    // Load event data
    await loadEvent();

    if (!('BarcodeDetector' in window)) {
      coverMsg.textContent = 'Loading scanner engine...';
      try {
        const mod = await import('https://esm.sh/barcode-detector@2/pure');
        window.BarcodeDetector = mod.BarcodeDetector;
        engineName = 'polyfill';
      } catch (e) {
        coverMsg.textContent = 'Could not load the scanner engine. Check your connection and open in Safari or Chrome (not an in-app browser).';
        return;
      }
    } else {
      engineName = 'native';
    }
    statEl.classList.remove('hidden');

    let supported = [];
    try { supported = await BarcodeDetector.getSupportedFormats(); } catch (_) {}
    supportedFormats = supported.slice();
    if (!supported.length) {
      coverMsg.textContent = 'This browser exposes BarcodeDetector but reports no supported formats.';
      return;
    }

    buildDetector();
    await startCamera();
    cover.classList.add('hidden');
    manualEntry.style.display = 'flex';
    scanning = true;
    loop();
  } catch (err) {
    coverMsg.textContent = 'Could not start camera: ' + (err && err.message ? err.message : err) +
      '\nMake sure the page is served over HTTPS and camera permission is allowed.';
  }
});
