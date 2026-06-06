/**
 * 成否を値として表す Result 型。throw の代わりにこれを返すことで、
 * 呼び出し側に分岐を型で強制する（handler/usecase/repository 共通の規約）。
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * 例外を投げうる処理（fetch / JSON parse 等）を Result に統一する。
 * 主に repository 層で外部 I/O を包むために使う。
 */
export async function safeTry<T>(fn: () => Promise<T> | T): Promise<Result<T, unknown>> {
  try {
    return ok(await fn());
  } catch (cause) {
    return err(cause);
  }
}
