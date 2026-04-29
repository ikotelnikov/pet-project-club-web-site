function normalizeEntity(entity) {
  return entity === "announcement" ? "announce" : entity;
}

function getProjectGallery(currentObject) {
  if (Array.isArray(currentObject?.gallery) && currentObject.gallery.length > 0) {
    return currentObject.gallery
      .filter((entry) => entry?.src)
      .map((entry) => ({ ...entry }));
  }

  if (currentObject?.photo?.src) {
    return [{ ...currentObject.photo }];
  }

  return [];
}

function buildBaseLegacyFields(entity, currentObject = {}) {
  switch (entity) {
    case "announcement":
    case "meeting":
      return {
        date: currentObject.date,
        title: currentObject.title,
        place: currentObject.place,
        placeUrl: currentObject.placeUrl,
        format: currentObject.format,
        paragraphs: currentObject.paragraphs,
        detailsHtml: currentObject.detailsHtml,
        sections: currentObject.sections,
        links: currentObject.links,
        projectSlugs: currentObject.projectSlugs,
        photoAlt: currentObject.photo?.alt,
        photoStagedPath: currentObject.photo?.src ?? null,
        sourceLocale: currentObject.sourceLocale || "ru",
      };
    case "participant":
      return {
        handle: currentObject.handle,
        name: currentObject.name,
        role: currentObject.role,
        bio: currentObject.bio,
        points: currentObject.points,
        location: currentObject.location,
        tags: currentObject.tags,
        links: currentObject.links,
        photoAlt: currentObject.photo?.alt,
        photoStagedPath: currentObject.photo?.src ?? null,
        sourceLocale: currentObject.sourceLocale || "ru",
      };
    case "project":
      return {
        title: currentObject.title,
        status: currentObject.status,
        stack: currentObject.stack,
        summary: currentObject.summary,
        detailsHtml: currentObject.detailsHtml,
        points: currentObject.points,
        location: currentObject.location,
        tags: currentObject.tags,
        ownerSlugs: currentObject.ownerSlugs,
        links: currentObject.links,
        photoAlt: currentObject.photo?.alt,
        photoStagedPath: currentObject.photo?.src ?? null,
        gallery: getProjectGallery(currentObject),
        sourceLocale: currentObject.sourceLocale || "ru",
      };
    default:
      return {
        sourceLocale: currentObject.sourceLocale || "ru",
      };
  }
}

function normalizeAttachmentEntries(attachments = [], indices = []) {
  const normalized = [];

  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= attachments.length) {
      continue;
    }

    const attachment = attachments[index];
    if (attachment?.kind === "photo" && typeof attachment.stagedPath === "string" && attachment.stagedPath.trim() !== "") {
      normalized.push(attachment);
    }
  }

  return normalized;
}

function getPhotoAttachments(attachments = []) {
  return attachments.filter((attachment) => (
    attachment?.kind === "photo" &&
    typeof attachment.stagedPath === "string" &&
    attachment.stagedPath.trim() !== ""
  ));
}

function hasExplicitPhotoChange(entity, fields = {}) {
  if (!fields || typeof fields !== "object") {
    return false;
  }

  if (typeof fields.photoAction === "string" && fields.photoAction.trim() !== "") {
    return true;
  }

  if (typeof fields.photoStagedPath === "string" && fields.photoStagedPath.trim() !== "") {
    return true;
  }

  if (entity === "project" && Array.isArray(fields.gallery)) {
    return fields.gallery.some((entry) => typeof entry?.src === "string" && entry.src.trim() !== "");
  }

  return false;
}

function buildImplicitPhotoPatch({
  entity,
  currentObject,
  fields = {},
  attachments = [],
}) {
  const photoAttachments = getPhotoAttachments(attachments);
  if (photoAttachments.length === 0 || hasExplicitPhotoChange(entity, fields)) {
    return null;
  }

  const fallbackAlt =
    fields.photoAlt ||
    currentObject?.photo?.alt ||
    fields.title ||
    fields.name ||
    fields.slug ||
    currentObject?.title ||
    currentObject?.name ||
    currentObject?.slug;

  if (entity === "project") {
    const existing = Array.isArray(fields.gallery)
      ? fields.gallery
          .filter((entry) => typeof entry?.src === "string" && entry.src.trim() !== "")
          .map((entry) => ({ ...entry }))
      : getProjectGallery(currentObject);
    const appended = photoAttachments.map((attachment) => ({
      src: attachment.stagedPath,
      alt: fallbackAlt,
    }));
    const nextGallery = [...existing, ...appended];

    return {
      gallery: nextGallery,
      photoAlt: nextGallery[0]?.alt ?? fallbackAlt,
      photoStagedPath: nextGallery[0]?.src ?? null,
      photoAction: existing.length > 0 ? "append" : "replace",
    };
  }

  return {
    photoAlt: fallbackAlt,
    photoStagedPath: photoAttachments[0].stagedPath,
    photoAction: "replace",
  };
}

