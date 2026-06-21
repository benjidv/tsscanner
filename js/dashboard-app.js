import {
  getAllParticipants, getActiveEvent, getAllEvents,
  createEvent, activateEvent, deactivateEvent, deleteEvent,
  subscribeToScans, getScansForParticipant,
  deleteScansForParticipant, deleteAllScansForEvent
} from './db.js?v=3';

/* ---------- Auth check ---------- */
if (!sessionStorage.getItem('dashboardAuth')) {
  location.href = 'index.html';
}

/* ---------- State ---------- */
let allParticipants = [];
let scopedParticipants = []; // after settings scope filter
let displayList = [];        // after filter bar
let activeEvent = null;
let allScans = [];
let scannedMap = new Map();
let scanTimestamps = [];
let unsubScans = null;
let modalParticipant = null;

/* ---------- Elements ---------- */
const eventNameEl = document.getElementById('eventName');
const eventStatusEl = document.getElementById('eventStatus');
const statTotal = document.getElementById('statTotal');
const statScanned = document.getElementById('statScanned');
const statMissing = document.getElementById('statMissing');
const statRate = document.getElementById('statRate');
const settingsPanel = document.getElementById('settingsPanel');
const settingsToggle = document.getElementById('settingsToggle');
const newEventName = document.getElementById('newEventName');
const createEventBtn = document.getElementById('createEventBtn');
const eventListEl = document.getElementById('eventList');
const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const statusFilter = document.getElementById('statusFilter');
const exportBtn = document.getElementById('exportBtn');
const ptableBody = document.getElementById('ptableBody');
const scanModal = document.getElementById('scanModal');
const modalClose = document.getElementById('modalClose');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalDeleteScans = document.getElementById('modalDeleteScans');
const deleteAllScansBtn = document.getElementById('deleteAllScansBtn');
const deleteAllStatus = document.getElementById('deleteAllStatus');
const scopeHallsEl = document.getElementById('scopeHalls');
const scopeGendersEl = document.getElementById('scopeGenders');
const scopeAgeMin = document.getElementById('scopeAgeMin');
const scopeAgeMax = document.getElementById('scopeAgeMax');
const applyScopeBtn = document.getElementById('applyScopeBtn');

/* ========== Multi-select dropdown component ========== */

function createMultiSelect(container, label, values, onChange) {
  // state: all selected by default
  const selected = new Set(values);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'multi-select-btn';

  const panel = document.createElement('div');
  panel.className = 'multi-select-panel';

  function updateLabel() {
    const all = selected.size === values.length;
    const none = selected.size === 0;
    if (all || none) {
      btn.innerHTML = `${esc(label)} <span class="ms-arrow">&#9660;</span>`;
    } else {
      btn.innerHTML = `${esc(label)} <span class="ms-count">${selected.size}</span> <span class="ms-arrow">&#9660;</span>`;
    }
  }

  function buildPanel() {
    panel.innerHTML = '';
    for (const val of values) {
      const lbl = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(val);
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(val); else selected.delete(val);
        updateLabel();
        onChange();
      });
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(' ' + val));
      panel.appendChild(lbl);
    }

    // Select all / none actions
    const actions = document.createElement('div');
    actions.className = 'ms-actions';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'ms-link';
    allBtn.textContent = 'All';
    allBtn.addEventListener('click', () => {
      values.forEach(v => selected.add(v));
      buildPanel();
      updateLabel();
      onChange();
    });
    const noneBtn = document.createElement('button');
    noneBtn.type = 'button';
    noneBtn.className = 'ms-link';
    noneBtn.textContent = 'None';
    noneBtn.addEventListener('click', () => {
      selected.clear();
      buildPanel();
      updateLabel();
      onChange();
    });
    actions.appendChild(allBtn);
    actions.appendChild(noneBtn);
    panel.appendChild(actions);
  }

  // Toggle open/close
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close other open multi-selects
    document.querySelectorAll('.multi-select.open').forEach(ms => {
      if (ms !== container) ms.classList.remove('open');
    });
    container.classList.toggle('open');
  });

  buildPanel();
  updateLabel();
  container.appendChild(btn);
  container.appendChild(panel);

  // Return getter for selected values
  return {
    getSelected: () => selected,
    rebuild: (newValues) => {
      values = newValues;
      // keep previously selected values that still exist
      for (const v of [...selected]) {
        if (!newValues.includes(v)) selected.delete(v);
      }
      // add new values as selected by default
      for (const v of newValues) {
        if (!selected.has(v) && selected.size === 0) {
          // if user had cleared all, don't auto-add
        } else {
          selected.add(v);
        }
      }
      if (selected.size === 0) newValues.forEach(v => selected.add(v));
      buildPanel();
      updateLabel();
    }
  };
}

