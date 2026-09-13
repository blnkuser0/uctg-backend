interface ChecklistItemLike {
  isChecked: boolean;
}

/** Percentage (0-100, rounded) of checked items. Returns 0 for an empty checklist. */
export function computeChecklistProgress(items: ChecklistItemLike[]): number {
  if (!items || items.length === 0) return 0;
  const checked = items.filter((item) => item.isChecked).length;
  return Math.round((checked / items.length) * 100);
}
