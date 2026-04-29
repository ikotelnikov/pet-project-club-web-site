import test from "node:test";
import assert from "node:assert/strict";

import { PendingMemoryStore } from "../storage/pending-memory-store.js";
import { createPendingRecord } from "../../core/confirmation-flow.js";
import { ExtractionClient } from "../openai/extraction-client.js";
import { handleTelegramMessageV2 } from "./handle-message-v2.js";
import { handleTelegramMessage } from "./message-handler.js";
import { groupTelegramUpdates, processTelegramUpdates } from "../../services/telegram-update-processor.js";

function createRepository() {
  return {
    async listEntityCandidates(entity) {
      if (entity === "announce") {
        return [{
          slug: "airbnb-moja-ljubov-skozi-goda",
          label: "Airbnb: moja ljubov skvozi goda",
          title: "Airbnb: moja ljubov skvozi goda",
        }];
      }

      if (entity === "project") {
        return [{
          slug: "doveritelnoe-upravlenie-v-chernogorii",
          label: "Доверительное управление в Черногории",
          title: "Доверительное управление в Черногории",
        }, {
          slug: "pet-project-club",
          label: "Pet Project Club",
          title: "Pet Project Club",
        }];
      }

      if (entity === "participant") {
        return [{
          slug: "ikotelnikov",
          label: "Ilya Kotelnikov",
          name: "Ilya Kotelnikov",
          handle: "@ikotelnikov",
        }];
      }

      return [];
    },

    async readItem(entity, slug) {
      if (entity === "announce" && slug === "airbnb-moja-ljubov-skozi-goda") {
        return {
          sourceLocale: "ru",
          slug,
          date: "2026-04-17",
          title: "Airbnb: moja ljubov skvozi goda",
          place: "Online",
          format: "news",
          paragraphs: ["Update text"],
          projectSlugs: [],
        };
      }

      if (entity === "project" && slug === "doveritelnoe-upravlenie-v-chernogorii") {
        return {
          sourceLocale: "ru",
          slug,
          title: "Доверительное управление в Черногории",
          status: "active",
          stack: "service",
          summary: "Current summary",
          points: ["Current point"],
        };
      }

      throw new Error(`Unexpected readItem(${entity}, ${slug})`);
    },

    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: ["airbnb-moja-ljubov-skozi-goda", "doveritelnoe-upravlenie-v-chernogorii", "ikotelnikov"] },
        nextIndex: { items: ["airbnb-moja-ljubov-skozi-goda", "doveritelnoe-upravlenie-v-chernogorii", "ikotelnikov", parsedCommand.fields.slug].filter((value, index, array) => array.indexOf(value) === index) },
        nextItem: mapped.item,
        paths: {
          indexPath:
            parsedCommand.entity === "announce"
              ? "content/meetings/announcements/index.json"
              : parsedCommand.entity === "project"
                ? "content/projects/index.json"
                : "content/participants/index.json",
          itemPath:
            parsedCommand.entity === "announce"
              ? `content/meetings/items/${parsedCommand.fields.slug}.json`
              : parsedCommand.entity === "project"
                ? `content/projects/items/${parsedCommand.fields.slug}.json`
                : `content/participants/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };
}

function createExtractionClient() {
  return {
    async analyzeIntent() {
      return {
        intent: "update",
        entity: "announcement",
        target: {
          mode: "existing",
          ref: "airbnb-moja-ljubov-skozi-goda",
        },
        relatedEntities: [
          {
            entity: "project",
            ref: "doveritelnoe-upravlenie-v-chernogorii",
            role: "project_link",
          },
        ],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "high",
      };
    },

    async generateOperation() {
      return {
        entity: "announcement",
        action: "update",
        targetSlug: "airbnb-moja-ljubov-skozi-goda",
        newObject: null,
        patch: {
          projectSlugs: ["doveritelnoe-upravlenie-v-chernogorii"],
        },
        translation: null,
        assetActions: [],
        warnings: [],
      };
    },
  };
}

test("v2 pipeline updates announcement projectSlugs without project hijack", async () => {
  const pendingStore = new PendingMemoryStore();
  const result = await handleTelegramMessageV2({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: "обнови новость airbnb-moja-ljubov-skozi-goda: projectSlugs = doveritelnoe-upravlenie-v-chernogorii",
    },
    updateId: 21,
    pendingStore,
    repository: createRepository(),
    extractionClient: createExtractionClient(),
    text: "обнови новость airbnb-moja-ljubov-skozi-goda: projectSlugs = doveritelnoe-upravlenie-v-chernogorii",
    formattedTextHtml: null,
    attachments: [],
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.entity, "announce");
  assert.equal(result.pendingState.operation.slug, "airbnb-moja-ljubov-skozi-goda");
  assert.deepEqual(
    result.pendingState.operation.fields.projectSlugs,
    ["doveritelnoe-upravlenie-v-chernogorii"]
  );
});

test("main handler routes through v2 pipeline when feature flag is enabled", async () => {
  const previous = process.env.BOT_USE_INTENT_PIPELINE;
  process.env.BOT_USE_INTENT_PIPELINE = "true";

  try {
    const pendingStore = new PendingMemoryStore();
    const result = await handleTelegramMessage({
      message: {
        message_id: 11,
        from: { id: 123 },
        chat: { id: 555 },
        text: "обнови новость airbnb-moja-ljubov-skozi-goda: projectSlugs = doveritelnoe-upravlenie-v-chernogorii",
      },
      updateId: 21,
      pendingStore,
      repository: createRepository(),
      photoStore: null,
      extractionClient: createExtractionClient(),
      dryRun: true,
    });

    assert.equal(result.status, "processed");
    assert.equal(result.pendingState.operation.entity, "announce");
    assert.equal(result.pendingState.operation.slug, "airbnb-moja-ljubov-skozi-goda");
    assert.deepEqual(
      result.pendingState.operation.fields.projectSlugs,
      ["doveritelnoe-upravlenie-v-chernogorii"]
    );
  } finally {
    if (previous == null) {
      delete process.env.BOT_USE_INTENT_PIPELINE;
    } else {
      process.env.BOT_USE_INTENT_PIPELINE = previous;
    }
  }
});

test("main handler rejects the retired legacy flow when useIntentPipeline is false", async () => {
  const pendingStore = new PendingMemoryStore();
  const result = await handleTelegramMessage({
    message: {
      message_id: 12,
      from: { id: 123 },
      chat: { id: 555 },
      text: "create participant Ilya Kotelnikov",
    },
    updateId: 22,
    useIntentPipeline: false,
    pendingStore,
    repository: createRepository(),
    photoStore: null,
    extractionClient: createExtractionClient(),
    dryRun: true,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "legacy_handler_retired");
});

test("main handler /new clears pending context", async () => {
  const pendingStore = new PendingMemoryStore();
  await pendingStore.setPending(555, createPendingRecord({
    chatId: 555,
    userId: 123,
    state: "awaiting_clarification",
    sourceMessageId: 10,
    sourceUpdateId: 20,
    question: "Need more details",
    operation: {
      type: "v2_intent_clarification",
      turn: {
        messages: [
          {
            messageId: 10,
            text: "create participant",
            attachments: [],
          },
        ],
        recentContext: {
          activeSession: {
            intent: "create",
            entity: "participant",
            target: {
              mode: "new",
              ref: null,
            },
          },
        },
      },
    },
  }));

  const result = await handleTelegramMessage({
    message: {
      message_id: 12,
      from: { id: 123 },
      chat: { id: 555 },
      text: "/new",
    },
    updateId: 22,
    pendingStore,
    repository: createRepository(),
    photoStore: null,
    extractionClient: createExtractionClient(),
    dryRun: true,
  });

  assert.equal(result.status, "command");
  assert.equal(result.command, "new");
  assert.equal(result.hadContext, true);
  assert.equal(await pendingStore.getPending(555), null);
});

test("main handler /state returns current context summary", async () => {
  const pendingStore = new PendingMemoryStore();
  await pendingStore.setPending(555, createPendingRecord({
    chatId: 555,
    userId: 123,
    state: "awaiting_clarification",
    sourceMessageId: 11,
    sourceUpdateId: 21,
    question: "Need the participant name",
    operation: {
      type: "v2_intent_clarification",
      turn: {
        messages: [
          {
            messageId: 11,
            text: "create participant",
            attachments: [],
          },
          {
            messageId: 12,
            text: "Asker",
            attachments: [{ kind: "photo", fileName: "asker.jpg" }],
          },
        ],
        recentContext: {
          activeSession: {
            intent: "create",
            entity: "participant",
            target: {
              mode: "new",
              ref: "asker",
            },
          },
        },
      },
    },
  }));

  const result = await handleTelegramMessage({
    message: {
      message_id: 13,
      from: { id: 123 },
      chat: { id: 555 },
      text: "/state",
    },
    updateId: 23,
    pendingStore,
    repository: createRepository(),
    photoStore: null,
    extractionClient: createExtractionClient(),
    dryRun: true,
  });

  assert.equal(result.status, "command");
  assert.equal(result.command, "state");
  assert.equal(result.contextState.hasContext, true);
  assert.equal(result.contextState.messageCount, 2);
  assert.equal(result.contextState.fileCount, 1);
  assert.equal(result.contextState.intentSummary.intent, "create");
  assert.equal(result.contextState.intentSummary.entity, "participant");
  assert.equal(result.contextState.intentSummary.targetRef, "asker");
  assert.equal(result.contextState.doubt.question, "Need the participant name");
});

test("v2 main handler does not re-rank recent entities by attachment heuristics", async () => {
  const previous = process.env.BOT_USE_INTENT_PIPELINE;
  process.env.BOT_USE_INTENT_PIPELINE = "true";

  try {
    const pendingStore = new PendingMemoryStore();
    await pendingStore.setPending(555, createPendingRecord({
      chatId: 555,
      userId: 123,
      state: "idle",
      sourceMessageId: 10,
      sourceUpdateId: 20,
      operation: null,
      context: {
        recentEntities: [
          {
            entity: "participant",
            slug: "ikotelnikov",
            fields: {
              name: "Ilya Kotelnikov",
            },
          },
          {
            entity: "project",
            slug: "pet-project-club",
            fields: {
              title: "Pet Project Club",
            },
          },
        ],
      },
    }));

    let seenRecentContext = null;
    const result = await handleTelegramMessage({
      message: {
        message_id: 13,
        from: { id: 123 },
        chat: { id: 555 },
        caption: "создай участника Ilya Kotelnikov",
        photo: [{ file_id: "ph1", file_unique_id: "uph1", width: 100, height: 100 }],
      },
      updateId: 23,
      pendingStore,
      repository: createRepository(),
      photoStore: null,
      extractionClient: {
        async analyzeIntent({ turn }) {
          seenRecentContext = turn.recentContext;
          return {
            intent: "create",
            entity: "participant",
            target: {
              mode: "new",
              ref: "Ilya Kotelnikov",
            },
            relatedEntities: [],
            requestedLocales: {
              sourceLocale: null,
              targetLocale: null,
              targetLocales: [],
            },
            needsClarification: false,
            clarificationReason: null,
            clarificationQuestion: null,
            confidence: "high",
          };
        },
        async generateOperation() {
          return {
            entity: "participant",
            action: "create",
            targetSlug: null,
            newObject: {
              slug: "ilya-kotelnikov",
              name: "Ilya Kotelnikov",
              role: "Founder",
              bio: "Founder of the club.",
              points: ["Founder of Pet Project Club"],
              sourceLocale: "ru",
            },
            patch: null,
            translation: null,
            assetActions: [],
            warnings: [],
          };
        },
      },
      dryRun: true,
    });

    assert.equal(result.status, "processed");
    assert.equal(seenRecentContext.lastConfirmedObject.entity, "participant");
    assert.equal(seenRecentContext.lastConfirmedObject.slug, "ikotelnikov");
  } finally {
    if (previous == null) {
      delete process.env.BOT_USE_INTENT_PIPELINE;
    } else {
      process.env.BOT_USE_INTENT_PIPELINE = previous;
    }
  }
});

test("v2 main handler drops legacy clarification state instead of resuming old flow", async () => {
  const previous = process.env.BOT_USE_INTENT_PIPELINE;
  process.env.BOT_USE_INTENT_PIPELINE = "true";

  try {
    const pendingStore = new PendingMemoryStore();
    await pendingStore.setPending(555, createPendingRecord({
      chatId: 555,
      userId: 123,
      state: "awaiting_clarification",
      sourceMessageId: 10,
      sourceUpdateId: 20,
      question: "Legacy clarification",
      operation: {
        type: "operation_resolution",
        requestText: "old request",
        attachments: [],
      },
    }));

    let analyzeCalled = 0;
    const result = await handleTelegramMessage({
      message: {
        message_id: 14,
        from: { id: 123 },
        chat: { id: 555 },
        text: "создай участника Ilya Kotelnikov",
      },
      updateId: 24,
      pendingStore,
      repository: createRepository(),
      photoStore: null,
      extractionClient: {
        async analyzeIntent() {
          analyzeCalled += 1;
          return {
            intent: "create",
            entity: "participant",
            target: {
              mode: "new",
              ref: "Ilya Kotelnikov",
            },
            relatedEntities: [],
            requestedLocales: {
              sourceLocale: null,
              targetLocale: null,
              targetLocales: [],
            },
            needsClarification: false,
            clarificationReason: null,
            clarificationQuestion: null,
            confidence: "high",
          };
        },
        async generateOperation() {
          return {
            entity: "participant",
            action: "create",
            targetSlug: null,
            newObject: {
              slug: "ilya-kotelnikov",
              name: "Ilya Kotelnikov",
              role: "Founder",
              bio: "Founder of the club.",
              points: ["Founder of Pet Project Club"],
              sourceLocale: "ru",
            },
            patch: null,
            translation: null,
            assetActions: [],
            warnings: [],
          };
        },
      },
      dryRun: true,
    });

    assert.equal(result.status, "processed");
    assert.equal(analyzeCalled, 1);
    assert.equal(result.pendingState.operation.type, "v2_content_operation");
  } finally {
    if (previous == null) {
      delete process.env.BOT_USE_INTENT_PIPELINE;
    } else {
      process.env.BOT_USE_INTENT_PIPELINE = previous;
    }
  }
});

test("v2 pipeline resumes target clarification by numeric selection", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async listEntityCandidates(entity) {
      if (entity !== "project") {
        return [];
      }

      return [
        { slug: "club-alpha", label: "Club", title: "Club" },
        { slug: "pet-project-club", label: "Club", title: "Club" },
      ];
    },
    async readItem(entity, slug) {
      if (entity === "project" && slug === "pet-project-club") {
        return {
          sourceLocale: "ru",
          slug,
          title: "Pet Project Club",
          status: "active",
          stack: "community",
          summary: "Current summary",
          points: ["Current point"],
        };
      }

      throw new Error(`Unexpected readItem(${entity}, ${slug})`);
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: ["pet-project-club"] },
        nextIndex: { items: ["pet-project-club"] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/projects/index.json",
          itemPath: `content/projects/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };

  const extractionClient = {
    async analyzeIntent() {
      return {
        intent: "update",
        entity: "project",
        target: {
          mode: "existing",
          ref: "Club",
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "medium",
      };
    },
    async generateOperation({ resolved }) {
      return {
        entity: "project",
        action: "update",
        targetSlug: resolved.target.slug,
        newObject: null,
        patch: {
          summary: "Updated after clarification",
        },
        translation: null,
        assetActions: [],
        warnings: [],
      };
    },
  };

  const first = await handleTelegramMessageV2({
    message: {
      message_id: 21,
      from: { id: 123 },
      chat: { id: 555 },
      text: "обнови проект Club",
    },
    updateId: 31,
    pendingStore,
    repository,
    extractionClient,
    text: "обнови проект Club",
    formattedTextHtml: null,
    attachments: [],
    dryRun: true,
  });

  assert.equal(first.status, "clarification");
  assert.equal(first.pendingState.operation.type, "v2_target_clarification");
  assert.equal(first.pendingState.operation.clarification.options.length, 2);

  const previous = process.env.BOT_USE_INTENT_PIPELINE;
  process.env.BOT_USE_INTENT_PIPELINE = "true";

  try {
    const resumed = await handleTelegramMessage({
      message: {
        message_id: 22,
        from: { id: 123 },
        chat: { id: 555 },
        text: "2",
      },
      updateId: 32,
      pendingStore,
      repository,
      photoStore: null,
      extractionClient,
      dryRun: true,
    });

    assert.equal(resumed.status, "processed");
    assert.equal(resumed.pendingState.operation.entity, "project");
    assert.equal(resumed.pendingState.operation.slug, "pet-project-club");
    assert.equal(resumed.pendingState.operation.fields.summary, "Updated after clarification");
  } finally {
    if (previous == null) {
      delete process.env.BOT_USE_INTENT_PIPELINE;
    } else {
      process.env.BOT_USE_INTENT_PIPELINE = previous;
    }
  }
});

