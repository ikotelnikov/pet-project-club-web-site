export function buildOperationPreview(operation, repositoryPreview = null, options = {}) {
  const files = resolvePreviewFiles(repositoryPreview);
  const attachments = Array.isArray(options.attachments) ? options.attachments : [];

  return {
    entity: operation.entity,
    action: operation.action,
    slug: operation.fields.slug,
    fields: summarizeFields(operation.fields),
    files,
    hasPhoto: Boolean(
      operation.fields.photoAlt ||
      operation.fields.photoalt ||
      operation.fields.photoStagedPath ||
      (Array.isArray(operation.fields.gallery) && operation.fields.gallery.length > 0)
    ),
    attachments: attachments.map((attachment) => ({
      kind: attachment.kind,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
    })),
  };
}

function resolvePreviewFiles(repositoryPreview) {
  if (!repositoryPreview) {
    return [];
  }

  const files = [];

  if (repositoryPreview.paths?.itemPath) {
    files.push(repositoryPreview.paths.itemPath);
  }

  if (repositoryPreview.paths?.indexPath) {
    files.push(repositoryPreview.paths.indexPath);
  }

  if (Array.isArray(repositoryPreview.paths?.assetPaths)) {
    files.push(...repositoryPreview.paths.assetPaths);
  }

  return files;
}

function summarizeFields(fields) {
  const summary = {};

  for (const [key, value] of Object.entries(fields)) {
    if (key === "slug") {
      continue;
    }

    if (Array.isArray(value)) {
      summary[key] = value.length;
      continue;
    }

    if (value && typeof value === "object") {
      summary[key] = "object";
      continue;
    }

    if (typeof value === "string") {
      summary[key] = summarizeStringField(key, value);
      continue;
    }

    summary[key] = value;
  }

  return summary;
}

function summarizeStringField(key, value) {
  if (/html$/i.test(key)) {
    const plainText = value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return plainText.length > 140 ? `${plainText.slice(0, 137).trimEnd()}...` : plainText;
  }

  if (value.length > 140) {
    return `${value.slice(0, 137).trimEnd()}...`;
  }

  return value;
}
