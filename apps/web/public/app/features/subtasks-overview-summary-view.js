const SUMMARY_FIELDS = [
  ["subtasks.statTasks", "Subtasks", (items) => items.length],
  ["subtasks.statRunning", "Running", (items) => items.filter((item) => item?.status === "running").length],
  ["subtasks.statDone", "Done", (items) => items.filter((item) => item?.status === "done").length],
  ["subtasks.statFailed", "Failed", (items) => items.filter((item) => ["error", "timeout", "stopped"].includes(item?.status)).length],
];

export function createSubtasksOverviewSummaryView({
  refs,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const { subtasksSummaryEl } = refs;

  return {
    render(items) {
      if (!subtasksSummaryEl) return;
      const safeItems = Array.isArray(items) ? items : [];
      const ownerDocument = subtasksSummaryEl.ownerDocument ?? document;
      const cards = SUMMARY_FIELDS.map(([labelKey, labelFallback, getValue]) => {
        const card = ownerDocument.createElement("div");
        card.className = "memory-stat-card";

        const label = ownerDocument.createElement("span");
        label.className = "memory-stat-label";
        label.textContent = String(t(labelKey, {}, labelFallback) ?? "");

        const value = ownerDocument.createElement("strong");
        value.className = "memory-stat-value";
        value.textContent = String(getValue(safeItems));

        card.append(label, value);
        return card;
      });
      subtasksSummaryEl.replaceChildren(...cards);
    },
  };
}
