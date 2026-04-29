import {
  createPendingRecord,
} from "../../core/confirmation-flow.js";
import { validateOperation } from "../../core/operation-validator.js";
import { buildOperationPreview } from "../../core/preview-builder.js";
import { mapOperationToContent } from "../../core/content-mapper.js";
import { normalizeContentLocale } from "../../core/content-localization.js";
import { ContentValidationError } from "../../shared/errors.js";
import { analyzeIntent } from "../../orchestration/analyze-intent.js";
import { collectTurn, appendTurnMessage } from "../../orchestration/collect-turn.js";
import { operationToLegacyCommand } from "../../orchestration/operation-to-legacy-command.js";
import { resolveTargets } from "../../orchestration/resolve-targets.js";
import { generateOperation } from "../../orchestration/generate-operation.js";
import { resolvePendingTranslationLocales } from "../../services/post-confirmation-translation.js";
import { ENTITY_SCHEMAS } from "../../schemas/prompt-schemas.js";

function normalizeEntity(entity) {
  return entity === "announcement" ? "announce" : entity;
}

function cloneRecentContext(recentContext = null) {
  return {
    lastConfirmedObject: recentContext?.lastConfirmedObject || null,
    pendingDraft: recentContext?.pendingDraft || null,
    activeSession: recentContext?.activeSession || null,
  };
}

function buildIntentHint(intent = null) {
  if (!intent) {
    return null;
  }

  return {
    intent: intent.intent || null,
    entity: intent.entity || null,
    target: {
      mode: intent.target?.mode || null,
      ref: intent.target?.ref || null,
    },
    relatedEntities: Array.isArray(intent.relatedEntities) ? intent.relatedEntities.map((entry) => ({ ...entry })) : [],
    requestedLocales: intent.requestedLocales || {
      sourceLocale: null,
      targetLocale: null,
      targetLocales: [],
    },
    needsClarification: Boolean(intent.needsClarification),
    clarificationReason: intent.clarificationReason || null,
    clarificationQuestion: intent.clarificationQuestion || null,
    confidence: intent.confidence || "medium",
  };
}

function buildIntentHintFromResolved(resolved = null) {
  if (!resolved) {
    return null;
  }

  return buildIntentHint({
    intent: resolved.intent || null,
    entity: resolved.entity || null,
    target: {
      mode: resolved.target?.exists ? "existing" : (resolved.target ? "new" : null),
      ref: resolved.target?.slug || null,
    },
    relatedEntities: Array.isArray(resolved.relatedEntities)
      ? resolved.relatedEntities.map((entry) => ({
          entity: entry.entity,
          ref: entry.slug,
          role: entry.role,
        }))
      : [],
    requestedLocales: resolved.requestedLocales || {
      sourceLocale: null,
      targetLocale: null,
      targetLocales: [],
    },
    needsClarification: false,
    clarificationReason: null,
    clarificationQuestion: null,
    confidence: "high",
  });
}

function buildActiveSession({
  phase,
  intent,
  resolved = null,
  question = null,
  operation = null,
}) {
  return {
    phase,
    intent: buildIntentHint(intent || buildIntentHintFromResolved(resolved)),
    resolvedTarget: resolved?.target?.slug
      ? {
          entity: resolved.entity,
          slug: resolved.target.slug,
          exists: Boolean(resolved.target.exists),
        }
      : null,
    draft:
      operation && typeof operation === "object"
        ? {
            entity: operation.entity || null,
            action: operation.action || null,
            targetSlug: operation.targetSlug || null,
          }
        : null,
    clarificationQuestion: question || null,
  };
}

function applyActiveSessionToTurn(turn, activeSession = null) {
  return {
    ...turn,
    recentContext: {
      ...cloneRecentContext(turn.recentContext),
      activeSession: activeSession || null,
    },
  };
}