test("v2 pipeline supports create participant", async () => {
  const pendingStore = new PendingMemoryStore();
  const result = await handleTelegramMessageV2({
    message: {
      message_id: 31,
      from: { id: 123 },
      chat: { id: 555 },
      text: "создай участника Ilya Kotelnikov",
    },
    updateId: 41,
    pendingStore,
    repository: createRepository(),
    extractionClient: {
      async analyzeIntent() {
        return {
          intent: "create",
          entity: "participant",
          target: {
            mode: "new",
            ref: "Ilya Kotelnikov",
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
          needsClarification: false,
          clarificationReason: null,
          clarificationQuestion: null,
          confidence: "high",
        };
      },
      async generateOperation() {
        return {
          entity: "participant",
          action: "create",
          targetSlug: null,
          newObject: {
            slug: "ilya-kotelnikov",
            name: "Ilya Kotelnikov",
            role: "Founder",
            bio: "Builds the club.",
            points: ["Founder of Pet Project Club"],
            sourceLocale: "ru",
          },
          patch: null,
          translation: null,
          assetActions: [],
          warnings: [],
        };
      },
    },
    text: "создай участника Ilya Kotelnikov",
    formattedTextHtml: null,
    attachments: [],
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.entity, "participant");
  assert.equal(result.pendingState.operation.slug, "ilya-kotelnikov");
  assert.equal(result.pendingState.operation.fields.name, "Ilya Kotelnikov");
});

test("v2 pipeline resumes incomplete-operation clarification inside v2", async () => {
  const pendingStore = new PendingMemoryStore();
  let analyzeCount = 0;

  const first = await handleTelegramMessageV2({
    message: {
      message_id: 35,
      from: { id: 123 },
      chat: { id: 555 },
      text: "создай участника",
    },
    updateId: 45,
    pendingStore,
    repository: createRepository(),
    extractionClient: {
      async analyzeIntent() {
        analyzeCount += 1;
        return {
          intent: "create",
          entity: "participant",
          target: {
            mode: "new",
            ref: null,
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
          needsClarification: false,
          clarificationReason: null,
          clarificationQuestion: null,
          confidence: "medium",
        };
      },
      async generateOperation() {
        return {
          entity: "participant",
          action: "create",
          targetSlug: null,
          newObject: {
            role: "Founder",
            bio: "Builds the club.",
            points: ["Founder of Pet Project Club"],
            sourceLocale: "ru",
          },
          patch: null,
          translation: null,
          assetActions: [],
          warnings: [],
        };
      },
    },
    text: "создай участника",
    formattedTextHtml: null,
    attachments: [],
    dryRun: true,
  });

  assert.equal(first.status, "clarification");
  assert.equal(first.pendingState.operation.type, "v2_incomplete_operation");

  const previous = process.env.BOT_USE_INTENT_PIPELINE;
  process.env.BOT_USE_INTENT_PIPELINE = "true";

  try {
    const resumed = await handleTelegramMessage({
      message: {
        message_id: 36,
        from: { id: 123 },
        chat: { id: 555 },
        text: "Ilya Kotelnikov",
      },
      updateId: 46,
      pendingStore,
      repository: createRepository(),
      photoStore: null,
      extractionClient: {
        async analyzeIntent({ turn }) {
          analyzeCount += 1;
          assert.equal(turn.messages.length, 2);
          assert.equal(turn.recentContext?.activeSession?.intent?.entity, "participant");
          assert.equal(turn.recentContext?.activeSession?.intent?.intent, "create");
          return {
            intent: "noop",
            entity: null,
            target: {
              mode: null,
              ref: null,
            },
            relatedEntities: [],
            requestedLocales: {
              sourceLocale: null,
              targetLocale: null,
              targetLocales: [],
            },
            needsClarification: false,
            clarificationReason: null,
            clarificationQuestion: null,
            confidence: "medium",
          };
        },
        async generateOperation({ turn }) {
          assert.equal(turn.recentContext?.activeSession?.intent?.entity, "participant");
          return {
            entity: "participant",
            action: "create",
            targetSlug: null,
            newObject: {
              slug: "ilya-kotelnikov",
              name: "Ilya Kotelnikov",
              role: "Founder",
              bio: "Builds the club.",
              points: ["Founder of Pet Project Club"],
              sourceLocale: "ru",
            },
            patch: null,
            translation: null,
            assetActions: [],
            warnings: [],
          };
        },
      },
      dryRun: true,
    });

    assert.equal(resumed.status, "processed");
    assert.equal(resumed.pendingState.operation.entity, "participant");
    assert.equal(resumed.pendingState.operation.slug, "ilya-kotelnikov");
    assert.equal(analyzeCount, 2);
  } finally {
    if (previous == null) {
      delete process.env.BOT_USE_INTENT_PIPELINE;
    } else {
      process.env.BOT_USE_INTENT_PIPELINE = previous;
    }
  }
});

test("v2 awaiting-confirmation draft follow-up stays inside v2 pipeline", async () => {
  const pendingStore = new PendingMemoryStore();
  let analyzeCount = 0;

  const first = await handleTelegramMessageV2({
    message: {
      message_id: 37,
      from: { id: 123 },
      chat: { id: 555 },
      text: "создай участника Ilya Kotelnikov",
    },
    updateId: 47,
    pendingStore,
    repository: createRepository(),
    extractionClient: {
      async analyzeIntent() {
        analyzeCount += 1;
        return {
          intent: "create",
          entity: "participant",
          target: {
            mode: "new",
            ref: "Ilya Kotelnikov",
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
          needsClarification: false,
          clarificationReason: null,
          clarificationQuestion: null,
          confidence: "high",
        };
      },
      async generateOperation() {
        return {
          entity: "participant",
          action: "create",
          targetSlug: null,
          newObject: {
            slug: "ilya-kotelnikov",
            name: "Ilya Kotelnikov",
            role: "Founder",
            bio: "Builds the club.",
            points: ["Founder of Pet Project Club"],
            sourceLocale: "ru",
          },
          patch: null,
          translation: null,
          assetActions: [],
          warnings: [],
        };
      },
    },
    text: "создай участника Ilya Kotelnikov",
    formattedTextHtml: null,
    attachments: [],
    dryRun: true,
  });

  assert.equal(first.status, "processed");
  assert.equal(first.pendingState.operation.type, "v2_content_operation");

  const previous = process.env.BOT_USE_INTENT_PIPELINE;
  process.env.BOT_USE_INTENT_PIPELINE = "true";

  try {
    const resumed = await handleTelegramMessage({
      message: {
        message_id: 38,
        from: { id: 123 },
        chat: { id: 555 },
        text: "Добавь роль Community Builder",
      },
      updateId: 48,
      pendingStore,
      repository: createRepository(),
      photoStore: null,
      extractionClient: {
        async analyzeIntent({ turn }) {
          analyzeCount += 1;
          assert.equal(turn.messages.length, 2);
          return {
            intent: "create",
            entity: "participant",
            target: {
              mode: "new",
              ref: "Ilya Kotelnikov",
            },
            relatedEntities: [],
            requestedLocales: {
              sourceLocale: null,
              targetLocale: null,
              targetLocales: [],
            },
            needsClarification: false,
            clarificationReason: null,
            clarificationQuestion: null,
            confidence: "high",
          };
        },
        async generateOperation() {
          return {
            entity: "participant",
            action: "create",
            targetSlug: null,
            newObject: {
              slug: "ilya-kotelnikov",
              name: "Ilya Kotelnikov",
              role: "Community Builder",
              bio: "Builds the club.",
              points: ["Founder of Pet Project Club"],
              sourceLocale: "ru",
            },
            patch: null,
            translation: null,
            assetActions: [],
            warnings: [],
          };
        },
      },
      dryRun: true,
    });

    assert.equal(resumed.status, "processed");
    assert.equal(resumed.pendingState.operation.type, "v2_content_operation");
    assert.equal(resumed.pendingState.operation.fields.role, "Community Builder");
    assert.equal(analyzeCount, 2);
  } finally {
    if (previous == null) {
      delete process.env.BOT_USE_INTENT_PIPELINE;
    } else {
      process.env.BOT_USE_INTENT_PIPELINE = previous;
    }
  }
});

test("v2 pipeline supports update project", async () => {
  const pendingStore = new PendingMemoryStore();
  const result = await handleTelegramMessageV2({
    message: {
      message_id: 41,
      from: { id: 123 },
      chat: { id: 555 },
      text: "обнови проект doveritelnoe-upravlenie-v-chernogorii",
    },
    updateId: 51,
    pendingStore,
    repository: createRepository(),
    extractionClient: {
      async analyzeIntent() {
        return {
          intent: "update",
          entity: "project",
          target: {
            mode: "existing",
            ref: "doveritelnoe-upravlenie-v-chernogorii",
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
          needsClarification: false,
          clarificationReason: null,
          clarificationQuestion: null,
          confidence: "high",
        };
      },
      async generateOperation() {
        return {
          entity: "project",
          action: "update",
          targetSlug: "doveritelnoe-upravlenie-v-chernogorii",
          newObject: null,
          patch: {
            summary: "Updated summary from v2 pipeline",
          },
          translation: null,
          assetActions: [],
          warnings: [],
        };
      },
    },
    text: "обнови проект doveritelnoe-upravlenie-v-chernogorii",
    formattedTextHtml: null,
    attachments: [],
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.entity, "project");
  assert.equal(result.pendingState.operation.slug, "doveritelnoe-upravlenie-v-chernogorii");
  assert.equal(result.pendingState.operation.fields.summary, "Updated summary from v2 pipeline");
});

test("v2 pipeline supports project primary photo asset action", async () => {
  const pendingStore = new PendingMemoryStore();
  const result = await handleTelegramMessageV2({
    message: {
      message_id: 51,
      from: { id: 123 },
      chat: { id: 555 },
      caption: "поставь это главным фото проекта",
      photo: [{ file_id: "ph1" }],
    },
    updateId: 61,
    pendingStore,
    repository: createRepository(),
    extractionClient: {
      async analyzeIntent() {
        return {
          intent: "update",
          entity: "project",
          target: {
            mode: "existing",
            ref: "doveritelnoe-upravlenie-v-chernogorii",
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
          needsClarification: false,
          clarificationReason: null,
          clarificationQuestion: null,
          confidence: "high",
        };
      },
      async generateOperation() {
        return {
          entity: "project",
          action: "update",
          targetSlug: "doveritelnoe-upravlenie-v-chernogorii",
          newObject: null,
          patch: {},
          translation: null,
          assetActions: [
            {
              kind: "set_primary_photo",
              attachmentIndex: 0,
              alt: "Project cover",
            },
          ],
          warnings: [],
        };
      },
    },
    text: "поставь это главным фото проекта",
    formattedTextHtml: null,
    attachments: [
      {
        kind: "photo",
        stagedPath: "assets/uploads/555/51-photo.jpg",
        fileName: "51-photo.jpg",
        mimeType: "image/jpeg",
      },
    ],
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.entity, "project");
  assert.equal(result.pendingState.operation.fields.photoStagedPath, "assets/uploads/555/51-photo.jpg");
  assert.equal(result.pendingState.operation.fields.photoAction, "replace");
  assert.equal(result.pendingState.operation.fields.gallery[0].src, "assets/uploads/555/51-photo.jpg");
});

test("v2 pipeline supports project append photos asset action", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    ...createRepository(),
    async readItem(entity, slug) {
      if (entity === "project" && slug === "doveritelnoe-upravlenie-v-chernogorii") {
        return {
          sourceLocale: "ru",
          slug,
          title: "Доверительное управление в Черногории",
          status: "active",
          stack: "service",
          summary: "Current summary",
          points: ["Current point"],
          gallery: [
            { src: "assets/projects/existing.jpg", alt: "Existing photo" },
          ],
          photo: { src: "assets/projects/existing.jpg", alt: "Existing photo" },
        };
      }

      return createRepository().readItem(entity, slug);
    },
  };

  const result = await handleTelegramMessageV2({
    message: {
      message_id: 61,
      from: { id: 123 },
      chat: { id: 555 },
      caption: "добавь еще фото проекта",
      photo: [{ file_id: "ph2" }],
    },
    updateId: 71,
    pendingStore,
    repository,
    extractionClient: {
      async analyzeIntent() {
        return {
          intent: "update",
          entity: "project",
          target: {
            mode: "existing",
            ref: "doveritelnoe-upravlenie-v-chernogorii",
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
          needsClarification: false,
          clarificationReason: null,
          clarificationQuestion: null,
          confidence: "high",
        };
      },
      async generateOperation() {
        return {
          entity: "project",
          action: "update",
          targetSlug: "doveritelnoe-upravlenie-v-chernogorii",
          newObject: null,
          patch: {},
          translation: null,
          assetActions: [
            {
              kind: "append_photos",
              attachmentIndices: [0, 1],
              alt: "Gallery photo",
            },
          ],
          warnings: [],
        };
      },
    },
    text: "добавь еще фото проекта",
    formattedTextHtml: null,
    attachments: [
      {
        kind: "photo",
        stagedPath: "assets/uploads/555/61-photo-a.jpg",
        fileName: "61-photo-a.jpg",
        mimeType: "image/jpeg",
      },
      {
        kind: "photo",
        stagedPath: "assets/uploads/555/61-photo-b.jpg",
        fileName: "61-photo-b.jpg",
        mimeType: "image/jpeg",
      },
    ],
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.entity, "project");
  assert.equal(result.pendingState.operation.fields.photoAction, "append");
  assert.equal(result.pendingState.operation.fields.gallery.length, 3);
  assert.equal(result.pendingState.operation.fields.gallery[1].src, "assets/uploads/555/61-photo-a.jpg");
  assert.equal(result.pendingState.operation.fields.gallery[2].src, "assets/uploads/555/61-photo-b.jpg");
});

test("v2 pipeline preserves attached photo on project create without explicit asset actions", async () => {
  const pendingStore = new PendingMemoryStore();

  const result = await handleTelegramMessageV2({
    message: {
      message_id: 71,
      from: { id: 123 },
      chat: { id: 555 },
      caption: "создай проект CreometriX",
      photo: [{ file_id: "ph3" }],
    },
    updateId: 81,
    pendingStore,
    repository: createRepository(),
    extractionClient: {
      async analyzeIntent() {
        return {
          intent: "create",
          entity: "project",
          target: {
            mode: "new",
            ref: "CreometriX",
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
          needsClarification: false,
          clarificationReason: null,
          clarificationQuestion: null,
          confidence: "high",
        };
      },
      async generateOperation() {
        return {
          entity: "project",
          action: "create",
          targetSlug: null,
          newObject: {
            slug: "creometrix",
            title: "CreometriX",
            status: "active",
          },
          patch: null,
          translation: null,
          assetActions: [],
          warnings: [],
        };
      },
    },
    text: "создай проект CreometriX",
    formattedTextHtml: null,
    attachments: [
      {
        kind: "photo",
        stagedPath: "assets/uploads/555/71-photo.jpg",
        fileName: "71-photo.jpg",
        mimeType: "image/jpeg",
      },
    ],
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.entity, "project");
  assert.equal(result.pendingState.operation.fields.photoStagedPath, "assets/uploads/555/71-photo.jpg");
  assert.equal(result.pendingState.operation.fields.photoAction, "replace");
  assert.equal(result.pendingState.operation.fields.gallery.length, 1);
  assert.equal(result.pendingState.operation.fields.gallery[0].src, "assets/uploads/555/71-photo.jpg");
});

test("v2 pipeline appends attached photo on project update without explicit asset actions", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    ...createRepository(),
    async readItem(entity, slug) {
      if (entity === "project" && slug === "doveritelnoe-upravlenie-v-chernogorii") {
        return {
          sourceLocale: "ru",
          slug,
          title: "Доверительное управление в Черногории",
          status: "active",
          stack: "service",
          summary: "Current summary",
          gallery: [
            { src: "assets/projects/existing.jpg", alt: "Existing photo" },
          ],
          photo: { src: "assets/projects/existing.jpg", alt: "Existing photo" },
        };
      }

      return createRepository().readItem(entity, slug);
    },
  };

  const result = await handleTelegramMessageV2({
    message: {
      message_id: 72,
      from: { id: 123 },
      chat: { id: 555 },
      caption: "обнови проект и добавь фото",
      photo: [{ file_id: "ph4" }],
    },
    updateId: 82,
    pendingStore,
    repository,
    extractionClient: {
      async analyzeIntent() {
        return {
          intent: "update",
          entity: "project",
          target: {
            mode: "existing",
            ref: "doveritelnoe-upravlenie-v-chernogorii",
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
          needsClarification: false,
          clarificationReason: null,
          clarificationQuestion: null,
          confidence: "high",
        };
      },
      async generateOperation() {
        return {
          entity: "project",
          action: "update",
          targetSlug: "doveritelnoe-upravlenie-v-chernogorii",
          newObject: null,
          patch: {
            summary: "Updated summary",
          },
          translation: null,
          assetActions: [],
          warnings: [],
        };
      },
    },
    text: "обнови проект и добавь фото",
    formattedTextHtml: null,
    attachments: [
      {
        kind: "photo",
        stagedPath: "assets/uploads/555/72-photo.jpg",
        fileName: "72-photo.jpg",
        mimeType: "image/jpeg",
      },
    ],
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.entity, "project");
  assert.equal(result.pendingState.operation.fields.photoStagedPath, "assets/projects/existing.jpg");
  assert.equal(result.pendingState.operation.fields.photoAction, "append");
  assert.equal(result.pendingState.operation.fields.gallery.length, 2);
  assert.equal(result.pendingState.operation.fields.gallery[1].src, "assets/uploads/555/72-photo.jpg");
});

test("v2 pipeline preserves attached photo on participant create without explicit asset actions", async () => {
  const pendingStore = new PendingMemoryStore();

  const result = await handleTelegramMessageV2({
    message: {
      message_id: 73,
      from: { id: 123 },
      chat: { id: 555 },
      caption: "создай участника Аскер",
      photo: [{ file_id: "ph5" }],
    },
    updateId: 83,
    pendingStore,
    repository: createRepository(),
    extractionClient: {
      async analyzeIntent() {
        return {
          intent: "create",
          entity: "participant",
          target: {
            mode: "new",
            ref: "Аскер",
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
          needsClarification: false,
          clarificationReason: null,
          clarificationQuestion: null,
          confidence: "high",
        };
      },
      async generateOperation() {
        return {
          entity: "participant",
          action: "create",
          targetSlug: null,
          newObject: {
            slug: "asker",
            name: "Аскер",
            role: "Участник",
          },
          patch: null,
          translation: null,
          assetActions: [],
          warnings: [],
        };
      },
    },
    text: "создай участника Аскер",
    formattedTextHtml: null,
    attachments: [
      {
        kind: "photo",
        stagedPath: "assets/uploads/555/73-photo.jpg",
        fileName: "73-photo.jpg",
        mimeType: "image/jpeg",
      },
    ],
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.entity, "participant");
  assert.equal(result.pendingState.operation.fields.photoStagedPath, "assets/uploads/555/73-photo.jpg");
  assert.equal(result.pendingState.operation.fields.photoAction, "replace");
});

test("v2 pipeline supports locale-specific translation overlay update", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    ...createRepository(),
    async readItem(entity, slug) {
      if (entity === "participant" && slug === "ikotelnikov") {
        return {
          sourceLocale: "ru",
          slug,
          name: "Илья Котельников",
          role: "Основатель",
          bio: "Строит клуб.",
          points: ["Основатель клуба"],
          translations: {
            en: {
              bio: "Old English bio",
            },
          },
          translationStatus: {
            en: "edited",
          },
        };
      }

      return createRepository().readItem(entity, slug);
    },
  };

  const result = await handleTelegramMessageV2({
    message: {
      message_id: 71,
      from: { id: 123 },
      chat: { id: 555 },
      text: "обнови английский bio участника ikotelnikov",
    },
    updateId: 81,
    pendingStore,
    repository,
    extractionClient: {
      async analyzeIntent() {
        return {
          intent: "update",
          entity: "participant",
          target: {
            mode: "existing",
            ref: "ikotelnikov",
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: "ru",
            targetLocale: "en",
            targetLocales: ["en"],
          },
          needsClarification: false,
          clarificationReason: null,
          clarificationQuestion: null,
          confidence: "high",
        };
      },
      async generateOperation() {
        return {
          entity: "participant",
          action: "update",
          targetSlug: "ikotelnikov",
          newObject: null,
          patch: {
            locale: "en",
            bio: "Builds the club.",
          },
          translation: {
            sourceLocale: "ru",
            targetLocale: "en",
            targetLocales: ["en"],
          },
          assetActions: [],
          warnings: [],
        };
      },
    },
    text: "обнови английский bio участника ikotelnikov",
    formattedTextHtml: null,
    attachments: [],
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.entity, "participant");
  assert.equal(result.pendingState.operation.slug, "ikotelnikov");
  assert.equal(result.pendingState.operation.fields.locale, "en");
  assert.equal(result.pendingState.operation.fields.bio, "Builds the club.");
});

test("v2 pipeline supports translation batch confirmation flow", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    ...createRepository(),
    async readItem(entity, slug) {
      if (entity === "project" && slug === "doveritelnoe-upravlenie-v-chernogorii") {
        return {
          sourceLocale: "ru",
          slug,
          title: "Доверительное управление в Черногории",
          summary: "Русское описание",
          translationStatus: {
            en: "stale",
            me: "machine",
            es: "edited",
          },
          translations: {
            me: {
              title: "Postojeci prevod",
            },
            es: {
              title: "Manual",
            },
          },
        };
      }

      return createRepository().readItem(entity, slug);
    },
  };

  const result = await handleTelegramMessageV2({
    message: {
      message_id: 81,
      from: { id: 123 },
      chat: { id: 555 },
      text: "переведи проект doveritelnoe-upravlenie-v-chernogorii на en и me",
    },
    updateId: 91,
    pendingStore,
    repository,
    extractionClient: {
      async analyzeIntent() {
        return {
          intent: "translate",
          entity: "project",
          target: {
            mode: "existing",
            ref: "doveritelnoe-upravlenie-v-chernogorii",
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: "ru",
            targetLocale: null,
            targetLocales: ["en", "me"],
          },
          needsClarification: false,
          clarificationReason: null,
          clarificationQuestion: null,
          confidence: "high",
        };
      },
      async generateOperation() {
        return {
          entity: "project",
          action: "translate",
          targetSlug: "doveritelnoe-upravlenie-v-chernogorii",
          newObject: null,
          patch: null,
          translation: {
            sourceLocale: "ru",
            targetLocale: null,
            targetLocales: ["en", "me"],
          },
          assetActions: [],
          warnings: [],
        };
      },
    },
    text: "переведи проект doveritelnoe-upravlenie-v-chernogorii на en и me",
    formattedTextHtml: null,
    attachments: [],
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.type, "translation_batch");
  assert.equal(result.pendingState.operation.entity, "project");
  assert.equal(result.pendingState.operation.slug, "doveritelnoe-upravlenie-v-chernogorii");
  assert.deepEqual(result.pendingState.operation.targetLocales, ["en", "me"]);
  assert.equal(result.pendingState.operation.preview.fields.locales, "en, me");
});

test("telegram update processor batches consecutive v2 messages into one analyzed turn", async () => {
  const analyzeCalls = [];
  const pendingStore = new PendingMemoryStore();
  const offsetStore = {
    async readOffset() {
      return 0;
    },
    async writeOffset() {},
  };

  const result = await processTelegramUpdates({
    updates: [
      {
        update_id: 101,
        message: {
          message_id: 11,
          from: { id: 123 },
          chat: { id: 555 },
          date: 100,
          text: "Создай участника",
        },
      },
      {
        update_id: 102,
        message: {
          message_id: 12,
          from: { id: 123 },
          chat: { id: 555 },
          date: 108,
          text: "Ilya Kotelnikov, founder of the club",
        },
      },
    ],
    allowedUserId: null,
    repository: createRepository(),
    photoStore: null,
    offsetStore,
    pendingStore,
    extractionClient: {
      async analyzeIntent({ turn }) {
        analyzeCalls.push(turn);
        return {
          intent: "create",
          entity: "participant",
          target: {
            mode: "new",
            ref: "Ilya Kotelnikov",
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
          needsClarification: false,
          clarificationReason: null,
          clarificationQuestion: null,
          confidence: "high",
        };
      },
      async generateOperation() {
        return {
          entity: "participant",
          action: "create",
          targetSlug: null,
          newObject: {
            slug: "ilya-kotelnikov",
            name: "Ilya Kotelnikov",
            role: "Founder",
            bio: "Founder of the club.",
            points: ["Founder of Pet Project Club"],
            sourceLocale: "ru",
          },
          patch: null,
          translation: null,
          assetActions: [],
          warnings: [],
        };
      },
    },
    useIntentPipeline: true,
    dryRun: true,
  });

  assert.equal(analyzeCalls.length, 1);
  assert.equal(analyzeCalls[0].messages.length, 2);
  assert.equal(result.processedCount, 1);
  assert.equal(result.ignoredCount, 1);
  assert.equal(result.results[1].reason, "batched-into-turn");
});

test("groupTelegramUpdates does not batch v2 messages across a larger time gap", () => {
  const groups = groupTelegramUpdates([
    {
      update_id: 201,
      message: {
        message_id: 21,
        from: { id: 123 },
        chat: { id: 555 },
        date: 100,
        text: "Создай участника",
      },
    },
    {
      update_id: 202,
      message: {
        message_id: 22,
        from: { id: 123 },
        chat: { id: 555 },
        date: 130,
        text: "Ilya Kotelnikov, founder of the club",
      },
    },
  ], { useIntentPipeline: true });

  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 1);
  assert.equal(groups[1].length, 1);
});

test("groupTelegramUpdates does not batch v2 messages across explicit command boundaries", () => {
  const groups = groupTelegramUpdates([
    {
      update_id: 301,
      message: {
        message_id: 31,
        from: { id: 123 },
        chat: { id: 555 },
        date: 100,
        text: "Создай участника",
      },
    },
    {
      update_id: 302,
      message: {
        message_id: 32,
        from: { id: 123 },
        chat: { id: 555 },
        date: 101,
        text: "/participant create",
      },
    },
  ], { useIntentPipeline: true });

  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 1);
  assert.equal(groups[1].length, 1);
});

test("main handler reprocesses the same persisted session as new messages arrive", async () => {
  const pendingStore = new PendingMemoryStore();
  const analyzeCalls = [];
  const repository = {
    async listEntityCandidates(entity) {
      if (entity === "participant") {
        return [{
          slug: "yugatov-konstantin",
          label: "Югатов Константин",
          name: "Югатов Константин",
        }];
      }

      return [];
    },
    async readItem(entity, slug) {
      assert.equal(entity, "participant");
      assert.equal(slug, "yugatov-konstantin");
      return {
        sourceLocale: "ru",
        slug,
        name: "Югатов Константин",
        role: "Архитектор",
        bio: "Старое описание",
      };
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: ["yugatov-konstantin"] },
        nextIndex: { items: ["yugatov-konstantin"] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/participants/index.json",
          itemPath: `content/participants/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };
  const extractionClient = {
    async analyzeIntent({ turn }) {
      analyzeCalls.push(turn);
      if (turn.messages.length === 1) {
        return {
          intent: "update",
          entity: "participant",
          target: {
            mode: "existing",
            ref: "yugatov-konstantin",
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
          needsClarification: true,
          clarificationReason: "insufficient_data",
          clarificationQuestion: "Please provide the participant details to update.",
          confidence: "high",
        };
      }

      return {
        intent: "update",
        entity: "participant",
        target: {
          mode: "existing",
          ref: "yugatov-konstantin",
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "high",
      };
    },
    async generateOperation({ turn }) {
      assert.equal(turn.messages.length, 2);
      return {
        entity: "participant",
        action: "update",
        targetSlug: "yugatov-konstantin",
        newObject: null,
        patch: {
          name: "Югатов Константин",
          bio: turn.messages.map((message) => message.text).filter(Boolean).join("\n"),
          sourceLocale: "ru",
        },
        translation: null,
        assetActions: [],
        warnings: [],
      };
    },
  };

  const firstPromise = handleTelegramMessage({
    message: {
      message_id: 41,
      from: { id: 123 },
      chat: { id: 555 },
      text: "обнови информацию участника yugatov-konstantin:",
    },
    updateId: 401,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
    useIntentPipeline: true,
    coalesceDelayMs: 30,
    pendingCoalesceDelayMs: 30,
  });
  const firstResult = await firstPromise;

  const secondResult = await handleTelegramMessage({
    message: {
      message_id: 42,
      from: { id: 123 },
      chat: { id: 555 },
      text: "Югатов Константин\nАрхитектор и дизайнер с 15-летним опытом.",
      forward_origin: { type: "user" },
    },
    updateId: 402,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
    useIntentPipeline: true,
    coalesceDelayMs: 30,
    pendingCoalesceDelayMs: 30,
  });

  assert.equal(firstResult.status, "clarification");
  assert.equal(secondResult.status, "processed");
  assert.equal(analyzeCalls.length, 2);
  assert.equal(analyzeCalls[1].messages.length, 2);
  assert.equal(secondResult.pendingState.operation.entity, "participant");
  assert.equal(secondResult.pendingState.operation.slug, "yugatov-konstantin");
});

test("ExtractionClient v2 JSON parsing unwraps fenced json output", async () => {
  const client = new ExtractionClient({
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          output_text: "```json\n{\"intent\":\"update\",\"entity\":\"participant\",\"target\":{\"mode\":\"existing\",\"ref\":\"yugatov-konstantin\"},\"relatedEntities\":[],\"requestedLocales\":{\"sourceLocale\":null,\"targetLocale\":null,\"targetLocales\":[]},\"needsClarification\":false,\"clarificationReason\":null,\"clarificationQuestion\":null,\"confidence\":\"high\"}\n```",
        };
      },
    }),
  });

  const result = await client.analyzeIntent({
    turn: {
      chatId: 555,
      userId: 123,
      messages: [
        {
          messageId: 1,
          text: "обнови участника yugatov-konstantin",
          formattedTextHtml: null,
          attachments: [],
          isForwarded: false,
          hasQuote: false,
        },
      ],
      recentContext: {
        lastConfirmedObject: null,
        pendingDraft: null,
      },
    },
  });

  assert.equal(result.intent, "update");
  assert.equal(result.entity, "participant");
  assert.equal(result.target.ref, "yugatov-konstantin");
});

test("v2 intent clarification keeps create participant context across follow-up message", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async listEntityCandidates() {
      return [];
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: [] },
        nextIndex: { items: [parsedCommand.fields.slug] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/participants/index.json",
          itemPath: `content/participants/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };
  let analyzeCallCount = 0;
  const extractionClient = {
    async analyzeIntent({ turn }) {
      analyzeCallCount += 1;

      if (analyzeCallCount === 1) {
        return {
          intent: "create",
          entity: "participant",
          target: {
            mode: "new",
            ref: null,
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
          needsClarification: true,
          clarificationReason: "insufficient_data",
          clarificationQuestion: "Please provide the name or identifier for the new participant profile to be created.",
          confidence: "high",
        };
      }

      assert.equal(turn.messages.length, 2);
      return {
        intent: "noop",
        entity: null,
        target: {
          mode: null,
          ref: null,
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "medium",
      };
    },
    async generateOperation({ turn }) {
      assert.equal(turn.messages.length, 2);
      return {
        entity: "participant",
        action: "create",
        targetSlug: null,
        newObject: {
          slug: "yugatov-konstantin",
          name: "Югатов Константин",
          role: "Архитектор",
          bio: turn.messages.map((message) => message.text).filter(Boolean).join("\n"),
          sourceLocale: "ru",
        },
        patch: null,
        translation: null,
        assetActions: [],
        warnings: [],
      };
    },
  };

  const first = await handleTelegramMessageV2({
    message: {
      message_id: 51,
      from: { id: 123 },
      chat: { id: 555 },
      text: "создай участника:",
    },
    updateId: 501,
    pendingStore,
    repository,
    extractionClient,
    text: "создай участника:",
    formattedTextHtml: null,
    attachments: [],
    dryRun: true,
  });

  assert.equal(first.status, "clarification");
  assert.equal(first.pendingState.operation.type, "v2_intent_clarification");

  const second = await handleTelegramMessage({
    message: {
      message_id: 52,
      from: { id: 123 },
      chat: { id: 555 },
      text: "Югатов Константин\nАрхитектор и дизайнер с 15-летним опытом.",
      forward_origin: { type: "user" },
    },
    updateId: 502,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
    useIntentPipeline: true,
    coalesceDelayMs: 0,
  });

  assert.equal(second.status, "processed");
  assert.equal(second.pendingState.operation.entity, "participant");
  assert.equal(second.pendingState.operation.action, "create");
  assert.equal(second.pendingState.operation.slug, "yugatov-konstantin");
});

test("main handler reprocesses clarification follow-up messages against the same active session", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async listEntityCandidates() {
      return [];
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: [] },
        nextIndex: { items: [parsedCommand.fields.slug] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/participants/index.json",
          itemPath: `content/participants/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };
  const baseTurn = {
    chatId: 555,
    userId: 123,
    recentContext: {
      lastConfirmedObject: null,
      pendingDraft: null,
    },
    messages: [
      {
        messageId: 61,
        updateId: 601,
        text: "создай участника и добавь фото:",
        formattedTextHtml: null,
        attachments: [],
        isForwarded: false,
        hasQuote: false,
      },
    ],
  };
  await pendingStore.setPending(555, createPendingRecord({
    chatId: 555,
    userId: 123,
    state: "awaiting_clarification",
    sourceMessageId: 61,
    sourceUpdateId: 601,
    question: "Please provide the participant's name and the photo to add.",
    operation: {
      type: "v2_intent_clarification",
      turn: baseTurn,
      intent: {
        intent: "create",
        entity: "participant",
        target: {
          mode: "new",
          ref: null,
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: true,
        clarificationReason: "insufficient_data",
        clarificationQuestion: "Please provide the participant's name and the photo to add.",
        confidence: "high",
      },
    },
  }));

  let analyzeCallCount = 0;
  const extractionClient = {
    async analyzeIntent({ turn }) {
      analyzeCallCount += 1;
      if (turn.messages.length === 2) {
        return {
          intent: "noop",
          entity: null,
          target: {
            mode: null,
            ref: null,
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
          needsClarification: true,
          clarificationReason: "insufficient_data",
          clarificationQuestion: "Please provide the participant bio too.",
          confidence: "medium",
        };
      }

      return {
        intent: "noop",
        entity: null,
        target: {
          mode: null,
          ref: null,
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "medium",
      };
    },
    async generateOperation({ turn }) {
      assert.equal(turn.messages.length, 3);
      return {
        entity: "participant",
        action: "create",
        targetSlug: null,
        newObject: {
          slug: "asker",
          name: "Asker",
          bio: turn.messages.map((message) => message.text).filter(Boolean).join("\n"),
          sourceLocale: "ru",
        },
        patch: null,
        translation: null,
        assetActions: [],
        warnings: [],
      };
    },
  };

  const firstPromise = handleTelegramMessage({
    message: {
      message_id: 62,
      from: { id: 123 },
      chat: { id: 555 },
      text: "Asker",
    },
    updateId: 602,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
    useIntentPipeline: true,
    coalesceDelayMs: 30,
    pendingCoalesceDelayMs: 30,
  });
  const firstResult = await firstPromise;

  const secondResult = await handleTelegramMessage({
    message: {
      message_id: 63,
      from: { id: 123 },
      chat: { id: 555 },
      text: "Designer and architect.",
    },
    updateId: 603,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
    useIntentPipeline: true,
    coalesceDelayMs: 30,
    pendingCoalesceDelayMs: 30,
  });

  assert.equal(firstResult.status, "clarification");
  assert.equal(secondResult.status, "processed");
  assert.equal(analyzeCallCount, 2);
  assert.equal(secondResult.pendingState.operation.entity, "participant");
  assert.equal(secondResult.pendingState.operation.action, "create");
  assert.equal(secondResult.pendingState.operation.slug, "asker");
});

test("pending clarification context appends new messages immediately without waiting for a debounce window", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async listEntityCandidates() {
      return [];
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: [] },
        nextIndex: { items: [parsedCommand.fields.slug] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/participants/index.json",
          itemPath: `content/participants/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };

  await pendingStore.setPending(555, createPendingRecord({
    chatId: 555,
    userId: 123,
    state: "awaiting_clarification",
    sourceMessageId: 71,
    sourceUpdateId: 701,
    question: "Please provide the participant's name and the photo to add.",
    operation: {
      type: "v2_intent_clarification",
      turn: {
        chatId: 555,
        userId: 123,
        recentContext: {
          lastConfirmedObject: null,
          pendingDraft: null,
        },
        messages: [
          {
            messageId: 71,
            updateId: 701,
            text: "создай участника и добавь фото:",
            formattedTextHtml: null,
            attachments: [],
            isForwarded: false,
            hasQuote: false,
          },
        ],
      },
      intent: {
        intent: "create",
        entity: "participant",
        target: {
          mode: "new",
          ref: null,
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: true,
        clarificationReason: "insufficient_data",
        clarificationQuestion: "Please provide the participant's name and the photo to add.",
        confidence: "high",
      },
    },
  }));

  let analyzeCallCount = 0;
  const extractionClient = {
    async analyzeIntent({ turn }) {
      analyzeCallCount += 1;
      if (turn.messages.length === 2) {
        return {
          intent: "noop",
          entity: null,
          target: {
            mode: null,
            ref: null,
          },
          relatedEntities: [],
          requestedLocales: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
          needsClarification: true,
          clarificationReason: "insufficient_data",
          clarificationQuestion: "Please provide the participant bio too.",
          confidence: "medium",
        };
      }

      return {
        intent: "noop",
        entity: null,
        target: {
          mode: null,
          ref: null,
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "medium",
      };
    },
    async generateOperation({ turn }) {
      assert.equal(turn.messages.length, 3);
      return {
        entity: "participant",
        action: "create",
        targetSlug: null,
        newObject: {
          slug: "asker",
          name: "Asker",
          bio: turn.messages.map((message) => message.text).filter(Boolean).join("\n"),
          sourceLocale: "ru",
        },
        patch: null,
        translation: null,
        assetActions: [],
        warnings: [],
      };
    },
  };

  const firstResult = await handleTelegramMessage({
    message: {
      message_id: 72,
      from: { id: 123 },
      chat: { id: 555 },
      text: "Asker",
    },
    updateId: 702,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
    useIntentPipeline: true,
    coalesceDelayMs: 5,
    pendingCoalesceDelayMs: 40,
  });
  assert.equal(firstResult.status, "clarification");

  const secondResult = await handleTelegramMessage({
    message: {
      message_id: 73,
      from: { id: 123 },
      chat: { id: 555 },
      text: "Designer and architect.",
    },
    updateId: 703,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
    useIntentPipeline: true,
    coalesceDelayMs: 5,
    pendingCoalesceDelayMs: 40,
  });
  assert.equal(secondResult.status, "processed");
  assert.equal(analyzeCallCount, 2);
});

test("main handler waits for a fresh turn to become stable and only the latest invocation processes it", async () => {
  const pendingStore = new PendingMemoryStore();
  const analyzeCalls = [];
  const repository = {
    async listEntityCandidates() {
      return [];
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: [] },
        nextIndex: { items: [parsedCommand.fields.slug] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/participants/index.json",
          itemPath: `content/participants/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };
  const extractionClient = {
    async analyzeIntent({ turn }) {
      analyzeCalls.push(turn.messages.map((entry) => entry.text));
      return {
        intent: "create",
        entity: "participant",
        target: {
          mode: "new",
          ref: "Asker",
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "high",
      };
    },
    async generateOperation({ turn }) {
      assert.equal(turn.messages.length, 2);
      return {
        entity: "participant",
        action: "create",
        targetSlug: null,
        newObject: {
          slug: "asker",
          name: "Asker",
          bio: turn.messages.map((entry) => entry.text).filter(Boolean).join("\n"),
          sourceLocale: "ru",
        },
        patch: null,
        translation: null,
        assetActions: [],
        warnings: [],
      };
    },
  };

  const firstPromise = handleTelegramMessage({
    message: {
      message_id: 81,
      from: { id: 123 },
      chat: { id: 555 },
      text: "создай участника:",
    },
    updateId: 801,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
    useIntentPipeline: true,
    coalesceDelayMs: 20,
  });

  await new Promise((resolve) => setTimeout(resolve, 5));

  const secondResult = await handleTelegramMessage({
    message: {
      message_id: 82,
      from: { id: 123 },
      chat: { id: 555 },
      text: "Меня зовут Аскер",
    },
    updateId: 802,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
    useIntentPipeline: true,
    coalesceDelayMs: 20,
  });
  const firstResult = await firstPromise;

  assert.equal(firstResult.status, "ignored");
  assert.equal(firstResult.reason, "batched-into-turn-context");
  assert.equal(secondResult.status, "processed");
  assert.equal(analyzeCalls.length, 1);
  assert.deepEqual(analyzeCalls[0], ["создай участника:", "Меня зовут Аскер"]);
});

test("main handler waits for a pending clarification turn to become stable and only the latest invocation resumes it", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async listEntityCandidates() {
      return [];
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: [] },
        nextIndex: { items: [parsedCommand.fields.slug] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/participants/index.json",
          itemPath: `content/participants/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };

  await pendingStore.setPending(555, createPendingRecord({
    chatId: 555,
    userId: 123,
    state: "awaiting_clarification",
    sourceMessageId: 90,
    sourceUpdateId: 900,
    question: "Please provide more participant details.",
    operation: {
      type: "v2_intent_clarification",
      turn: {
        chatId: 555,
        userId: 123,
        recentContext: {
          lastConfirmedObject: null,
          pendingDraft: null,
        },
        messages: [
          {
            messageId: 90,
            updateId: 900,
            text: "создай участника:",
            formattedTextHtml: null,
            attachments: [],
            isForwarded: false,
            hasQuote: false,
          },
        ],
      },
      intent: {
        intent: "create",
        entity: "participant",
        target: {
          mode: "new",
          ref: null,
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: true,
        clarificationReason: "insufficient_data",
        clarificationQuestion: "Please provide more participant details.",
        confidence: "high",
      },
    },
  }));

  const analyzeCalls = [];
  const extractionClient = {
    async analyzeIntent({ turn }) {
      analyzeCalls.push(turn.messages.map((entry) => entry.text));
      return {
        intent: "create",
        entity: "participant",
        target: {
          mode: "new",
          ref: "Asker",
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "high",
      };
    },
    async generateOperation({ turn }) {
      assert.equal(turn.messages.length, 3);
      return {
        entity: "participant",
        action: "create",
        targetSlug: null,
        newObject: {
          slug: "asker",
          name: "Asker",
          bio: turn.messages.map((entry) => entry.text).filter(Boolean).join("\n"),
          sourceLocale: "ru",
        },
        patch: null,
        translation: null,
        assetActions: [],
        warnings: [],
      };
    },
  };

  const firstPromise = handleTelegramMessage({
    message: {
      message_id: 91,
      from: { id: 123 },
      chat: { id: 555 },
      text: "Меня зовут Аскер",
    },
    updateId: 901,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
    useIntentPipeline: true,
    pendingCoalesceDelayMs: 20,
    coalesceDelayMs: 20,
  });

  await new Promise((resolve) => setTimeout(resolve, 5));

  const secondResult = await handleTelegramMessage({
    message: {
      message_id: 92,
      from: { id: 123 },
      chat: { id: 555 },
      text: "Архитектор и дизайнер.",
    },
    updateId: 902,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
    useIntentPipeline: true,
    pendingCoalesceDelayMs: 20,
    coalesceDelayMs: 20,
  });
  const firstResult = await firstPromise;

  assert.equal(firstResult.status, "ignored");
  assert.equal(firstResult.reason, "batched-into-pending-context");
  assert.equal(secondResult.status, "processed");
  assert.equal(analyzeCalls.length, 1);
  assert.deepEqual(analyzeCalls[0], [
    "создай участника:",
    "Меня зовут Аскер",
    "Архитектор и дизайнер.",
  ]);
});
