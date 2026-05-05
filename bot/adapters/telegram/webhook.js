import { buildTelegramReply } from "./reply-text.js";

const TELEGRAM_PROCESSING_ACK_TEXT = "Processing...";

export async function handleTelegramWebhookRequest({
  request,
  runtime,
  webhookSecret = null,
  adminToken = null,
  dryRun = true,
  executionCtx = null,
}) {
  const url = new URL(request.url);

  if (request.method === "GET") {
    if (url.pathname === "/health") {
      return jsonResponse(200, {
        ok: true,
        mode: "webhook",
      });
    }

    if (url.pathname === "/admin/logs") {
      return handleAdminLogsRequest({
        request,
        runtime,
        adminToken,
      });
    }
  }

  if (request.method === "POST" && url.pathname === "/admin/translation-job") {
    return handleAdminTranslationJobRequest({
      request,
      runtime,
      adminToken,
      executionCtx,
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: "Method not allowed.",
    });
  }

  if (url.pathname !== "/telegram/webhook") {
    return jsonResponse(404, {
      ok: false,
      error: "Not found.",
    });
  }

  if (webhookSecret) {
    const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token");

    if (receivedSecret !== webhookSecret) {
      return jsonResponse(401, {
        ok: false,
        error: "Invalid webhook secret.",
      });
    }
  }

  let update;

  try {
    update = await request.json();
  } catch {
    return jsonResponse(400, {
      ok: false,
      error: "Invalid JSON payload.",
    });
  }

  if (
    !update ||
    typeof update !== "object" ||
    typeof update.update_id !== "number" ||
    (!update.message && !update.callback_query)
  ) {
    return jsonResponse(400, {
      ok: false,
      error: "Unsupported Telegram update payload.",
    });
  }

  const incomingMessage = update.message ?? update.callback_query?.message ?? null;
  const callbackData =
    typeof update.callback_query?.data === "string" ? update.callback_query.data : null;
  const normalizedUpdate =
    callbackData && incomingMessage
      ? {
          ...update,
          message: {
            ...incomingMessage,
            from: update.callback_query?.from ?? incomingMessage.from,
            text: callbackData,
          },
        }
      : update;

  try {
    await writeRuntimeLog(runtime, "info", {
      event: "telegram_webhook_received",
      updateId: update.update_id,
      messageId: normalizedUpdate.message?.message_id ?? null,
      chatId: normalizedUpdate.message?.chat?.id ?? null,
      fromUserId: normalizedUpdate.message?.from?.id ?? update.callback_query?.from?.id ?? null,
      payload: {
        hasText: typeof normalizedUpdate.message?.text === "string",
        hasCaption: typeof normalizedUpdate.message?.caption === "string",
        hasPhoto: Array.isArray(normalizedUpdate.message?.photo) && normalizedUpdate.message.photo.length > 0,
        hasCallbackQuery: Boolean(update.callback_query),
        callbackData,
      },
    });

    let callbackAnswered = false;

    if (runtime.telegramClient && update.callback_query?.id) {
      try {
        await runtime.telegramClient.answerCallbackQuery({
          callbackQueryId: update.callback_query.id,
        });
        callbackAnswered = true;
      } catch (callbackError) {
        await writeRuntimeLog(runtime, "error", {
          event: "telegram_callback_answer_failed",
          updateId: update.update_id,
          payload: {
            stage: "before_processing",
            error: callbackError instanceof Error ? callbackError.message : String(callbackError),
          },
        });
      }
    }

    if (
      runtime.telegramClient &&
      !update.callback_query &&
      normalizedUpdate.message?.chat?.id != null &&
      normalizedUpdate.message?.message_id != null
    ) {
      try {
        await runtime.telegramClient.sendMessage({
          chatId: normalizedUpdate.message.chat.id,
          text: TELEGRAM_PROCESSING_ACK_TEXT,
          replyToMessageId: normalizedUpdate.message.message_id,
        });

        await writeRuntimeLog(runtime, "info", {
          event: "telegram_processing_ack_sent",
          updateId: update.update_id,
          messageId: normalizedUpdate.message.message_id,
          chatId: normalizedUpdate.message.chat.id,
          payload: {
            replyLength: TELEGRAM_PROCESSING_ACK_TEXT.length,
          },
        });
      } catch (ackError) {
        await writeRuntimeLog(runtime, "error", {
          event: "telegram_processing_ack_failed",
          updateId: update.update_id,
          messageId: normalizedUpdate.message?.message_id ?? null,
          chatId: normalizedUpdate.message?.chat?.id ?? null,
          payload: {
            error: ackError instanceof Error ? ackError.message : String(ackError),
          },
        });
      }
    }

    const result = await runtime.handleTelegramUpdate(normalizedUpdate, { dryRun });
    const reply = buildTelegramReply(result, {
      dryRun,
      devMode: Boolean(runtime.devMode),
    });
    const replyText = reply.text;

    await writeRuntimeLog(runtime, result?.status === "failed" ? "error" : "info", {
      event: "telegram_webhook_result",
      updateId: update.update_id,
      messageId: normalizedUpdate.message?.message_id ?? null,
      chatId: normalizedUpdate.message?.chat?.id ?? null,
      fromUserId: normalizedUpdate.message?.from?.id ?? update.callback_query?.from?.id ?? null,
      payload: {
        status: result?.status ?? null,
        reason: result?.reason ?? null,
        error: result?.error ?? null,
        rawText: result?.rawText ?? null,
        usedModel: result?.usedModel ?? null,
        attempts: result?.attempts ?? null,
        pendingState: result?.pendingState?.state ?? null,
        extractionIntent: result?.extraction?.intent ?? null,
        extractionConfidence: result?.extraction?.confidence ?? null,
        replyPlanned: Boolean(replyText),
        ...buildResultLogDetails(result),
      },
    });

    if (!callbackAnswered && runtime.telegramClient && update.callback_query?.id) {
      try {
        await runtime.telegramClient.answerCallbackQuery({
          callbackQueryId: update.callback_query.id,
        });
      } catch (callbackError) {
        await writeRuntimeLog(runtime, "error", {
          event: "telegram_callback_answer_failed",
          updateId: update.update_id,
          payload: {
            stage: "after_processing",
            error: callbackError instanceof Error ? callbackError.message : String(callbackError),
          },
        });
      }
    }

    if (replyText && runtime.telegramClient && normalizedUpdate.message?.chat?.id != null) {
      await runtime.telegramClient.sendMessage({
        chatId: normalizedUpdate.message.chat.id,
        text: replyText,
        replyMarkup: reply.replyMarkup,
      });

      await writeRuntimeLog(runtime, "info", {
        event: "telegram_reply_sent",
        updateId: update.update_id,
        chatId: normalizedUpdate.message.chat.id,
        payload: {
          replyLength: replyText.length,
        },
      });
    }

    if (
      result?.status === "confirmed" &&
      result?.translationPlan &&
      typeof runtime.runPostConfirmTranslations === "function"
    ) {
      const translationTask = runTranslationJobChunk({
        request,
        runtime,
        adminToken,
        executionCtx,
        updateId: update.update_id,
        job: buildTranslationJobFromResult(result),
      });

      if (executionCtx && typeof executionCtx.waitUntil === "function") {
        executionCtx.waitUntil(translationTask);
      } else {
        await translationTask;
      }
    }

    return jsonResponse(200, {
      ok: true,
      dryRun,
      result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await writeRuntimeLog(runtime, "error", {
      event: "telegram_webhook_error",
      updateId: update.update_id,
      chatId: incomingMessage?.chat?.id ?? null,
      fromUserId: incomingMessage?.from?.id ?? update.callback_query?.from?.id ?? null,
      payload: {
        error: errorMessage,
      },
    });

    if (runtime.telegramClient && update.callback_query?.id) {
      try {
        await runtime.telegramClient.answerCallbackQuery({
          callbackQueryId: update.callback_query.id,
        });
      } catch {}
    }

    if (runtime.telegramClient && incomingMessage?.chat?.id != null) {
      const failureReply = buildTelegramReply(
        {
          status: "failed",
          reason: "runtime_error",
          error: errorMessage,
        },
        {
          dryRun,
          devMode: Boolean(runtime.devMode),
        }
      );

      if (failureReply.text) {
        try {
          await runtime.telegramClient.sendMessage({
            chatId: incomingMessage.chat.id,
            text: failureReply.text,
            replyMarkup: failureReply.replyMarkup,
          });
        } catch (replyError) {
          await writeRuntimeLog(runtime, "error", {
            event: "telegram_webhook_error_reply_failed",
            updateId: update.update_id,
            chatId: incomingMessage.chat.id,
            payload: {
              error: replyError instanceof Error ? replyError.message : String(replyError),
            },
          });
        }
      }
    }

    return jsonResponse(200, {
      ok: false,
      handled: true,
      error: errorMessage,
    });
  }
}

async function handleAdminTranslationJobRequest({ request, runtime, adminToken, executionCtx }) {
  if (!isAuthorizedAdminRequest(request, adminToken)) {
    return jsonResponse(401, {
      ok: false,
      error: "Invalid admin token.",
    });
  }

  let job;

  try {
    job = normalizeTranslationJob(await request.json());
  } catch (error) {
    return jsonResponse(400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const result = await runTranslationJobChunk({
    request,
    runtime,
    adminToken,
    executionCtx,
    updateId: null,
    job,
  });

  return jsonResponse(200, {
    ok: true,
    result,
  });
}

async function handleAdminLogsRequest({ request, runtime, adminToken }) {
  if (!isAuthorizedAdminRequest(request, adminToken)) {
    return jsonResponse(401, {
      ok: false,
      error: "Invalid admin token.",
    });
  }

  const url = new URL(request.url);
  const logs = await runtime.logStore.listRecent({
    limit: url.searchParams.get("limit") || undefined,
    level: url.searchParams.get("level") || undefined,
    event: url.searchParams.get("event") || undefined,
    since: url.searchParams.get("since") || undefined,
  });

  return jsonResponse(200, {
    ok: true,
    count: logs.length,
    logs,
  });
}

function isAuthorizedAdminRequest(request, adminToken) {
  if (!adminToken) {
    return false;
  }

  const headerToken = request.headers.get("x-admin-token");
  const bearerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  return headerToken === adminToken || bearerToken === adminToken;
}

function buildTranslationJobFromResult(result) {
  return normalizeTranslationJob({
    chatId: result.chatId,
    entity: result.translationPlan?.entity,
    slug: result.translationPlan?.slug,
    sourceLocale: result.translationPlan?.sourceLocale,
    targetLocales: result.translationPlan?.targetLocales || null,
  });
}

function normalizeTranslationJob(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Translation job payload must be an object.");
  }

  const chatId = Number.parseInt(String(value.chatId), 10);
  const targetLocales = Array.isArray(value.targetLocales)
    ? value.targetLocales.filter((locale) => typeof locale === "string" && locale.trim() !== "")
    : null;

  if (!Number.isInteger(chatId)) {
    throw new Error("Translation job requires chatId.");
  }

  if (typeof value.entity !== "string" || value.entity.trim() === "") {
    throw new Error("Translation job requires entity.");
  }

  if (typeof value.slug !== "string" || value.slug.trim() === "") {
    throw new Error("Translation job requires slug.");
  }

  return {
    chatId,
    entity: value.entity.trim(),
    slug: value.slug.trim(),
    sourceLocale: typeof value.sourceLocale === "string" && value.sourceLocale.trim()
      ? value.sourceLocale.trim()
      : null,
    targetLocales,
  };
}

async function runTranslationJobChunk({
  request,
  runtime,
  adminToken,
  executionCtx,
  updateId,
  job,
}) {
  try {
    await writeRuntimeLog(runtime, "info", {
      event: "telegram_translation_job_started",
      updateId,
      chatId: job.chatId,
      payload: {
        entity: job.entity,
        slug: job.slug,
        sourceLocale: job.sourceLocale,
        targetLocales: job.targetLocales,
      },
    });

    const result = await runtime.runPostConfirmTranslations(job, {
      maxLocales: 1,
      log: (level, event, payload) => writeRuntimeLog(runtime, level, {
        event,
        updateId,
        chatId: payload?.chatId ?? job.chatId,
        payload,
      }),
    });

    const remainingLocales = Array.isArray(result?.remainingLocales) ? result.remainingLocales : [];

    await writeRuntimeLog(runtime, "info", {
      event: "telegram_translation_job_finished",
      updateId,
      chatId: job.chatId,
      payload: {
        entity: job.entity,
        slug: job.slug,
        successes: result?.successes || [],
        failures: result?.failures || [],
        remainingLocales,
      },
    });

    if (remainingLocales.length > 0) {
      scheduleNextTranslationJob({
        request,
        runtime,
        adminToken,
        executionCtx,
        job: {
          ...job,
          targetLocales: remainingLocales,
        },
      });
    }

    return result;
  } catch (translationError) {
    await writeRuntimeLog(runtime, "error", {
      event: "telegram_post_confirm_translation_failed",
      updateId,
      chatId: job?.chatId ?? null,
      payload: {
        entity: job?.entity ?? null,
        slug: job?.slug ?? null,
        error: translationError instanceof Error ? translationError.message : String(translationError),
      },
    });

    throw translationError;
  }
}

function scheduleNextTranslationJob({ request, runtime, adminToken, executionCtx, job }) {
  if (!adminToken) {
    return;
  }

  const url = new URL(request.url);
  url.pathname = "/admin/translation-job";
  url.search = "";

  const task = fetch(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": adminToken,
    },
    body: JSON.stringify(job),
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Translation job enqueue returned ${response.status}: ${await response.text()}`);
    }
  }).catch((error) =>
    writeRuntimeLog(runtime, "error", {
      event: "telegram_translation_job_enqueue_failed",
      chatId: job.chatId,
      payload: {
        entity: job.entity,
        slug: job.slug,
        targetLocales: job.targetLocales,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  );

  if (executionCtx && typeof executionCtx.waitUntil === "function") {
    executionCtx.waitUntil(task);
  }
}

function buildResultLogDetails(result) {
  if (!result || typeof result !== "object") {
    return {};
  }

  return {
    preview: summarizePreview(result.operation),
    pendingOperation: summarizePendingOperation(result.pendingState?.operation),
    appliedOperation: summarizeAppliedOperation(result.operation),
    writeResult: summarizeWriteResult(result.writeResult),
    translationPlan: summarizeTranslationPlan(result.translationPlan),
  };
}

function summarizePreview(operation) {
  if (!operation || typeof operation !== "object") {
    return null;
  }

  return {
    entity: operation.entity ?? null,
    action: operation.action ?? null,
    slug: operation.slug ?? null,
    files: Array.isArray(operation.files) ? operation.files.slice(0, 10) : [],
    fields: summarizeFields(operation.fields),
    changes: summarizeChanges(operation.changes),
    hasPhoto: operation.hasPhoto ?? null,
    attachments: summarizeAttachments(operation.attachments),
  };
}

function summarizePendingOperation(operation) {
  if (!operation || typeof operation !== "object") {
    return null;
  }

  return {
    type: operation.type ?? "content_operation",
    entity: operation.entity ?? null,
    action: operation.action ?? null,
    slug: operation.slug ?? null,
    confidence: operation.confidence ?? null,
    summary: operation.summary ?? null,
    fields: summarizeFields(operation.fields),
    preview: summarizePreview(operation.preview),
    continuationOf: operation.continuationOf ?? null,
  };
}

function summarizeAppliedOperation(operation) {
  if (!operation || typeof operation !== "object") {
    return null;
  }

  return {
    entity: operation.entity ?? null,
    action: operation.action ?? null,
    slug: operation.fields?.slug ?? null,
    fields: summarizeFields(operation.fields),
  };
}

function summarizeChanges(changes) {
  if (!Array.isArray(changes)) {
    return [];
  }

  return changes.slice(0, 10).map((change) => ({
    field: change?.field ?? null,
    before: change?.before ?? null,
    after: change?.after ?? null,
    beforeCount: typeof change?.beforeCount === "number" ? change.beforeCount : null,
    afterCount: typeof change?.afterCount === "number" ? change.afterCount : null,
    added: Array.isArray(change?.added) ? change.added.slice(0, 6) : [],
    removed: Array.isArray(change?.removed) ? change.removed.slice(0, 6) : [],
  }));
}

function summarizeWriteResult(writeResult) {
  if (!writeResult || typeof writeResult !== "object") {
    return null;
  }

  return {
    action: writeResult.action ?? null,
    entity: writeResult.entity ?? null,
    slug: writeResult.slug ?? null,
    commitSha: writeResult.commitSha ?? null,
    commitMessage: writeResult.commitMessage ?? null,
    pageUrl: writeResult.pageUrl ?? null,
    translationLinks: Array.isArray(writeResult.translationLinks)
      ? writeResult.translationLinks.slice(0, 10)
      : null,
    paths: writeResult.paths
      ? {
          itemPath: writeResult.paths.itemPath ?? null,
          indexPath: writeResult.paths.indexPath ?? null,
          assetPaths: Array.isArray(writeResult.paths.assetPaths) ? writeResult.paths.assetPaths.slice(0, 10) : [],
        }
      : null,
  };
}

function summarizeTranslationPlan(plan) {
  if (!plan || typeof plan !== "object") {
    return null;
  }

  return {
    entity: plan.entity ?? null,
    slug: plan.slug ?? null,
    sourceLocale: plan.sourceLocale ?? null,
    targetLocales: Array.isArray(plan.targetLocales) ? plan.targetLocales.slice(0, 10) : null,
  };
}

function summarizeFields(fields) {
  if (!fields || typeof fields !== "object") {
    return null;
  }

  const summary = {};

  for (const [key, value] of Object.entries(fields)) {
    if (key === "requestText" || key === "detailsHtml") {
      summary[key] = summarizeString(value, key === "detailsHtml" ? 220 : 140);
      continue;
    }

    if (typeof value === "string") {
      summary[key] = summarizeString(value, 140);
      continue;
    }

    if (Array.isArray(value)) {
      if (key === "links") {
        summary[key] = value
          .filter((entry) => entry && typeof entry === "object")
          .slice(0, 10)
          .map((entry) => ({
            label: entry.label ?? null,
            href: entry.href ?? null,
          }));
      } else if (key === "gallery") {
        summary[key] = value
          .filter((entry) => entry && typeof entry === "object")
          .slice(0, 10)
          .map((entry) => ({
            src: entry.src ?? null,
            alt: entry.alt ?? null,
          }));
      } else if (value.every((entry) => typeof entry === "string")) {
        summary[key] = value.slice(0, 10);
      } else {
        summary[key] = {
          count: value.length,
          sample: value.slice(0, 3),
        };
      }
      continue;
    }

    if (value && typeof value === "object") {
      summary[key] = value;
      continue;
    }

    summary[key] = value;
  }

  return summary;
}

function summarizeAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.slice(0, 10).map((attachment) => ({
    kind: attachment?.kind ?? null,
    fileName: attachment?.fileName ?? null,
    mimeType: attachment?.mimeType ?? null,
  }));
}

function summarizeString(value, limit = 140) {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

async function writeRuntimeLog(runtime, level, entry) {
  const payload = {
    level,
    ...entry,
  };
  const line = JSON.stringify({
    event: payload.event,
    level: payload.level,
    updateId: payload.updateId ?? null,
    messageId: payload.messageId ?? null,
    chatId: payload.chatId ?? null,
    fromUserId: payload.fromUserId ?? null,
    ...(payload.payload || {}),
  });

  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }

  if (runtime?.logStore && typeof runtime.logStore.write === "function") {
    await runtime.logStore.write(payload);
  }
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
