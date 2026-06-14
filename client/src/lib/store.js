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

// { code, token, playerId, name, hostToken }  — hostToken present ⇒ host mode
export const session = signal(loadSession());
export const poolState = signal(null);
export const myPreds = signal({});
export const connected = signal(false);
export const toast = signal(null);

export const view = computed(() => (session.value ? 'pool' : 'landing'));
export const isHost = computed(() => !!session.value?.hostToken);
export const me = computed(() => session.value?.playerId || null);
export const appConfig = signal(null);

request('/config').then((c) => (appConfig.value = c)).catch(() => {});

// Resume on another device: open a link with #resume=CODE.TOKEN (kept in the
// fragment so the token never hits the server logs / referrer).
function consumeResumeLink() {
  const m = /[#&]resume=([A-Z0-9]+)\.([a-f0-9]+)/i.exec(location.hash || '');
  if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search);
  persist({ code: m[1].toUpperCase(), token: m[2] });
  return true;
}

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

// If the host kicked us, our id drops out of the roster → eject locally.
function detectRemoval(state) {
  const s = session.value;
  if (s?.playerId && Array.isArray(state.players) && !state.players.some((p) => p.id === s.playerId)) {
    showToast('You were removed from this pool');
    leavePool();
    return true;
  }
  return false;
}

function mergeShared(shared) {
  if (detectRemoval(shared)) return;
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
    if (detectRemoval(state)) return;
    poolState.value = state;
    myPreds.value = state.myPredictions || {};
    syncIdentity(state);
  });
  socket.on('pool:sync', mergeShared);
  socket.on('pool:error', (e) => showToast(e.message || 'Connection error'));
}

// Fill playerId/name from the server's view of who we are (powers resume links).
function syncIdentity(state) {
  const s = session.value;
  if (!s || !state?.you) return;
  if (s.playerId !== state.you || !s.name) {
    const meRow = (state.players || []).find((p) => p.id === state.you);
    persist({ ...s, playerId: state.you, name: meRow?.name || s.name });
  }
}

// Wraps a host action: clears the host session on expiry so the UI re-prompts.
async function hostRequest(path, opts = {}) {
  const s = session.value;
  try {
    return await request(path, { ...opts, hostToken: s?.hostToken });
  } catch (e) {
    if (e.status === 403) {
      persist({ ...session.value, hostToken: undefined });
      showToast('Host session expired — tap 🔑 Host to re-enter your PIN');
    }
    throw e;
  }
}

// auto-connect on load (consuming a resume link first if present)
consumeResumeLink();
if (session.value) connectSocket();

async function refreshState() {
  const s = session.value;
  if (!s) return;
  try {
    const state = await request(`/pools/${s.code}/state`, { token: s.token });
    poolState.value = state;
    myPreds.value = state.myPredictions || {};
    syncIdentity(state);
  } catch (e) {
    if (e.status === 401 || e.status === 404) {
      showToast('You were removed from this pool');
      leavePool();
    } else {
      showToast(e.message);
    }
  }
}

// Build a resume link a player can open on another device.
export function resumeLink() {
  const s = session.value;
  if (!s) return '';
  return `${location.origin}/#resume=${s.code}.${s.token}`;
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
      manual: form.manual,
    },
  });
  persist({ code: res.pool.code, token: res.token, playerId: res.playerId, name: form.hostName });
  // exchange the PIN for a short-lived host token (don't keep the raw PIN around)
  await unlockHost(form.pin);
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

// Verify the PIN once, get back a short-lived host-session token.
export async function unlockHost(pin) {
  const s = session.value;
  try {
    const res = await request(`/pools/${s.code}/host-session`, { method: 'POST', body: { pin } });
    persist({ ...session.value, hostToken: res.hostToken });
    return true;
  } catch (e) {
    if (e.status === 429) showToast(e.message);
    return false;
  }
}

export async function enterResult(num, homeScore, awayScore, penWinner) {
  const s = session.value;
  await hostRequest(`/pools/${s.code}/results`, { method: 'POST', body: { num, homeScore, awayScore, penWinner } });
}

export async function clearResult(num) {
  const s = session.value;
  await hostRequest(`/pools/${s.code}/results/${num}`, { method: 'DELETE' });
}

export async function toggleLock(num, locked) {
  const s = session.value;
  await hostRequest(`/pools/${s.code}/matches/${num}/lock`, { method: 'POST', body: { locked } });
}

export async function togglePaid(playerId, paid) {
  const s = session.value;
  await hostRequest(`/pools/${s.code}/players/${playerId}/paid`, { method: 'POST', body: { paid } });
}

export async function kickPlayer(playerId) {
  const s = session.value;
  await hostRequest(`/pools/${s.code}/players/${playerId}`, { method: 'DELETE' });
}

export async function updateSettings(patch) {
  const s = session.value;
  await hostRequest(`/pools/${s.code}/settings`, { method: 'PATCH', body: patch });
}

// ── custom bets ──
export async function createCustomBet(bet) {
  const s = session.value;
  await hostRequest(`/pools/${s.code}/custom-bets`, { method: 'POST', body: bet });
}
export async function editCustomBet(id, patch) {
  const s = session.value;
  await hostRequest(`/pools/${s.code}/custom-bets/${id}`, { method: 'PATCH', body: patch });
}
export async function deleteCustomBet(id) {
  const s = session.value;
  await hostRequest(`/pools/${s.code}/custom-bets/${id}`, { method: 'DELETE' });
}
export async function answerCustomBet(id, answer) {
  const s = session.value;
  await request(`/pools/${s.code}/custom-bets/${id}/answer`, { method: 'POST', token: s.token, body: { answer } });
}

export function leavePool() {
  if (socket) socket.disconnect();
  socket = null;
  connected.value = false;
  poolState.value = null;
  myPreds.value = {};
  persist(null);
}
