// ── Memory kinds ─────────────────────────────────────────────────────────────
export const KIND_COLORS = {
  episode:   "#5b9dff",
  lesson:    "#ffb454",
  decision:  "#ff6b9d",
  reference: "#7ee787",
};

export const KIND_SIZES = {
  decision:  16,
  lesson:    11,
  reference:  8,
  episode:    5,
};

// ── Memory-graph edge kinds ──────────────────────────────────────────────────
export const EDGE_COLORS = {
  semantic: "rgba(120,160,255,0.55)",
  explicit: "rgba(255,180,100,0.85)",
  temporal: "rgba(255,255,255,0.18)",
  cross:    "rgba(184,107,255,0.75)",
};

// ── Entity kinds ─────────────────────────────────────────────────────────────
export const ENTITY_KIND_COLORS = {
  project:   "#5b9dff",
  tech:      "#7ee787",
  tool:      "#ffb454",
  system:    "#ff6b9d",
  host:      "#5cdcff",
  domain:    "#b86bff",
  card:      "#a0cfff",
  component: "#888888",
  person:    "#ff9b54",
  product:   "#ff6b54",
  language:  "#9bff9b",
};

// ── Predicate semantic groups ────────────────────────────────────────────────
export function predicateColor(p) {
  if (!p) return "rgba(184,164,255,0.5)";
  const s = p.toLowerCase();
  if (/^(uses|built_with|requires|runs_on|reads)$/.test(s))
    return "rgba(126,231,135,0.65)";
  if (/^(contains|part_of|has_views|builds_as|groups|outputs|models)$/.test(s))
    return "rgba(91,157,255,0.65)";
  if (/^(has_bug|had_bug|had_issue)$/.test(s))
    return "rgba(255,107,107,0.7)";
  if (/^(has_lesson|has_decision|has_design|has_requirement|has_theme)$/.test(s))
    return "rgba(255,180,84,0.65)";
  if (/^(lives_at|deploys_to|hosted_on|hosted_at|runs_on_port|stakeholder_of)$/.test(s))
    return "rgba(255,107,157,0.65)";
  if (/^(related_to|modified_by|opens|diagnoses|built_for|uses_language)$/.test(s))
    return "rgba(160,207,255,0.6)";
  return "rgba(184,107,255,0.65)";
}

export function predicateGroupName(p) {
  if (!p) return "Other";
  const s = p.toLowerCase();
  if (/^(uses|built_with|requires|runs_on|reads)$/.test(s))                                return "Tech use";
  if (/^(contains|part_of|has_views|builds_as|groups|outputs|models)$/.test(s))             return "Composition";
  if (/^(has_bug|had_bug|had_issue)$/.test(s))                                              return "Problems";
  if (/^(has_lesson|has_decision|has_design|has_requirement|has_theme)$/.test(s))           return "Wisdom";
  if (/^(lives_at|deploys_to|hosted_on|hosted_at|runs_on_port|stakeholder_of)$/.test(s))    return "Place / People";
  return "Other";
}

export const PREDICATE_GROUPS = [
  { name: "Tech use",       color: "rgba(126,231,135,0.85)" },
  { name: "Composition",    color: "rgba(91,157,255,0.85)"  },
  { name: "Problems",       color: "rgba(255,107,107,0.85)" },
  { name: "Wisdom",         color: "rgba(255,180,84,0.85)"  },
  { name: "Place / People", color: "rgba(255,107,157,0.85)" },
];
