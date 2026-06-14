import { signal } from '@preact/signals';
import { io } from 'socket.io-client';
import { request } from './api.js';

export const me = signal(null);
export const fixtures = signal([]);
export const fixtureView = signal(null); // { fixture, pools, winnerOptions }
export const poolView = signal(null); // { standing, fixture, myEntry, winnerOptions, me }
export const earnings = signal({ total: 0, balance: 0 });
export const route = signal({ name: 'auth', params: {} });
export const toast = signal(null);
export const adminPin = signal(localStorage.getItem('ubet.adminPin') || '');
export const ready = signal(false);

let socket = null;
let toastTimer;
const currentSub = { fixtureNum: null, poolId: null };
export function showToast(msg, ms = 2600) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), ms);
}

// ── hash routing ──
function parseHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const [name, ...rest] = h.split('/');
  if (name === 'fixture') return { name: 'fixture', params: { num: Number(rest[0]) } };
  if (name === 'pool') return { name: 'pool', params: { poolId: decodeURIComponent(rest.join('/')) } };
  return { name: 'fixtures', params: {} };
}
export function navigate(hash) {
  if (location.hash === hash) applyRoute();
  else location.hash = hash;
}
export const goFixtures = () => navigate('#/fixtures');
export const goFixture = (num) => navigate(`#/fixture/${num}`);
export const goPool = (poolId) => navigate(`#/pool/${encodeURIComponent(poolId)}`);

async function applyRoute() {
  if (!me.value) {
    route.value = { name: 'auth', params: {} };
    return;
  }
  const r = parseHash();
  route.value = r;
  if (r.name === 'fixtures') loadFixtures();
  else if (r.name === 'fixture') openFixture(r.params.num);
  else if (r.name === 'pool') openPool(r.params.poolId);
}
window.addEventListener('hashchange', applyRoute);

// ── socket ──
function connectSocket() {
  if (socket) return;
  socket = io({ transports: ['websocket', 'polling'], withCredentials: true });
  // On every (re)connect the server reads our cookie and joins our user room;
  // re-assert any active fixture/pool subscriptions too.
  socket.on('connect', () => {
    if (currentSub.fixtureNum != null) socket.emit('fixture:subscribe', { num: currentSub.fixtureNum });
    if (currentSub.poolId) socket.emit('pool:subscribe', { poolId: currentSub.poolId });
  });
  socket.on('user:earnings', (e) => {
    earnings.value = e;
    if (me.value) me.value = { ...me.value, balance: e.balance };
  });
  socket.on('pool:update', (s) => {
    if (poolView.value && s.poolId === poolView.value.standing.poolId) {
      poolView.value = { ...poolView.value, standing: s };
    }
  });
  socket.on('match:scoreUpdate', (p) => {
    patchFixture(p.fixtureNum, p);
    if (fixtureView.value?.fixture?.num === p.fixtureNum) {
      fixtureView.value = { ...fixtureView.value, fixture: { ...fixtureView.value.fixture, ...p } };
    }
    if (poolView.value?.fixture?.num === p.fixtureNum) {
      poolView.value = { ...poolView.value, fixture: { ...poolView.value.fixture, ...p } };
    }
  });
  socket.on('fixtures:update', (p) => patchFixture(p.fixtureNum, p));
}

// Re-establish the socket so the handshake carries the (new) session cookie.
function reconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
  connectSocket();
}
function patchFixture(num, p) {
  fixtures.value = fixtures.value.map((f) =>
    f.num === num ? { ...f, status: p.status ?? f.status, live: p.live ?? f.live, homeScore: p.homeScore ?? f.homeScore, awayScore: p.awayScore ?? f.awayScore, homeTeam: f.homeTeam, awayTeam: f.awayTeam } : f,
  );
}

// ── init ──
export async function init() {
  try {
    const { user } = await request('/auth/me');
    me.value = user;
  } catch { /* not logged in */ }
  connectSocket();
  if (me.value) await loadEarnings();
  await applyRoute();
  ready.value = true;
}

// ── auth actions ──
export async function authSubmit(mode, form) {
  const path = mode === 'register' ? '/auth/register' : '/auth/login';
  const { user } = await request(path, { method: 'POST', body: form });
  me.value = user;
  reconnectSocket(); // handshake now carries the session cookie → user room
  await loadEarnings();
  navigate('#/fixtures');
}
export async function logout() {
  try { await request('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  me.value = null;
  poolView.value = null;
  fixtureView.value = null;
  currentSub.fixtureNum = null;
  currentSub.poolId = null;
  reconnectSocket();
  route.value = { name: 'auth', params: {} };
}

// ── data actions ──
export async function loadFixtures() {
  try {
    const { fixtures: list } = await request('/fixtures');
    fixtures.value = list;
  } catch (e) { showToast(e.message); }
}
export async function openFixture(num) {
  try {
    const data = await request(`/fixtures/${num}`);
    fixtureView.value = data;
    currentSub.fixtureNum = num;
    socket?.emit('fixture:subscribe', { num });
  } catch (e) { showToast(e.message); }
}
export async function openPool(poolId) {
  try {
    const data = await request(`/pools/${encodeURIComponent(poolId)}`);
    poolView.value = data;
    currentSub.fixtureNum = data.fixture.num;
    currentSub.poolId = poolId;
    socket?.emit('fixture:subscribe', { num: data.fixture.num });
    socket?.emit('pool:subscribe', { poolId });
  } catch (e) { showToast(e.message); }
}
export async function enterPool(poolId, pred) {
  const res = await request(`/pools/${encodeURIComponent(poolId)}/enter`, { method: 'POST', body: { pred } });
  if (me.value) me.value = { ...me.value, balance: res.balance };
  await openPool(poolId);
  await loadEarnings();
  showToast('Pick placed — good luck');
}
export async function loadEarnings() {
  try { earnings.value = await request('/me/earnings'); } catch { /* ignore */ }
}
export async function loadBreakdown() {
  return request('/me/earnings/breakdown');
}

// ── admin ──
export function setAdminPin(pin) {
  adminPin.value = pin;
  localStorage.setItem('ubet.adminPin', pin);
}
export async function adminCheck(pin) {
  await request('/admin/check', { method: 'POST', adminPin: pin });
  setAdminPin(pin);
  return true;
}
export async function adminLive(num, body) {
  await request(`/admin/fixtures/${num}/live`, { method: 'POST', adminPin: adminPin.value, body });
}
export async function adminResult(num, body) {
  await request(`/admin/fixtures/${num}/result`, { method: 'POST', adminPin: adminPin.value, body });
}
