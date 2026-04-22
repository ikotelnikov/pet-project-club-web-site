import { ContentValidationError } from "../shared/errors.js";
import { SLUG_PATTERN } from "../shared/constants.js";

const ENTITY_FIELD_RULES = {
  announcement: new Set(["type", "date", "title", "place", "placeUrl", "placeurl", "format", "paragraphs", "detailsHtml", "sections", "section", "links", "link", "projectSlugs", "photoAlt", "photoalt", "photoStagedPath", "photoAction", "slug", "locale", "sourceLocale"]),
  announce: new Set(["type", "date", "title", "place", "placeUrl", "placeurl", "format", "paragraphs", "detailsHtml", "sections", "section", "links", "link", "projectSlugs", "photoAlt", "photoalt", "photoStagedPath", "photoAction", "slug", "locale", "sourceLocale"]),
  meeting: new Set(["type", "date", "title", "place", "placeUrl", "placeurl", "format", "paragraphs", "detailsHtml", "sections", "section", "links", "link", "projectSlugs", "photoAlt", "photoalt", "photoStagedPath", "photoAction", "slug", "locale", "sourceLocale"]),
  participant: new Set(["handle", "name", "role", "bio", "points", "location", "tags", "links", "link", "photoAlt", "photoalt", "photoStagedPath", "photoAction", "slug", "locale", "sourceLocale"]),
  project: new Set(["title", "status", "stack", "summary", "detailsHtml", "points", "location", "tags", "ownerSlugs", "owners", "links", "link", "photoAlt", "photoalt", "photoStagedPath", "photoAction", "gallery", "slug", "locale", "sourceLocale"]),
};

export function validateOperation(operation) {
  const { entity, action, fields } = operation;

  if (!entity || !action || !fields || typeof fields !== "object") {
    throw new ContentValidationError("Operation must include entity, action, and fields.");
  }

  if (!fields.slug || !SLUG_PATTERN.test(fields.slug)) {
    throw new ContentValidationError("Operation field 'slug' must use lowercase letters, numbers, and hyphens only.");
  }

  const allowedFields = ENTITY_FIELD_RULES[entity];

  if (!allowedFields) {
    throw new ContentValidationError(`Unsupported entity '${entity}'.`);
  }

  for (const fieldName of Object.keys(fields)) {
    if (!allowedFields.has(fieldName)) {
      throw new ContentValidationError(`Field '${fieldName}' is not allowed for entity '${entity}'.`);
    }
  }

  if (action !== "delete") {
    validateFieldShapes(entity, fields);
  }

  return operation;
}

function validateFieldShapes(entity, fields) {
  if (fields.paragraphs && !isNonEmptyStringArray(fields.paragraphs)) {
    throw new ContentValidationError("Field 'paragraphs' must be a non-empty array of strings.");
  }

  if (fields.points && !isNonEmptyStringArray(fields.points)) {
    throw new ContentValidationError("Field 'points' must be a non-empty array of strings.");
  }

  const sections = fields.section ?? fields.sections;

  if (sections && !Array.isArray(sections)) {
    throw new ContentValidationError("Field 'sections' must be an array.");
  }

  if (sections) {
    for (const section of sections) {
      if (!section || typeof section.title !== "string" || !isNonEmptyStringArray(section.items)) {
        throw new ContentValidationError("Each section must contain a title and a non-empty items array.");
      }
    }
  }

  const links = fields.link ?? fields.links;

  if (links) {
    if (!Array.isArray(links)) {
      throw new ContentValidationError("Field 'links' must be an array.");
    }

    for (const link of links) {
      if (!link || typeof link.label !== "string" || typeof link.href !== "string") {
        throw new ContentValidationError("Each link must include 'label' and 'href'.");
      }
    }
  }

  if (fields.photoAction && !["append", "replace", "remove", "clear"].includes(fields.photoAction)) {
    throw new ContentValidationError("Field 'photoAction' must be one of append, replace, remove, or clear.");
  }

  if (fields.gallery) {
    if (!Array.isArray(fields.gallery)) {
      throw new ContentValidationError("Field 'gallery' must be an array.");
    }

    for (const entry of fields.gallery) {
      if (!entry || typeof entry.src !== "string" || entry.src.trim() === "") {
        throw new ContentValidationError("Each gallery entry must include a non-empty 'src'.");
      }
    }
  }

  if ((entity === "project" || entity === "participant") && fields.tags && !isNonEmptyStringArray(fields.tags)) {
    throw new ContentValidationError("Field 'tags' must be a non-empty array of strings.");
  }

  if ((entity === "announce" || entity === "announcement" || entity === "meeting") && fields.projectSlugs && !isNonEmptyStringArray(fields.projectSlugs)) {
    throw new ContentValidationError("Field 'projectSlugs' must be a non-empty array of strings.");
  }

  if ((entity === "announce" || entity === "announcement" || entity === "meeting") && fields.type && !["announce", "meeting"].includes(fields.type)) {
    throw new ContentValidationError("Field 'type' must be 'announce' or 'meeting'.");
  }

  if (entity === "project") {
    const ownerSlugs = fields.ownerSlugs ?? fields.owners;
    if (ownerSlugs && !isNonEmptyStringArray(ownerSlugs)) {
      throw new ContentValidationError("Field 'ownerSlugs' must be a non-empty array of strings.");
    }
  }
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim() !== "");
}
