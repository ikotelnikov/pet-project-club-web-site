import { TelegramBotError } from "../domain/errors.js";

export class TelegramClient {
  constructor({ botToken, fetchImpl = globalThis.fetch }) {
    if (!botToken) {
      throw new TelegramBotError("TELEGRAM_BOT_TOKEN is required.");
    }

    if (typeof fetchImpl !== "function") {
      throw new TelegramBotError("A fetch implementation is required.");
    }

    this.botToken = botToken;
    this.fetchImpl = fetchImpl;
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async getUpdates({ offset = 0, limit = 20, timeout = 0 } = {}) {
    return this.call("getUpdates", {
      offset,
      limit,
      timeout,
      allowed_updates: ["message", "callback_query"],
    });
  }

  async sendMessage({ chatId, text, replyMarkup = null }) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: replyMarkup ?? undefined,
    });
  }

  async answerCallbackQuery({ callbackQueryId, text = null }) {
    return this.call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: text ?? undefined,
    });
  }

  async getFile(fileId) {
    return this.call("getFile", {
      file_id: fileId,
    });
  }

  async downloadFileBytes(fileId) {
    const file = await this.getFile(fileId);

    if (!file?.file_path) {
      throw new TelegramBotError("Telegram file_path is missing.");
    }

    const response = await this.fetchImpl(`https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`, {
      method: "GET",
    });

    if (!response.ok) {
      throw new TelegramBotError(`Telegram file download failed with status ${response.status}.`);
    }

    return {
      filePath: file.file_path,
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  }

  async call(method, payload) {
    const response = await this.fetchImpl(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await safeReadTelegramBody(response);
      throw new TelegramBotError(`Telegram API request failed in ${method} with status ${response.status}${body ? `: ${body}` : "."}`);
    }

    const data = await response.json();

    if (!data.ok) {
      throw new TelegramBotError(`Telegram API error in ${method}: ${data.description || "unknown error"}`);
    }

    return data.result;
  }
}

async function safeReadTelegramBody(response) {
  try {
    const text = await response.text();
    return text.trim();
  } catch {
    return "";
  }
}
