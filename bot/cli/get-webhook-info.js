import { loadBotConfig } from "../config.js";

const config = loadBotConfig();

if (!config.telegramBotToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is required.");
}

const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/getWebhookInfo`, {
  method: "POST",
});
const payload = await response.json();

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
