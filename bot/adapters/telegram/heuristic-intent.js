import { validateExtraction } from "../../core/extraction-validator.js";

export function inferHeuristicExtraction(messageText) {
  const text = typeof messageText === "string" ? messageText.trim() : "";

  if (!text) {
    return null;
  }

  const normalized = text.toLowerCase();
  const translationIntent = inferTranslationIntent(text);

  if (translationIntent) {
    const { locale, targetRef } = translationIntent;

    if (targetRef) {
      return buildTranslationOperation({
        entity: inferEntity(normalized, "participant"),
        targetRef,
        locale,
        summary: `update ${locale || "target"} translation for ${targetRef}`,
      });
    }
  }
  const deleteMatch =
    text.match(/^delete\s+participant:\s*(.+)$/i) ||
    text.match(/^delete\s+the\s+profile\s+of\s+(.+)$/i) ||
    text.match(/^delete\s+profile\s+of\s+(.+)$/i) ||
    text.match(/^delete\s+(.+)$/i);

  if (deleteMatch) {
    const targetRef = sanitizeTargetRef(deleteMatch[1]);
    if (!targetRef) {
      return null;
    }

    return buildContentOperation({
      entity: inferEntity(normalized, "participant"),
      action: "delete",
      targetRef,
      summary: `delete ${inferEntity(normalized, "participant")} ${targetRef}`,
      fields: {},
    });
  }

  const updateMatch =
    text.match(/^update\s+participant:\s*(.+)$/i) ||
    text.match(/^let'?s\s+update\s+(.+)$/i) ||
    text.match(/^update\s+(.+)$/i);

  if (updateMatch) {
    const targetRef = sanitizeTargetRef(updateMatch[1]);
    if (!targetRef || !isSimpleHeuristicTarget(targetRef)) {
      return null;
    }

    return buildContentOperation({
      entity: inferEntity(normalized, "participant"),
      action: "update",
      targetRef,
      summary: `update ${inferEntity(normalized, "participant")} ${targetRef}`,
      fields: {},
    });
  }

  const createMatch =
    text.match(/^create\s+participant:\s*(.+)$/i) ||
    text.match(/^add\s+a\s+new\s+participant\s+called\s+(.+)$/i) ||
    text.match(/^create\s+(.+)$/i);

  if (createMatch) {
    const targetRef = sanitizeTargetRef(createMatch[1]);
    if (!targetRef || !isSimpleHeuristicTarget(targetRef)) {
      return null;
    }

    return buildContentOperation({
      entity: inferEntity(normalized, "participant"),
      action: "create",
      targetRef,
      summary: `create ${inferEntity(normalized, "participant")} ${targetRef}`,
      fields: {
        name: targetRef,
      },
    });
  }

  return null;
}

function inferTranslationIntent(text) {
  const translateToMatch = text.match(
    /^translate\s+(.+?)\s+to\s+(ru|en|de|me|es|russian|english|german|deutsch|montenegrin|crnogorski|spanish|espanol|español)$/i
  );

  if (translateToMatch) {
    return {
      targetRef: sanitizeTargetRef(translateToMatch[1]),
      locale: normalizeLocaleHint(translateToMatch[2]),
    };
  }

  const updateTranslationMatch = text.match(
    /^update\s+(?:the\s+)?(ru|en|de|me|es|russian|english|german|deutsch|montenegrin|crnogorski|spanish|espanol|español)\s+translation\s+for\s+(.+)$/i
  );

  if (updateTranslationMatch) {
    return {
      targetRef: sanitizeTargetRef(updateTranslationMatch[2]),
      locale: normalizeLocaleHint(updateTranslationMatch[1]),
    };
  }

  const addTranslationMatch = text.match(
    /^add\s+(?:the\s+)?(ru|en|de|me|es|russian|english|german|deutsch|montenegrin|crnogorski|spanish|espanol|español)\s+translation\s+for\s+(.+)$/i
  );

  if (addTranslationMatch) {
    return {
      targetRef: sanitizeTargetRef(addTranslationMatch[2]),
      locale: normalizeLocaleHint(addTranslationMatch[1]),
    };
  }

  return null;
}

function inferEntity(normalizedText, fallback) {
  if (normalizedText.includes("participant") || normalizedText.includes("profile")) {
    return "participant";
  }

  if (normalizedText.includes("project")) {
    return "project";
  }

  if (normalizedText.includes("meeting")) {
    return "meeting";
  }

  if (normalizedText.includes("announcement") || normalizedText.includes("announce")) {
    return "announcement";
  }

  return fallback;
}

function sanitizeTargetRef(value) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim().replace(/[.!?]+$/, "").trim();
  return cleaned || null;
}

function buildContentOperation({ entity, action, targetRef, summary, fields }) {
  const extraction = {
    intent: "content_operation",
    entity,
    action,
    slug: null,
    targetRef,
    confidence: "medium",
    needsConfirmation: true,
    summary,
    fields,
    questions: [],
    warnings: ["heuristic-fallback"],
  };

  validateExtraction(extraction);
  return extraction;
}

function buildTranslationOperation({ entity, targetRef, locale, summary }) {
  const extraction = {
    intent: "translation_operation",
    entity,
    action: "update",
    slug: null,
    targetRef,
    confidence: locale ? "medium" : "low",
    needsConfirmation: true,
    summary,
    fields: locale ? { locale } : {},
    questions: locale ? [] : ["Which locale should I update: ru, en, de, me, or es?"],
    warnings: ["heuristic-fallback"],
  };

  validateExtraction(extraction);
  return extraction;
}

function normalizeLocaleHint(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  switch (normalized) {
    case "ru":
    case "russian":
      return "ru";
    case "en":
    case "english":
      return "en";
    case "de":
    case "german":
    case "deutsch":
      return "de";
    case "me":
    case "montenegrin":
    case "crnogorski":
      return "me";
    case "es":
    case "spanish":
    case "espanol":
    case "español":
      return "es";
    default:
      return null;
  }
}

function isSimpleHeuristicTarget(targetRef) {
  if (typeof targetRef !== "string") {
    return false;
  }

  const normalized = targetRef.trim().toLowerCase();

  if (!normalized || normalized.length > 80) {
    return false;
  }

  return !(
    normalized.includes("\n") ||
    normalized.includes("http://") ||
    normalized.includes("https://") ||
    /\b(to|with|into|using)\b/.test(normalized) ||
    /\b(bio|role|summary|details|title|description|link|photo|image)\b/.test(normalized)
  );
}
