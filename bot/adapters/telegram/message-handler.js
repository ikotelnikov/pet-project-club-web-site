import {
  createPendingRecord,
  isConfirmationDecision,
  isPendingExpired,
  normalizeConfirmationDecision,
} from "../../core/confirmation-flow.js";
import { validateOperation } from "../../core/operation-validator.js";
import { buildOperationPreview } from "../../core/preview-builder.js";
import { mapOperationToContent } from "../../core/content-mapper.js";

export async function handleTelegramMessage({
  message,
  updateId,
  allowedUserId,
  repository,
  pendingStore,
  photoStore,
  extractionClient,
  dryRun = true,
}) {
  const fromUserId = message.from?.id || null;
  const chatId = message.chat?.id || fromUserId;

  if (allowedUserId != null && fromUserId !== allowedUserId) {
    return {
      status: "ignored",
      reason: "unauthorized-user",
      fromUserId,
      chatId,
    };
  }

  const text = extractMessageText(message);

  if (!text) {
    return {
      status: "ignored",
      reason: "no-command",
      fromUserId,
      chatId,
    };
  }

  const existingPending = await pendingStore.getPending(chatId);

  if (existingPending && isPendingExpired(existingPending)) {
    await pendingStore.deletePending(chatId);
  }

  if (isConfirmationDecision(text)) {
    return handleConfirmationDecision({
      text,
      chatId,
      fromUserId,
      pendingStore,
      pending: existingPending,
      repository,
      photoStore,
      dryRun,
    });
  }

  const extractionResult = await extractionClient.extractIntent({
    messageText: text,
    hasPhoto: Boolean(message.photo?.length),
    photoCount: Array.isArray(message.photo) ? message.photo.length : 0,
    pendingState: existingPending ? existingPending.state : null,
    allowedEntityTypes: ["announcement", "meeting", "participant", "project"],
    allowedActions: ["create", "update", "delete"],
  });

  if (!extractionResult.ok) {
    return {
      status: "failed",
      reason: extractionResult.reason,
      error: extractionResult.error ?? null,
      rawText: extractionResult.rawText ?? null,
      usedModel: extractionResult.usedModel ?? null,
      attempts: extractionResult.attempts ?? null,
      chatId,
      fromUserId,
    };
  }

  const extraction = extractionResult.extraction;

  if (extraction.intent !== "content_operation") {
    return {
      status: "ignored",
      reason: extraction.intent === "non_actionable" ? "no-command" : extraction.intent,
      chatId,
      fromUserId,
      extraction,
    };
  }

  const normalizedOperation = normalizeExtractionToOperation(extraction);
  const validated = validateOperation(normalizedOperation);
  const photo = await (dryRun
    ? photoStore.planPhoto(validated.entity, validated.fields.slug, null)
    : photoStore.applyPhoto(validated.entity, validated.fields.slug, null));
  const mapped = mapOperationToContent(validated, {
    photoFilename: photo?.filename || null,
  });
  const repositoryPreview = dryRun
    ? await repository.previewCommand(validated, mapped)
    : await repository.previewCommand(validated, mapped);
  const preview = buildOperationPreview(validated, repositoryPreview);
  const newPending = createPendingRecord({
    chatId,
    userId: fromUserId,
    state: "awaiting_confirmation",
    sourceMessageId: message.message_id ?? null,
    sourceUpdateId: updateId,
    operation: {
      entity: validated.entity,
      action: validated.action,
      slug: validated.fields.slug,
      confidence: extraction.confidence,
      summary: extraction.summary,
      fields: validated.fields,
      warnings: extraction.warnings,
      photo: {
        hasPhoto: Boolean(photo),
        telegramFileIds: [],
      },
      preview,
    },
  });

  await pendingStore.setPending(chatId, newPending);

  return {
    status: "processed",
    fromUserId,
    chatId,
    parsed: validated,
    extraction,
    operation: repositoryPreview,
    pendingState: newPending,
  };
}

export function extractMessageText(message) {
  const text = typeof message.text === "string" && message.text.trim() ? message.text : null;
  const caption = typeof message.caption === "string" && message.caption.trim() ? message.caption : null;
  return text || caption || null;
}

export function extractCommandText(message) {
  const candidate = extractMessageText(message);
  return candidate && candidate.trim().startsWith("/") ? candidate : null;
}

async function handleConfirmationDecision({
  text,
  chatId,
  fromUserId,
  pendingStore,
  pending,
  repository,
  photoStore,
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
    await pendingStore.deletePending(chatId);
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

  const operation = {
    entity: pending.operation.entity,
    action: pending.operation.action,
    fields: pending.operation.fields,
  };
  const photo = await (dryRun
    ? photoStore.planPhoto(operation.entity, operation.fields.slug, null)
    : photoStore.applyPhoto(operation.entity, operation.fields.slug, null));
  const mapped = mapOperationToContent(operation, {
    photoFilename: photo?.filename || null,
  });
  const writeResult = dryRun
    ? await repository.previewCommand(operation, mapped)
    : await repository.applyCommand(operation, mapped);

  await pendingStore.deletePending(chatId);

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

function normalizeExtractionToOperation(extraction) {
  const derivedSlug = normalizeSlug(extraction.slug ?? extraction.fields?.slug ?? null);

  return {
    entity: extraction.entity === "announcement" ? "announce" : extraction.entity,
    action: extraction.action,
    fields: {
      ...extraction.fields,
      slug:
        derivedSlug ||
        normalizeSlug(extraction.fields?.handle) ||
        normalizeSlug(extraction.fields?.name) ||
        normalizeSlug(extraction.fields?.title),
    },
  };
}

function normalizeSlug(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || null;
}
