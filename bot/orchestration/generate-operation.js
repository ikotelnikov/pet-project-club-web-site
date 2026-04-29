export async function generateOperation({
  turn,
  resolved,
  extractionClient,
  entitySchema,
  debugContext = null,
}) {
  return extractionClient.generateOperation({
    turn,
    resolved,
    entitySchema,
    debugContext,
  });
}
