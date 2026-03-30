export function buildTelegramReplyText(result, options = {}) {
  const dryRun = options.dryRun ?? true;

  if (!result || !result.status) {
    return "Unknown bot result.";
  }

  switch (result.status) {
    case "processed":
      return buildPreviewText(result, dryRun);
    case "confirmed":
      return buildConfirmedText(result, dryRun);
    case "cancelled":
      return "Cancelled. No website changes were applied.";
    case "control":
      if (result.hasPending) {
        return "There is a pending interaction, but it is not ready for confirmation yet.";
      }

      return "There is no pending action to confirm or cancel.";
    case "failed":
      return buildFailedText(result);
    case "ignored":
      return buildIgnoredText(result);
    default:
      return "Request received, but no reply formatter exists for this result yet.";
  }
}

function buildFailedText(result) {
  if (typeof result.error === "string" && result.error.includes("GitHub API request failed with 403")) {
    return "I reached GitHub but was not allowed to read or write the repository. Check the GitHub token permissions in Cloudflare secrets.";
  }

  if (typeof result.error === "string" && result.error.includes("Operation field 'slug'")) {
    return "I understood the request, but could not derive a valid slug. Try giving a simple latin title or handle.";
  }

  return "I couldn't interpret that safely. Rephrase it as a content change request.";
}

function buildPreviewText(result, dryRun) {
  const preview = result.pendingState?.operation?.preview || null;
  const entity = preview?.entity || result.parsed?.entity || "content";
  const action = preview?.action || result.parsed?.action || "update";
  const slug = preview?.slug || result.parsed?.fields?.slug || "unknown-slug";
  const fields = preview?.fields || {};
  const files = Array.isArray(preview?.files) ? preview.files : [];
  const fieldLines = Object.entries(fields)
    .slice(0, 8)
    .map(([key, value]) => `- ${key}: ${formatValue(value)}`);
  const fileLines = files.slice(0, 4).map((file) => `- ${file}`);

  return [
    `${dryRun ? "Dry-run preview" : "Preview"}: ${action} ${entity} ${slug}`,
    fieldLines.length > 0 ? `Fields:\n${fieldLines.join("\n")}` : null,
    fileLines.length > 0 ? `Files:\n${fileLines.join("\n")}` : null,
    "Reply with confirm or cancel.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildConfirmedText(result, dryRun) {
  const writeResult = result.writeResult || {};

  return [
    dryRun ? "Dry run confirmed." : "Applied successfully.",
    writeResult.entity && writeResult.slug
      ? `${writeResult.action} ${writeResult.entity} ${writeResult.slug}`
      : null,
    writeResult.commitSha ? `Commit: ${writeResult.commitSha}` : null,
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

function formatValue(value) {
  if (typeof value === "string") {
    return value;
  }

  return String(value);
}
