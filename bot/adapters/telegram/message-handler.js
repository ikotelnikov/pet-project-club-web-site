import {
  createPendingRecord,
  extractEditInstruction,
  isConfirmationDecision,
  isEditRequest,
  isPendingExpired,
  normalizeConfirmationDecision,
} from "../../core/confirmation-flow.js";
import { mapOperationToContent } from "../../core/content-mapper.js";
import { extractTelegramAttachments } from "./attachments.js";
import { handleBufferedV2PendingTurn, handleTelegramMessageV2, handleV2PendingResponse } from "./handle-message-v2.js";
import { collectTurn, appendTurnMessage } from "../../orchestration/collect-turn.js";

const RECENT_SESSION_TTL_HOURS = 72;

function buildV2RecentContext(recentEntity) {
  return {
    lastConfirmedObject: recentEntity
      ? {
          entity: recentEntity.entity,
          slug: recentEntity.slug,
          summary: recentEntity.summary || recentEntity.fields?.title || recentEntity.fields?.name || recentEntity.slug,
        }
      : null,
    pendingDraft: null,
  };
}

function isV2PendingOperation(pending) {
  return typeof pending?.operation?.type === "string" && pending.operation.type.startsWith("v2_");
}

function isLegacyPendingState(pending) {
  if (!pending || !pending.operation) {
    return false;
  }

  if (isV2PendingOperation(pending)) {
    return false;
  }

  if (pending.state === "awaiting_confirmation") {
    return pending.operation.type !== "undo" && pending.operation.type !== "translation_batch";
  }

  if (pending.state === "awaiting_clarification") {
    return true;
  }

  return false;
}

