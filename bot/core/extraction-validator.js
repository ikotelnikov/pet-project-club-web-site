import { ContentValidationError } from "../shared/errors.js";
import { SLUG_PATTERN } from "../shared/constants.js";

const INTENTS = new Set([
  "content_operation",
  "translation_operation",
  "clarification_response",
  "confirmation_response",
  "non_actionable",
]);

const ENTITIES = new Set([
  "announcement",
  "meeting",
  "participant",
  "project",
]);

const ACTIONS = new Set([
  "create",
  "update",
  "delete",
]);

const CONFIDENCE_VALUES = new Set([
  "high",
  "medium",
  "low",
]);

const ENTITY_FIELD_RULES = {
  announcement: new Set(["slug", "type", "date", "title", "place", "placeUrl", "format", "paragraphs", "detailsHtml", "sections", "links", "projectSlugs", "photoAlt", "photoStagedPath", "photoAction", "locale", "sourceLocale"]),
  meeting: new Set(["slug", "type", "date", "title", "place", "placeUrl", "format", "paragraphs", "detailsHtml", "sections", "links", "projectSlugs", "photoAlt", "photoStagedPath", "photoAction", "locale", "sourceLocale"]),
  participant: new Set(["slug", "handle", "name", "role", "bio", "detailsHtml", "points", "location", "tags", "links", "photoAlt", "photoStagedPath", "photoAction", "locale", "sourceLocale"]),
  project: new Set(["slug", "title", "status", "stack", "summary", "detailsHtml", "points", "location", "tags", "ownerSlugs", "links", "photoAlt", "photoStagedPath", "photoAction", "gallery", "locale", "sourceLocale"]),
};

export function validateExtraction(extraction) {
  if (!extraction || typeof extraction !== "object") {
    throw new ContentValidationError("Extraction must be an object.");
  }

  requireStringEnum(extraction.intent, INTENTS, "intent");
  requireStringEnum(extraction.confidence, CONFIDENCE_VALUES, "confidence");

  if (!Array.isArray(extraction.questions) || !extraction.questions.every(isNonEmptyString)) {
    throw new ContentValidationError("Extraction field 'questions' must be an array of non-empty strings.");
  }

  if (!Array.isArray(extraction.warnings) || !extraction.warnings.every(isNonEmptyString)) {
    throw new ContentValidationError("Extraction field 'warnings' must be an array of non-empty strings.");
  }

  if (typeof extraction.summary !== "string" || extraction.summary.trim() === "") {
    throw new ContentValidationError("Extraction field 'summary' must be a non-empty string.");
  }

  if (typeof extraction.needsConfirmation !== "boolean") {
    throw new ContentValidationError("Extraction field 'needsConfirmation' must be a boolean.");
  }

  if (extraction.intent === "content_operation" || extraction.intent === "translation_operation") {
    validateContentOperationExtraction(extraction);
  } else {
    validateNonOperationExtraction(extraction);
  }

  return extraction;
}

function validateContentOperationExtraction(extraction) {
  requireStringEnum(extraction.entity, ENTITIES, "entity");
  if (extraction.intent === "translation_operation") {
    if (
      extraction.action !== "create" &&
      extraction.action !== "update" &&
      extraction.action !== null
    ) {
      throw new ContentValidationError("Translation operations support only create, update, or null action.");
    }
  } else {
    requireStringEnum(extraction.action, ACTIONS, "action");
  }

  if (extraction.slug != null) {
    requireSlug(extraction.slug);
  }

  if (extraction.fields?.slug != null) {
    requireSlug(extraction.fields.slug);
  }

  if (!extraction.fields || typeof extraction.fields !== "object" || Array.isArray(extraction.fields)) {
    throw new ContentValidationError("Extraction field 'fields' must be an object.");
  }

  if (extraction.needsConfirmation !== true) {
    throw new ContentValidationError("Content operations must require confirmation.");
  }

  if (extraction.confidence === "low" && extraction.questions.length === 0) {
    throw new ContentValidationError("Low-confidence content operations must include at least one clarification question.");
  }

  const allowedFields = ENTITY_FIELD_RULES[extraction.entity];

  for (const fieldName of Object.keys(extraction.fields)) {
    if (!allowedFields.has(fieldName)) {
      throw new ContentValidationError(`Extraction field '${fieldName}' is not allowed for entity '${extraction.entity}'.`);
    }
  }

  validateFieldShapes(extraction.entity, extraction.fields);

  if (
    extraction.intent === "translation_operation" &&
    extraction.fields.locale != null &&
    !["ru", "en", "de", "me", "es"].includes(extraction.fields.locale)
  ) {
    throw new ContentValidationError("Translation operation field 'locale' must be one of ru, en, de, me, es.");
  }

  const hasResolvableTarget =
    typeof extraction.slug === "string" ||
    typeof extraction.targetRef === "string" ||
    typeof extraction.fields?.handle === "string" ||
    typeof extraction.fields?.name === "string" ||
    typeof extraction.fields?.title === "string";

  if ((extraction.action === "update" || extraction.action === "delete") && !hasResolvableTarget) {
    throw new ContentValidationError(
      `Extraction action '${extraction.action}' requires a slug or target reference.`
    );
  }
}

