function normalizeEntity(entity) {
  return entity === "announcement" ? "announce" : entity;
}

function buildCandidateLabel(candidate) {
  return (
    candidate.label ||
    candidate.title ||
    candidate.name ||
    candidate.handle ||
    candidate.slug
  );
}

async function listCandidates(repository, entity) {
  return repository.listEntityCandidates(normalizeEntity(entity));
}

function exactMatchCandidates(candidates, ref) {
  const normalized = String(ref || "").trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  return candidates.filter((candidate) => {
    const values = [
      candidate.slug,
      candidate.label,
      candidate.title,
      candidate.name,
      candidate.handle,
    ]
      .filter(Boolean)
      .map((value) => String(value).trim().toLowerCase());

    return values.includes(normalized);
  });
}

export async function resolveSingleReference({
  repository,
  entity,
  ref,
  required = true,
}) {
  const candidates = await listCandidates(repository, entity);
  const exact = exactMatchCandidates(candidates, ref);

  if (exact.length === 1) {
    return {
      ok: true,
      resolved: {
        entity,
        slug: exact[0].slug,
        exists: true,
      },
    };
  }

  if (exact.length > 1) {
    return {
      ok: false,
      clarification: {
        kind: "target_ambiguity",
        question: `Which ${entity} do you mean?`,
        options: exact.slice(0, 5).map((candidate) => ({
          entity,
          slug: candidate.slug,
          label: buildCandidateLabel(candidate),
        })),
      },
    };
  }

  if (required) {
    return {
      ok: false,
      clarification: {
        kind: "target_missing",
        question: `I couldn't find that ${entity}. Tell me the exact slug, name, or handle.`,
        options: [],
      },
    };
  }

  return {
    ok: true,
    resolved: {
      entity,
      slug: null,
      exists: false,
    },
  };
}

export async function resolveTargets({ intent, repository }) {
  if (intent.intent === "noop" || intent.intent === "undo") {
    return {
      ok: true,
      resolved: {
        intent: intent.intent,
        entity: intent.entity,
        target: null,
        relatedEntities: [],
        currentObject: null,
        requestedLocales: intent.requestedLocales,
      },
    };
  }

  const relatedEntities = [];
  let target = null;
  let currentObject = null;

  if (intent.target?.mode === "existing") {
    const targetResolution = await resolveSingleReference({
      repository,
      entity: intent.entity,
      ref: intent.target.ref,
      required: true,
    });

    if (!targetResolution.ok) {
      return targetResolution;
    }

    target = targetResolution.resolved;
    currentObject = await repository.readItem(
      normalizeEntity(intent.entity),
      target.slug
    );
  } else if (intent.target?.mode === "new") {
    target = {
      entity: intent.entity,
      slug: null,
      exists: false,
    };
  }

  for (const related of intent.relatedEntities || []) {
    const relatedResolution = await resolveSingleReference({
      repository,
      entity: related.entity,
      ref: related.ref,
      required: true,
    });

    if (!relatedResolution.ok) {
      return relatedResolution;
    }

    relatedEntities.push({
      ...relatedResolution.resolved,
      role: related.role,
    });
  }

  return {
    ok: true,
    resolved: {
      intent: intent.intent,
      entity: intent.entity,
      target,
      relatedEntities,
      currentObject,
      requestedLocales: intent.requestedLocales,
    },
  };
}
