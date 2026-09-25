const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function getToken() {
  return localStorage.getItem('token');
}

export async function api(path, options = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...options.headers,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The server could not complete that request.');
  return data;
}

/** Fetches a binary response (e.g. a generated PDF) instead of JSON. */
export async function apiBlob(path) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not generate the report.');
  }
  const blob = await res.blob();
  const filename = res.headers.get('Content-Disposition')?.match(/filename="?([^"; ]+)"?/)?.[1] || 'report.pdf';
  return { blob, filename };
}

export { BASE };