async function writeDebugLog(debugLog, event, turn, payload = {}) {
  if (typeof debugLog !== "function") {
    return;
  }

  await debugLog({
    event,
    updateId: turn?.messages?.[turn.messages.length - 1]?.updateId ?? null,
    messageId: turn?.messages?.[turn.messages.length - 1]?.messageId ?? null,
    chatId: turn?.chatId ?? null,
    fromUserId: turn?.userId ?? null,
    payload: {
      turn: sanitizeTurnForDebug(turn),
      ...payload,
    },
  });
}

function buildTurnDebugContext(turn) {
  return {
    updateId: turn?.messages?.[turn.messages.length - 1]?.updateId ?? null,
    messageId: turn?.messages?.[turn.messages.length - 1]?.messageId ?? null,
    chatId: turn?.chatId ?? null,
    fromUserId: turn?.userId ?? null,
  };
}

function sanitizeTurnForDebug(turn) {
  if (!turn) {
    return null;
  }

  return {
    chatId: turn.chatId ?? null,
    userId: turn.userId ?? null,
    recentContext: turn.recentContext || null,
    messages: Array.isArray(turn.messages)
      ? turn.messages.map((message) => ({
          messageId: message.messageId ?? null,
          updateId: message.updateId ?? null,
          text: message.text || null,
          formattedTextHtml: message.formattedTextHtml || null,
          attachments: Array.isArray(message.attachments)
            ? message.attachments.map((attachment) => ({
                kind: attachment.kind || null,
                fileName: attachment.fileName || null,
                stagedPath: attachment.stagedPath || null,
                mimeType: attachment.mimeType || null,
              }))
            : [],
          isForwarded: Boolean(message.isForwarded),
          hasQuote: Boolean(message.hasQuote),
        }))
      : [],
  };
}

function getEntitySchema(entity) {
  return ENTITY_SCHEMAS[entity] || { entity };
}

function normalizeTranslationLocales(translation, currentObject = {}) {
  const sourceLocale = normalizeContentLocale(
    translation?.sourceLocale ||
    currentObject?.sourceLocale ||
    "ru"
  ) || "ru";

  const explicitTargets = Array.isArray(translation?.targetLocales) && translation.targetLocales.length > 0
    ? translation.targetLocales
    : (translation?.targetLocale ? [translation.targetLocale] : null);

  const targetLocales = explicitTargets
    ? [...new Set(
        explicitTargets
          .map((locale) => normalizeContentLocale(locale))
          .filter((locale) => locale && locale !== sourceLocale)
      )]
    : resolvePendingTranslationLocales(currentObject, sourceLocale);

  return {
    sourceLocale,
    targetLocales,
  };
}

function parseClarificationSelection(text, options = []) {
  const normalized = typeof text === "string" ? text.trim() : "";
  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    const index = Number.parseInt(normalized, 10) - 1;
    return index >= 0 && index < options.length ? options[index] : null;
  }

  const lowered = normalized.toLowerCase();
  return options.find((option) => {
    const probes = [option.slug, option.label]
      .filter(Boolean)
      .map((value) => String(value).trim().toLowerCase());
    return probes.includes(lowered);
  }) || null;
}

function buildIncompleteOperationQuestion(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("field 'slug'")) {
    return "I still need the title, name, or handle before I can prepare the draft. Send the missing text and I will continue from this turn.";
  }

  return `I need a bit more data before I can prepare the draft. ${message}`;
}

