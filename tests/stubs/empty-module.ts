/**
 * Stand-in for the `server-only` / `client-only` marker packages under Vitest.
 *
 * Those packages exist to fail a bundle at build time when a module crosses the
 * wrong boundary, and they do that by throwing on import outside the matching
 * environment. The Next.js build still enforces the boundary; the test runner
 * only needs the import to resolve so server modules (services, SQL helpers,
 * the AI gateway) can be unit tested directly.
 */
export {};