// Close dropdowns when clicking outside
document.addEventListener('click', () => {
  document.querySelectorAll('.multi-select.open').forEach(ms => ms.classList.remove('open'));
});

/* ---------- Multi-select instances ---------- */
let msHall, msCountry, msGender, msAge;

function buildFilterDropdowns() {
  const halls = [...new Set(scopedParticipants.map(p => p.hall))].sort();
  const countries = [...new Set(scopedParticipants.map(p => p.country))].sort();
  const genders = [...new Set(scopedParticipants.map(p => p.gender))].sort();
  const ages = [...new Set(scopedParticipants.map(p => p.age))].sort((a, b) => a - b).map(String);

  // Clear and rebuild containers
  for (const id of ['filterHall', 'filterCountry', 'filterGender', 'filterAge']) {
    document.getElementById(id).innerHTML = '';
  }

  msHall = createMultiSelect(document.getElementById('filterHall'), 'Halls', halls, applyFilters);
  msCountry = createMultiSelect(document.getElementById('filterCountry'), 'Countries', countries, applyFilters);
  msGender = createMultiSelect(document.getElementById('filterGender'), 'Gender', genders, applyFilters);
  msAge = createMultiSelect(document.getElementById('filterAge'), 'Ages', ages, applyFilters);
}

/* ---------- Settings toggle ---------- */
settingsToggle.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
});

/* ---------- Init ---------- */
async function init() {
  try {
    allParticipants = await getAllParticipants();
  } catch (e) {
    console.error('Failed to load participants:', e);
  }

  buildScopeCheckboxes();
  applyScope();
  buildFilterDropdowns();
  await loadEvents();
  applyFilters();
  startScanSubscription();
}

/* ---------- Scope (settings panel) ---------- */
function buildScopeCheckboxes() {
  const halls = [...new Set(allParticipants.map(p => p.hall))].sort();
  const genders = [...new Set(allParticipants.map(p => p.gender))].sort();

  scopeHallsEl.innerHTML = '';
  for (const h of halls) {
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" value="${esc(h)}" checked /> ${esc(h)}`;
    scopeHallsEl.appendChild(lbl);
  }

  scopeGendersEl.innerHTML = '';
  for (const g of genders) {
    const label = g === 'M' ? 'Male' : g === 'F' ? 'Female' : g;
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" value="${esc(g)}" checked /> ${esc(label)}`;
    scopeGendersEl.appendChild(lbl);
  }
}

function applyScope() {
  const selectedHalls = [...scopeHallsEl.querySelectorAll('input:checked')].map(cb => cb.value);
  const selectedGenders = [...scopeGendersEl.querySelectorAll('input:checked')].map(cb => cb.value);
  const ageMin = parseInt(scopeAgeMin.value) || 0;
  const ageMax = parseInt(scopeAgeMax.value) || 99;

  scopedParticipants = allParticipants.filter(p =>
    selectedHalls.includes(p.hall) &&
    selectedGenders.includes(p.gender) &&
    p.age >= ageMin && p.age <= ageMax
  );

  // Rebuild filter bar dropdowns based on scoped data
  buildFilterDropdowns();
  applyFilters();
}

applyScopeBtn.addEventListener('click', applyScope);

/* ---------- Events ---------- */
async function loadEvents() {
  const events = await getAllEvents();
  activeEvent = events.find(e => e.active) || null;

  if (activeEvent) {
    eventNameEl.textContent = activeEvent.name;
    eventStatusEl.textContent = 'Active';
    eventStatusEl.className = 'event-status active';
  } else {
    eventNameEl.textContent = 'No active event';
    eventStatusEl.textContent = 'Inactive';
    eventStatusEl.className = 'event-status inactive';
  }

  renderEventList(events);
}

function renderEventList(events) {
  eventListEl.innerHTML = '';
  for (const ev of events) {
    const div = document.createElement('div');
    div.className = 'event-item';
    div.innerHTML = `
      <span class="event-item-name">${esc(ev.name)}</span>
      ${ev.active ? '<span class="event-badge active">Active</span>' : ''}
      ${ev.active
        ? `<button class="btn btn-ghost btn-sm" data-deactivate="${ev.id}">Deactivate</button>`
        : `<button class="btn btn-primary btn-sm" data-activate="${ev.id}">Activate</button>`}
      <button class="btn btn-danger btn-sm" data-delete="${ev.id}">Delete</button>
    `;
    eventListEl.appendChild(div);
  }

  eventListEl.querySelectorAll('[data-activate]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await activateEvent(btn.dataset.activate);
      await loadEvents();
      startScanSubscription();
    });
  });
  eventListEl.querySelectorAll('[data-deactivate]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await deactivateEvent(btn.dataset.deactivate);
      await loadEvents();
      startScanSubscription();
    });
  });
  eventListEl.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Delete this event? Scan records will remain.')) {
        await deleteEvent(btn.dataset.delete);
        await loadEvents();
        startScanSubscription();
      }
    });
  });
}

