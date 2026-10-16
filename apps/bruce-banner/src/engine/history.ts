/** Undo / redo over whole-document snapshots (as Kiln). Banner documents are a few KB: images live elsewhere. */
export class History<T> {
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  constructor(private limit = 100) {}

  /** Records the state before an edit. */
  push(before: T) {
    const snap = JSON.stringify(before);
    if (this.undoStack[this.undoStack.length - 1] === snap) return;
    this.undoStack.push(snap);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: T): T | null {
    const snap = this.undoStack.pop();
    if (!snap) return null;
    this.redoStack.push(JSON.stringify(current));
    return JSON.parse(snap) as T;
  }

  redo(current: T): T | null {
    const snap = this.redoStack.pop();
    if (!snap) return null;
    this.undoStack.push(JSON.stringify(current));
    return JSON.parse(snap) as T;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
