type Cleanup = { name: string; close: (restart: boolean) => void | Promise<void> };

/** Invoke every admission barrier immediately; one slow or failed provider cannot
 * leave another service accepting work while shutdown is in progress. */
export class OfficeShutdown {
  private work?: Promise<void>;
  closed = false;
  constructor(private readonly services: Cleanup[]) {}

  close(restart = false): Promise<void> {
    if (this.work) return this.work;
    this.closed = true;
    // Reserve the shared completion before calling providers, including providers
    // that synchronously trigger another shutdown request.
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    this.work = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const pending = this.services.map(service => {
      try { return Promise.resolve(service.close(restart)); }
      catch (error) { return Promise.reject(error); }
    });
    void Promise.allSettled(pending).then(results => {
      const errors = results.flatMap((result, index) => result.status === 'rejected'
        ? [new Error(`${this.services[index].name} cleanup failed`, { cause: result.reason })] : []);
      if (errors.length) reject(new AggregateError(errors, 'Office shutdown did not complete cleanly'));
      else resolve();
    });
    return this.work;
  }
}