createEventBtn.addEventListener('click', async () => {
  const name = newEventName.value.trim();
  if (!name) return;
  await createEvent(name);
  newEventName.value = '';
  await loadEvents();
});

/* ---------- Filtering + sorting ---------- */
function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  const status = statusFilter.value;
  const sort = sortSelect.value;

  const selectedHalls = msHall ? msHall.getSelected() : new Set();
  const selectedCountries = msCountry ? msCountry.getSelected() : new Set();
  const selectedGenders = msGender ? msGender.getSelected() : new Set();
  const selectedAges = msAge ? msAge.getSelected() : new Set();

  let list = scopedParticipants;

  // multi-select filters (narrow within scope)
  list = list.filter(p =>
    selectedHalls.has(p.hall) &&
    selectedCountries.has(p.country) &&
    selectedGenders.has(p.gender) &&
    selectedAges.has(String(p.age))
  );

  // text search
  if (query) {
    list = list.filter(p =>
      p.name.toLowerCase().includes(query) ||
      p.barcode.includes(query) ||
      (p.accomInfo && p.accomInfo.toLowerCase().includes(query))
    );
  }

  // scanned status
  if (status === 'scanned') {
    list = list.filter(p => scannedMap.has(p.barcode));
  } else if (status === 'not-scanned') {
    list = list.filter(p => !scannedMap.has(p.barcode));
  }

  // sort
  list = [...list];
  list.sort((a, b) => {
    switch (sort) {
      case 'name': return a.name.localeCompare(b.name);
      case 'barcode': return a.barcode.localeCompare(b.barcode);
      case 'hall': return a.hall.localeCompare(b.hall) || a.name.localeCompare(b.name);
      case 'country': return a.country.localeCompare(b.country) || a.name.localeCompare(b.name);
      case 'age': return a.age - b.age || a.name.localeCompare(b.name);
      case 'accomInfo': return (a.accomInfo || '').localeCompare(b.accomInfo || '') || a.name.localeCompare(b.name);
      case 'scanned': {
        const aS = scannedMap.has(a.barcode) ? 0 : 1;
        const bS = scannedMap.has(b.barcode) ? 0 : 1;
        return aS - bS || a.name.localeCompare(b.name);
      }
      default: return 0;
    }
  });

  displayList = list;
  renderTable();
  updateStats();
}

searchInput.addEventListener('input', applyFilters);
[sortSelect, statusFilter].forEach(el => el.addEventListener('change', applyFilters));

// Column header sort
document.querySelectorAll('.ptable th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    const map = { status: 'scanned', barcode: 'barcode', name: 'name', age: 'age',
                  gender: 'name', country: 'country', hall: 'hall', accomInfo: 'accomInfo', scanTime: 'scanned' };
    if (map[col]) {
      sortSelect.value = map[col];
      applyFilters();
    }
  });
});

/* ---------- Real-time scan subscription ---------- */
function startScanSubscription() {
  if (unsubScans) { unsubScans(); unsubScans = null; }
  scannedMap.clear();
  scanTimestamps = [];

  if (!activeEvent) {
    applyFilters();
    return;
  }

  unsubScans = subscribeToScans(activeEvent.id, (scans) => {
    allScans = scans;
    scannedMap.clear();
    scanTimestamps = [];

    for (const s of scans) {
      const ts = s.timestamp ? (s.timestamp.toDate ? s.timestamp.toDate() : new Date(s.timestamp)) : null;
      if (ts) scanTimestamps.push(ts.getTime());

      if (!scannedMap.has(s.barcode) && ts) {
        scannedMap.set(s.barcode, ts);
      }
    }

    applyFilters();
  });
}

/* ---------- Stats ---------- */
function updateStats() {
  const total = displayList.length;
  const scanned = displayList.filter(p => scannedMap.has(p.barcode)).length;
  const missing = total - scanned;

  statTotal.textContent = total;
  statScanned.textContent = scanned;
  statMissing.textContent = missing;

  const now = Date.now();
  const fiveMin = 5 * 60 * 1000;
  const recent = scanTimestamps.filter(t => now - t < fiveMin);
  const rate = recent.length > 0 ? (recent.length / 5).toFixed(1) : '0';
  statRate.textContent = rate;
}

