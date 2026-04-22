export function buildOperationPreview(operation, repositoryPreview = null, options = {}) {
  const files = resolvePreviewFiles(repositoryPreview);
  const attachments = Array.isArray(options.attachments) ? options.attachments : [];
  const changes = buildPreviewChanges(repositoryPreview);

  return {
    entity: operation.entity,
    action: operation.action,
    slug: operation.fields.slug,
    fields: summarizeFields(operation.fields),
    changes,
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

function buildPreviewChanges(repositoryPreview) {
  const currentItem = repositoryPreview?.currentItem;
  const nextItem = repositoryPreview?.nextItem;

  if (!nextItem || typeof nextItem !== "object") {
    return null;
  }

  const fieldOrder = [
    "links",
    "tags",
    "projectSlugs",
    "ownerSlugs",
    "gallery",
    "points",
    "paragraphs",
    "summary",
    "title",
    "name",
    "bio",
    "status",
    "stack",
    "location",
  ];
  const changes = [];

  for (const key of fieldOrder) {
    const currentValue = currentItem?.[key];
    const nextValue = nextItem?.[key];

    if (arePreviewValuesEqual(currentValue, nextValue)) {
      continue;
    }

    const change = summarizePreviewFieldChange(key, currentValue, nextValue);
    if (change) {
      changes.push(change);
    }
  }

  return changes.length > 0 ? changes : null;
}

function summarizePreviewFieldChange(key, currentValue, nextValue) {
  if (Array.isArray(currentValue) || Array.isArray(nextValue)) {
    return summarizeArrayFieldChange(key, currentValue, nextValue);
  }

  return {
    field: key,
    before: summarizeSingleValue(currentValue),
    after: summarizeSingleValue(nextValue),
  };
}

function summarizeArrayFieldChange(key, currentValue, nextValue) {
  const beforeItems = summarizeArrayItems(key, currentValue);
  const afterItems = summarizeArrayItems(key, nextValue);
  const beforeKeys = new Set(beforeItems.map((entry) => entry.key));
  const afterKeys = new Set(afterItems.map((entry) => entry.key));
  const removed = beforeItems.filter((entry) => !afterKeys.has(entry.key)).map((entry) => entry.label);
  const added = afterItems.filter((entry) => !beforeKeys.has(entry.key)).map((entry) => entry.label);

  return {
    field: key,
    beforeCount: beforeItems.length,
    afterCount: afterItems.length,
    added: added.slice(0, 6),
    removed: removed.slice(0, 6),
    after: afterItems.slice(0, 6).map((entry) => entry.label),
  };
}

function summarizeArrayItems(key, value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => summarizeArrayItem(key, entry))
    .filter(Boolean);
}

function summarizeArrayItem(key, entry) {
  if (typeof entry === "string") {
    return {
      key: entry,
      label: summarizeStringField(key, entry),
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  if (key === "links") {
    const href = typeof entry.href === "string" ? entry.href.trim() : "";
    const label = typeof entry.label === "string" ? entry.label.trim() : href;
    if (!href && !label) {
      return null;
    }

    return {
      key: href || label,
      label: label && href ? `${label} -> ${href}` : (label || href),
    };
  }

  if (key === "gallery") {
    const src = typeof entry.src === "string" ? entry.src.trim() : "";
    if (!src) {
      return null;
    }

    return {
      key: src,
      label: entry.alt ? `${entry.alt} -> ${src}` : src,
    };
  }

  const serialized = JSON.stringify(entry);
  return {
    key: serialized,
    label: serialized,
  };
}

function summarizeSingleValue(value) {
  if (typeof value === "string") {
    return summarizeStringField("value", value);
  }

  if (value == null) {
    return null;
  }

  if (typeof value === "object") {
    return "object";
  }

  return value;
}

function arePreviewValuesEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
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

  if (Array.isArray(repositoryPreview.paths?.extraIndexPaths)) {
    files.push(...repositoryPreview.paths.extraIndexPaths);
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