export async function handleTelegramMessage({
  message,
  updateId,
  batchedMessages = null,
  useIntentPipeline = process.env.BOT_USE_INTENT_PIPELINE !== "false",
  coalesceDelayMs = 0,
  pendingCoalesceDelayMs = 0,
  allowedUserId,
  repository,
  pendingStore,
  photoStore,
  extractionClient,
  translationClient,
  telegramClient,
  debugLog = null,
  dryRun = true,
}) {
  const fromUserId = message.from?.id || null;
  const chatId = message.chat?.id || fromUserId;
  const rawAttachments = extractTelegramAttachments(message);
  let existingPending = await pendingStore.getPending(chatId);

  if (allowedUserId != null && fromUserId !== allowedUserId) {
    return {
      status: "ignored",
      reason: "unauthorized-user",
      fromUserId,
      chatId,
    };
  }

  const rawText = extractMessageText(message);
  const formattedTextHtml = extractFormattedMessageHtml(message);
  const text = isEditRequest(rawText) ? extractEditInstruction(rawText) || rawText : rawText;

  if (existingPending && isPendingExpired(existingPending)) {
    await pendingStore.deletePending(chatId);
    existingPending = null;
  }

  const command = extractBotCommand(rawText);
  if (command) {
    return handleBotCommand({
      command,
      chatId,
      fromUserId,
      pending: existingPending,
      pendingStore,
      repository,
    });
  }

  const attachments = await stageTelegramAttachments({
    attachments: rawAttachments,
    chatId,
    messageId: message.message_id ?? updateId,
    repository,
    telegramClient,
  });
  const recentEntity = getRecentEntity(existingPending);

  if (!text && attachments.length === 0) {
    return {
      status: "ignored",
      reason: "no-command",
      fromUserId,
      chatId,
    };
  }

  if (text && isConfirmationDecision(text)) {
    if (useIntentPipeline && isCollectingTurnPending(existingPending)) {
      return handleCollectingTurnDecision({
        text,
        chatId,
        fromUserId,
        pendingStore,
        pending: existingPending,
        repository,
      });
    }

    return handleConfirmationDecision({
      text,
      chatId,
      fromUserId,
      pendingStore,
      pending: existingPending,
      repository,
      photoStore,
      translationClient,
      dryRun,
    });
  }

  if (text && isUndoRequest(text)) {
    return handleUndoRequest({
      chatId,
      fromUserId,
      updateId,
      messageId: message.message_id ?? null,
      pendingStore,
      repository,
    });
  }

  if (useIntentPipeline && isLegacyPendingState(existingPending)) {
    await pendingStore.deletePending(chatId);
    existingPending = null;
  }

  if (useIntentPipeline && isCollectingTurnPending(existingPending)) {
    const nextTurn = appendTurnMessage(existingPending.operation.turn, {
      message,
      updateId,
      text,
      formattedTextHtml,
      attachments,
    });
    const bufferedPending = createBufferedTurnPending({
      pending: existingPending,
      turn: nextTurn,
      chatId,
      fromUserId,
      updateId,
      messageId: message.message_id ?? null,
    });
    await pendingStore.setPending(chatId, bufferedPending);

    const stablePending = await waitForBufferedTurnStability({
      pendingStore,
      chatId,
      pendingType: "v2_turn_context",
      waitMs: coalesceDelayMs,
    });

    if (!isLatestBufferedMessage(stablePending, updateId, message.message_id ?? null)) {
      return {
        status: "ignored",
        reason: "batched-into-turn-context",
        fromUserId,
        chatId,
      };
    }

    const stableTurn = stablePending?.operation?.turn ?? nextTurn;
    return handleTelegramMessageV2({
      message,
      updateId,
      pendingStore,
      repository,
      extractionClient,
      text: null,
      formattedTextHtml: null,
      attachments: [],
      recentContext: stableTurn.recentContext || buildV2RecentContext(recentEntity),
      debugLog,
      dryRun,
      existingTurn: stableTurn,
    });
  }

  if (existingPending && isV2PendingOperation(existingPending)) {
    const nextTurn = appendTurnMessage(existingPending.operation.turn, {
      message,
      updateId,
      text,
      formattedTextHtml,
      attachments,
    });
    const bufferedPending = createBufferedTurnPending({
      pending: existingPending,
      turn: nextTurn,
      chatId,
      fromUserId,
      updateId,
      messageId: message.message_id ?? null,
    });
    await pendingStore.setPending(chatId, bufferedPending);

    const stablePending = await waitForBufferedTurnStability({
      pendingStore,
      chatId,
      pendingType: existingPending.operation.type,
      waitMs: pendingCoalesceDelayMs || coalesceDelayMs,
    });

    if (!isLatestBufferedMessage(stablePending, updateId, message.message_id ?? null)) {
      return {
        status: "ignored",
        reason: "batched-into-pending-context",
        fromUserId,
        chatId,
      };
    }

    return handleBufferedV2PendingTurn({
      message,
      updateId,
      pendingStore,
      pending: stablePending,
      repository,
      extractionClient,
      debugLog,
      dryRun,
    });
  }

  if (
    useIntentPipeline &&
    Array.isArray(batchedMessages) &&
    batchedMessages.length > 0
  ) {
    let turn = null;

    for (const entry of batchedMessages) {
      const batchMessage = entry.message;
      const batchText = extractMessageText(batchMessage);
      const batchFormattedTextHtml = extractFormattedMessageHtml(batchMessage);
      const batchAttachments = await stageTelegramAttachments({
        attachments: extractTelegramAttachments(batchMessage),
        chatId,
        messageId: batchMessage.message_id ?? entry.updateId,
        repository,
        telegramClient,
      });

      turn = turn
        ? appendTurnMessage(turn, {
            message: batchMessage,
            updateId: entry.updateId,
            text: batchText,
            formattedTextHtml: batchFormattedTextHtml,
            attachments: batchAttachments,
          })
        : collectTurn({
            message: batchMessage,
            updateId: entry.updateId,
            text: batchText,
            formattedTextHtml: batchFormattedTextHtml,
            recentContext: buildV2RecentContext(recentEntity),
            attachments: batchAttachments,
          });
    }

    const lastEntry = batchedMessages[batchedMessages.length - 1];
    return handleTelegramMessageV2({
      message: lastEntry.message,
      updateId: lastEntry.updateId,
      pendingStore,
      repository,
      extractionClient,
      text: null,
      formattedTextHtml: null,
      attachments: [],
      recentContext: turn?.recentContext || null,
      debugLog,
      dryRun,
      existingTurn: turn,
    });
  }

  if (!useIntentPipeline) {
    return {
      status: "failed",
      reason: "legacy_handler_retired",
      error: "Legacy Telegram handler flow has been retired. Use the intent pipeline or omit useIntentPipeline=false.",
      chatId,
      fromUserId,
    };
  }

  const initialTurn = collectTurn({
    message,
    updateId,
    text,
    formattedTextHtml,
    recentContext: buildV2RecentContext(recentEntity),
    attachments,
  });
  const bufferedPending = createBufferedTurnPending({
    pending: null,
    turn: initialTurn,
    chatId,
    fromUserId,
    updateId,
    messageId: message.message_id ?? null,
  });
  await pendingStore.setPending(chatId, bufferedPending);

  const stablePending = await waitForBufferedTurnStability({
    pendingStore,
    chatId,
    pendingType: "v2_turn_context",
    waitMs: coalesceDelayMs,
  });

  if (!isLatestBufferedMessage(stablePending, updateId, message.message_id ?? null)) {
    return {
      status: "ignored",
      reason: "batched-into-turn-context",
      fromUserId,
      chatId,
    };
  }

  const stableTurn = stablePending?.operation?.turn ?? initialTurn;
  return handleTelegramMessageV2({
    message,
    updateId,
    pendingStore,
    repository,
    extractionClient,
    text: null,
    formattedTextHtml: null,
    attachments: [],
    recentContext: stableTurn.recentContext || buildV2RecentContext(recentEntity),
    debugLog,
    dryRun,
    existingTurn: stableTurn,
  });
}

