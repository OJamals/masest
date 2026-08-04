export async function fetchBlobWithAuth(path, dependencies, retried = false) {
  const token = await dependencies.getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await dependencies.fetchImpl(path, { method: 'GET', headers });
  if (response.status === 401 && !retried && await dependencies.refreshSession()) {
    return fetchBlobWithAuth(path, dependencies, true);
  }
  if (!response.ok) {
    const out = await response.json().catch(() => ({}));
    if (response.status === 401) dependencies.onExpired?.();
    throw Object.assign(new Error(out.error || 'request_failed'), { status: response.status, data: out });
  }
  return response.blob();
}
