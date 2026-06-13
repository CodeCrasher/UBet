// Thin fetch wrapper around the REST API. Auth is passed per-call from the
// store (player token and/or host PIN) so this module stays dependency-free.
export async function request(path, { method = 'GET', body, token, pin } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers['x-player-token'] = token;
  if (pin) headers['x-host-pin'] = pin;
  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
