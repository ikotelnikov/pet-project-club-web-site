import { buildTelegramReply } from "./reply-text.js";

export async function handleTelegramWebhookRequest({
  request,
  runtime,
  webhookSecret = null,
  dryRun = true,
}) {
  if (request.method === "GET") {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return jsonResponse(200, {
        ok: true,
        mode: "webhook",
      });
    }
  }

  if (request.method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: "Method not allowed.",
    });
  }

  const url = new URL(request.url);

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
    console.log(
      JSON.stringify({
        event: "telegram_webhook_received",
        updateId: update.update_id,
        messageId: normalizedUpdate.message?.message_id ?? null,
        chatId: normalizedUpdate.message?.chat?.id ?? null,
        fromUserId: normalizedUpdate.message?.from?.id ?? update.callback_query?.from?.id ?? null,
        hasText: typeof normalizedUpdate.message?.text === "string",
        hasCaption: typeof normalizedUpdate.message?.caption === "string",
        hasPhoto: Array.isArray(normalizedUpdate.message?.photo) && normalizedUpdate.message.photo.length > 0,
        hasCallbackQuery: Boolean(update.callback_query),
        callbackData,
      })
    );

    let callbackAnswered = false;

    if (runtime.telegramClient && update.callback_query?.id) {
      try {
        await runtime.telegramClient.answerCallbackQuery({
          callbackQueryId: update.callback_query.id,
        });
        callbackAnswered = true;
      } catch (callbackError) {
        console.error(
          JSON.stringify({
            event: "telegram_callback_answer_failed",
            updateId: update.update_id,
            stage: "before_processing",
            error: callbackError instanceof Error ? callbackError.message : String(callbackError),
          })
        );
      }
    }

    const result = await runtime.handleTelegramUpdate(normalizedUpdate, { dryRun });
    const reply = buildTelegramReply(result, {
      dryRun,
      devMode: Boolean(runtime.devMode),
    });
    const replyText = reply.text;

    console.log(
      JSON.stringify({
        event: "telegram_webhook_result",
        updateId: update.update_id,
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
      })
    );

    if (!callbackAnswered && runtime.telegramClient && update.callback_query?.id) {
      try {
        await runtime.telegramClient.answerCallbackQuery({
          callbackQueryId: update.callback_query.id,
        });
      } catch (callbackError) {
        console.error(
          JSON.stringify({
            event: "telegram_callback_answer_failed",
            updateId: update.update_id,
            stage: "after_processing",
            error: callbackError instanceof Error ? callbackError.message : String(callbackError),
          })
        );
      }
    }

    if (replyText && runtime.telegramClient && normalizedUpdate.message?.chat?.id != null) {
      await runtime.telegramClient.sendMessage({
        chatId: normalizedUpdate.message.chat.id,
        text: replyText,
        replyMarkup: reply.replyMarkup,
      });

      console.log(
        JSON.stringify({
          event: "telegram_reply_sent",
          updateId: update.update_id,
          chatId: normalizedUpdate.message.chat.id,
          replyLength: replyText.length,
        })
      );
    }

    return jsonResponse(200, {
      ok: true,
      dryRun,
      result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(
      JSON.stringify({
        event: "telegram_webhook_error",
        updateId: update.update_id,
        error: errorMessage,
      })
    );

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
          console.error(
            JSON.stringify({
              event: "telegram_webhook_error_reply_failed",
              updateId: update.update_id,
              error: replyError instanceof Error ? replyError.message : String(replyError),
            })
          );
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

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
