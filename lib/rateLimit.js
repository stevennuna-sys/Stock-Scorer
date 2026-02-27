const requests = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;

export function checkRateLimit(ip) {
  const now = Date.now();
  const data = requests.get(ip) || { count: 0, start: now };

  if (now - data.start > WINDOW_MS) {
    requests.set(ip, { count: 1, start: now });
    return true;
  }

  if (data.count >= MAX_PER_WINDOW) return false;

  data.count++;
  requests.set(ip, data);
  return true;
}
