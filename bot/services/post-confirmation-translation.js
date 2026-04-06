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
  siteBaseUrl = null,
}) {
  if (!repository || !translationClient || !telegramClient || chatId == null || !entity || !slug) {
    return;
  }

  const currentItem = await repository.readItem(entity, slug);
  const normalizedSourceLocale =
    normalizeContentLocale(sourceLocale || currentItem?.sourceLocale) || DEFAULT_SOURCE_LOCALE;
  const targetLocales = resolvePendingTranslationLocales(currentItem, normalizedSourceLocale);

  for (const targetLocale of targetLocales) {
    try {
      const latestItem = await repository.readItem(entity, slug);
      const translatedFields = await translationClient.translateFields({
        entity,
        sourceLocale: normalizedSourceLocale,
        targetLocale,
        fields: extractLocalizableFields(entity, latestItem),
      });
      const nextItem = applyTranslationToItem(entity, latestItem, targetLocale, translatedFields, "machine");
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

      await telegramClient.sendMessage({
        chatId,
        text: [
          `Translation to ${targetLocale} updated.`,
          pageUrl ? `Link: ${pageUrl}` : null,
          writeResult.commitSha ? `Commit: ${writeResult.commitSha}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      });
    } catch (error) {
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
}

export function resolvePendingTranslationLocales(item, sourceLocale = DEFAULT_SOURCE_LOCALE) {
  const normalizedSourceLocale = normalizeContentLocale(sourceLocale) || DEFAULT_SOURCE_LOCALE;
  const translationStatus = item?.translationStatus && typeof item.translationStatus === "object"
    ? item.translationStatus
    : {};

  return SUPPORTED_LOCALES.filter((locale) => {
    if (locale === normalizedSourceLocale) {
      return false;
    }

    return translationStatus[locale] !== "edited";
  });
}
