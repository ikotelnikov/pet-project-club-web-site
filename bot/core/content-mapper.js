import { ContentValidationError } from "../shared/errors.js";
import { buildLocalizedItemPatch, DEFAULT_SOURCE_LOCALE, normalizeContentLocale } from "./content-localization.js";

export function mapOperationToContent(operation, options = {}) {
  const { entity, action, fields } = operation;

  if (action === "delete") {
    return {
      slug: fields.slug,
      item: null,
    };
  }

  const photo = buildPhoto(entity, fields, options.photoFilename || null);
  const gallery = buildGallery(entity, fields, options.photoFilename || null);
  const links = buildLinks(fields.link ?? fields.links);

  switch (entity) {
    case "announce":
    case "announcement":
      return {
        slug: fields.slug,
        item: toLocalizedItemPatch(entity, pruneEmpty({
          slug: fields.slug,
          type: fields.type || "announce",
          date: fields.date,
          title: fields.title,
          place: fields.place,
          placeUrl: fields.placeurl ?? fields.placeUrl,
          format: fields.format,
          photo,
          paragraphs: fields.paragraphs,
          detailsHtml: fields.detailsHtml,
          sections: fields.section ?? fields.sections,
          links,
        }), fields, options),
      };
    case "meeting":
      return {
        slug: fields.slug,
        item: toLocalizedItemPatch(entity, pruneEmpty({
          slug: fields.slug,
          type: fields.type || "meeting",
          date: fields.date,
          title: fields.title,
          place: fields.place,
          placeUrl: fields.placeurl ?? fields.placeUrl,
          format: fields.format,
          photo,
          paragraphs: fields.paragraphs,
          detailsHtml: fields.detailsHtml,
          sections: fields.section ?? fields.sections,
          links,
        }), fields, options),
      };
    case "participant":
      return {
        slug: fields.slug,
        item: toLocalizedItemPatch(entity, pruneEmpty({
          slug: fields.slug,
          handle: fields.handle,
          name: fields.name,
          role: fields.role,
          bio: fields.bio,
          points: fields.points,
          photo,
          links,
          location: fields.location,
          tags: fields.tags,
        }), fields, options),
      };
    case "project":
      const normalizedProjectText = normalizeProjectTextFields(fields);
      return {
        slug: fields.slug,
        item: toLocalizedItemPatch(entity, pruneEmpty({
          slug: fields.slug,
          title: fields.title,
          status: fields.status,
          stack: fields.stack,
          summary: normalizedProjectText.summary,
          detailsHtml: normalizedProjectText.detailsHtml,
          points: fields.points,
          photo,
          gallery,
          links,
          ownerSlugs: fields.owners ?? fields.ownerSlugs,
          location: fields.location,
          tags: fields.tags,
        }), fields, options),
      };
    default:
      throw new ContentValidationError(`Unsupported entity '${entity}'.`);
  }
}

function toLocalizedItemPatch(entity, item, fields, options = {}) {
  const sourceLocale = normalizeContentLocale(options.sourceLocale || fields.sourceLocale || DEFAULT_SOURCE_LOCALE) || DEFAULT_SOURCE_LOCALE;
  return buildLocalizedItemPatch(entity, {
    ...item,
    locale: fields.locale,
    sourceLocale: fields.sourceLocale,
  }, {
    sourceLocale,
  });
}

function normalizeProjectTextFields(fields) {
  const rawSummary = typeof fields.summary === "string" ? fields.summary.trim() : "";
  const rawDetailsHtml = typeof fields.detailsHtml === "string" ? fields.detailsHtml.trim() : "";

  if (rawDetailsHtml) {
    const normalizedDetailsHtml = looksLikeHtml(rawDetailsHtml)
      ? rawDetailsHtml
      : textToHtmlParagraphs(rawDetailsHtml);

    return {
      summary: rawSummary || summarizeRichText(rawDetailsHtml),
      detailsHtml: normalizedDetailsHtml,
    };
  }

  if (rawSummary.length > 320) {
    return {
      summary: summarizePlainText(rawSummary),
      detailsHtml: textToHtmlParagraphs(rawSummary),
    };
  }

  return {
    summary: rawSummary || undefined,
    detailsHtml: undefined,
  };
}

function summarizeRichText(html) {
  const plainText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return summarizePlainText(plainText);
}

function summarizePlainText(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return undefined;
  }

  const normalized = text.trim().replace(/\s+/g, " ");
  const firstSentenceMatch = normalized.match(/^(.{1,220}?[.!?])(\s|$)/);

  if (firstSentenceMatch) {
    return firstSentenceMatch[1].trim();
  }

  if (normalized.length <= 220) {
    return normalized;
  }

  return `${normalized.slice(0, 217).trimEnd()}...`;
}

function textToHtmlParagraphs(text) {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function looksLikeHtml(value) {
  return /<[^>]+>/.test(value);
}

export function mapCommandToContent(parsedCommand, options = {}) {
  return mapOperationToContent(parsedCommand, options);
}

function buildPhoto(entity, fields, photoFilename) {
  if (entity === "project" && Array.isArray(fields.gallery)) {
    const firstEntry = fields.gallery.find((entry) => entry?.src);
    return firstEntry ? normalizePhotoEntry(firstEntry) : null;
  }

  const photoSrcPath = fields.photoStagedPath ?? null;
  const photoAlt = fields.photoalt ?? fields.photoAlt ?? buildFallbackPhotoAlt(fields);

  if (!photoFilename && !photoSrcPath) {
    return undefined;
  }

  if ((photoFilename || photoSrcPath) && !photoAlt) {
    throw new ContentValidationError("Photo file is present, but 'photoalt' is missing.");
  }

  return {
    src: photoSrcPath || `assets/${resolveAssetFolder(entity)}/${photoFilename}`,
    alt: photoAlt,
  };
}

function buildGallery(entity, fields, photoFilename) {
  if (entity !== "project") {
    return undefined;
  }

  if (Array.isArray(fields.gallery)) {
    return fields.gallery.map((entry) => normalizePhotoEntry(entry)).filter((entry) => entry?.src);
  }

  const singlePhoto = buildPhoto(entity, fields, photoFilename);
  return singlePhoto ? [singlePhoto] : undefined;
}

function normalizePhotoEntry(entry) {
  if (!entry || typeof entry !== "object" || typeof entry.src !== "string" || entry.src.trim() === "") {
    return null;
  }

  return {
    src: entry.src,
    alt: entry.alt || undefined,
  };
}

function buildFallbackPhotoAlt(fields) {
  return fields.name || fields.title || fields.slug || undefined;
}

function buildLinks(linkEntries) {
  if (!Array.isArray(linkEntries) || linkEntries.length === 0) {
    return undefined;
  }

  return linkEntries;
}

function resolveAssetFolder(entity) {
  switch (entity) {
    case "announce":
    case "announcement":
    case "meeting":
      return "meetings";
    case "participant":
      return "participants";
    case "project":
      return "projects";
    default:
      throw new ContentValidationError(`Unsupported entity '${entity}'.`);
  }
}

function pruneEmpty(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}
