import {
  createPendingRecord,
  extractEditInstruction,
  isConfirmationDecision,
  isEditRequest,
  isPendingExpired,
  normalizeConfirmationDecision,
} from "../../core/confirmation-flow.js";
import { validateOperation } from "../../core/operation-validator.js";
import { buildOperationPreview } from "../../core/preview-builder.js";
import { mapOperationToContent } from "../../core/content-mapper.js";
import { extractTelegramAttachments } from "./attachments.js";
import { inferHeuristicExtraction } from "./heuristic-intent.js";

const CONFIRM_TRANSLATION_TIMEOUT_MS = 4000;

export async function handleTelegramMessage({
  message,
  updateId,
  allowedUserId,
  repository,
  pendingStore,
  photoStore,
  extractionClient,
  translationClient,
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
  const formattedTextHtml = extractFormattedMessageHtml(message);

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
      translationClient,
      dryRun,
    });
  }

  if (existingPending?.state === "awaiting_edit") {
    return handleEditInstruction({
      instruction: text,
      chatId,
      fromUserId,
      updateId,
      messageId: message.message_id ?? null,
      pendingStore,
      pending: existingPending,
      repository,
      extractionClient,
    });
  }

  if (isEditRequest(text)) {
    return handleEditRequest({
      text,
      chatId,
      fromUserId,
      updateId,
      messageId: message.message_id ?? null,
      pendingStore,
      pending: existingPending,
      repository,
      extractionClient,
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
        formattedTextHtml,
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
      requestText: text,
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
  let mapped = mapOperationToContent(operation);

  if (!dryRun && operation.action !== "delete" && translationClient && mapped.item) {
    const preview = await repository.previewCommand(operation, mapped);
    const translationOutcome = await translatePendingItemSafely({
      translationClient,
      entity: operation.entity,
      item: preview.nextItem,
      sourceLocale: operation.fields.sourceLocale || "ru",
      timeoutMs: CONFIRM_TRANSLATION_TIMEOUT_MS,
    });

    if (translationOutcome.ok) {
      mapped = {
        ...mapped,
        item: translationOutcome.item,
      };
    } else {
      console.warn(
        JSON.stringify({
          event: "telegram_confirmation_translation_skipped",
          chatId,
          entity: operation.entity,
          action: operation.action,
          slug: operation.fields?.slug ?? null,
          reason: translationOutcome.error,
        })
      );
    }
  }

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

async function translatePendingItemSafely({
  translationClient,
  entity,
  item,
  sourceLocale,
  timeoutMs,
}) {
  try {
    const translatedItem = await withTimeout(
      translationClient.translateItem({
        entity,
        item,
        sourceLocale,
      }),
      timeoutMs,
      `translation timed out after ${timeoutMs}ms`
    );

    return {
      ok: true,
      item: translatedItem,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
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

async function handleEditRequest({
  text,
  chatId,
  fromUserId,
  updateId,
  messageId,
  pendingStore,
  pending,
  repository,
  extractionClient,
  dryRun,
}) {
  if (!pending || isPendingExpired(pending)) {
    if (pending && isPendingExpired(pending)) {
      await pendingStore.deletePending(chatId);
    }

    return {
      status: "clarification",
      chatId,
      fromUserId,
      question: "There is no active preview to edit. Start with a content change request first.",
    };
  }

  if (pending.state !== "awaiting_confirmation" || pending.operation?.type === "undo") {
    return {
      status: "clarification",
      chatId,
      fromUserId,
      question: "This preview cannot be edited. Reply with confirm or cancel, or send a new content change request.",
    };
  }

  const instruction = extractEditInstruction(text);

  if (!instruction) {
    const editPending = createPendingRecord({
      chatId,
      userId: fromUserId,
      state: "awaiting_edit",
      sourceMessageId: messageId,
      sourceUpdateId: updateId,
      operation: pending.operation,
      question: "Specify which field(s) should be edited.",
    });

    await pendingStore.setPending(chatId, editPending);

    return {
      status: "clarification",
      chatId,
      fromUserId,
      question: "Specify which field(s) should be edited.",
    };
  }

  return handleEditInstruction({
    instruction,
    chatId,
    fromUserId,
    updateId,
    messageId,
    pendingStore,
    pending,
    repository,
    extractionClient,
  });
}

async function handleEditInstruction({
  instruction,
  chatId,
  fromUserId,
  updateId,
  messageId,
  pendingStore,
  pending,
  repository,
  extractionClient,
}) {
  const extractionResult = await extractionClient.extractIntent({
    messageText: instruction,
    pendingState: "editing_pending_preview",
    pendingOperation: {
      entity: pending.operation.entity,
      action: pending.operation.action,
      slug: pending.operation.slug,
      fields: pending.operation.fields,
      summary: pending.operation.summary ?? null,
      requestText: pending.operation.requestText ?? null,
    },
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
      status: "clarification",
      chatId,
      fromUserId,
      question: "I couldn't understand what to edit. Name the fields and new values you want to change.",
    };
  }

  const pendingFields = pending.operation.fields || {};
  const editFields = normalizeExtractionToOperation(extraction, instruction).fields || {};
  const mergedFields = {
    ...pendingFields,
    ...editFields,
    slug:
      normalizeSlug(editFields.slug) ||
      normalizeSlug(pendingFields.slug) ||
      normalizeSlug(pending.operation.slug),
  };

  const editedOperation = validateOperation({
    entity: pending.operation.entity,
    action: pending.operation.action,
    fields: mergedFields,
  });
  const mapped = mapOperationToContent(editedOperation);
  const repositoryPreview = await repository.previewCommand(editedOperation, mapped);
  const preview = buildOperationPreview(editedOperation, repositoryPreview, {
    attachments: pending.operation.attachments ?? [],
  });
  const newPending = createPendingRecord({
    chatId,
    userId: fromUserId,
    state: "awaiting_confirmation",
    sourceMessageId: messageId,
    sourceUpdateId: updateId,
    operation: {
      ...pending.operation,
      entity: editedOperation.entity,
      action: editedOperation.action,
      slug: editedOperation.fields.slug,
      summary: extraction.summary || pending.operation.summary || null,
      requestText: pending.operation.requestText ?? null,
      fields: editedOperation.fields,
      preview,
    },
  });

  await pendingStore.setPending(chatId, newPending);

  return {
    status: "processed",
    fromUserId,
    chatId,
    parsed: editedOperation,
    extraction,
    operation: repositoryPreview,
    pendingState: newPending,
  };
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

function normalizeExtractionToOperation(extraction, sourceText = "") {
  const enrichedFields = enrichContactFields(extraction.entity, extraction.fields ?? {}, sourceText);
  const derivedSlug = normalizeSlug(extraction.slug ?? extraction.fields?.slug ?? null);

  return {
    entity: extraction.entity === "announcement" ? "announce" : extraction.entity,
    action: extraction.action,
    fields: {
      ...enrichedFields,
      photoStagedPath: enrichedFields.photoStagedPath ?? null,
      slug:
        derivedSlug ||
        normalizeSlug(enrichedFields.handle) ||
        normalizeSlug(enrichedFields.name) ||
        normalizeSlug(enrichedFields.title),
    },
  };
}

function enrichContactFields(entity, fields, sourceText) {
  const enriched = { ...fields };
  const discoveredLinks = extractLinksFromText(sourceText);

  if (entity === "participant" && !enriched.handle) {
    const telegramLink = discoveredLinks.find((link) => /^https:\/\/t\.me\//i.test(link.href));
    if (telegramLink?.href) {
      const username = telegramLink.href.replace(/^https:\/\/t\.me\//i, "").replace(/\/+$/, "");
      if (username) {
        enriched.handle = `@${username}`;
      }
    }
  }

  const mergedLinks = mergeLinkEntries(enriched.links, discoveredLinks, enriched.handle);
  if (mergedLinks.length) {
    enriched.links = mergedLinks;
  }

  return enriched;
}

function extractLinksFromText(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return [];
  }

  const results = [];
  const urlPattern = /\bhttps?:\/\/[^\s<>()]+/gi;

  for (const match of text.matchAll(urlPattern)) {
    const href = match[0].replace(/[),.;:!?]+$/, "");
    results.push({
      label: inferLinkLabel(href),
      href,
      external: true,
    });
  }

  const telegramHandlePattern = /(^|[\s(])@([A-Za-z0-9_]{4,})\b/g;
  for (const match of text.matchAll(telegramHandlePattern)) {
    const username = match[2];
    results.push({
      label: "Telegram",
      href: `https://t.me/${username}`,
      external: true,
    });
  }

  return dedupeLinks(results);
}

function inferLinkLabel(href) {
  const lower = href.toLowerCase();

  if (lower.includes("t.me/")) {
    return "Telegram";
  }

  if (lower.includes("linkedin.com/")) {
    return "LinkedIn";
  }

  if (lower.includes("x.com/") || lower.includes("twitter.com/")) {
    return "X / Twitter";
  }

  if (lower.includes("github.com/")) {
    return "GitHub";
  }

  try {
    const url = new URL(href);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "Link";
  }
}

function mergeLinkEntries(existingLinks, discoveredLinks, handle) {
  const combined = [];

  if (Array.isArray(existingLinks)) {
    combined.push(...existingLinks);
  }

  if (Array.isArray(discoveredLinks)) {
    combined.push(...discoveredLinks);
  }

  const username = typeof handle === "string" ? handle.trim().replace(/^@+/, "") : "";
  const normalizedTelegramHref = username ? `https://t.me/${username}` : null;

  return dedupeLinks(
    combined.filter((link) => {
      if (!link?.href || !link?.label) {
        return false;
      }

      if (normalizedTelegramHref && link.href === normalizedTelegramHref && /^telegram$/i.test(link.label)) {
        return false;
      }

      return true;
    })
  );
}

function dedupeLinks(links) {
  const seen = new Set();
  const deduped = [];

  for (const link of links) {
    const key = `${link.label}::${link.href}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(link);
  }

  return deduped;
}

async function buildOperationFromExtraction({ extraction, repository, extractionClient, messageText }) {
  let baseOperation = normalizeExtractionToOperation(extraction, messageText);

  if (
    repository &&
    typeof repository.findEntityBySlug === "function" &&
    baseOperation.action !== "create" &&
    baseOperation.fields.slug
  ) {
    const actualEntity = await repository.findEntityBySlug(baseOperation.fields.slug);

    if (actualEntity && actualEntity !== baseOperation.entity) {
      baseOperation = {
        ...baseOperation,
        entity: actualEntity,
      };
    }
  }

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
        detailsHtml: currentItem.detailsHtml,
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