function applyAssetActionsToPatch({ entity, currentObject, patch = {}, assetActions = [], attachments = [] }) {
  if (!Array.isArray(assetActions) || assetActions.length === 0) {
    return patch;
  }

  let nextPatch = { ...patch };

  for (const action of assetActions) {
    if (!action || typeof action !== "object") {
      continue;
    }

    if (action.kind === "set_primary_photo") {
      const selected = normalizeAttachmentEntries(attachments, [action.attachmentIndex])[0];
      if (!selected) {
        continue;
      }

      const alt = action.alt || currentObject?.photo?.alt || currentObject?.title || currentObject?.name || currentObject?.slug;

      if (entity === "project") {
        const existing = getProjectGallery(currentObject);
        const rest = existing.slice(1);
        nextPatch = {
          ...nextPatch,
          gallery: [{ src: selected.stagedPath, alt }, ...rest],
          photoAlt: alt,
          photoStagedPath: selected.stagedPath,
          photoAction: "replace",
        };
      } else {
        nextPatch = {
          ...nextPatch,
          photoAlt: alt,
          photoStagedPath: selected.stagedPath,
          photoAction: "replace",
        };
      }
    }

    if (action.kind === "append_photos" && entity === "project") {
      const selected = normalizeAttachmentEntries(attachments, Array.isArray(action.attachmentIndices) ? action.attachmentIndices : []);
      if (selected.length === 0) {
        continue;
      }

      const alt = action.alt || currentObject?.photo?.alt || currentObject?.title || currentObject?.slug;
      const existing = Array.isArray(nextPatch.gallery)
        ? nextPatch.gallery.map((entry) => ({ ...entry }))
        : getProjectGallery(currentObject);

      const appended = selected.map((attachment) => ({
        src: attachment.stagedPath,
        alt,
      }));

      const nextGallery = [...existing, ...appended];
      nextPatch = {
        ...nextPatch,
        gallery: nextGallery,
        photoAlt: nextGallery[0]?.alt ?? alt,
        photoStagedPath: nextGallery[0]?.src ?? null,
        photoAction: "append",
      };
    }
  }

  return nextPatch;
}

export async function operationToLegacyCommand({
  operation,
  resolved,
  attachments = [],
}) {
  if (operation.action === "create") {
    const fieldsFromAssets = applyAssetActionsToPatch({
      entity: operation.entity,
      currentObject: null,
      patch: operation.newObject || {},
      assetActions: operation.assetActions || [],
      attachments,
    });
    const implicitPhotoPatch = buildImplicitPhotoPatch({
      entity: operation.entity,
      currentObject: null,
      fields: fieldsFromAssets,
      attachments,
    });
    const fields = implicitPhotoPatch
      ? {
          ...fieldsFromAssets,
          ...implicitPhotoPatch,
        }
      : fieldsFromAssets;

    return {
      entity: normalizeEntity(operation.entity),
      action: "create",
      fields,
    };
  }

  if (operation.action === "update") {
    const baseFields = buildBaseLegacyFields(operation.entity, resolved.currentObject || {});
    const patch = applyAssetActionsToPatch({
      entity: operation.entity,
      currentObject: resolved.currentObject || {},
      patch: operation.patch || {},
      assetActions: operation.assetActions || [],
      attachments,
    });
    const implicitPhotoPatch = buildImplicitPhotoPatch({
      entity: operation.entity,
      currentObject: resolved.currentObject || {},
      fields: patch,
      attachments,
    });

    return {
      entity: normalizeEntity(operation.entity),
      action: "update",
      fields: {
        ...baseFields,
        ...patch,
        ...(implicitPhotoPatch || {}),
        slug: operation.targetSlug,
      },
    };
  }

  if (operation.action === "delete") {
    return {
      entity: normalizeEntity(operation.entity),
      action: "delete",
      fields: {
        slug: operation.targetSlug,
      },
    };
  }

  throw new Error(`Unsupported v2 action '${operation.action}'.`);
}
