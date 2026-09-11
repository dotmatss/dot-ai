/**
 * Return shape for Server Actions. Expected failures (validation, wrong
 * credentials) are modelled as values, never thrown, so forms can render them.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export function actionSuccess<T>(data?: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionFailure<T = undefined>(error: string, fieldErrors?: Record<string, string[] | undefined>): ActionResult<T> {
  return { ok: false, error, fieldErrors };
}