async function finalizeV2Operation({
  message,
  updateId,
  pendingStore,
  repository,
  turn,
  intent,
  operation,
  resolved,
  attachments,
  debugLog,
  dryRun,
}) {
  try {
    if (operation.action === "translate") {
      const turnWithSession = applyActiveSessionToTurn(
        turn,
        buildActiveSession({
          phase: "awaiting_confirmation",
          intent,
          resolved,
          operation,
        })
      );
      const { sourceLocale, targetLocales } = normalizeTranslationLocales(
        operation.translation,
        resolved.currentObject || {}
      );

      if (!Array.isArray(targetLocales) || targetLocales.length === 0) {
        return {
          status: "clarification",
          chatId: turn.chatId,
          fromUserId: turn.userId,
          question: "There are no auto-updatable locales for this entity. Existing translations are already manual or only the source locale remains.",
          pendingState: null,
        };
      }

      const preview = {
        entity: normalizeEntity(operation.entity),
        action: "translate",
        slug: operation.targetSlug,
        fields: {
          locales: targetLocales.join(", "),
        },
        files: [operation.targetSlug ? `${normalizeEntity(operation.entity)}:${operation.targetSlug}` : normalizeEntity(operation.entity)],
        attachments: [],
      };

      const pending = createPendingRecord({
        chatId: turnWithSession.chatId,
        userId: turnWithSession.userId,
        state: "awaiting_confirmation",
        sourceMessageId: message.message_id ?? null,
        sourceUpdateId: updateId,
        operation: {
          type: "translation_batch",
          entity: normalizeEntity(operation.entity),
          action: "translate",
          slug: operation.targetSlug,
          sourceLocale,
          targetLocales,
          preview,
          attachments: [],
          turn: turnWithSession,
          intentHint: buildIntentHint(intent || buildIntentHintFromResolved(resolved)),
        },
      });

      await pendingStore.setPending(turnWithSession.chatId, pending);
      await writeDebugLog(debugLog, "telegram_v2_translation_pending", turnWithSession, {
        pendingType: pending.operation?.type || null,
        question: null,
        operationPreview: preview,
      });

      return {
        status: "processed",
        chatId: turnWithSession.chatId,
        fromUserId: turnWithSession.userId,
        pendingState: pending,
        operation: preview,
        dryRun,
      };
    }

    const turnWithSession = applyActiveSessionToTurn(
      turn,
      buildActiveSession({
        phase: "awaiting_confirmation",
        intent,
        resolved,
        operation,
      })
    );

    const legacyCommand = await operationToLegacyCommand({
      operation,
      resolved,
      attachments,
    });

    const validated = validateOperation(legacyCommand);
    const mapped = mapOperationToContent(validated);
    const repositoryPreview = await repository.previewCommand(validated, mapped);
    const preview = buildOperationPreview(validated, repositoryPreview, {
      attachments,
    });

    const pending = createPendingRecord({
      chatId: turnWithSession.chatId,
      userId: turnWithSession.userId,
      state: "awaiting_confirmation",
      sourceMessageId: message.message_id ?? null,
      sourceUpdateId: updateId,
      operation: {
        type: "v2_content_operation",
        entity: validated.entity,
        action: validated.action,
        slug: validated.fields.slug,
        fields: validated.fields,
        preview,
        attachments,
        turn: turnWithSession,
        intentHint: buildIntentHint(intent || buildIntentHintFromResolved(resolved)),
        requestText: turnWithSession.messages.map((item) => item.text).filter(Boolean).join("\n"),
        summary: `${validated.action} ${validated.entity} ${validated.fields.slug}`.trim(),
        warnings: operation.warnings || [],
      },
    });

    await pendingStore.setPending(turnWithSession.chatId, pending);
    await writeDebugLog(debugLog, "telegram_v2_content_pending", turnWithSession, {
      pendingType: pending.operation?.type || null,
      question: null,
      operationFields: pending.operation?.fields || null,
    });

    return {
      status: "processed",
      chatId: turnWithSession.chatId,
      fromUserId: turnWithSession.userId,
      pendingState: pending,
      operation: repositoryPreview,
      dryRun,
    };
  } catch (error) {
    if (!(error instanceof ContentValidationError)) {
      throw error;
    }

    const question = buildIncompleteOperationQuestion(error);
    const turnWithSession = applyActiveSessionToTurn(
      turn,
      buildActiveSession({
        phase: "awaiting_clarification",
        intent,
        resolved,
        question,
        operation,
      })
    );
    const pending = createPendingRecord({
      chatId: turnWithSession.chatId,
      userId: turnWithSession.userId,
      state: "awaiting_clarification",
      sourceMessageId: message.message_id ?? null,
      sourceUpdateId: updateId,
      question,
      operation: {
        type: "v2_incomplete_operation",
        turn: turnWithSession,
        intentHint: buildIntentHint(intent || buildIntentHintFromResolved(resolved)),
      },
    });

    await pendingStore.setPending(turnWithSession.chatId, pending);
    await writeDebugLog(debugLog, "telegram_v2_incomplete_operation", turnWithSession, {
      pendingType: pending.operation?.type || null,
      question,
      validationError: error.message,
    });

    return {
      status: "clarification",
      chatId: turnWithSession.chatId,
      fromUserId: turnWithSession.userId,
      question: pending.question,
      pendingState: pending,
    };
  }
}

