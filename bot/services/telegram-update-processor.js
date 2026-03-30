import { handleTelegramMessage } from "../adapters/telegram/message-handler.js";

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
}) {
  const results = [];
  let nextOffset = await offsetStore.readOffset();

  for (const update of updates) {
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
        allowedUserId,
        repository,
        pendingStore,
        photoStore,
        extractionClient,
        telegramClient,
        dryRun,
      });
      nextOffset = Math.max(nextOffset, updateId + 1);
      results.push({ updateId, ...result });
    } catch (error) {
      const fromUserId = message.from?.id || null;
      nextOffset = Math.max(nextOffset, updateId + 1);
      results.push({
        updateId,
        status: "failed",
        fromUserId,
        error: error instanceof Error ? error.message : String(error),
      });
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
