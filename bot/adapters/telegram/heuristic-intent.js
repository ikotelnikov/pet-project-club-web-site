import { validateExtraction } from "../../core/extraction-validator.js";

export function inferHeuristicExtraction(messageText) {
  const text = typeof messageText === "string" ? messageText.trim() : "";

  if (!text) {
    return null;
  }

  const normalized = text.toLowerCase();
  const deleteMatch =
    text.match(/^delete\s+participant:\s*(.+)$/i) ||
    text.match(/^delete\s+the\s+profile\s+of\s+(.+)$/i) ||
    text.match(/^delete\s+profile\s+of\s+(.+)$/i) ||
    text.match(/^delete\s+(.+)$/i);

  if (deleteMatch) {
    const targetRef = sanitizeTargetRef(deleteMatch[1]);
    if (!targetRef) {
      return null;
    }

    return buildContentOperation({
      entity: inferEntity(normalized, "participant"),
      action: "delete",
      targetRef,
      summary: `delete ${inferEntity(normalized, "participant")} ${targetRef}`,
      fields: {},
    });
  }

  const updateMatch =
    text.match(/^update\s+participant:\s*(.+)$/i) ||
    text.match(/^let'?s\s+update\s+(.+)$/i) ||
    text.match(/^update\s+(.+)$/i);

  if (updateMatch) {
    const targetRef = sanitizeTargetRef(updateMatch[1]);
    if (!targetRef) {
      return null;
    }

    return buildContentOperation({
      entity: inferEntity(normalized, "participant"),
      action: "update",
      targetRef,
      summary: `update ${inferEntity(normalized, "participant")} ${targetRef}`,
      fields: {},
    });
  }

  const createMatch =
    text.match(/^create\s+participant:\s*(.+)$/i) ||
    text.match(/^add\s+a\s+new\s+participant\s+called\s+(.+)$/i) ||
    text.match(/^create\s+(.+)$/i);

  if (createMatch) {
    const targetRef = sanitizeTargetRef(createMatch[1]);
    if (!targetRef) {
      return null;
    }

    return buildContentOperation({
      entity: inferEntity(normalized, "participant"),
      action: "create",
      targetRef,
      summary: `create ${inferEntity(normalized, "participant")} ${targetRef}`,
      fields: {
        name: targetRef,
      },
    });
  }

  return null;
}

function inferEntity(normalizedText, fallback) {
  if (normalizedText.includes("participant") || normalizedText.includes("profile")) {
    return "participant";
  }

  if (normalizedText.includes("project")) {
    return "project";
  }

  if (normalizedText.includes("meeting")) {
    return "meeting";
  }

  if (normalizedText.includes("announcement") || normalizedText.includes("announce")) {
    return "announcement";
  }

  return fallback;
}

function sanitizeTargetRef(value) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim().replace(/[.!?]+$/, "").trim();
  return cleaned || null;
}

function buildContentOperation({ entity, action, targetRef, summary, fields }) {
  const extraction = {
    intent: "content_operation",
    entity,
    action,
    slug: null,
    targetRef,
    confidence: "medium",
    needsConfirmation: true,
    summary,
    fields,
    questions: [],
    warnings: ["heuristic-fallback"],
  };

  validateExtraction(extraction);
  return extraction;
}
