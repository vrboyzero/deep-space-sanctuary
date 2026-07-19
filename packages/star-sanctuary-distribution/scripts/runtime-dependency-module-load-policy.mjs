function normalizeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function inspectOptionalRuntimeModule(moduleRequire, specifier, { load = false } = {}) {
  let resolvedFrom;
  try {
    resolvedFrom = moduleRequire.resolve(specifier);
  } catch (error) {
    if (error?.code === "MODULE_NOT_FOUND") {
      return { present: false, load: { ok: null } };
    }
    return {
      present: null,
      load: { ok: null },
      error: normalizeError(error),
    };
  }

  if (!load) {
    return { present: true, resolvedFrom, load: { ok: null } };
  }
  try {
    moduleRequire(specifier);
    return { present: true, resolvedFrom, load: { ok: true } };
  } catch (error) {
    return {
      present: true,
      resolvedFrom,
      load: { ok: false, error: normalizeError(error) },
    };
  }
}