/* ---------- Table rendering ---------- */
function renderTable() {
  ptableBody.innerHTML = '';

  for (const p of displayList) {
    const scanTime = scannedMap.get(p.barcode);
    const isScanned = !!scanTime;
    const tr = document.createElement('tr');
    tr.className = isScanned ? 'scanned clickable' : '';

    tr.innerHTML = `
      <td class="status-icon">${isScanned ? '&#10003;' : '&mdash;'}</td>
      <td>${esc(p.barcode)}</td>
      <td>${esc(p.name)}</td>
      <td>${p.age}</td>
      <td>${p.gender}</td>
      <td>${esc(p.country)}</td>
      <td>${esc(p.hall)}</td>
      <td>${esc(p.accomInfo || '')}</td>
      <td>${isScanned ? formatTime(scanTime) : ''}</td>
    `;

    if (isScanned) {
      tr.addEventListener('click', () => showScanRecords(p));
    }

    ptableBody.appendChild(tr);
  }
}

function formatTime(date) {
  if (!date) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/* ---------- Scan records modal ---------- */
async function showScanRecords(participant) {
  modalParticipant = participant;
  modalTitle.textContent = `Scans for ${participant.name} (${participant.barcode})`;
  modalBody.innerHTML = 'Loading...';
  modalDeleteScans.style.display = '';
  scanModal.classList.add('visible');

  try {
    const records = await getScansForParticipant(participant.barcode, activeEvent.id);
    if (records.length === 0) {
      modalBody.innerHTML = '<p style="color:var(--text2)">No scan records found.</p>';
      return;
    }

    records.sort((a, b) => {
      const tA = a.timestamp ? (a.timestamp.toDate ? a.timestamp.toDate().getTime() : a.timestamp) : 0;
      const tB = b.timestamp ? (b.timestamp.toDate ? b.timestamp.toDate().getTime() : b.timestamp) : 0;
      return tA - tB;
    });

    modalBody.innerHTML = records.map(r => {
      const ts = r.timestamp ? (r.timestamp.toDate ? r.timestamp.toDate() : new Date(r.timestamp)) : null;
      return `<div class="scan-record">
        <span class="scan-time">${ts ? ts.toLocaleString() : 'Pending...'}</span>
        <span class="scan-device">Device: ${esc(r.deviceId || 'unknown')}</span>
      </div>`;
    }).join('');
  } catch (e) {
    modalBody.innerHTML = '<p style="color:var(--fail)">Error loading records.</p>';
    console.error(e);
  }
}

modalClose.addEventListener('click', () => {
  scanModal.classList.remove('visible');
  modalParticipant = null;
});
scanModal.addEventListener('click', (e) => {
  if (e.target === scanModal) {
    scanModal.classList.remove('visible');
    modalParticipant = null;
  }
});

/* ---------- Delete scans for one participant ---------- */
modalDeleteScans.addEventListener('click', async () => {
  if (!modalParticipant || !activeEvent) return;
  if (!confirm(`Delete all scans for ${modalParticipant.name} in this event?`)) return;

  modalDeleteScans.textContent = 'Deleting...';
  modalDeleteScans.disabled = true;
  try {
    const count = await deleteScansForParticipant(modalParticipant.barcode, activeEvent.id);
    modalBody.innerHTML = `<p style="color:var(--text2)">Deleted ${count} scan(s). The table will update automatically.</p>`;
    modalDeleteScans.style.display = 'none';
  } catch (e) {
    console.error(e);
    alert('Failed to delete scans: ' + e.message);
  }
  modalDeleteScans.textContent = 'Delete scans for this person';
  modalDeleteScans.disabled = false;
});

/* ---------- Delete all scans for active event ---------- */
deleteAllScansBtn.addEventListener('click', async () => {
  if (!activeEvent) { alert('No active event'); return; }
  if (!confirm(`Delete ALL scans for "${activeEvent.name}"? This cannot be undone.`)) return;

  deleteAllScansBtn.disabled = true;
  deleteAllStatus.textContent = 'Deleting...';
  try {
    const count = await deleteAllScansForEvent(activeEvent.id);
    deleteAllStatus.textContent = `Deleted ${count} scan(s).`;
  } catch (e) {
    deleteAllStatus.textContent = 'Error: ' + e.message;
    console.error(e);
  }
  deleteAllScansBtn.disabled = false;
});

/* ---------- CSV Export ---------- */
exportBtn.addEventListener('click', () => {
  const headers = ['Barcode', 'Name', 'Age', 'Gender', 'Country', 'Hall', 'Accom Info', 'Scanned', 'Scan Time'];
  const rows = displayList.map(p => {
    const scanTime = scannedMap.get(p.barcode);
    const isScanned = !!scanTime;
    return [
      p.barcode,
      p.name,
      p.age,
      p.gender,
      p.country,
      p.hall,
      p.accomInfo || '',
      isScanned ? 'Yes' : 'No',
      isScanned ? scanTime.toISOString() : ''
    ];
  });

  const csv = [headers, ...rows].map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `checkin-${activeEvent ? activeEvent.name.replace(/\s+/g, '-') : 'export'}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

/* ---------- Util ---------- */
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ---------- Start ---------- */
init();
