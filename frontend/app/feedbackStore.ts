/**
 * In-session record of the feedback the user has given on this page.
 *
 * The backend persists feedback (POST /api/v1/feedback) but exposes no read
 * endpoint, and the feedback buttons keep their selection in component state.
 * This store mirrors those confirmed selections so the report export can show
 * the same feedback state the user sees on screen. It never invents state:
 * anything not recorded here is exported as "Not rated".
 */

export type FeedbackValue = "useful" | "not_useful" | "incorrect";

const selections = new Map<string, FeedbackValue>();

function key(entityType: string, entityRef: string): string {
  return `${entityType}\u0000${entityRef}`;
}

/** Record a feedback selection after the server accepted it. */
export function recordFeedback(
  entityType: string,
  entityRef: string,
  value: FeedbackValue,
): void {
  selections.set(key(entityType, entityRef), value);
}

/** The feedback recorded for this entity in this session, if any. */
export function getFeedback(
  entityType: string,
  entityRef: string,
): FeedbackValue | undefined {
  return selections.get(key(entityType, entityRef));
}
