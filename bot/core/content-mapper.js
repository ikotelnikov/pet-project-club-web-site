import { ContentValidationError } from "../shared/errors.js";

export function mapOperationToContent(operation, options = {}) {
  const { entity, action, fields } = operation;

  if (action === "delete") {
    return {
      slug: fields.slug,
      item: null,
    };
  }

  const photo = buildPhoto(entity, fields, options.photoFilename || null);
  const links = buildLinks(fields.link ?? fields.links);

  switch (entity) {
    case "announce":
    case "announcement":
      return {
        slug: fields.slug,
        item: pruneEmpty({
          slug: fields.slug,
          type: "announce",
          date: fields.date,
          title: fields.title,
          place: fields.place,
          placeUrl: fields.placeurl ?? fields.placeUrl,
          format: fields.format,
          photo,
          paragraphs: fields.paragraphs,
          sections: fields.section ?? fields.sections,
          links,
        }),
      };
    case "meeting":
      return {
        slug: fields.slug,
        item: pruneEmpty({
          slug: fields.slug,
          type: "meeting",
          date: fields.date,
          title: fields.title,
          place: fields.place,
          placeUrl: fields.placeurl ?? fields.placeUrl,
          format: fields.format,
          photo,
          paragraphs: fields.paragraphs,
          sections: fields.section ?? fields.sections,
          links,
        }),
      };
    case "participant":
      return {
        slug: fields.slug,
        item: pruneEmpty({
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
        }),
      };
    case "project":
      return {
        slug: fields.slug,
        item: pruneEmpty({
          slug: fields.slug,
          title: fields.title,
          status: fields.status,
          stack: fields.stack,
          summary: fields.summary,
          points: fields.points,
          photo,
          links,
          ownerSlugs: fields.owners ?? fields.ownerSlugs,
          location: fields.location,
          tags: fields.tags,
        }),
      };
    default:
      throw new ContentValidationError(`Unsupported entity '${entity}'.`);
  }
}

export function mapCommandToContent(parsedCommand, options = {}) {
  return mapOperationToContent(parsedCommand, options);
}

function buildPhoto(entity, fields, photoFilename) {
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
