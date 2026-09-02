// Its own module, with no dependencies, so the main bundle can recognise a cancelled merge
// without importing merge.js — and with it pdf-lib — on a path that may never run.
export class MergeCancelled extends Error {
  constructor() {
    super('Merge cancelled');
    this.name = 'MergeCancelled';
  }
}
