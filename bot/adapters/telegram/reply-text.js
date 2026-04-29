export function buildTelegramReply(result, options = {}) {
  const dryRun = options.dryRun ?? true;
  const devMode = options.devMode ?? false;

  if (!result || !result.status) {
    return {
      text: "Unknown bot result.",
      replyMarkup: null,
    };
  }

  const text = (() => {
  switch (result.status) {
    case "command":
      return buildCommandText(result);
    case "processed":
      return buildPreviewText(result, dryRun);
    case "confirmed":
      return buildConfirmedText(result, dryRun);
    case "cancelled":
      return "Cancelled. No website changes were applied.";
    case "clarification":
      return result.question || "I need one more detail before I can continue.";
    case "control":
      if (result.hasPending) {
        return "There is a pending interaction, but it is not ready for confirmation yet.";
      }

      return "There is no pending action to confirm or cancel.";
    case "failed":
      return buildFailedText(result, devMode);
    case "ignored":
      return buildIgnoredText(result);
    default:
      return "Request received, but no reply formatter exists for this result yet.";
  }
  })();

  return {
    text,
    replyMarkup: buildReplyMarkup(result),
  };
}

export function buildTelegramReplyText(result, options = {}) {
  return buildTelegramReply(result, options).text;
}

function buildCommandText(result) {
  switch (result.command) {
    case "new":
      return result.hadContext
        ? "Context cleared. Start a fresh request with new messages, photos, or forwards."
        : "There was no active context. You can start a fresh request now.";
    case "state":
      return buildStateText(result.contextState);
    case "help":
      return [
        "Send normal text, forwards, links, and photos. The bot keeps an active context for the current task and reprocesses it as new messages arrive.",
        "Main controls:",
        "/new - clear the current context and start over",
        "/state - show the current context: message count, file count, active intent, and current doubt",
        "/help - show this help",
        "Workflow:",
        "- send one or more messages, files, or forwards for the same task",
        "- reply with more details if the bot asks a clarification",
        "- reply with confirm or cancel when you get a preview",
        "- use undo to revert the last applied change when supported",
      ].join("\n");
    default:
      return "Unknown command.";
  }
}

function buildStateText(contextState) {
  if (!contextState?.hasContext) {
    return [
      "Context state: idle",
      "Messages: 0",
      "Files: 0",
      "Intent: none",
      "Doubt: none",
    ].join("\n");
  }

  const intentSummary = formatIntentSummary(contextState.intentSummary);
  const doubt = formatDoubtSummary(contextState.doubt);

  return [
    `Context state: ${contextState.state || "idle"}`,
    `Pending type: ${contextState.operationType || "none"}`,
    `Messages: ${contextState.messageCount || 0}`,
    `Files: ${contextState.fileCount || 0}`,
    `Intent: ${intentSummary}`,
    `Doubt: ${doubt}`,
  ].join("\n");
}

function formatIntentSummary(intentSummary) {
  if (!intentSummary) {
    return "none";
  }

  const parts = [
    intentSummary.intent || intentSummary.action || null,
    intentSummary.entity || null,
    intentSummary.targetRef || intentSummary.slug || null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" ") : "present, but incomplete";
}

function formatDoubtSummary(doubt) {
  if (!doubt) {
    return "none";
  }

  if (doubt.question && doubt.reason) {
    return `${doubt.reason}: ${doubt.question}`;
  }

  return doubt.question || doubt.reason || "present, but unspecified";
}

function buildFailedText(result, devMode = false) {
  const safeError = sanitizeErrorMessage(result.error, devMode);

  if (typeof safeError === "string" && safeError.includes("GitHub API request failed with 403")) {
    return "I reached GitHub but was not allowed to read or write the repository. Check the GitHub token permissions in Cloudflare secrets.";
  }

  if (typeof safeError === "string" && safeError.includes("Operation field 'slug'")) {
    return "I understood the request, but could not derive a valid slug. Try giving a simple latin title or handle.";
  }

  if (safeError) {
    return `I couldn't complete that safely.\nReason: ${safeError}`;
  }

  return "I couldn't interpret that safely. Rephrase it as a content change request.";
}

