export function dedupeLinks(links) {
  if (!Array.isArray(links) || links.length === 0) {
    return links;
  }

  const deduped = [];
  const seenByKey = new Map();

  for (const link of links) {
    if (!link || typeof link !== "object") {
      continue;
    }

    const normalized = normalizeLink(link);
    if (!normalized) {
      continue;
    }

    const key = buildLinkKey(normalized.href);
    const existingIndex = seenByKey.get(key);

    if (existingIndex == null) {
      seenByKey.set(key, deduped.length);
      deduped.push(normalized);
      continue;
    }

    if (scoreLinkLabel(normalized.label) > scoreLinkLabel(deduped[existingIndex].label)) {
      deduped[existingIndex] = normalized;
    }
  }

  return deduped;
}

export function buildLinkKey(href) {
  try {
    const url = new URL(String(href).trim());
    const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.hostname.replace(/^www\./i, "").toLowerCase()}${normalizedPath}${url.search}`;
  } catch {
    return String(href || "").trim().toLowerCase();
  }
}

function normalizeLink(link) {
  const label = typeof link.label === "string" ? link.label.trim() : "";
  const href = normalizeHref(link.href);

  if (!label || !href) {
    return null;
  }

  return {
    label,
    href,
    ...(link.external === true ? { external: true } : {}),
  };
}

function normalizeHref(href) {
  if (typeof href !== "string" || href.trim() === "") {
    return null;
  }

  const trimmed = href.trim();

  try {
    return new URL(trimmed).href;
  } catch {
    return trimmed;
  }
}

function scoreLinkLabel(label) {
  const normalized = String(label || "").trim().toLowerCase();

  if (!normalized) {
    return 0;
  }

  if (normalized === "telegram" || normalized === "instagram" || normalized === "linkedin" || normalized === "github" || normalized === "x / twitter") {
    return 3;
  }

  if (normalized.includes(".com") || normalized.includes(".me") || normalized.includes(".org") || normalized.includes(".net")) {
    return 1;
  }

  return 2;
}
