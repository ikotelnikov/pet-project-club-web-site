export function dedupeLinks(links) {
  if (!Array.isArray(links) || links.length === 0) {
    return links;
  }

  const deduped = [];
  const seenByKey = new Map();

  for (const link of links) {
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

export function normalizeLinks(links) {
  if (!Array.isArray(links)) {
    return links;
  }

  return links
    .map((link) => normalizeLink(link))
    .filter(Boolean);
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
  if (typeof link === "string") {
    return normalizeLink({ href: link });
  }

  if (!link || typeof link !== "object") {
    return null;
  }

  const rawLabel = typeof link.label === "string" ? link.label.trim() : "";
  const href = resolveHref(link, rawLabel);
  const label = rawLabel && rawLabel !== href
    ? rawLabel
    : deriveLinkLabel(href);

  if (!label || !href) {
    return null;
  }

  return {
    label,
    href,
    ...(link.external === true || isExternalHref(href) ? { external: true } : {}),
  };
}

function normalizeHref(href) {
  if (typeof href !== "string" || href.trim() === "") {
    return null;
  }

  return href.trim();
}

function resolveHref(link, rawLabel) {
  const directHref = normalizeHref(link.href);
  if (directHref) {
    return normalizeContactHref(directHref);
  }

  for (const fieldName of ["url", "uri", "link", "value", "text"]) {
    const candidate = normalizeHref(link[fieldName]);
    if (candidate) {
      return normalizeContactHref(candidate);
    }
  }

  const hrefFromLabel = normalizeHref(rawLabel);
  return hrefFromLabel && looksLikeHref(hrefFromLabel)
    ? normalizeContactHref(hrefFromLabel)
    : null;
}

function normalizeContactHref(href) {
  const trimmed = String(href || "").trim();
  if (/^@[a-z0-9_]{3,}$/i.test(trimmed)) {
    return `https://t.me/${trimmed.slice(1)}`;
  }

  if (/^t\.me\/[a-z0-9_/?=&.-]+$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

function looksLikeHref(value) {
  return (
    /^https?:\/\//i.test(value) ||
    /^mailto:/i.test(value) ||
    /^tel:/i.test(value) ||
    /^t\.me\//i.test(value) ||
    /^@[a-z0-9_]{3,}$/i.test(value) ||
    /^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(value)
  );
}

function deriveLinkLabel(href) {
  if (!href) {
    return "";
  }

  const normalized = String(href).trim();
  const lower = normalized.toLowerCase();

  if (lower.startsWith("mailto:")) {
    return "Email";
  }

  if (lower.startsWith("tel:")) {
    return "Phone";
  }

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();

    if (hostname === "t.me" || hostname.endsWith(".telegram.org")) {
      return "Telegram";
    }

    if (hostname === "instagram.com") {
      return "Instagram";
    }

    if (hostname === "linkedin.com") {
      return "LinkedIn";
    }

    if (hostname === "github.com") {
      return "GitHub";
    }

    if (hostname === "x.com" || hostname === "twitter.com") {
      return "X / Twitter";
    }

    return hostname;
  } catch {
    if (/^@[a-z0-9_]{3,}$/i.test(normalized) || /^t\.me\//i.test(normalized)) {
      return "Telegram";
    }

    return normalized;
  }
}

function isExternalHref(href) {
  return /^(https?:|mailto:|tel:)/i.test(String(href || "").trim());
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
