import fs from "node:fs/promises";
import process from "node:process";

import { handleTelegramWebhookRequest } from "../adapters/telegram/webhook.js";
import { loadBotConfig } from "../config.js";
import { createBotRuntime } from "../runtime/create-runtime.js";

const argv = process.argv.slice(2);
const updatePath = readFlagValue(argv, "--update");
const dryRun = !argv.includes("--apply");

if (!updatePath) {
  process.stderr.write("Usage: node bot/cli/simulate-webhook.js --update <path> [--apply]\n");
  process.exit(1);
}

const config = loadBotConfig();
const runtime = createBotRuntime(config);
const payload = await fs.readFile(updatePath, "utf8");

const request = new Request("https://local.test/telegram/webhook", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(config.telegramWebhookSecret
      ? { "x-telegram-bot-api-secret-token": config.telegramWebhookSecret }
      : {}),
  },
  body: payload,
});

const response = await handleTelegramWebhookRequest({
  request,
  runtime,
  webhookSecret: config.telegramWebhookSecret,
  dryRun,
});

process.stdout.write(`${await response.text()}\n`);

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
