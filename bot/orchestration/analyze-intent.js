export async function analyzeIntent({ turn, extractionClient, debugContext = null }) {
  return extractionClient.analyzeIntent({ turn, debugContext });
}
