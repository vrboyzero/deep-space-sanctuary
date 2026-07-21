const STAT_FIELDS = [
  ["total", "experience.statTotal", "Candidates"],
  ["methods", "experience.statMethods", "Methods"],
  ["skills", "experience.statSkills", "Skills"],
  ["draft", "experience.statDraft", "Draft"],
  ["accepted", "experience.statAccepted", "Accepted"],
  ["rejected", "experience.statRejected", "Rejected"],
];

export function createExperienceWorkbenchStatsView({
  refs,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const { experienceWorkbenchStatsEl } = refs;

  return {
    render(stats = null) {
      if (!experienceWorkbenchStatsEl) return;
      const safeStats = stats && typeof stats === "object" ? stats : null;
      const ownerDocument = experienceWorkbenchStatsEl.ownerDocument ?? document;
      const cards = STAT_FIELDS.map(([field, labelKey, labelFallback]) => {
        const card = ownerDocument.createElement("div");
        card.className = "memory-stat-card";

        const label = ownerDocument.createElement("span");
        label.className = "memory-stat-label";
        label.textContent = String(t(labelKey, {}, labelFallback) ?? "");

        const value = ownerDocument.createElement("strong");
        value.className = "memory-stat-value";
        value.textContent = String(safeStats ? safeStats[field] : "--");

        card.append(label, value);
        return card;
      });
      experienceWorkbenchStatsEl.replaceChildren(...cards);
    },
  };
}
