import { GitHubContentRepository } from "../adapters/github/repository.js";
import { ExtractionClient } from "../adapters/openai/extraction-client.js";
import { PrototypeExtractionClient } from "../adapters/openai/prototype-extraction-client.js";
import { PendingKvStore } from "../adapters/storage/pending-kv-store.js";
import { PendingMemoryStore } from "../adapters/storage/pending-memory-store.js";
import { TelegramClient } from "../adapters/telegram/telegram-client.js";
import { handleTelegramMessage } from "../adapters/telegram/message-handler.js";

export function createWorkerRuntime(env = {}, options = {}) {
  const fetchImpl = normalizeFetchImpl(options.fetchImpl);
  const repository = new GitHubContentRepository({
    owner: env.GITHUB_REPO_OWNER || null,
    repo: env.GITHUB_REPO_NAME || null,
    branch: env.GITHUB_BRANCH || null,
    token: env.GITHUB_WRITE_TOKEN || null,
    fetchImpl,
  });
  const extractionClient =
    env.EXTRACTION_BACKEND === "openai"
      ? new ExtractionClient({
          apiKey: env.OPENAI_API_KEY || null,
          model: env.OPENAI_MODEL || undefined,
          fetchImpl,
        })
      : new PrototypeExtractionClient();
  const pendingStore =
    options.pendingStore ||
    (env.PENDING_STATE_KV
      ? new PendingKvStore({
          namespace: env.PENDING_STATE_KV,
        })
      : new PendingMemoryStore());
  const photoStore = options.photoStore || createWorkerPhotoStore(repository);
  const telegramClient =
    options.telegramClient ||
    (env.TELEGRAM_BOT_TOKEN
      ? new TelegramClient({
          botToken: env.TELEGRAM_BOT_TOKEN,
          fetchImpl,
        })
      : null);

  return {
    repository,
    extractionClient,
    pendingStore,
    photoStore,
    telegramClient,
    devMode: env.DEV_MODE === "true",
    async handleTelegramUpdate(update, runtimeOptions = {}) {
      return handleTelegramMessage({
        message: update.message,
        updateId: update.update_id,
        allowedUserId: env.TELEGRAM_ALLOWED_USER_ID
          ? Number.parseInt(env.TELEGRAM_ALLOWED_USER_ID, 10)
          : null,
        repository,
        pendingStore,
        photoStore,
        extractionClient,
        telegramClient,
        dryRun: runtimeOptions.dryRun ?? true,
      });
    },
  };
}

function normalizeFetchImpl(fetchImpl) {
  const candidate = fetchImpl || fetch;
  return (...args) => candidate(...args);
}

function createWorkerPhotoStore(repository) {
  return {
    async planPhoto() {
      return null;
    },
    async applyPhoto() {
      return null;
    },
    async planStagedPhoto(entity, slug, stagedPath) {
      if (typeof repository.planStagedPhoto !== "function") {
        return null;
      }

      return repository.planStagedPhoto(entity, slug, stagedPath);
    },
    async applyStagedPhoto(entity, slug, stagedPath) {
      if (typeof repository.applyStagedPhoto !== "function") {
        return null;
      }

      return repository.applyStagedPhoto(entity, slug, stagedPath);
    },
  };
}