function buildRecentContextFromPending(operation) {
  return cloneRecentContext(operation?.turn?.recentContext || null);
}

function mergeClarifiedIntent(previousIntent, nextIntent) {
  if (!previousIntent) {
    return nextIntent;
  }

  return {
    ...nextIntent,
    intent:
      nextIntent?.intent && nextIntent.intent !== "noop"
        ? nextIntent.intent
        : (previousIntent.intent || nextIntent?.intent || null),
    entity: nextIntent?.entity || previousIntent.entity || null,
    target: {
      mode:
        nextIntent?.target?.mode ||
        previousIntent?.target?.mode ||
        null,
      ref:
        nextIntent?.target?.ref ||
        previousIntent?.target?.ref ||
        null,
    },
    relatedEntities:
      Array.isArray(nextIntent?.relatedEntities) && nextIntent.relatedEntities.length > 0
        ? nextIntent.relatedEntities
        : (Array.isArray(previousIntent.relatedEntities) ? previousIntent.relatedEntities : []),
    requestedLocales: nextIntent?.requestedLocales || previousIntent.requestedLocales || {
      sourceLocale: null,
      targetLocale: null,
      targetLocales: [],
    },
  };
}

async function resumeV2Turn({
  operation,
  message,
  updateId,
  pendingStore,
  repository,
  extractionClient,
  text,
  formattedTextHtml,
  attachments,
  intentHint = null,
  debugLog,
  dryRun,
  useExistingTurn = false,
}) {
  const resumedTurn = useExistingTurn
    ? operation.turn
    : appendTurnMessage(operation.turn, {
        message,
        updateId,
        text,
        formattedTextHtml,
        attachments,
      });

  return handleTelegramMessageV2({
    message,
    updateId,
    pendingStore,
    repository,
    extractionClient,
    text: resumedTurn.messages.map((item) => item.text).filter(Boolean).join("\n"),
    formattedTextHtml,
    attachments,
    recentContext: resumedTurn.recentContext || buildRecentContextFromPending(operation),
    intentHint,
    debugLog,
    dryRun,
    existingTurn: resumedTurn,
  });
}

export async function handleV2PendingResponse({
  message,
  updateId,
  pendingStore,
  pending,
  repository,
  extractionClient,
  text,
  formattedTextHtml,
  attachments = [],
  debugLog,
  dryRun,
}) {
  const operation = pending.operation || {};

  if (pending.state === "awaiting_confirmation" && operation.type === "v2_content_operation") {
    return resumeV2Turn({
      operation,
      message,
      updateId,
      pendingStore,
      repository,
      extractionClient,
      text,
      formattedTextHtml,
      attachments,
      intentHint: operation.intentHint || operation.turn?.recentContext?.activeSession?.intent || null,
      debugLog,
      dryRun,
    });
  }

  return handleV2ClarificationResponse({
    message,
    updateId,
    pendingStore,
    pending,
    repository,
    extractionClient,
    text,
    formattedTextHtml,
    attachments,
    debugLog,
    dryRun,
  });
}

