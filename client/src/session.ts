/** A same-origin HttpOnly cookie authenticates HTTP and browser WebSockets. */
let pending: Promise<void> | null = null;
export function ensureSession(): Promise<void> {
  return pending ??= fetch('/api/session').then((res) => {
    if (!res.ok) throw new Error('Could not connect to the office session');
  }).finally(() => { pending = null; });
}
