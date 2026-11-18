/**
 * Publishes a notification to the central notification backend (notification-backend).
 * Fire-and-forget: a missing config or a failed call never affects the caller.
 * NOTIFICATION_API_URL + NOTIFICATION_SERVICE_KEY (the key registered as "agent" in the service's SERVICE_KEYS).
 */
export function publishNotification(event, { fetchImpl = fetch } = {}) {
  const base = (process.env.NOTIFICATION_API_URL || '').trim().replace(/\/+$/, '');
  const key = (process.env.NOTIFICATION_SERVICE_KEY || '').trim();
  if (!base || !key || !event?.companyId || !event?.userId) return Promise.resolve(false);
  return fetchImpl(`${base}/v1/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Service-Key': key },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(5000),
  })
    .then((res) => res.ok)
    .catch((error) => {
      console.warn('[notification-hub] publish failed:', error.message);
      return false;
    });
}
