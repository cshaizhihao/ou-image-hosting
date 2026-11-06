// File references and physical deletion must share one writer queue. The JSON
// store alone cannot protect the interval between committing a deletion and
// unlinking a content-addressed file reused by another upload.
export class MediaCoordinator {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