function createBufferedTurnPending({
  pending,
  turn,
  chatId,
  fromUserId,
  updateId,
  messageId,
}) {
  if (pending?.operation?.type === "v2_turn_context") {
    return createPendingRecord({
      chatId,
      userId: fromUserId,
      state: "collecting_turn",
      sourceMessageId: messageId,
      sourceUpdateId: updateId,
      question: pending.question ?? null,
      context: pending.context || {},
      operation: {
        ...pending.operation,
        turn,
      },
    });
  }

  if (pending?.operation?.type?.startsWith("v2_")) {
    return createPendingRecord({
      chatId,
      userId: fromUserId,
      state: pending.state,
      sourceMessageId: messageId,
      sourceUpdateId: updateId,
      question: pending.question ?? null,
      context: pending.context || {},
      operation: {
        ...pending.operation,
        turn,
      },
    });
  }

  return createPendingRecord({
    chatId,
    userId: fromUserId,
    state: "collecting_turn",
    sourceMessageId: messageId,
    sourceUpdateId: updateId,
    operation: {
      type: "v2_turn_context",
      turn,
    },
  });
}

async function waitForBufferedTurnStability({
  pendingStore,
  chatId,
  pendingType,
  waitMs = 1000,
  maxRounds = 3,
}) {
  let previousSignature = getPendingTurnSignature(await pendingStore.getPending(chatId), pendingType);

  for (let round = 0; round < maxRounds; round += 1) {
    if (!previousSignature || waitMs <= 0) {
      return pendingStore.getPending(chatId);
    }

    await sleep(waitMs);
    const currentPending = await pendingStore.getPending(chatId);
    const currentSignature = getPendingTurnSignature(currentPending, pendingType);

    if (currentSignature === previousSignature) {
      return currentPending;
    }

    previousSignature = currentSignature;
  }

  return pendingStore.getPending(chatId);
}

function getPendingTurnSignature(pending, expectedType = null) {
  if (!pending?.operation?.turn) {
    return null;
  }

  if (expectedType && pending.operation.type !== expectedType) {
    return null;
  }

  const messages = Array.isArray(pending.operation.turn.messages) ? pending.operation.turn.messages : [];
  const latest = messages[messages.length - 1] || null;

  return JSON.stringify({
    state: pending.state || null,
    type: pending.operation.type || null,
    count: messages.length,
    updateId: latest?.updateId ?? null,
    messageId: latest?.messageId ?? null,
  });
}

