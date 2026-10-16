import type { SceneDoc } from './scene';

/** Undo / redo over whole-document snapshots. Documents are small: SVG text lives elsewhere. */
export class History {
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  constructor(private limit = 100) {}

  /** Records the state before an edit. */
  push(before: SceneDoc) {
    const snap = JSON.stringify(before);
    if (this.undoStack[this.undoStack.length - 1] === snap) return;
    this.undoStack.push(snap);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: SceneDoc): SceneDoc | null {
    const snap = this.undoStack.pop();
    if (!snap) return null;
    this.redoStack.push(JSON.stringify(current));
    return JSON.parse(snap) as SceneDoc;
  }

  redo(current: SceneDoc): SceneDoc | null {
    const snap = this.redoStack.pop();
    if (!snap) return null;
    this.undoStack.push(JSON.stringify(current));
    return JSON.parse(snap) as SceneDoc;
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
