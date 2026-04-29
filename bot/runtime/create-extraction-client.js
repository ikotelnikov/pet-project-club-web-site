import { ExtractionClient } from "../adapters/openai/extraction-client.js";
import { PrototypeExtractionClient } from "../adapters/openai/prototype-extraction-client.js";

export function createExtractionClient(config, options = {}) {
  if (config.extractionBackend === "openai") {
    return new ExtractionClient({
      apiKey: config.openAiApiKey,
      model: config.openAiModel || undefined,
      fetchImpl: options.fetchImpl,
      debugLogger: options.debugLogger,
    });
  }

  return new PrototypeExtractionClient();
}
