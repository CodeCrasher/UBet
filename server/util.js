export const now = () => new Date().toISOString();

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
