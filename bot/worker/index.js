import { handleTelegramWebhookRequest } from "../adapters/telegram/webhook.js";
import { createWorkerRuntime } from "../runtime/create-worker-runtime.js";

export default {
  async fetch(request, env = {}, executionCtx) {
    const runtime = createWorkerRuntime(env, { fetchImpl: fetch });

    return handleTelegramWebhookRequest({
      request,
      runtime,
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || null,
      adminToken: env.WORKER_ADMIN_TOKEN || null,
      dryRun: env.DRY_RUN !== "false",
      executionCtx,
    });
  },
};