export async function handleBufferedV2PendingTurn({
  message,
  updateId,
  pendingStore,
  pending,
  repository,
  extractionClient,
  debugLog,
  dryRun,
}) {
  const operation = pending.operation || {};
  const turn = operation.turn;
  if (!turn) {
    throw new Error("Buffered v2 pending turn is missing turn context.");
  }

  const latestEntry = Array.isArray(turn.messages) && turn.messages.length > 0
    ? turn.messages[turn.messages.length - 1]
    : null;
  const latestText = latestEntry?.text || null;
  const latestFormattedTextHtml = latestEntry?.formattedTextHtml || null;
  const latestAttachments = Array.isArray(latestEntry?.attachments) ? latestEntry.attachments : [];

  if (pending.state === "awaiting_confirmation" && operation.type === "v2_content_operation") {
    return handleTelegramMessageV2({
      message,
      updateId,
      pendingStore,
      repository,
      extractionClient,
      text: turn.messages.map((item) => item.text).filter(Boolean).join("\n"),
      formattedTextHtml: latestFormattedTextHtml,
      attachments: latestAttachments,
      recentContext: turn.recentContext || buildRecentContextFromPending(operation),
      intentHint: operation.intentHint || turn.recentContext?.activeSession?.intent || null,
      debugLog,
      dryRun,
      existingTurn: turn,
    });
  }

  return handleV2ClarificationResponse({
    message,
    updateId,
    pendingStore,
    pending,
    repository,
    extractionClient,
    text: latestText,
    formattedTextHtml: latestFormattedTextHtml,
    attachments: latestAttachments,
    debugLog,
    dryRun,
    useExistingTurn: true,
  });
}