function isLatestBufferedMessage(pending, updateId, messageId) {
  const messages = Array.isArray(pending?.operation?.turn?.messages) ? pending.operation.turn.messages : [];
  const latest = messages[messages.length - 1] || null;

  return Boolean(latest) && latest.updateId === updateId && latest.messageId === messageId;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCollectingTurnPending(pending) {
  return pending?.state === "collecting_turn" && pending?.operation?.type === "v2_turn_context";
}

async function handleCollectingTurnDecision({
  text,
  chatId,
  fromUserId,
  pendingStore,
  pending,
  repository,
}) {
  const decision = normalizeConfirmationDecision(text);

  if (decision === "cancel") {
    await cleanupStagedAttachments(repository, collectPendingTurnAttachments(pending));
    await pendingStore.deletePending(chatId);
    return {
      status: "cancelled",
      decision,
      hasPending: true,
      chatId,
      fromUserId,
    };
  }

  return {
    status: "control",
    decision,
    hasPending: true,
    chatId,
    fromUserId,
    reason: "pending-state-not-confirmable",
  };
}

function collectPendingTurnAttachments(pending) {
  const messages = Array.isArray(pending?.operation?.turn?.messages)
    ? pending.operation.turn.messages
    : [];

  return messages.flatMap((entry) => Array.isArray(entry.attachments) ? entry.attachments : []);
}

function collectAllPendingAttachments(pending) {
  const turnAttachments = collectPendingTurnAttachments(pending);
  const operationAttachments = Array.isArray(pending?.operation?.attachments)
    ? pending.operation.attachments
    : [];

  return [...turnAttachments, ...operationAttachments];
}

export function extractMessageText(message) {
  const text = typeof message.text === "string" && message.text.trim() ? message.text : null;
  const caption = typeof message.caption === "string" && message.caption.trim() ? message.caption : null;
  return text || caption || null;
}

export function extractFormattedMessageHtml(message) {
  const text = typeof message.text === "string" && message.text.trim() ? message.text : null;
  const caption = typeof message.caption === "string" && message.caption.trim() ? message.caption : null;
  const rawText = text || caption;
  const entities = text ? message.entities : message.caption_entities;

  if (!rawText || !Array.isArray(entities) || entities.length === 0) {
    return null;
  }

  return telegramEntitiesToHtml(rawText, entities);
}

export function extractCommandText(message) {
  const candidate = extractMessageText(message);
  return candidate && candidate.trim().startsWith("/") ? candidate : null;
}

function extractBotCommand(text) {
  if (typeof text !== "string") {
    return null;
  }

  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const [head] = trimmed.split(/\s+/, 1);
  const normalized = head.toLowerCase();
  const command = normalized.includes("@") ? normalized.slice(0, normalized.indexOf("@")) : normalized;

  switch (command) {
    case "/new":
    case "/state":
    case "/help":
      return command;
    default:
      return null;
  }
}

async function handleBotCommand({
  command,
  chatId,
  fromUserId,
  pending,
  pendingStore,
  repository,
}) {
  switch (command) {
    case "/new":
      await cleanupStagedAttachments(repository, collectAllPendingAttachments(pending));
      await pendingStore.deletePending(chatId);
      return {
        status: "command",
        command: "new",
        chatId,
        fromUserId,
        hadContext: Boolean(pending),
      };
    case "/state":
      return {
        status: "command",
        command: "state",
        chatId,
        fromUserId,
        contextState: summarizePendingContext(pending),
      };
    case "/help":
      return {
        status: "command",
        command: "help",
        chatId,
        fromUserId,
      };
    default:
      return {
        status: "ignored",
        reason: "no-command",
        fromUserId,
        chatId,
      };
  }
}

function summarizePendingContext(pending) {
  if (!pending) {
    return {
      hasContext: false,
      state: "idle",
      operationType: null,
      messageCount: 0,
      fileCount: 0,
      intentSummary: null,
      doubt: null,
    };
  }

  const turn = pending?.operation?.turn ?? null;
  const messages = Array.isArray(turn?.messages) ? turn.messages : [];
  const attachments = collectAllPendingAttachments(pending);
  const activeSession = turn?.recentContext?.activeSession ?? null;
  const operationType = pending?.operation?.type ?? null;
  const previewOperation =
    pending?.operation && !operationType
      ? {
          action: pending.operation.action ?? null,
          entity: pending.operation.entity ?? null,
          slug: pending.operation.slug ?? pending.operation.fields?.slug ?? null,
        }
      : null;

  const intentSummary = activeSession
    ? {
        intent: activeSession.intent ?? null,
        entity: activeSession.entity ?? null,
        targetMode: activeSession.target?.mode ?? null,
        targetRef: activeSession.target?.ref ?? null,
      }
    : previewOperation;

  const doubt = pending.state === "awaiting_clarification"
    ? {
        reason: pending?.operation?.clarification?.kind ?? pending?.operation?.clarificationReason ?? null,
        question: pending?.question ?? null,
      }
    : null;

  return {
    hasContext: true,
    state: pending.state ?? "idle",
    operationType,
    messageCount: messages.length,
    fileCount: attachments.length,
    intentSummary,
    doubt,
    sourceMessageId: pending.sourceMessageId ?? null,
  };
}

async function handleConfirmationDecision({
  text,
  chatId,
  fromUserId,
  pendingStore,
  pending,
  repository,
  photoStore,
  translationClient,
  dryRun,
}) {
  const decision = normalizeConfirmationDecision(text);

  if (!pending || isPendingExpired(pending)) {
    if (pending && isPendingExpired(pending)) {
      await pendingStore.deletePending(chatId);
    }

    return {
      status: "control",
      decision,
      hasPending: false,
      chatId,
      fromUserId,
    };
  }

  if (decision === "cancel") {
    await cleanupStagedAttachments(repository, pending.operation?.attachments ?? []);
    await persistSessionState(pendingStore, chatId, clearActiveDraft(pending));
    return {
      status: "cancelled",
      decision,
      hasPending: true,
      chatId,
      fromUserId,
    };
  }

  if (pending.state !== "awaiting_confirmation") {
    return {
      status: "control",
      decision,
      hasPending: true,
      chatId,
      fromUserId,
      reason: "pending-state-not-confirmable",
    };
  }

  if (pending.operation?.type === "undo") {
    const writeResult = dryRun
      ? await repository.previewUndoLastChange(pending.operation.undoTarget)
      : await repository.applyUndoLastChange(pending.operation.undoTarget);

    await persistSessionState(
      pendingStore,
      chatId,
      createRecentEntitySession(pending, {
        entity: "content",
        slug: pending.operation.slug,
        action: "undo",
        fields: pending.operation.fields,
        summary: pending.operation.preview?.fields?.message || null,
      })
    );

    return {
      status: "confirmed",
      decision,
      hasPending: true,
      chatId,
      fromUserId,
      dryRun,
      writeResult,
    };
  }

  if (pending.operation?.type === "translation_batch") {
    await persistSessionState(
      pendingStore,
      chatId,
      createRecentEntitySession(pending, {
        entity: pending.operation.entity,
        slug: pending.operation.slug,
        action: "translate",
        fields: {
          slug: pending.operation.slug,
          sourceLocale: pending.operation.sourceLocale || "ru",
        },
        summary: pending.operation.preview?.fields?.locales || null,
      })
    );

    return {
      status: "confirmed",
      decision,
      hasPending: true,
      chatId,
      fromUserId,
      dryRun,
      writeResult: {
        action: "translate",
        entity: pending.operation.entity,
        slug: pending.operation.slug,
      },
      translationPlan: {
        entity: pending.operation.entity,
        slug: pending.operation.slug,
        sourceLocale: pending.operation.sourceLocale || "ru",
        targetLocales: Array.isArray(pending.operation.targetLocales) ? pending.operation.targetLocales : [],
      },
    };
  }

  const operation = {
    entity: pending.operation.entity,
    action: pending.operation.action,
    fields: pending.operation.fields,
  };
  let mapped = mapOperationToContent(operation);

  const writeResult = dryRun
    ? await repository.previewCommand(operation, mapped)
    : await repository.applyCommand(operation, mapped);

  await persistSessionState(
    pendingStore,
    chatId,
    createRecentEntitySession(pending, {
      entity: operation.entity,
      slug: operation.fields.slug,
      action: operation.action,
      fields: operation.fields,
      summary: pending.operation.summary || null,
    })
  );

  return {
    status: "confirmed",
    decision,
    hasPending: true,
    chatId,
    fromUserId,
    dryRun,
    writeResult,
    operation,
    translationPlan:
      !dryRun &&
      operation.action !== "delete" &&
      shouldAutoTranslateAfterConfirmation(pending.operation)
        ? {
            entity: operation.entity,
            slug: operation.fields.slug,
            sourceLocale: operation.fields.sourceLocale || "ru",
          }
        : null,
  };
}

async function handleUndoRequest({
  chatId,
  fromUserId,
  updateId,
  messageId,
  pendingStore,
  repository,
}) {
  if (
    !repository ||
    typeof repository.previewUndoLastChange !== "function" ||
    typeof repository.applyUndoLastChange !== "function"
  ) {
    return {
      status: "failed",
      reason: "undo_not_supported",
      error: "Undo is not supported in this runtime.",
      chatId,
      fromUserId,
    };
  }

  const undoPreview = await repository.previewUndoLastChange();
  const preview = {
    entity: "content",
    action: "undo",
    slug: undoPreview.target.commitSha.slice(0, 7),
    fields: {
      commitSha: undoPreview.target.commitSha,
      message: undoPreview.target.message,
    },
    files: undoPreview.paths.files,
    hasPhoto: false,
    attachments: [],
  };

  const newPending = createPendingRecord({
    chatId,
    userId: fromUserId,
    state: "awaiting_confirmation",
    sourceMessageId: messageId,
    sourceUpdateId: updateId,
    operation: {
      type: "undo",
      entity: "content",
      action: "undo",
      slug: preview.slug,
      fields: {
        commitSha: undoPreview.target.commitSha,
      },
      preview,
      undoTarget: undoPreview.target,
      attachments: [],
    },
  });

  await pendingStore.setPending(chatId, newPending);

  return {
    status: "processed",
    fromUserId,
    chatId,
    pendingState: newPending,
  };
}

function shouldAutoTranslateAfterConfirmation(operation) {
  const sourceLocale = normalizeSourceLocale(operation?.fields?.sourceLocale);
  const targetLocale = normalizeSourceLocale(operation?.fields?.locale);

  return !targetLocale || targetLocale === sourceLocale;
}

function normalizeSourceLocale(locale) {
  return typeof locale === "string" && locale.trim() ? locale.trim().toLowerCase() : "ru";
}

function getRecentEntity(pending) {
  if (!pending?.context) {
    return null;
  }

  if (Array.isArray(pending.context.recentEntities) && pending.context.recentEntities.length > 0) {
    return pending.context.recentEntities[0];
  }

  return pending.context.recentEntity ?? null;
}


function clearActiveDraft(pending) {
  if (!pending) {
    return null;
  }

  return createPendingRecord({
    chatId: pending.chatId,
    userId: pending.userId,
    state: "idle",
    sourceMessageId: pending.sourceMessageId ?? null,
    sourceUpdateId: pending.sourceUpdateId ?? null,
    operation: null,
    context: {
      ...(pending.context || {}),
    },
    ttlHours: RECENT_SESSION_TTL_HOURS,
  });
}

function createRecentEntitySession(pending, recentEntity) {
  const cleared = clearActiveDraft(pending);
  const stampedRecentEntity = recentEntity
    ? {
        ...recentEntity,
        lastTouchedAt: new Date().toISOString(),
      }
    : null;
  const previous = Array.isArray(cleared.context?.recentEntities)
    ? cleared.context.recentEntities
    : (cleared.context?.recentEntity ? [cleared.context.recentEntity] : []);
  const nextRecentEntities = [
    stampedRecentEntity,
    ...previous.filter((entry) => !(entry?.entity === stampedRecentEntity?.entity && entry?.slug === stampedRecentEntity?.slug)),
  ]
    .filter(Boolean)
    .slice(0, 5);

  return {
    ...cleared,
    context: {
      ...(cleared.context || {}),
      recentEntity: stampedRecentEntity,
      recentEntities: nextRecentEntities,
    },
  };
}

async function persistSessionState(pendingStore, chatId, record) {
  if (!record || (!record.operation && !record.context?.recentEntity)) {
    await pendingStore.deletePending(chatId);
    return;
  }

  await pendingStore.setPending(chatId, record);
}

function telegramEntitiesToHtml(text, entities) {
  const normalizedEntities = entities
    .filter((entity) => entity && Number.isInteger(entity.offset) && Number.isInteger(entity.length) && entity.length > 0)
    .map((entity) => ({
      ...entity,
      end: entity.offset + entity.length,
    }))
    .sort((left, right) => left.offset - right.offset || right.length - left.length);

  return renderEntityRange(text, normalizedEntities, 0, text.length);
}

function renderEntityRange(text, entities, start, end) {
  let cursor = start;
  let html = "";
  const scoped = entities.filter((entity) => entity.offset >= start && entity.end <= end);

  while (cursor < end) {
    const nextEntity = scoped.find((entity) => entity.offset === cursor);

    if (!nextEntity) {
      const nextBoundary = scoped
        .filter((entity) => entity.offset > cursor)
        .reduce((min, entity) => Math.min(min, entity.offset), end);
      html += escapeTelegramHtml(text.slice(cursor, nextBoundary)).replace(/\n/g, "<br>");
      cursor = nextBoundary;
      continue;
    }

    const childEntities = scoped.filter(
      (entity) =>
        entity !== nextEntity &&
        entity.offset >= nextEntity.offset &&
        entity.end <= nextEntity.end
    );
    const innerHtml = renderEntityRange(text, childEntities, nextEntity.offset, nextEntity.end);
    html += wrapTelegramEntity(nextEntity, innerHtml);
    cursor = nextEntity.end;
  }

  return html;
}

function wrapTelegramEntity(entity, innerHtml) {
  switch (entity.type) {
    case "bold":
      return `<strong>${innerHtml}</strong>`;
    case "italic":
      return `<em>${innerHtml}</em>`;
    case "underline":
      return `<u>${innerHtml}</u>`;
    case "strikethrough":
      return `<s>${innerHtml}</s>`;
    case "spoiler":
      return `<span class="tg-spoiler">${innerHtml}</span>`;
    case "code":
      return `<code>${innerHtml.replace(/<br>/g, "\n")}</code>`;
    case "pre":
      return `<pre>${innerHtml.replace(/<br>/g, "\n")}</pre>`;
    case "text_link":
      return `<a href="${escapeTelegramAttribute(entity.url || "#")}">${innerHtml}</a>`;
    case "url":
      return `<a href="${escapeTelegramAttribute(stripHtmlTags(innerHtml))}">${innerHtml}</a>`;
    default:
      return innerHtml;
  }
}

function escapeTelegramHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeTelegramAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function stripHtmlTags(value) {
  return String(value).replace(/<[^>]+>/g, "");
}

async function stageTelegramAttachments({
  attachments,
  chatId,
  messageId,
  repository,
  telegramClient,
}) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return [];
  }

  if (!telegramClient || typeof repository.stageAttachment !== "function") {
    return attachments;
  }

  const stagedAttachments = [];

  for (const attachment of attachments) {
    if (!attachment.fileId) {
      stagedAttachments.push(attachment);
      continue;
    }

    const download = await telegramClient.downloadFileBytes(attachment.fileId);
    const stagedAttachment = await repository.stageAttachment({
      chatId,
      messageId,
      attachment: {
        ...attachment,
        fileName: attachment.fileName || deriveAttachmentName(attachment, download.filePath),
      },
      bytes: download.bytes,
    });

    stagedAttachments.push({
      ...stagedAttachment,
      sourceFilePath: download.filePath,
    });
  }

  return stagedAttachments;
}

function deriveAttachmentName(attachment, filePath) {
  const extensionMatch = typeof filePath === "string" ? filePath.match(/(\.[a-zA-Z0-9]+)$/) : null;
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : "";
  return `${attachment.kind}-${attachment.fileUniqueId || attachment.fileId || "file"}${extension}`;
}

async function cleanupStagedAttachments(repository, attachments) {
  if (!repository || typeof repository.deleteStagedAttachment !== "function") {
    return;
  }

  for (const attachment of attachments) {
    if (attachment?.stagedPath) {
      await repository.deleteStagedAttachment(attachment.stagedPath);
    }
  }
}

function isUndoRequest(text) {
  return typeof text === "string" && text.trim().toLowerCase() === "undo";
}
