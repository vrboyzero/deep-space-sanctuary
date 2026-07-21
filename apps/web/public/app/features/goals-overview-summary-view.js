const SUMMARY_FIELDS = [
  ["goals.statGoals", "Long Tasks", (goals) => goals.length],
  ["goals.statExecuting", "Executing", (goals) => goals.filter((goal) => goal?.status === "executing").length],
  ["goals.statPaused", "Paused", (goals) => goals.filter((goal) => goal?.status === "paused").length],
  ["goals.statCustomRoot", "Custom Root", (goals) => goals.filter((goal) => goal?.pathSource === "user-configured").length],
];

export function createGoalsOverviewSummaryView({
  refs,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const { goalsSummaryEl } = refs;

  return {
    render(items) {
      if (!goalsSummaryEl) return;
      const goals = Array.isArray(items) ? items : [];
      const ownerDocument = goalsSummaryEl.ownerDocument ?? document;
      const cards = SUMMARY_FIELDS.map(([labelKey, labelFallback, getValue]) => {
        const card = ownerDocument.createElement("div");
        card.className = "memory-stat-card";

        const label = ownerDocument.createElement("span");
        label.className = "memory-stat-label";
        label.textContent = String(t(labelKey, {}, labelFallback) ?? "");

        const value = ownerDocument.createElement("strong");
        value.className = "memory-stat-value";
        value.textContent = String(getValue(goals));

        card.append(label, value);
        return card;
      });
      goalsSummaryEl.replaceChildren(...cards);
    },
  };
}
