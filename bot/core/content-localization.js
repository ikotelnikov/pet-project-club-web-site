export const SUPPORTED_LOCALES = ["ru", "en", "de", "me", "es"];
export const DEFAULT_SOURCE_LOCALE = "ru";

const LOCALIZABLE_FIELDS = {
  announce: ["date", "title", "place", "format", "paragraphs", "sections", "links", "photo"],
  announcement: ["date", "title", "place", "format", "paragraphs", "sections", "links", "photo"],
  meeting: ["date", "title", "place", "format", "paragraphs", "sections", "links", "photo"],
  participant: ["handle", "name", "role", "bio", "points", "location", "links"],
  project: ["title", "status", "stack", "summary", "detailsHtml", "points", "location", "links"],
};

function normalizeEntity(entity) {
  return entity === "announcement" ? "announce" : entity;
}

export function normalizeContentLocale(locale) {
  if (typeof locale !== "string") {
    return null;
  }

  const normalized = locale.trim().toLowerCase();

  if (SUPPORTED_LOCALES.includes(normalized)) {
    return normalized;
  }

  if (normalized === "sr" || normalized === "bs" || normalized === "hr" || normalized === "mk" || normalized === "cnr") {
    return "me";
  }

  return null;
}

export function isLocalizedContentItem(item) {
  return Boolean(item && typeof item === "object" && item.translations && typeof item.translations === "object");
}

export function localizeContentNode(value, locale, sourceLocaleFallback = DEFAULT_SOURCE_LOCALE) {
  if (Array.isArray(value)) {
    return value.map((entry) => localizeContentNode(entry, locale, sourceLocaleFallback));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const normalizedLocale = normalizeContentLocale(locale) || sourceLocaleFallback;
  const baseObject = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["translations", "translationStatus", "machineSuggestions"].includes(key))
      .map(([key, entry]) => [key, localizeContentNode(entry, normalizedLocale, sourceLocaleFallback)])
  );

  const sourceLocale = normalizeContentLocale(baseObject.sourceLocale) || sourceLocaleFallback;
  const translationOverlay =
    normalizedLocale !== sourceLocale &&
    value.translations &&
    typeof value.translations === "object" &&
    value.translations[normalizedLocale] &&
    typeof value.translations[normalizedLocale] === "object"
      ? localizeContentNode(value.translations[normalizedLocale], normalizedLocale, sourceLocaleFallback)
      : null;

  return translationOverlay
    ? deepMerge(baseObject, translationOverlay)
    : baseObject;
}

export function buildLocalizedItemPatch(entity, fields, options = {}) {
  const normalizedEntity = normalizeEntity(entity);
  const sourceLocale = normalizeContentLocale(options.sourceLocale || fields.sourceLocale || DEFAULT_SOURCE_LOCALE) || DEFAULT_SOURCE_LOCALE;
  const targetLocale = normalizeContentLocale(fields.locale);
  const localizableFields = new Set(LOCALIZABLE_FIELDS[normalizedEntity] || []);
  const result = {};

  for (const [key, value] of Object.entries(fields)) {
    if (["slug", "locale", "sourceLocale"].includes(key)) {
      continue;
    }

    if (targetLocale && targetLocale !== sourceLocale && localizableFields.has(key)) {
      continue;
    }

    result[key] = value;
  }

  result.slug = fields.slug;
  result.sourceLocale = sourceLocale;

  if (targetLocale && targetLocale !== sourceLocale) {
    const translationFields = {};

    for (const [key, value] of Object.entries(fields)) {
      if (localizableFields.has(key)) {
        translationFields[key] = value;
      }
    }

    result.translations = {
      [targetLocale]: translationFields,
    };
    result.translationStatus = {
      [targetLocale]: "edited",
    };
  }

  return result;
}

export function mergeContentItems(existingItem, nextItem, options = {}) {
  if (!existingItem) {
    return nextItem;
  }

  const sourceLocale = normalizeContentLocale(nextItem.sourceLocale || existingItem.sourceLocale || options.sourceLocale || DEFAULT_SOURCE_LOCALE) || DEFAULT_SOURCE_LOCALE;
  const merged = deepMerge(existingItem, nextItem);
  merged.sourceLocale = sourceLocale;

  const nextTranslations = nextItem.translations;
  if (nextTranslations && typeof nextTranslations === "object") {
    merged.translations = deepMerge(existingItem.translations || {}, nextTranslations);
  }

  const nextStatuses = nextItem.translationStatus;
  if (nextStatuses && typeof nextStatuses === "object") {
    merged.translationStatus = {
      ...(existingItem.translationStatus || {}),
      ...nextStatuses,
    };
  }

  if (!nextTranslations && hasSourceTextChange(existingItem, nextItem, options.entity)) {
    merged.translationStatus = markNonSourceLocalesStale(merged.translationStatus || {}, sourceLocale);
  }

  return merged;
}

export function applyTranslationToItem(entity, item, locale, translatedFields, status = "machine") {
  const normalizedLocale = normalizeContentLocale(locale);
  const sourceLocale = normalizeContentLocale(item.sourceLocale) || DEFAULT_SOURCE_LOCALE;

  if (!normalizedLocale || normalizedLocale === sourceLocale) {
    return item;
  }

  return {
    ...item,
    translations: deepMerge(item.translations || {}, {
      [normalizedLocale]: translatedFields,
    }),
    translationStatus: {
      ...(item.translationStatus || {}),
      [normalizedLocale]: status,
    },
  };
}

export function extractLocalizableFields(entity, item) {
  const localizableFields = LOCALIZABLE_FIELDS[normalizeEntity(entity)] || [];
  return Object.fromEntries(
    localizableFields
      .filter((field) => field in item)
      .map((field) => [field, item[field]])
  );
}

function hasSourceTextChange(existingItem, nextItem, entity) {
  const localizableFields = LOCALIZABLE_FIELDS[normalizeEntity(entity)] || [];

  return localizableFields.some((field) => field in nextItem && JSON.stringify(existingItem?.[field]) !== JSON.stringify(nextItem?.[field]));
}

function markNonSourceLocalesStale(translationStatus, sourceLocale) {
  const nextStatus = { ...translationStatus };

  for (const locale of Object.keys(nextStatus)) {
    if (locale !== sourceLocale && nextStatus[locale] !== "edited") {
      nextStatus[locale] = "stale";
    }
  }

  return nextStatus;
}

function deepMerge(baseValue, overrideValue) {
  if (Array.isArray(overrideValue)) {
    return overrideValue.map((entry) => cloneValue(entry));
  }

  if (!overrideValue || typeof overrideValue !== "object") {
    return overrideValue;
  }

  const baseObject = baseValue && typeof baseValue === "object" && !Array.isArray(baseValue)
    ? baseValue
    : {};
  const result = { ...baseObject };

  for (const [key, value] of Object.entries(overrideValue)) {
    const baseEntry = result[key];

    if (Array.isArray(value)) {
      result[key] = value.map((entry) => cloneValue(entry));
      continue;
    }

    if (value && typeof value === "object") {
      result[key] = deepMerge(baseEntry, value);
      continue;
    }

    result[key] = value;
  }

  return result;
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }

  if (value && typeof value === "object") {
    return deepMerge({}, value);
  }

  return value;
}
