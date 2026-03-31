import {
  createPendingRecord,
  isConfirmationDecision,
  isPendingExpired,
  normalizeConfirmationDecision,
} from "../../core/confirmation-flow.js";
import { validateOperation } from "../../core/operation-validator.js";
import { buildOperationPreview } from "../../core/preview-builder.js";
import { mapOperationToContent } from "../../core/content-mapper.js";
import { extractTelegramAttachments } from "./attachments.js";
import { inferHeuristicExtraction } from "./heuristic-intent.js";

export async function handleTelegramMessage({
  message,
  updateId,
  allowedUserId,
  repository,
  pendingStore,
  photoStore,
  extractionClient,
  telegramClient,
  dryRun = true,
}) {
  const fromUserId = message.from?.id || null;
  const chatId = message.chat?.id || fromUserId;
  const rawAttachments = extractTelegramAttachments(message);

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

  if (isUndoRequest(text)) {
    return handleUndoRequest({
      chatId,
      fromUserId,
      updateId,
      messageId: message.message_id ?? null,
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

  const heuristicExtraction = inferHeuristicExtraction(text);
  const extractionResult = heuristicExtraction
    ? {
        ok: true,
        usedModel: "heuristic",
        attempts: 0,
        extraction: heuristicExtraction,
      }
    : await extractionClient.extractIntent({
        messageText: text,
        hasPhoto: Boolean(message.photo?.length),
        photoCount: Array.isArray(message.photo) ? message.photo.length : 0,
        attachments,
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

  const normalizedOperationResult = await buildOperationFromExtraction({
    extraction,
    repository,
    extractionClient,
    messageText: text,
  });

  if (!normalizedOperationResult.ok) {
    return {
      status: "clarification",
      chatId,
      fromUserId,
      question: normalizedOperationResult.question,
      extraction,
    };
  }

  const normalizedOperation = normalizedOperationResult.operation;
  const validated = validateOperation(normalizedOperation);
  const photo = await planOrApplyStagedPhoto({
    photoStore,
    entity: validated.entity,
    slug: validated.fields.slug,
    stagedPath: validated.fields.photoStagedPath ?? null,
    dryRun,
  });
  const mapped = mapOperationToContent(validated, {
    photoFilename: photo?.filename || null,
  });
  const repositoryPreview = dryRun
    ? await repository.previewCommand(validated, mapped)
    : await repository.previewCommand(validated, mapped);
  const preview = buildOperationPreview(validated, repositoryPreview, {
    attachments,
  });
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
      attachments,
      photo: {
        hasPhoto: Boolean(photo) || attachments.some((attachment) => attachment.kind === "photo"),
        telegramFileIds: attachments.map((attachment) => attachment.fileId).filter(Boolean),
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
    await cleanupStagedAttachments(repository, pending.operation?.attachments ?? []);
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

  if (pending.operation?.type === "undo") {
    const writeResult = dryRun
      ? await repository.previewUndoLastChange(pending.operation.undoTarget)
      : await repository.applyUndoLastChange(pending.operation.undoTarget);

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

  const operation = {
    entity: pending.operation.entity,
    action: pending.operation.action,
    fields: pending.operation.fields,
  };
  const mapped = mapOperationToContent(operation);
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

function normalizeExtractionToOperation(extraction) {
  const derivedSlug = normalizeSlug(extraction.slug ?? extraction.fields?.slug ?? null);

  return {
    entity: extraction.entity === "announcement" ? "announce" : extraction.entity,
    action: extraction.action,
    fields: {
      ...extraction.fields,
      photoStagedPath: extraction.fields?.photoStagedPath ?? null,
      slug:
        derivedSlug ||
        normalizeSlug(extraction.fields?.handle) ||
        normalizeSlug(extraction.fields?.name) ||
        normalizeSlug(extraction.fields?.title),
    },
  };
}

async function buildOperationFromExtraction({ extraction, repository, extractionClient, messageText }) {
  const baseOperation = normalizeExtractionToOperation(extraction);

  if (baseOperation.action === "create") {
    return {
      ok: true,
      operation: baseOperation,
    };
  }

  const resolvedSlug =
    baseOperation.fields.slug ||
    (await resolveExistingSlug({
      repository,
      entity: baseOperation.entity,
      fields: extraction.fields,
      targetRef: extraction.targetRef,
      extractionClient,
      messageText,
    }));

  if (!resolvedSlug) {
    return {
      ok: false,
      question: `I couldn't find which ${baseOperation.entity} you want to ${baseOperation.action}. Tell me the exact name, handle, or slug.`,
    };
  }

  const operationWithSlug = {
    ...baseOperation,
    fields: {
      ...baseOperation.fields,
      slug: resolvedSlug,
    },
  };

  if (baseOperation.action !== "update") {
    return {
      ok: true,
      operation: operationWithSlug,
    };
  }

  const currentItem = await repository.readItem(operationWithSlug.entity, operationWithSlug.fields.slug);
  const mergedFields = mergeExistingFields(operationWithSlug.entity, currentItem, extraction.fields);

  return {
    ok: true,
    operation: {
      ...operationWithSlug,
      fields: {
        ...mergedFields,
        slug: operationWithSlug.fields.slug,
      },
    },
  };
}

async function resolveExistingSlug({
  repository,
  entity,
  fields,
  targetRef,
  extractionClient,
  messageText,
}) {
  const candidates = await repository.listEntityCandidates(entity);

  if (candidates.length === 0) {
    return null;
  }

  const normalizedCandidates = new Set(
    [
      targetRef,
      fields?.slug,
      fields?.handle,
      fields?.name,
      fields?.title,
    ]
      .map((value) => normalizeSlug(value))
      .filter(Boolean)
  );

  for (const candidate of candidates) {
    const candidateKeys = [candidate.slug, candidate.label, candidate.handle, candidate.title]
      .map((value) => normalizeSlug(value))
      .filter(Boolean);

    if (candidateKeys.some((candidateKey) => normalizedCandidates.has(candidateKey))) {
      return candidate.slug;
    }
  }

  if (extractionClient && typeof extractionClient.resolveTarget === "function") {
    const resolutionResult = await extractionClient.resolveTarget({
      entity,
      targetRef:
        targetRef ||
        fields?.handle ||
        fields?.name ||
        fields?.title ||
        messageText,
      candidates,
      messageText,
    });

    if (resolutionResult.ok && resolutionResult.resolution?.matchedSlug) {
      return resolutionResult.resolution.matchedSlug;
    }
  }

  return null;
}

function mergeExistingFields(entity, currentItem, newFields) {
  switch (entity) {
    case "participant":
      return {
        handle: currentItem.handle,
        name: currentItem.name,
        role: currentItem.role,
        bio: currentItem.bio,
        points: currentItem.points,
        location: currentItem.location,
        tags: currentItem.tags,
        links: currentItem.links,
        photoAlt: currentItem.photo?.alt,
        photoStagedPath: currentItem.photo?.src,
        ...newFields,
      };
    case "project":
      return {
        title: currentItem.title,
        status: currentItem.status,
        stack: currentItem.stack,
        summary: currentItem.summary,
        points: currentItem.points,
        location: currentItem.location,
        tags: currentItem.tags,
        ownerSlugs: currentItem.ownerSlugs,
        links: currentItem.links,
        photoAlt: currentItem.photo?.alt,
        photoStagedPath: currentItem.photo?.src,
        ...newFields,
      };
    case "meeting":
    case "announce":
      return {
        date: currentItem.date,
        title: currentItem.title,
        place: currentItem.place,
        placeUrl: currentItem.placeUrl,
        format: currentItem.format,
        paragraphs: currentItem.paragraphs,
        sections: currentItem.sections,
        links: currentItem.links,
        photoAlt: currentItem.photo?.alt,
        photoStagedPath: currentItem.photo?.src,
        ...newFields,
      };
    default:
      return {
        ...currentItem,
        ...newFields,
      };
  }
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

async function planOrApplyStagedPhoto({
  photoStore,
  entity,
  slug,
  stagedPath,
  dryRun,
}) {
  if (!stagedPath) {
    return null;
  }

  if (dryRun) {
    if (typeof photoStore.planStagedPhoto === "function") {
      return photoStore.planStagedPhoto(entity, slug, stagedPath);
    }

    return photoStore.planPhoto(entity, slug, stagedPath);
  }

  if (typeof photoStore.applyStagedPhoto === "function") {
    return photoStore.applyStagedPhoto(entity, slug, stagedPath);
  }

  return photoStore.applyPhoto(entity, slug, stagedPath);
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

function isUndoRequest(text) {
  return typeof text === "string" && text.trim().toLowerCase() === "undo";
}
