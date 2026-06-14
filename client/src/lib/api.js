// Fetch wrapper. credentials:'include' sends/stores the httpOnly session cookie.
export async function request(path, { method = 'GET', body, adminPin } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (adminPin) headers['x-admin-pin'] = adminPin;
  const res = await fetch('/api' + path, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