export async function handleV2ClarificationResponse({
  message,
  updateId,
  pendingStore,
  pending,
  repository,
  extractionClient,
  text,
  formattedTextHtml,
  attachments = [],
  debugLog,
  dryRun,
  useExistingTurn = false,
}) {
  const operation = pending.operation || {};

  if (operation.type === "v2_intent_clarification") {
    const resumedTurn = useExistingTurn
      ? operation.turn
      : appendTurnMessage(operation.turn, {
          message,
          updateId,
          text,
          formattedTextHtml,
          attachments,
        });
    const turnWithSession = applyActiveSessionToTurn(
      resumedTurn,
      buildActiveSession({
        phase: "awaiting_clarification",
        intent: operation.intent,
        question: pending.question,
      })
    );
    await writeDebugLog(debugLog, "telegram_v2_clarification_resume", turnWithSession, {
      clarificationType: operation.type,
      pendingQuestion: pending.question,
      intentHint: operation.intent || null,
    });
    const nextIntent = mergeClarifiedIntent(
      operation.intent,
      await analyzeIntent({
        turn: turnWithSession,
        extractionClient,
        debugContext: buildTurnDebugContext(turnWithSession),
      })
    );

    if (nextIntent.needsClarification) {
      const nextTurn = applyActiveSessionToTurn(
        turnWithSession,
        buildActiveSession({
          phase: "awaiting_clarification",
          intent: nextIntent,
          question: nextIntent.clarificationQuestion,
        })
      );
      const nextPending = createPendingRecord({
        chatId: nextTurn.chatId,
        userId: nextTurn.userId,
        state: "awaiting_clarification",
        sourceMessageId: message.message_id ?? null,
        sourceUpdateId: updateId,
        question: nextIntent.clarificationQuestion,
        operation: {
          type: "v2_intent_clarification",
          turn: nextTurn,
          intent: nextIntent,
        },
      });

      await pendingStore.setPending(nextTurn.chatId, nextPending);
      await writeDebugLog(debugLog, "telegram_v2_clarification_pending", nextTurn, {
        clarificationType: nextPending.operation?.type || null,
        question: nextPending.question,
        intent: nextIntent,
      });

      return {
        status: "clarification",
        chatId: nextTurn.chatId,
        fromUserId: nextTurn.userId,
        question: nextPending.question,
        pendingState: nextPending,
      };
    }

    const resolution = await resolveTargets({ intent: nextIntent, repository });
    if (!resolution.ok) {
      const nextTurn = applyActiveSessionToTurn(
        turnWithSession,
        buildActiveSession({
          phase: "awaiting_clarification",
          intent: nextIntent,
          question: resolution.clarification.question,
        })
      );
      const nextPending = createPendingRecord({
        chatId: nextTurn.chatId,
        userId: nextTurn.userId,
        state: "awaiting_clarification",
        sourceMessageId: message.message_id ?? null,
        sourceUpdateId: updateId,
        question: resolution.clarification.question,
        operation: {
          type: "v2_target_clarification",
          turn: nextTurn,
          intent: nextIntent,
          clarification: resolution.clarification,
        },
      });

      await pendingStore.setPending(nextTurn.chatId, nextPending);
      await writeDebugLog(debugLog, "telegram_v2_clarification_pending", nextTurn, {
        clarificationType: nextPending.operation?.type || null,
        question: nextPending.question,
        intent: nextIntent,
      });

      return {
        status: "clarification",
        chatId: nextTurn.chatId,
        fromUserId: nextTurn.userId,
        question: nextPending.question,
        pendingState: nextPending,
      };
    }

    const entitySchema = getEntitySchema(nextIntent.entity);
    const nextOperation = await generateOperation({
      turn: turnWithSession,
      resolved: resolution.resolved,
      extractionClient,
      entitySchema,
      debugContext: buildTurnDebugContext(turnWithSession),
    });

    return finalizeV2Operation({
      message,
      updateId,
      pendingStore,
      repository,
      turn: turnWithSession,
      intent: nextIntent,
      operation: nextOperation,
      resolved: resolution.resolved,
      attachments,
      debugLog,
      dryRun,
    });
  }

  if (operation.type === "v2_target_clarification") {
    const options = Array.isArray(operation.clarification?.options) ? operation.clarification.options : [];
    const selected = parseClarificationSelection(text, options);
    const nextIntent = {
      ...operation.intent,
      target: {
        ...(operation.intent?.target || {}),
        ref: selected?.slug || (typeof text === "string" && text.trim() ? text.trim() : operation.intent?.target?.ref || null),
      },
    };
    const resumedTurn = useExistingTurn
      ? operation.turn
      : appendTurnMessage(operation.turn, {
          message,
          updateId,
          text,
          formattedTextHtml,
          attachments,
        });
    const turnWithSession = applyActiveSessionToTurn(
      resumedTurn,
      buildActiveSession({
        phase: "awaiting_clarification",
        intent: nextIntent,
        question: pending.question,
      })
    );
    await writeDebugLog(debugLog, "telegram_v2_clarification_resume", turnWithSession, {
      clarificationType: operation.type,
      pendingQuestion: pending.question,
      intentHint: nextIntent,
    });

    const resolution = await resolveTargets({
      intent: nextIntent,
      repository,
    });

    if (!resolution.ok) {
      const nextTurn = applyActiveSessionToTurn(
        turnWithSession,
        buildActiveSession({
          phase: "awaiting_clarification",
          intent: nextIntent,
          question: resolution.clarification.question,
        })
      );
      const nextPending = createPendingRecord({
        chatId: nextTurn.chatId,
        userId: nextTurn.userId,
        state: "awaiting_clarification",
        sourceMessageId: message.message_id ?? null,
        sourceUpdateId: updateId,
        question: resolution.clarification.question,
        operation: {
          ...operation,
          intent: nextIntent,
          clarification: resolution.clarification,
          turn: nextTurn,
        },
      });

      await pendingStore.setPending(nextTurn.chatId, nextPending);
      await writeDebugLog(debugLog, "telegram_v2_clarification_pending", nextTurn, {
        clarificationType: nextPending.operation?.type || null,
        question: nextPending.question,
        intent: nextIntent,
      });

      return {
        status: "clarification",
        chatId: nextTurn.chatId,
        fromUserId: nextTurn.userId,
        question: nextPending.question,
        pendingState: nextPending,
      };
    }

    const entitySchema = getEntitySchema(nextIntent.entity);
    const nextOperation = await generateOperation({
      turn: turnWithSession,
      resolved: resolution.resolved,
      extractionClient,
      entitySchema,
      debugContext: buildTurnDebugContext(turnWithSession),
    });

    return finalizeV2Operation({
      message,
      updateId,
      pendingStore,
      repository,
      turn: turnWithSession,
      intent: nextIntent,
      operation: nextOperation,
      resolved: resolution.resolved,
      attachments,
      debugLog,
      dryRun,
    });
  }

  if (operation.type === "v2_incomplete_operation") {
    return resumeV2Turn({
      operation,
      message,
      updateId,
      pendingStore,
      repository,
      extractionClient,
      text,
      formattedTextHtml,
      attachments,
      intentHint: operation.intentHint || operation.turn?.recentContext?.activeSession?.intent || null,
      debugLog,
      dryRun,
      useExistingTurn,
    });
  }

  throw new Error(`Unsupported v2 clarification type '${operation.type}'.`);
}

