import { TranslationClient } from "../adapters/openai/translation-client.js";

export function createTranslationClient(config, options = {}) {
  if (!config.openAiApiKey) {
    return null;
  }

  return new TranslationClient({
    apiKey: config.openAiApiKey,
    model: config.openAiTranslationModel || config.openAiModel || undefined,
    fetchImpl: options.fetchImpl,
  });
}
