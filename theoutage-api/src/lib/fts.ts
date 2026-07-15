/**
 * Turn free-text user input into a safe FTS5 MATCH expression.
 *
 * Raw user input can't be passed to MATCH directly — FTS5 query syntax
 * treats quotes, hyphens, carets, colons, and asterisks as operators, so
 * unescaped input can throw a syntax error (or do something the user didn't
 * intend, like a column filter). Instead: strip everything except
 * alphanumerics per token, drop empty tokens, and AND together prefix
 * matches — e.g. "power outage!!" -> `"power"* AND "outage"*`.
 *
 * Returns null if there's nothing searchable left (caller should skip the
 * FTS join entirely in that case).
 */
export function buildFtsQuery(raw: string): string | null {
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.replace(/[^a-zA-Z0-9]/g, ""))
    .filter((t) => t.length > 0)
    .slice(0, 10); // cap terms to keep the query cheap

  if (tokens.length === 0) return null;

  return tokens.map((t) => `"${t}"*`).join(" AND ");
}
