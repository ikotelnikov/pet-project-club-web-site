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
      allowed_updates: ["message"],
    });
  }

  async sendMessage({ chatId, text }) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
    });
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
      throw new TelegramBotError(`Telegram API request failed with status ${response.status}.`);
    }

    const data = await response.json();

    if (!data.ok) {
      throw new TelegramBotError(`Telegram API error in ${method}: ${data.description || "unknown error"}`);
    }

    return data.result;
  }
}
