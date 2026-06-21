import { db } from './firebase-config.js?v=3';
import {
  doc, getDoc, setDoc, addDoc, getDocs, updateDoc, deleteDoc,
  collection, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ---------- Participants ---------- */

export async function getParticipant(barcode) {
  const snap = await getDoc(doc(db, 'participants', barcode));
  return snap.exists() ? snap.data() : null;
}

export async function getAllParticipants() {
  const snap = await getDocs(collection(db, 'participants'));
  const list = [];
  snap.forEach(d => list.push(d.data()));
  return list;
}

/* ---------- Events ---------- */

export async function getActiveEvent() {
  const q = query(collection(db, 'events'), where('active', '==', true));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function getAllEvents() {
  const snap = await getDocs(query(collection(db, 'events'), orderBy('createdAt', 'desc')));
  const list = [];
  snap.forEach(d => list.push({ id: d.id, ...d.data() }));
  return list;
}

export async function createEvent(name) {
  const ref = await addDoc(collection(db, 'events'), {
    name,
    active: false,
    createdAt: serverTimestamp()
  });
  return ref.id;
}

export async function activateEvent(eventId) {
  // deactivate all first
  const all = await getAllEvents();
  for (const ev of all) {
    if (ev.active) await updateDoc(doc(db, 'events', ev.id), { active: false });
  }
  await updateDoc(doc(db, 'events', eventId), { active: true });
}

export async function deactivateEvent(eventId) {
  await updateDoc(doc(db, 'events', eventId), { active: false });
}

export async function deleteEvent(eventId) {
  await deleteDoc(doc(db, 'events', eventId));
}

/* ---------- Scans ---------- */

export async function recordScan(barcode, eventId, deviceId) {
  await addDoc(collection(db, 'scans'), {
    barcode,
    eventId,
    deviceId,
    timestamp: serverTimestamp()
  });
}

export async function getScansForEvent(eventId) {
  const q = query(collection(db, 'scans'), where('eventId', '==', eventId));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach(d => list.push({ id: d.id, ...d.data() }));
  return list;
}

export function subscribeToScans(eventId, callback) {
  const q = query(collection(db, 'scans'), where('eventId', '==', eventId));
  return onSnapshot(q, snap => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    callback(list);
  });
}

export async function getScansForParticipant(barcode, eventId) {
  const q = query(
    collection(db, 'scans'),
    where('barcode', '==', barcode),
    where('eventId', '==', eventId)
  );
  const snap = await getDocs(q);
  const list = [];
  snap.forEach(d => list.push({ id: d.id, ...d.data() }));
  return list;
}

export async function deleteScansForParticipant(barcode, eventId) {
  const q = query(
    collection(db, 'scans'),
    where('barcode', '==', barcode),
    where('eventId', '==', eventId)
  );
  const snap = await getDocs(q);
  const deletes = [];
  snap.forEach(d => deletes.push(deleteDoc(doc(db, 'scans', d.id))));
  await Promise.all(deletes);
  return deletes.length;
}

export async function deleteAllScansForEvent(eventId) {
  const q = query(collection(db, 'scans'), where('eventId', '==', eventId));
  const snap = await getDocs(q);
  const BATCH = 50;
  const docs = [];
  snap.forEach(d => docs.push(d.id));
  let deleted = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    await Promise.all(batch.map(id => deleteDoc(doc(db, 'scans', id))));
    deleted += batch.length;
  }
  return deleted;
}

/* ---------- Config / Auth ---------- */

export async function getConfig() {
  const snap = await getDoc(doc(db, 'config', 'settings'));
  return snap.exists() ? snap.data() : null;
}

export async function verifyPin(pin) {
  const config = await getConfig();
  return config && config.scannerPin === pin;
}

export async function verifyPassword(password) {
  const config = await getConfig();
  return config && config.dashboardPassword === password;
}

export async function setConfig(scannerPin, dashboardPassword) {
  await setDoc(doc(db, 'config', 'settings'), { scannerPin, dashboardPassword });
}

/* ---------- Seed helpers ---------- */

export async function setParticipant(barcode, data) {
  await setDoc(doc(db, 'participants', barcode), data);
}

export { db, collection, getDocs, doc, setDoc, addDoc, serverTimestamp };
