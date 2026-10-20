const SAFE_MODEL_SLUG = /^[a-z0-9][a-z0-9.-]{0,179}$/;

function hashModelName(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function getModelSlug(modelName: string): string {
  const normalized = modelName.normalize("NFKC").trim().toLowerCase();
  const base = normalized
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 180);
  const slugBase = base || "model";

  if (
    SAFE_MODEL_SLUG.test(modelName) &&
    modelName === normalized &&
    slugBase === normalized
  ) {
    return slugBase;
  }

  return `${slugBase}-${hashModelName(modelName)}`;
}

export function getModelPath(modelName: string): string {
  return `/model/${getModelSlug(modelName)}`;
}

export function getModelSlugMap(modelNames: Iterable<string>): Map<string, string> {
  const slugToModel = new Map<string, string>();
  const ambiguousSlugs = new Set<string>();

  for (const modelName of modelNames) {
    const slug = getModelSlug(modelName);
    if (slugToModel.has(slug) && slugToModel.get(slug) !== modelName) {
      ambiguousSlugs.add(slug);
    } else {
      slugToModel.set(slug, modelName);
    }
  }

  for (const slug of ambiguousSlugs) {
    slugToModel.delete(slug);
  }

  return slugToModel;
}
