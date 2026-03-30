export function createPendingRecord({
  chatId,
  userId,
  state,
  sourceMessageId,
  sourceUpdateId,
  operation,
  question = null,
  context = {},
  now = new Date(),
  ttlHours = 6,
}) {
  const createdAt = toIsoString(now);
  const expiresAt = toIsoString(new Date(now.getTime() + ttlHours * 60 * 60 * 1000));

  return {
    version: 1,
    chatId,
    userId,
    state,
    createdAt,
    expiresAt,
    sourceMessageId,
    sourceUpdateId,
    operation,
    question,
    context,
  };
}

export function isPendingExpired(record, now = new Date()) {
  return new Date(record.expiresAt).getTime() <= now.getTime();
}

export function normalizePendingKey(chatId) {
  return `pending:${chatId}`;
}

export function isConfirmationDecision(text) {
  if (typeof text !== "string") {
    return false;
  }

  const normalized = text.trim().toLowerCase();
  return normalized === "confirm" || normalized === "cancel";
}

export function normalizeConfirmationDecision(text) {
  return text.trim().toLowerCase();
}

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