function buildPreviewText(result, dryRun) {
  const preview = result.pendingState?.operation?.preview || null;
  const continuation = result.pendingState?.operation?.continuationOf || null;
  const entity = preview?.entity || result.parsed?.entity || "content";
  const action = preview?.action || result.parsed?.action || "update";
  const slug = preview?.slug || result.parsed?.fields?.slug || "unknown-slug";
  const fields = preview?.fields || {};
  const changes = Array.isArray(preview?.changes) ? preview.changes : [];
  const files = Array.isArray(preview?.files) ? preview.files : [];
  const attachments = Array.isArray(preview?.attachments) ? preview.attachments : [];
  const fieldLines = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .slice(0, 8)
    .map(([key, value]) => `- ${key}: ${formatValue(value)}`);
  const changeLines = changes
    .slice(0, 6)
    .map((change) => `- ${formatPreviewChange(change)}`)
    .filter(Boolean);
  const fileLines = files.slice(0, 4).map((file) => `- ${file}`);
  const attachmentLines = attachments
    .slice(0, 4)
    .map((attachment) => `- ${attachment.kind}: ${attachment.fileName}${attachment.mimeType ? ` (${attachment.mimeType})` : ""}`);

  return [
    `${dryRun ? "Dry-run preview" : "Preview"}: ${action} ${entity} ${slug}`,
    continuation
      ? `Continuing: ${continuation.entity} ${continuation.slug}${continuation.summary ? ` (${continuation.summary})` : ""}`
      : null,
    changeLines.length > 0 ? `Changes:\n${changeLines.join("\n")}` : null,
    fieldLines.length > 0 ? `Fields:\n${fieldLines.join("\n")}` : null,
    attachmentLines.length > 0 ? `Attachments:\n${attachmentLines.join("\n")}` : null,
    fileLines.length > 0 ? `Files:\n${fileLines.join("\n")}` : null,
    "Reply with confirm or cancel. You can also send more details, links, or photos before confirming.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildConfirmedText(result, dryRun) {
  const writeResult = result.writeResult || {};
  const translationLinkLines = Array.isArray(writeResult.translationLinks)
    ? writeResult.translationLinks
        .filter((entry) => entry && entry.url)
        .map((entry) => `${String(entry.locale || "").toUpperCase()} - ${entry.url}`)
    : [];

  return [
    dryRun ? "Dry run confirmed." : "Applied successfully.",
    writeResult.entity && writeResult.slug
      ? `${writeResult.action} ${writeResult.entity} ${writeResult.slug}`
      : null,
    writeResult.commitSha ? `Commit: ${writeResult.commitSha}` : null,
    translationLinkLines.length > 0
      ? `Links:\n${translationLinkLines.join("\n")}`
      : (writeResult.pageUrl ? `Link: ${writeResult.pageUrl}` : null),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildIgnoredText(result) {
  switch (result.reason) {
    case "unauthorized-user":
    case "no-command":
      return null;
    case "clarification_response":
      return "I still need a full instruction. Describe the website change you want to make.";
    case "confirmation_response":
      return "Reply with confirm or cancel only when there is an active preview.";
    default:
      return null;
  }
}

function buildReplyMarkup(result) {
  if (result?.status === "processed" && result?.pendingState?.state === "awaiting_confirmation") {
    return {
      inline_keyboard: [
        [
          { text: "Confirm", callback_data: "confirm" },
          { text: "Cancel", callback_data: "cancel" },
        ],
      ],
    };
  }

  return null;
}

function formatValue(value) {
  if (typeof value === "string") {
    return value;
  }

  return String(value);
}

function formatPreviewChange(change) {
  if (!change || typeof change !== "object" || !change.field) {
    return null;
  }

  if (Array.isArray(change.added) || Array.isArray(change.removed)) {
    const parts = [];
    if (Array.isArray(change.removed) && change.removed.length > 0) {
      parts.push(`removed ${change.removed.join(", ")}`);
    }
    if (Array.isArray(change.added) && change.added.length > 0) {
      parts.push(`added ${change.added.join(", ")}`);
    }
    if (parts.length === 0 && typeof change.afterCount === "number" && typeof change.beforeCount === "number") {
      parts.push(`count ${change.beforeCount} -> ${change.afterCount}`);
    }
    return `${change.field}: ${parts.join("; ")}`;
  }

  return `${change.field}: ${formatValue(change.before)} -> ${formatValue(change.after)}`;
}

function sanitizeErrorMessage(error, devMode = false) {
  if (typeof error !== "string" || error.trim() === "") {
    return null;
  }

  const normalized = error.trim();

  if (!devMode && !isUserSafeError(normalized)) {
    return null;
  }

  return normalized
    .replace(/[A-Za-z]:\\[^|:\n]+/g, "[local-path]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/bot\d+:[A-Za-z0-9_-]+/gi, "bot[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "sk-[redacted]");
}

function isUserSafeError(error) {
  const safePatterns = [
    "Extraction field",
    "Operation field",
    "Field '",
    "must be a boolean",
    "must be a string",
    "must be an object",
    "must be an array",
    "must be a non-empty",
    "must include",
    "Cannot create '",
    "Cannot update '",
    "Cannot delete '",
    "requires a slug",
    "requires a slug or target reference",
    "Photo file is present",
    "Photo alt text is present",
    "does not exist in GitHub",
    "does not exist",
    "already exists",
    "Failed to parse JSON file",
    "Failed to read JSON file",
    "Unsupported entity",
    "GitHub API request failed with 403",
    "OpenAI API returned status 429",
    "insufficient_quota",
  ];

  return safePatterns.some((pattern) => error.includes(pattern));
}
