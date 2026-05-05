import {
  applyTranslationToItem,
  DEFAULT_SOURCE_LOCALE,
  extractLocalizableFields,
  normalizeContentLocale,
  SUPPORTED_LOCALES,
} from "../core/content-localization.js";
import { buildContentPageUrl } from "../core/content-links.js";

export async function runPostConfirmationTranslations({
  repository,
  translationClient,
  telegramClient,
  chatId,
  entity,
  slug,
  sourceLocale,
  targetLocales = null,
  siteBaseUrl = null,
  maxLocales = null,
  log = null,
}) {
  if (!repository || !translationClient || !telegramClient || chatId == null || !entity || !slug) {
    return {
      successes: [],
      failures: [],
      remainingLocales: [],
      skipped: true,
    };
  }

  let currentItem = await repository.readItem(entity, slug);
  const normalizedSourceLocale =
    normalizeContentLocale(sourceLocale || currentItem?.sourceLocale) || DEFAULT_SOURCE_LOCALE;
  const localesToUpdate = Array.isArray(targetLocales) && targetLocales.length > 0
    ? [...new Set(targetLocales
        .map((locale) => normalizeContentLocale(locale))
        .filter((locale) => locale && locale !== normalizedSourceLocale)
        .filter((locale) => currentItem?.translationStatus?.[locale] !== "edited"))]
    : resolvePendingTranslationLocales(currentItem, normalizedSourceLocale);
  const normalizedMaxLocales = Number.isInteger(maxLocales) && maxLocales > 0
    ? maxLocales
    : localesToUpdate.length;
  const localesToProcess = localesToUpdate.slice(0, normalizedMaxLocales);
  const remainingLocales = localesToUpdate.slice(normalizedMaxLocales);

  const failures = [];
  const successes = [];

  for (const targetLocale of localesToProcess) {
    try {
      await writeTranslationLog(log, "info", "telegram_translation_update_started", {
        chatId,
        entity,
        slug,
        targetLocale,
        remainingLocales,
      });
      const translatedFields = await translationClient.translateFields({
        entity,
        sourceLocale: normalizedSourceLocale,
        targetLocale,
        fields: extractLocalizableFields(entity, currentItem),
      });
      const nextItem = applyTranslationToItem(entity, currentItem, targetLocale, translatedFields, "machine");
      const writeResult = await repository.applyCommand(
        {
          entity,
          action: "update",
          fields: {
            slug,
          },
        },
        {
          item: nextItem,
        }
      );
      const pageUrl = buildContentPageUrl({
        siteBaseUrl,
        entity,
        slug,
        locale: targetLocale,
      });
      currentItem = nextItem;
      successes.push({
        locale: targetLocale,
        pageUrl,
        commitSha: writeResult?.commitSha ?? null,
      });
      await writeTranslationLog(log, "info", "telegram_translation_update_succeeded", {
        chatId,
        entity,
        slug,
        targetLocale,
        commitSha: writeResult?.commitSha ?? null,
      });
    } catch (error) {
      failures.push({
        locale: targetLocale,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(
        JSON.stringify({
          event: "telegram_translation_update_failed",
          chatId,
          entity,
          slug,
          targetLocale,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      await writeTranslationLog(log, "error", "telegram_translation_update_failed", {
        chatId,
        entity,
        slug,
        targetLocale,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const lines = [];

  if (successes.length > 0) {
    lines.push("Translations updated:");
    for (const success of successes) {
      lines.push(`- ${success.locale}${success.pageUrl ? `: ${success.pageUrl}` : ""}`);
    }
  }

  if (failures.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("Some translations failed to update:");
    lines.push(...failures.map((failure) => `- ${failure.locale}: ${failure.error}`));
  }

  if (lines.length > 0) {
    await telegramClient.sendMessage({
      chatId,
      text: lines.join("\n"),
    });
  }

  await writeTranslationLog(log, failures.length > 0 ? "warn" : "info", "telegram_translation_update_chunk_finished", {
    chatId,
    entity,
    slug,
    processedLocales: localesToProcess,
    remainingLocales,
    successes,
    failures,
  });

  return {
    successes,
    failures,
    remainingLocales,
    skipped: false,
  };
}

export function resolvePendingTranslationLocales(item, sourceLocale = DEFAULT_SOURCE_LOCALE) {
  const normalizedSourceLocale = normalizeContentLocale(sourceLocale) || DEFAULT_SOURCE_LOCALE;
  const translationStatus = item?.translationStatus && typeof item.translationStatus === "object"
    ? item.translationStatus
    : {};
  const translations = item?.translations && typeof item.translations === "object"
    ? item.translations
    : {};

  return SUPPORTED_LOCALES.filter((locale) => {
    if (locale === normalizedSourceLocale) {
      return false;
    }

    if (translationStatus[locale] === "edited") {
      return false;
    }

    const translationPayload = translations[locale];
    const hasTranslationPayload = hasNonEmptyTranslationPayload(translationPayload);

    return !hasTranslationPayload || translationStatus[locale] == null || translationStatus[locale] === "stale";
  });
}

function hasNonEmptyTranslationPayload(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return Object.keys(value).length > 0;
}

async function writeTranslationLog(log, level, event, payload) {
  if (typeof log !== "function") {
    return;
  }

  await log(level, event, payload);
}
