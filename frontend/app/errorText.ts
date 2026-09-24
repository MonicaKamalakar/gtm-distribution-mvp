/**
 * Maps raw backend error text to a user-friendly error state.
 * Categories: invalid URL, timeout, AI failure, crawl failure, analysis failure.
 * The raw message is still shown alongside for debugging.
 */

export type ErrorKind =
  | "invalid-url"
  | "timeout"
  | "ai"
  | "crawl"
  | "analysis";

export type FriendlyError = {
  kind: ErrorKind;
  title: string;
  message: string;
};

const INVALID_URL =
  /valid http|invalid url|must be.*url|only http|no hostname|blocked host|blocked internal|blocked:/i;
const TIMEOUT = /timed out|timeout|deadline exceeded/i;
const BUDGET = /budget exceeded/i;
const AI =
  /llm|openrouter|openai|provider|budget|empty completion|not valid json|unexpected response shape|analysis failed|product analysis|icp analysis|competitor research|buyer question|discovery query|distribution gap|opportunity generation|opportunity prioritization|action planning|provider returned/i;
const CRAWL =
  /resolve host|name or service|getaddrinfo|could not fetch|certificate|ssl|redirect|http \d{3}|did not return html|too many redirects|page is too large|connection|could not reach/i;

export function friendlyError(raw: string | null | undefined): FriendlyError {
  const text = raw ?? "";

  if (INVALID_URL.test(text)) {
    return {
      kind: "invalid-url",
      title: "Invalid website URL",
      message:
        "Enter a valid public website URL, for example https://example.com.",
    };
  }
  if (BUDGET.test(text)) {
    return {
      kind: "ai",
      title: "Analysis budget reached",
      message:
        "The analysis stopped because its AI cost budget was exhausted. Increase ANALYSIS_BUDGET_USD and retry the failed step.",
    };
  }
  if (TIMEOUT.test(text)) {
    return {
      kind: "timeout",
      title: "Request timed out",
      message:
        "The request took too long and was stopped. Retry the failed step, or run the analysis again.",
    };
  }
  if (AI.test(text)) {
    return {
      kind: "ai",
      title: "AI analysis failed",
      message:
        "The AI model did not return a usable result. Retry the failed step to try again.",
    };
  }
  if (CRAWL.test(text)) {
    return {
      kind: "crawl",
      title: "Website crawl failed",
      message:
        "We couldn't fetch this website. Check that the URL is publicly reachable, then try again.",
    };
  }
  return {
    kind: "analysis",
    title: "Analysis failed",
    message:
      "Something went wrong during the analysis. Retry the failed step, or run the analysis again.",
  };
}
