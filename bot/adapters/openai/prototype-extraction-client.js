import { parseTelegramCommand } from "../../parsers/telegram-command.js";
import { validateExtraction } from "../../core/extraction-validator.js";

export class PrototypeExtractionClient {
  constructor() {
    this.kind = "prototype";
  }

  async extractIntent({ messageText }) {
    const normalized = typeof messageText === "string" ? messageText.trim() : "";

    if (!normalized) {
      return validateResult({
        ok: true,
        usedModel: this.kind,
        attempts: 0,
        extraction: buildNonActionable("The message is empty."),
      });
    }

    const decision = normalized.toLowerCase();

    if (decision === "confirm" || decision === "cancel") {
      return validateResult({
        ok: true,
        usedModel: this.kind,
        attempts: 0,
        extraction: {
          intent: "confirmation_response",
          entity: null,
          action: null,
          slug: null,
          confidence: "high",
          needsConfirmation: false,
          summary: `The user chose to ${decision}.`,
          fields: {
            decision,
          },
          questions: [],
          warnings: [],
        },
      });
    }

    if (!normalized.startsWith("/")) {
      return validateResult({
        ok: true,
        usedModel: this.kind,
        attempts: 0,
        extraction: buildNonActionable("The message does not use the transitional slash-command prototype."),
      });
    }

    const parsed = parseTelegramCommand(normalized);

    return validateResult({
      ok: true,
      usedModel: this.kind,
      attempts: 0,
      extraction: {
        intent: "content_operation",
        entity: normalizeEntity(parsed.entity),
        action: parsed.action,
        slug: parsed.fields.slug ?? null,
        confidence: "high",
        needsConfirmation: true,
        summary: `${parsed.action} ${normalizeEntity(parsed.entity)} ${parsed.fields.slug ?? ""}`.trim(),
        fields: parsed.fields,
        questions: [],
        warnings: [],
      },
    });
  }
}

function validateResult(result) {
  validateExtraction(result.extraction);
  return result;
}

function normalizeEntity(entity) {
  return entity === "announce" ? "announcement" : entity;
}

function buildNonActionable(summary) {
  return {
    intent: "non_actionable",
    entity: null,
    action: null,
    slug: null,
    confidence: "high",
    needsConfirmation: false,
    summary,
    fields: {},
    questions: [],
    warnings: [],
  };
}