function validateNonOperationExtraction(extraction) {
  if (extraction.entity !== null || extraction.action !== null) {
    throw new ContentValidationError("Non-content intents must set 'entity' and 'action' to null.");
  }

  if (extraction.slug !== null) {
    throw new ContentValidationError("Non-content intents must set 'slug' to null.");
  }

  if (!extraction.fields || typeof extraction.fields !== "object" || Array.isArray(extraction.fields)) {
    throw new ContentValidationError("Extraction field 'fields' must be an object.");
  }

  if (extraction.intent === "confirmation_response") {
    const decision = extraction.fields.decision;
    if (decision !== "confirm" && decision !== "cancel") {
      throw new ContentValidationError("Confirmation responses must include fields.decision = 'confirm' or 'cancel'.");
    }
  }
}

function validateFieldShapes(entity, fields) {
  if (fields.paragraphs && !isStringArray(fields.paragraphs)) {
    throw new ContentValidationError("Extraction field 'paragraphs' must be an array of non-empty strings.");
  }

  if (fields.points && !isStringArray(fields.points)) {
    throw new ContentValidationError("Extraction field 'points' must be an array of non-empty strings.");
  }

  if (fields.tags && !isStringArray(fields.tags)) {
    throw new ContentValidationError("Extraction field 'tags' must be an array of non-empty strings.");
  }

  if (fields.ownerSlugs && !isStringArray(fields.ownerSlugs)) {
    throw new ContentValidationError("Extraction field 'ownerSlugs' must be an array of non-empty strings.");
  }

  if ((entity === "announcement" || entity === "meeting") && fields.projectSlugs && !isStringArray(fields.projectSlugs)) {
    throw new ContentValidationError("Extraction field 'projectSlugs' must be an array of non-empty strings.");
  }

  if ((entity === "announcement" || entity === "meeting") && fields.type && !["announce", "meeting"].includes(fields.type)) {
    throw new ContentValidationError("Extraction field 'type' must be one of announce or meeting.");
  }

  if (fields.sections) {
    if (!Array.isArray(fields.sections)) {
      throw new ContentValidationError("Extraction field 'sections' must be an array.");
    }

    for (const section of fields.sections) {
      if (!section || typeof section.title !== "string" || !isStringArray(section.items)) {
        throw new ContentValidationError("Each section must include a non-empty title and items array.");
      }
    }
  }

  if (fields.links) {
    if (!Array.isArray(fields.links)) {
      throw new ContentValidationError("Extraction field 'links' must be an array.");
    }

    for (const link of fields.links) {
      if (!link || typeof link.label !== "string" || link.label.trim() === "" || typeof link.href !== "string" || link.href.trim() === "") {
        throw new ContentValidationError("Each link must include non-empty 'label' and 'href'.");
      }
    }
  }

  if (fields.photoAction && !["append", "replace", "remove", "clear"].includes(fields.photoAction)) {
    throw new ContentValidationError("Extraction field 'photoAction' must be one of append, replace, remove, or clear.");
  }

  if (fields.gallery) {
    if (!Array.isArray(fields.gallery)) {
      throw new ContentValidationError("Extraction field 'gallery' must be an array.");
    }

    for (const entry of fields.gallery) {
      if (!entry || typeof entry.src !== "string" || entry.src.trim() === "") {
        throw new ContentValidationError("Each gallery entry must include a non-empty 'src'.");
      }
    }
  }

  if (entity === "participant" && fields.handle && typeof fields.handle !== "string") {
    throw new ContentValidationError("Extraction field 'handle' must be a string.");
  }
}

function requireStringEnum(value, allowed, fieldName) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new ContentValidationError(`Extraction field '${fieldName}' has an unsupported value.`);
  }
}

function requireSlug(value) {
  if (typeof value !== "string" || !SLUG_PATTERN.test(value)) {
    throw new ContentValidationError("Extraction field 'slug' must use lowercase letters, numbers, and hyphens only.");
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(isNonEmptyString);
}
