import { handleTelegramMessage } from "../adapters/telegram/message-handler.js";

const DEFAULT_TURN_BATCH_WINDOW_SECONDS = 20;

function isBatchableMessage(update) {
  const message = update?.message;
  if (!message) {
    return false;
  }

  const text = typeof message.text === "string" && message.text.trim() ? message.text.trim().toLowerCase() : null;
  const caption = typeof message.caption === "string" && message.caption.trim() ? message.caption.trim().toLowerCase() : null;
  const content = text || caption || "";

  if (!content) {
    return Array.isArray(message.photo) && message.photo.length > 0;
  }

  if (content === "confirm" || content === "cancel" || content.startsWith("edit") || content.startsWith("/")) {
    return false;
  }

  return true;
}

function canBatchTogether(left, right) {
  const leftMessage = left?.message;
  const rightMessage = right?.message;

  if (!leftMessage || !rightMessage) {
    return false;
  }

  const leftDate = Number.isFinite(leftMessage.date) ? leftMessage.date : null;
  const rightDate = Number.isFinite(rightMessage.date) ? rightMessage.date : null;
  if (
    leftDate != null &&
    rightDate != null &&
    Math.abs(rightDate - leftDate) > DEFAULT_TURN_BATCH_WINDOW_SECONDS
  ) {
    return false;
  }

  return (
    leftMessage.chat?.id != null &&
    leftMessage.chat?.id === rightMessage.chat?.id &&
    leftMessage.from?.id != null &&
    leftMessage.from?.id === rightMessage.from?.id &&
    isBatchableMessage(left) &&
    isBatchableMessage(right)
  );
}

export function groupTelegramUpdates(updates, { useIntentPipeline = false } = {}) {
  if (!useIntentPipeline) {
    return updates.map((update) => [update]);
  }

  const groups = [];

  for (const update of updates) {
    const currentGroup = groups[groups.length - 1];
    if (currentGroup && canBatchTogether(currentGroup[currentGroup.length - 1], update)) {
      currentGroup.push(update);
      continue;
    }

    groups.push([update]);
  }

  return groups;
}

export async function processTelegramUpdates({
  updates,
  allowedUserId,
  repository,
  photoStore,
  offsetStore,
  pendingStore,
  extractionClient,
  telegramClient,
  dryRun = true,
  useIntentPipeline = process.env.BOT_USE_INTENT_PIPELINE !== "false",
}) {
  const results = [];
  let nextOffset = await offsetStore.readOffset();

  for (const group of groupTelegramUpdates(updates, { useIntentPipeline })) {
    const update = group[0];
    const updateId = update.update_id;
    const message = update.message;

    if (!message) {
      nextOffset = Math.max(nextOffset, updateId + 1);
      results.push({
        updateId,
        status: "ignored",
        reason: "missing-message",
      });
      continue;
    }

    try {
      const result = await handleTelegramMessage({
        message,
        updateId,
        useIntentPipeline,
        batchedMessages: group.length > 1 ? group.map((entry) => ({
          updateId: entry.update_id,
          message: entry.message,
        })) : null,
        allowedUserId,
        repository,
        pendingStore,
        photoStore,
        extractionClient,
        telegramClient,
        dryRun,
      });
      for (const entry of group) {
        nextOffset = Math.max(nextOffset, entry.update_id + 1);
      }
      results.push({ updateId, ...result });

      for (const entry of group.slice(1)) {
        results.push({
          updateId: entry.update_id,
          status: "ignored",
          reason: "batched-into-turn",
        });
      }
    } catch (error) {
      const fromUserId = message.from?.id || null;
      for (const entry of group) {
        nextOffset = Math.max(nextOffset, entry.update_id + 1);
      }
      results.push({
        updateId,
        status: "failed",
        fromUserId,
        error: error instanceof Error ? error.message : String(error),
      });

      for (const entry of group.slice(1)) {
        results.push({
          updateId: entry.update_id,
          status: "ignored",
          reason: "batched-into-turn",
        });
      }
    }
  }

  await offsetStore.writeOffset(nextOffset);

  return {
    processedCount: results.filter((item) => item.status === "processed").length,
    failedCount: results.filter((item) => item.status === "failed").length,
    ignoredCount: results.filter((item) => item.status === "ignored").length,
    nextOffset,
    results,
  };
}
