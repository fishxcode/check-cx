const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 15;
const MAX_INTERVAL_SECONDS = 600;

function parseIntervalSeconds() {
  const raw = process.env.CHECK_POLL_INTERVAL_SECONDS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_INTERVAL_SECONDS;
}

export function getPollingIntervalSeconds() {
  const seconds = parseIntervalSeconds();
  return Math.max(MIN_INTERVAL_SECONDS, Math.min(MAX_INTERVAL_SECONDS, seconds));
}

export function getPollingIntervalMs() {
  return getPollingIntervalSeconds() * 1000;
}

export function getPollingIntervalLabel() {
  const seconds = getPollingIntervalSeconds();
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} 分钟`;
  }
  return `${seconds} 秒`;
}
