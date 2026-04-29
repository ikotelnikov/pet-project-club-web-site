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
}) {
  if (!repository || !translationClient || !telegramClient || chatId == null || !entity || !slug) {
    return;
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

  const failures = [];
  const successes = [];

  for (const targetLocale of localesToUpdate) {
    try {
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
