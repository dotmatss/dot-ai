/**
 * Database error types, deliberately in a leaf module.
 *
 * `toErrorResponse()` needs to recognise a database outage, and it is imported
 * by every route handler in the application - including public ones that never
 * touch the database at all. If this class lived in `client.ts`, importing the
 * error mapper would pull in the connection pool and the entire Drizzle schema
 * as a side effect, on every route.
 *
 * So the type lives here, with no imports of its own. `client.ts` re-exports it
 * for existing callers.
 */
export class DatabaseUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DatabaseUnavailableError";
  }
}