export async function handleTelegramMessageV2({
  message,
  updateId,
  pendingStore,
  repository,
  extractionClient,
  text,
  formattedTextHtml,
  attachments = [],
  recentContext = null,
  intentHint = null,
  debugLog = null,
  dryRun,
  existingTurn = null,
}) {
  const turn = collectTurn({
    message,
    updateId,
    text,
    formattedTextHtml,
    recentContext,
    attachments,
    existingTurn,
  });
  await writeDebugLog(debugLog, "telegram_v2_turn_received", turn, {
    intentHint: intentHint || null,
  });

  const intent = mergeClarifiedIntent(
    intentHint,
    await analyzeIntent({
      turn,
      extractionClient,
      debugContext: buildTurnDebugContext(turn),
    })
  );
  await writeDebugLog(debugLog, "telegram_v2_intent_result", turn, {
    intent,
  });

  if (intent.needsClarification) {
    const turnWithSession = applyActiveSessionToTurn(
      turn,
      buildActiveSession({
        phase: "awaiting_clarification",
        intent,
        question: intent.clarificationQuestion,
      })
    );
    const pending = createPendingRecord({
      chatId: turnWithSession.chatId,
      userId: turnWithSession.userId,
      state: "awaiting_clarification",
      sourceMessageId: message.message_id ?? null,
      sourceUpdateId: updateId,
      question: intent.clarificationQuestion,
      operation: {
        type: "v2_intent_clarification",
        turn: turnWithSession,
        intent,
      },
    });

    await pendingStore.setPending(turnWithSession.chatId, pending);
    await writeDebugLog(debugLog, "telegram_v2_clarification_pending", turnWithSession, {
      clarificationType: pending.operation?.type || null,
      question: pending.question,
      intent,
    });

    return {
      status: "clarification",
      chatId: turnWithSession.chatId,
      fromUserId: turnWithSession.userId,
      question: pending.question,
      pendingState: pending,
    };
  }

  const resolution = await resolveTargets({ intent, repository });
  if (!resolution.ok) {
    const turnWithSession = applyActiveSessionToTurn(
      turn,
      buildActiveSession({
        phase: "awaiting_clarification",
        intent,
        question: resolution.clarification.question,
      })
    );
    const pending = createPendingRecord({
      chatId: turnWithSession.chatId,
      userId: turnWithSession.userId,
      state: "awaiting_clarification",
      sourceMessageId: message.message_id ?? null,
      sourceUpdateId: updateId,
      question: resolution.clarification.question,
      operation: {
        type: "v2_target_clarification",
        turn: turnWithSession,
        intent,
        clarification: resolution.clarification,
      },
    });

    await pendingStore.setPending(turnWithSession.chatId, pending);
    await writeDebugLog(debugLog, "telegram_v2_clarification_pending", turnWithSession, {
      clarificationType: pending.operation?.type || null,
      question: pending.question,
      intent,
      clarification: resolution.clarification,
    });

    return {
      status: "clarification",
      chatId: turnWithSession.chatId,
      fromUserId: turnWithSession.userId,
      question: pending.question,
      pendingState: pending,
    };
  }

  const entitySchema = getEntitySchema(intent.entity);
  const operation = await generateOperation({
    turn,
    resolved: resolution.resolved,
    extractionClient,
    entitySchema,
  });
  await writeDebugLog(debugLog, "telegram_v2_operation_result", turn, {
    intent,
    resolved: resolution.resolved,
    operation,
  });

  return finalizeV2Operation({
    message,
    updateId,
    pendingStore,
    repository,
    turn,
    intent,
    operation,
    resolved: resolution.resolved,
    attachments,
    debugLog,
    dryRun,
  });
}
