// Thin fetch wrapper around the REST API. Auth is passed per-call from the
// store (player token and/or host PIN) so this module stays dependency-free.
export async function request(path, { method = 'GET', body, token, hostToken } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers['x-player-token'] = token;
  if (hostToken) headers['x-host-token'] = hostToken;
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
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
