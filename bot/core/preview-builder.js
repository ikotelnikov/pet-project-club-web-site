export function buildOperationPreview(operation, repositoryPreview = null, options = {}) {
  const files = resolvePreviewFiles(repositoryPreview);
  const attachments = Array.isArray(options.attachments) ? options.attachments : [];

  return {
    entity: operation.entity,
    action: operation.action,
    slug: operation.fields.slug,
    fields: summarizeFields(operation.fields),
    files,
    hasPhoto: Boolean(operation.fields.photoAlt || operation.fields.photoalt),
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

    summary[key] = value;
  }

  return summary;
}
