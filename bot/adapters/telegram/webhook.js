import { buildTelegramReplyText } from "./reply-text.js";

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

  if (!update || typeof update !== "object" || !update.message || typeof update.update_id !== "number") {
    return jsonResponse(400, {
      ok: false,
      error: "Unsupported Telegram update payload.",
    });
  }

  try {
    console.log(
      JSON.stringify({
        event: "telegram_webhook_received",
        updateId: update.update_id,
        messageId: update.message?.message_id ?? null,
        chatId: update.message?.chat?.id ?? null,
        fromUserId: update.message?.from?.id ?? null,
        hasText: typeof update.message?.text === "string",
        hasCaption: typeof update.message?.caption === "string",
        hasPhoto: Array.isArray(update.message?.photo) && update.message.photo.length > 0,
      })
    );

    const result = await runtime.handleTelegramUpdate(update, { dryRun });
    const replyText = buildTelegramReplyText(result, {
      dryRun,
      devMode: Boolean(runtime.devMode),
    });

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

    if (replyText && runtime.telegramClient && update.message?.chat?.id != null) {
      await runtime.telegramClient.sendMessage({
        chatId: update.message.chat.id,
        text: replyText,
      });

      console.log(
        JSON.stringify({
          event: "telegram_reply_sent",
          updateId: update.update_id,
          chatId: update.message.chat.id,
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

    if (runtime.telegramClient && update.message?.chat?.id != null) {
      const failureReplyText = buildTelegramReplyText(
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

      if (failureReplyText) {
        try {
          await runtime.telegramClient.sendMessage({
            chatId: update.message.chat.id,
            text: failureReplyText,
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
