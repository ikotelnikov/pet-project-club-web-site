import { GitHubContentRepository } from "../adapters/github/repository.js";
import { ExtractionClient } from "../adapters/openai/extraction-client.js";
import { PrototypeExtractionClient } from "../adapters/openai/prototype-extraction-client.js";
import { TranslationClient } from "../adapters/openai/translation-client.js";
import { PendingKvStore } from "../adapters/storage/pending-kv-store.js";
import { PendingMemoryStore } from "../adapters/storage/pending-memory-store.js";
import { TelegramClient } from "../adapters/telegram/telegram-client.js";
import { handleTelegramMessage } from "../adapters/telegram/message-handler.js";
import { buildContentPageUrl } from "../core/content-links.js";
import { runPostConfirmationTranslations } from "../services/post-confirmation-translation.js";
import { NoopWorkerLogStore, WorkerKvLogStore } from "../services/worker-log-store.js";

export function createWorkerRuntime(env = {}, options = {}) {
  const fetchImpl = normalizeFetchImpl(options.fetchImpl);
  const debugLlmLogs = env.BOT_DEBUG_LLM_LOGS == null
    ? env.DEV_MODE === "true"
    : env.BOT_DEBUG_LLM_LOGS === "true";
  const logStore =
    options.logStore ||
    (env.BOT_LOGS_KV
      ? new WorkerKvLogStore({
          namespace: env.BOT_LOGS_KV,
        })
      : new NoopWorkerLogStore());
  const debugLog = createRuntimeDebugLogger({
    enabled: debugLlmLogs,
    logStore,
  });
  const publicSiteBaseUrl = resolvePublicSiteBaseUrl(env);
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
          debugLogger: debugLog,
        })
      : new PrototypeExtractionClient();
  const translationClient = env.OPENAI_API_KEY
    ? new TranslationClient({
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_TRANSLATION_MODEL || env.OPENAI_MODEL || undefined,
        fetchImpl,
      })
    : null;
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
    translationClient,
    pendingStore,
    photoStore,
    telegramClient,
    logStore,
    debugLlmLogs,
    devMode: env.DEV_MODE === "true",
    useIntentPipeline: env.BOT_USE_INTENT_PIPELINE !== "false",
    telegramUpdateCoalesceDelayMs: resolveUpdateCoalesceDelayMs(env),
    telegramPendingContextCoalesceDelayMs: resolvePendingContextCoalesceDelayMs(env),
    publicSiteBaseUrl,
    async handleTelegramUpdate(update, runtimeOptions = {}) {
      const result = await handleTelegramMessage({
        message: update.message,
        updateId: update.update_id,
        useIntentPipeline: env.BOT_USE_INTENT_PIPELINE !== "false",
        coalesceDelayMs: Number.isInteger(runtimeOptions.coalesceDelayMs)
          ? runtimeOptions.coalesceDelayMs
          : resolveUpdateCoalesceDelayMs(env),
        pendingCoalesceDelayMs: Number.isInteger(runtimeOptions.pendingCoalesceDelayMs)
          ? runtimeOptions.pendingCoalesceDelayMs
          : resolvePendingContextCoalesceDelayMs(env),
        allowedUserId: env.TELEGRAM_ALLOWED_USER_ID
          ? Number.parseInt(env.TELEGRAM_ALLOWED_USER_ID, 10)
          : null,
        repository,
        pendingStore,
        photoStore,
        extractionClient,
        translationClient,
        telegramClient,
        debugLog,
        dryRun: runtimeOptions.dryRun ?? true,
      });

      return augmentTelegramResult(result, {
        publicSiteBaseUrl,
      });
    },
    async runPostConfirmTranslations(result) {
      if (!result?.translationPlan || !telegramClient) {
        return;
      }

      await runPostConfirmationTranslations({
        repository,
        translationClient,
        telegramClient,
        chatId: result.chatId,
        entity: result.translationPlan.entity,
        slug: result.translationPlan.slug,
        sourceLocale: result.translationPlan.sourceLocale,
        targetLocales: result.translationPlan.targetLocales || null,
        siteBaseUrl: publicSiteBaseUrl,
      });
    },
  };
}

function createRuntimeDebugLogger({ enabled, logStore }) {
  if (!enabled || !logStore || typeof logStore.write !== "function") {
    return null;
  }

  return async ({ event, payload = {}, updateId = null, messageId = null, chatId = null, fromUserId = null }) => {
    await logStore.write({
      level: "debug",
      event,
      updateId,
      messageId,
      chatId,
      fromUserId,
      payload,
    });
  };
}

function resolveUpdateCoalesceDelayMs(env) {
  const raw = env.TELEGRAM_UPDATE_COALESCE_DELAY_MS;
  if (raw == null || raw === "") {
    return 1000;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 1000;
}

function resolvePendingContextCoalesceDelayMs(env) {
  const raw = env.TELEGRAM_PENDING_CONTEXT_COALESCE_DELAY_MS;
  if (raw == null || raw === "") {
    return 20000;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 20000;
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

function resolvePublicSiteBaseUrl(env) {
  if (env.PUBLIC_SITE_BASE_URL) {
    return env.PUBLIC_SITE_BASE_URL;
  }

  if (env.GITHUB_REPO_OWNER && env.GITHUB_REPO_NAME) {
    return `https://${env.GITHUB_REPO_OWNER}.github.io/${env.GITHUB_REPO_NAME}`;
  }

  return null;
}

function augmentTelegramResult(result, { publicSiteBaseUrl } = {}) {
  if (!result?.writeResult?.entity || !result?.writeResult?.slug) {
    return result;
  }

  const sourceLocale =
    result.operation?.fields?.locale ||
    result.translationPlan?.sourceLocale ||
    result.operation?.fields?.sourceLocale ||
    result.pendingState?.operation?.fields?.sourceLocale ||
    "ru";

  return {
    ...result,
    writeResult: {
      ...result.writeResult,
      pageUrl: buildContentPageUrl({
        siteBaseUrl: publicSiteBaseUrl,
        entity: result.writeResult.entity,
        slug: result.writeResult.slug,
        locale: sourceLocale,
      }),
      translationLinks: Array.isArray(result.translationPlan?.targetLocales)
        ? result.translationPlan.targetLocales
            .map((locale) => ({
              locale,
              url: buildContentPageUrl({
                siteBaseUrl: publicSiteBaseUrl,
                entity: result.writeResult.entity,
                slug: result.writeResult.slug,
                locale,
              }),
            }))
            .filter((entry) => entry.url)
        : null,
    },
  };
}
