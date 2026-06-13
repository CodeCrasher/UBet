import { signal, computed } from '@preact/signals';
import { io } from 'socket.io-client';
import { request } from './api.js';

const LS_KEY = 'ubet.session';

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY));
  } catch {
    return null;
  }
}

// { code, token, playerId, name, hostPin }  — hostPin present ⇒ host mode
export const session = signal(loadSession());
export const poolState = signal(null);
export const myPreds = signal({});
export const connected = signal(false);
export const toast = signal(null);

export const view = computed(() => (session.value ? 'pool' : 'landing'));
export const isHost = computed(() => !!session.value?.hostPin);
export const me = computed(() => session.value?.playerId || null);

function persist(s) {
  session.value = s;
  if (s) localStorage.setItem(LS_KEY, JSON.stringify(s));
  else localStorage.removeItem(LS_KEY);
}

let toastTimer;
export function showToast(message, ms = 2400) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), ms);
}

let socket = null;

function mergeShared(shared) {
  poolState.value = shared;
  const myId = session.value?.playerId;
  if (myId && shared.revealed) {
    const next = { ...myPreds.value };
    for (const [num, list] of Object.entries(shared.revealed)) {
      const mine = list.find((p) => p.playerId === myId);
      if (mine) next[num] = { home: mine.home, away: mine.away, points: mine.points };
    }
    myPreds.value = next;
  }
}

export function connectSocket() {
  const s = session.value;
  if (!s) return;
  if (socket) socket.disconnect();
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    connected.value = true;
    socket.emit('pool:subscribe', { code: s.code, token: s.token });
  });
  socket.on('disconnect', () => (connected.value = false));
  socket.on('pool:state', (state) => {
    poolState.value = state;
    myPreds.value = state.myPredictions || {};
  });
  socket.on('pool:sync', mergeShared);
  socket.on('pool:error', (e) => showToast(e.message || 'Connection error'));
}

// auto-connect on load if we have a session
if (session.value) connectSocket();

async function refreshState() {
  const s = session.value;
  if (!s) return;
  try {
    const state = await request(`/pools/${s.code}/state`, { token: s.token });
    poolState.value = state;
    myPreds.value = state.myPredictions || {};
  } catch (e) {
    showToast(e.message);
  }
}

// ── actions ──
export async function createPool(form) {
  const res = await request('/pools', {
    method: 'POST',
    body: {
      name: form.name,
      buyIn: Number(form.buyIn),
      currency: form.currency,
      pin: form.pin,
      hostName: form.hostName,
      rules: form.rules,
    },
  });
  persist({
    code: res.pool.code,
    token: res.token,
    playerId: res.playerId,
    name: form.hostName,
    hostPin: form.pin,
  });
  connectSocket();
  await refreshState();
  return res.pool.code;
}

export async function joinPool(code, displayName) {
  const c = code.trim().toUpperCase();
  const res = await request(`/pools/${c}/join`, { method: 'POST', body: { displayName } });
  persist({ code: c, token: res.token, playerId: res.playerId, name: displayName });
  connectSocket();
  await refreshState();
}

export async function peekPool(code) {
  return request(`/pools/${code.trim().toUpperCase()}`);
}

export async function predict(num, home, away) {
  const s = session.value;
  // optimistic
  myPreds.value = { ...myPreds.value, [num]: { home, away, points: 0 } };
  const res = await request(`/pools/${s.code}/predictions`, {
    method: 'POST', token: s.token, body: { num, home, away },
  });
  myPreds.value = { ...myPreds.value, [num]: { home: res.home, away: res.away, points: res.points } };
}

export async function verifyHostPin(pin) {
  const s = session.value;
  const res = await request(`/pools/${s.code}/verify-pin`, { method: 'POST', body: { pin } });
  if (res.ok) {
    persist({ ...s, hostPin: pin });
    showToast('Host controls unlocked 🔑');
    return true;
  }
  return false;
}

export async function enterResult(num, homeScore, awayScore, penWinner) {
  const s = session.value;
  await request(`/pools/${s.code}/results`, {
    method: 'POST', pin: s.hostPin, body: { num, homeScore, awayScore, penWinner },
  });
}

export async function clearResult(num) {
  const s = session.value;
  await request(`/pools/${s.code}/results/${num}`, { method: 'DELETE', pin: s.hostPin });
}

export async function toggleLock(num, locked) {
  const s = session.value;
  await request(`/pools/${s.code}/matches/${num}/lock`, { method: 'POST', pin: s.hostPin, body: { locked } });
}

export async function togglePaid(playerId, paid) {
  const s = session.value;
  await request(`/pools/${s.code}/players/${playerId}/paid`, { method: 'POST', pin: s.hostPin, body: { paid } });
}

export async function updateSettings(patch) {
  const s = session.value;
  await request(`/pools/${s.code}/settings`, { method: 'PATCH', pin: s.hostPin, body: patch });
}

export function leavePool() {
  if (socket) socket.disconnect();
  socket = null;
  connected.value = false;
  poolState.value = null;
  myPreds.value = {};
  persist(null);
}
