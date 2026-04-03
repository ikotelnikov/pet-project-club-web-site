export const ENTITY_SCHEMAS = {
  participant: {
    entity: "participant",
    required: ["slug", "handle", "name", "role", "bio"],
    optional: ["slug", "points", "location", "tags", "links", "photoAlt", "photoStagedPath"],
    fieldTypes: {
      slug: "string",
      handle: "string",
      name: "string",
      role: "string",
      bio: "string",
      points: "string[]",
      location: "string",
      tags: "string[]",
      links: "Link[]",
      photoAlt: "string",
      photoStagedPath: "string",
    },
    aliases: {
      description: "bio",
      details: "bio",
      about: "bio",
    },
    matchingKeys: ["slug", "handle", "name"],
    attachmentHints: {
      photo: "A photo attachment may become participant photo media when the user message implies profile/portrait/photo update.",
      video: "A video attachment may become a participant media asset if explicitly requested later.",
      document: "A document attachment may be referenced as supporting material if the user asks for it.",
    },
  },
  project: {
    entity: "project",
    required: ["slug", "title", "status", "stack"],
    optional: ["slug", "summary", "detailsHtml", "points", "location", "tags", "ownerSlugs", "links", "photoAlt", "photoStagedPath"],
    fieldTypes: {
      slug: "string",
      title: "string",
      status: "string",
      stack: "string",
      summary: "string",
      detailsHtml: "string",
      points: "string[]",
      location: "string",
      tags: "string[]",
      ownerSlugs: "string[]",
      links: "Link[]",
      photoAlt: "string",
      photoStagedPath: "string",
    },
    aliases: {
      description: "detailsHtml",
      details: "detailsHtml",
      owners: "ownerSlugs",
    },
    matchingKeys: ["slug", "title"],
    attachmentHints: {
      photo: "A photo attachment may become project screenshot or cover media.",
      video: "A video attachment may become demo media if the user asks to attach it.",
      document: "A document may become project material or linked artifact.",
    },
  },
  meeting: {
    entity: "meeting",
    required: ["slug", "date", "title", "place", "format"],
    optional: ["slug", "placeUrl", "paragraphs", "sections", "links", "photoAlt", "photoStagedPath"],
    fieldTypes: {
      slug: "string",
      date: "string",
      title: "string",
      place: "string",
      placeUrl: "string",
      format: "string",
      paragraphs: "string[]",
      sections: "Section[]",
      links: "Link[]",
      photoAlt: "string",
      photoStagedPath: "string",
    },
    aliases: {
      description: "paragraphs",
      details: "paragraphs",
      agenda: "sections",
    },
    matchingKeys: ["slug", "title", "date"],
    attachmentHints: {
      photo: "A photo attachment may become meeting photo media.",
      video: "A video attachment may become meeting recap media.",
      document: "A document may become agenda or meeting material if explicitly requested.",
    },
  },
  announcement: {
    entity: "announcement",
    required: ["slug", "date", "title", "place", "format"],
    optional: ["slug", "placeUrl", "paragraphs", "sections", "links", "photoAlt", "photoStagedPath"],
    fieldTypes: {
      slug: "string",
      date: "string",
      title: "string",
      place: "string",
      placeUrl: "string",
      format: "string",
      paragraphs: "string[]",
      sections: "Section[]",
      links: "Link[]",
      photoAlt: "string",
      photoStagedPath: "string",
    },
    aliases: {
      description: "paragraphs",
      details: "paragraphs",
      agenda: "sections",
    },
    matchingKeys: ["slug", "title", "date"],
    attachmentHints: {
      photo: "A photo attachment may become announcement cover media.",
      video: "A video attachment may become announcement media if the message asks to attach it.",
      document: "A document may become linked material if explicitly requested.",
    },
  },
};

export const STAGE_SCHEMAS = {
  intent: {
    intent: "content_operation | clarification_response | confirmation_response | non_actionable",
    entity: "announcement | meeting | participant | project | null",
    action: "create | update | delete | null",
    slug: "string | null",
    targetRef: "string | null",
    confidence: "high | medium | low",
    summary: "string",
    needsConfirmation: "boolean",
    fields: "object",
    questions: "string[]",
    warnings: "string[]",
  },
  targetResolution: {
    matchedSlug: "string | null",
    confidence: "high | medium | low",
    question: "string | null",
  },
  fieldNormalization: {
    fields: "object",
    confidence: "high | medium | low",
    question: "string | null",
    warnings: "string[]",
  },
};

export function buildEntitySchemaSnippet(entity) {
  const schema = ENTITY_SCHEMAS[entity];
  return schema ? JSON.stringify(schema, null, 2) : "{}";
}

export function buildStageSchemaSnippet(stage) {
  const schema = STAGE_SCHEMAS[stage];
  return schema ? JSON.stringify(schema, null, 2) : "{}";
}
