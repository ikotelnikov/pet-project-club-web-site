import {
  BLOCK_FIELDS,
  BOT_ACTIONS,
  BOT_ENTITIES,
  CSV_FIELDS,
  ENTITY_CONFIG,
  LIST_FIELDS,
  REPEATABLE_FIELDS,
  SLUG_PATTERN,
} from "../domain/constants.js";
import { CommandParseError } from "../domain/errors.js";

export function parseTelegramCommand(input) {
  const source = normalizeInput(input);
  const lines = source.split(/\r?\n/);
  const headerLine = firstNonEmptyLine(lines);

  if (!headerLine) {
    throw new CommandParseError("Command is empty.");
  }

  const { entity, action } = parseHeader(headerLine);
  const payloadLines = lines.slice(lines.indexOf(headerLine) + 1);
  const fields = parseFields(payloadLines, entity, action);

  validateFields(entity, action, fields);

  return {
    entity,
    action,
    fields,
  };
}

function normalizeInput(input) {
  if (typeof input !== "string") {
    throw new CommandParseError("Command input must be a string.");
  }

  return input.trim();
}

function firstNonEmptyLine(lines) {
  return lines.find((line) => line.trim() !== "")?.trim() || "";
}

function parseHeader(line) {
  const match = line.match(/^\/([a-z]+)\s+([a-z]+)$/);

  if (!match) {
    throw new CommandParseError("Command header must match '/<entity> <action>'.");
  }

  const [, entity, action] = match;

  if (!BOT_ENTITIES.includes(entity)) {
    throw new CommandParseError(`Unsupported entity '${entity}'.`);
  }

  if (!BOT_ACTIONS.includes(action)) {
    throw new CommandParseError(`Unsupported action '${action}'.`);
  }

  return { entity, action };
}

function parseFields(lines, entity, action) {
  const allowedFields = new Set([
    ...ENTITY_CONFIG[entity].requiredFields[action],
    ...ENTITY_CONFIG[entity].optionalFields,
  ]);
  const fields = {};
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (line === "") {
      index += 1;
      continue;
    }

    const fieldMatch = line.match(/^([a-z]+):(.*)$/);

    if (!fieldMatch) {
      throw new CommandParseError(`Unexpected line '${line}'.`);
    }

    const fieldName = fieldMatch[1];
    const inlineValue = fieldMatch[2].trim();

    if (!allowedFields.has(fieldName)) {
      throw new CommandParseError(`Unknown field '${fieldName}' for ${entity} ${action}.`);
    }

    if (action === "delete" && fieldName !== "slug") {
      throw new CommandParseError("Delete commands may only contain 'slug'.");
    }

    if (BLOCK_FIELDS.has(fieldName)) {
      const block = collectBlock(lines, index + 1);
      fields[fieldName] = block.value;
      index = block.nextIndex;
      continue;
    }

    if (LIST_FIELDS.has(fieldName)) {
      const list = collectBullets(lines, index + 1, fieldName);
      fields[fieldName] = list.value;
      index = list.nextIndex;
      continue;
    }

    if (CSV_FIELDS.has(fieldName)) {
      if (!inlineValue) {
        throw new CommandParseError(`Field '${fieldName}' requires a value.`);
      }

      fields[fieldName] = parseCsvList(inlineValue);
      index += 1;
      continue;
    }

    if (fieldName === "section") {
      if (!inlineValue) {
        throw new CommandParseError("Field 'section' requires a title.");
      }

      const list = collectBullets(lines, index + 1, fieldName);
      const section = {
        title: inlineValue,
        items: list.value,
      };
      fields.section = fields.section || [];
      fields.section.push(section);
      index = list.nextIndex;
      continue;
    }

    if (fieldName === "link") {
      if (!inlineValue) {
        throw new CommandParseError("Field 'link' requires a value.");
      }

      const link = parseLink(inlineValue);
      fields.link = fields.link || [];
      fields.link.push(link);
      index += 1;
      continue;
    }

    if (REPEATABLE_FIELDS.has(fieldName)) {
      throw new CommandParseError(`Field '${fieldName}' must be handled as a repeatable field.`);
    }

    if (!inlineValue) {
      throw new CommandParseError(`Field '${fieldName}' requires a value.`);
    }

    fields[fieldName] = inlineValue;
    index += 1;
  }

  return fields;
}

function collectBlock(lines, startIndex) {
  const values = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed === "") {
      if (values.length > 0) {
        values.push("");
      }
      index += 1;
      continue;
    }

    if (isFieldDeclaration(trimmed) || isBullet(trimmed)) {
      break;
    }

    values.push(trimmed);
    index += 1;
  }

  const value = values.join("\n").trim();

  if (!value) {
    throw new CommandParseError("Multiline field must include at least one text line.");
  }

  return { value, nextIndex: index };
}

function collectBullets(lines, startIndex, fieldName) {
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const trimmed = lines[index].trim();

    if (trimmed === "") {
      index += 1;
      continue;
    }

    if (isFieldDeclaration(trimmed)) {
      break;
    }

    if (!isBullet(trimmed)) {
      throw new CommandParseError(`Field '${fieldName}' expects bullet lines starting with '- '.`);
    }

    const value = trimmed.slice(2).trim();

    if (!value) {
      throw new CommandParseError(`Field '${fieldName}' contains an empty bullet item.`);
    }

    items.push(value);
    index += 1;
  }

  if (items.length === 0) {
    throw new CommandParseError(`Field '${fieldName}' must include at least one bullet item.`);
  }

  return { value: items, nextIndex: index };
}

function parseCsvList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLink(value) {
  const parts = value.split(" | ");

  if (parts.length !== 2) {
    throw new CommandParseError("Link must use the format 'label | href'.");
  }

  const [label, href] = parts.map((part) => part.trim());

  if (!label || !href) {
    throw new CommandParseError("Link must include both label and href.");
  }

  return {
    label,
    href,
    external: /^https?:\/\//.test(href),
  };
}

function validateFields(entity, action, fields) {
  const { requiredFields } = ENTITY_CONFIG[entity];

  for (const fieldName of requiredFields[action]) {
    if (!(fieldName in fields)) {
      throw new CommandParseError(`Missing required field '${fieldName}'.`);
    }
  }

  if (action === "delete" && Object.keys(fields).length !== 1) {
    throw new CommandParseError("Delete commands may not include extra fields.");
  }

  if (fields.slug && !SLUG_PATTERN.test(fields.slug)) {
    throw new CommandParseError("Field 'slug' must use lowercase letters, numbers, and hyphens only.");
  }
}

function isFieldDeclaration(line) {
  return /^[a-z]+:/.test(line);
}

function isBullet(line) {
  return line.startsWith("- ");
}
