/**
 * A `?next=` value that is safe to redirect to: a path on this site, never
 * another origin ("//host" and "/\host" are protocol-relative in browsers).
 */
export function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/dashboard";
  return raw;
}
