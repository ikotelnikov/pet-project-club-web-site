import process from "node:process";

import { loadBotConfig } from "../config.js";

const argv = process.argv.slice(2);
const baseUrl = readFlagValue(argv, "--base-url");
const dropPendingUpdates = argv.includes("--drop-pending");
const config = loadBotConfig();

if (!baseUrl) {
  process.stderr.write(
    "Usage: node bot/cli/register-webhook.js --base-url <https://your-worker.example>\n"
  );
  process.exit(1);
}

if (!config.telegramBotToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is required.");
}

const webhookUrl = `${baseUrl.replace(/\/$/, "")}/telegram/webhook`;
const response = await fetch(
  `https://api.telegram.org/bot${config.telegramBotToken}/setWebhook`,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: config.telegramWebhookSecret || undefined,
      drop_pending_updates: dropPendingUpdates,
      allowed_updates: ["message"],
    }),
  }
);
const payload = await response.json();

process.stdout.write(
  `${JSON.stringify(
    {
      ok: response.ok,
      webhookUrl,
      result: payload,
    },
    null,
    2
  )}\n`
);

function readFlagValue(argvList, flagName) {
  const index = argvList.indexOf(flagName);

  if (index === -1) {
    return null;
  }

  const value = argvList[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Flag '${flagName}' requires a value.`);
  }

  return value;
}
