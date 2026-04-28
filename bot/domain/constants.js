export const BOT_ENTITIES = ["announce", "meeting", "participant", "project"];
export const BOT_ACTIONS = ["create", "update", "delete"];

export const ENTITY_CONFIG = {
  announce: {
    requiredFields: {
      create: ["slug", "date", "title", "place", "format", "paragraphs"],
      update: ["slug", "date", "title", "place", "format", "paragraphs"],
      delete: ["slug"],
    },
    optionalFields: ["placeurl", "photoalt", "section", "link"],
  },
  meeting: {
    requiredFields: {
      create: ["slug", "date", "title", "place", "format", "paragraphs"],
      update: ["slug", "date", "title", "place", "format", "paragraphs"],
      delete: ["slug"],
    },
    optionalFields: ["placeurl", "photoalt", "section", "link"],
  },
  participant: {
    requiredFields: {
      create: ["slug", "handle", "name", "role", "bio", "points"],
      update: ["slug", "handle", "name", "role", "bio", "points"],
      delete: ["slug"],
    },
    optionalFields: ["detailsHtml", "photoalt", "location", "tags", "link"],
  },
  project: {
    requiredFields: {
      create: ["slug", "title", "status", "stack", "points"],
      update: ["slug", "title", "status", "stack", "points"],
      delete: ["slug"],
    },
    optionalFields: ["summary", "detailsHtml", "photoalt", "location", "tags", "owners", "link"],
  },
};

export const FIELD_ALIASES = {
  paragraphs: "paragraphs",
  points: "points",
  bio: "bio",
  summary: "summary",
  tags: "tags",
  owners: "owners",
  section: "section",
  link: "link",
};

export const BLOCK_FIELDS = new Set(["bio", "summary", "detailsHtml"]);
export const LIST_FIELDS = new Set(["paragraphs", "points"]);
export const CSV_FIELDS = new Set(["tags", "owners"]);
export const REPEATABLE_FIELDS = new Set(["section", "link"]);

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
