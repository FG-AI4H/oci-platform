/**
 * What may be printed about an unexpected error.
 *
 * A file-system error's message quotes the path it failed on, and a
 * path inside a sample can be exactly the name that must not be copied
 * anywhere. For those, only the system's code and call are kept.
 */
export function describeError(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'code' in err && 'syscall' in err) {
    const { code, syscall } = err as { code: unknown; syscall: unknown };
    if (typeof code === 'string' && typeof syscall === 'string') {
      return `a file or folder could not be read or written (${code}, ${syscall})`;
    }
  }
  return err instanceof Error ? err.message : 'unknown error';
}
