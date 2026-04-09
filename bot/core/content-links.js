import { DEFAULT_SOURCE_LOCALE, normalizeContentLocale } from "./content-localization.js";

export function buildContentPageUrl({ siteBaseUrl, entity, slug, locale }) {
  if (!siteBaseUrl || !entity || !slug) {
    return null;
  }

  const normalizedLocale = normalizeContentLocale(locale) || DEFAULT_SOURCE_LOCALE;
  const normalizedBaseUrl = String(siteBaseUrl).replace(/\/+$/, "");
  const path = resolveEntityPath(entity, slug);

  if (!path) {
    return null;
  }

  const localePrefix = normalizedLocale === DEFAULT_SOURCE_LOCALE ? "" : `/${normalizedLocale}`;
  return `${normalizedBaseUrl}${localePrefix}/${path}`;
}

function resolveEntityPath(entity, slug) {
  switch (entity) {
    case "announce":
    case "meeting":
      return `meetings/${encodeURIComponent(slug)}/`;
    case "participant":
      return `participants/${encodeURIComponent(slug)}/`;
    case "project":
      return `projects/${encodeURIComponent(slug)}/`;
    default:
      return null;
  }
}
