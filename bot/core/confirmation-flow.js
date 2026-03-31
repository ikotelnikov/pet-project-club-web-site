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

export function isEditRequest(text) {
  if (typeof text !== "string") {
    return false;
  }

  return text.trim().toLowerCase().startsWith("edit");
}

export function extractEditInstruction(text) {
  if (!isEditRequest(text)) {
    return null;
  }

  const trimmed = text.trim();
  const instruction = trimmed.slice(4).trim();
  return instruction || null;
}

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
