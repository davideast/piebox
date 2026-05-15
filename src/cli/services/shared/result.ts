export type Result<T, E = { code: string; message: string }> =
  | { success: true; data: T }
  | { success: false; error: E };

export function ok<T>(data: T): Result<T, any> {
  return { success: true, data };
}

export function fail<E extends { code: string; message: string }>(
  code: E["code"],
  message: E["message"]
): Result<any, E> {
  return { success: false, error: { code, message } as E };
}
