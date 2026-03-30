import path from "node:path";

import { BotConfigError } from "./domain/errors.js";

export function loadBotConfig(env = process.env) {
  const repoRoot = env.BOT_REPO_ROOT
    ? path.resolve(env.BOT_REPO_ROOT)
    : process.cwd();

  const contentRoot = env.BOT_CONTENT_ROOT
    ? path.resolve(env.BOT_CONTENT_ROOT)
    : path.join(repoRoot, "content");

  const assetsRoot = env.BOT_ASSETS_ROOT
    ? path.resolve(env.BOT_ASSETS_ROOT)
    : path.join(repoRoot, "assets");
  const telegramOffsetStatePath = env.TELEGRAM_OFFSET_STATE_PATH
    ? path.resolve(env.TELEGRAM_OFFSET_STATE_PATH)
    : path.join(repoRoot, "bot", "state", "telegram-offset.json");
  const pendingStateRoot = env.PENDING_STATE_ROOT
    ? path.resolve(env.PENDING_STATE_ROOT)
    : path.join(repoRoot, "bot", "state", "pending");
  const attachmentStageRoot = env.ATTACHMENT_STAGE_ROOT
    ? path.resolve(env.ATTACHMENT_STAGE_ROOT)
    : path.join(repoRoot, "bot", "state", "attachments");

  const allowedUserId = env.TELEGRAM_ALLOWED_USER_ID
    ? Number.parseInt(env.TELEGRAM_ALLOWED_USER_ID, 10)
    : null;

  if (env.TELEGRAM_ALLOWED_USER_ID && !Number.isInteger(allowedUserId)) {
    throw new BotConfigError("TELEGRAM_ALLOWED_USER_ID must be an integer when provided.");
  }

  return {
    repoRoot,
    contentRoot,
    assetsRoot,
    pendingStateRoot,
    attachmentStageRoot,
    telegramOffsetStatePath,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || null,
    telegramAllowedUserId: allowedUserId,
    telegramWebhookSecret: env.TELEGRAM_WEBHOOK_SECRET || null,
    openAiApiKey: env.OPENAI_API_KEY || null,
    openAiModel: env.OPENAI_MODEL || null,
    extractionBackend: env.EXTRACTION_BACKEND || "prototype",
    githubRepoOwner: env.GITHUB_REPO_OWNER || null,
    githubRepoName: env.GITHUB_REPO_NAME || null,
    githubBranch: env.GITHUB_BRANCH || null,
    githubWriteToken: env.GITHUB_WRITE_TOKEN || null,
  };
}
