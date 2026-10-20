import type { z } from "zod";
import { createDocument } from "./doc.js";
import type { PatinaDocument } from "./types.js";
import type { Session } from "./session.js";

export interface EditorState {
  doc: PatinaDocument;
  /** Selected layer id. */
  selection: string | null;
}

export interface CommandContext {
  editor: Editor;
  /** The current document. Documents are immutable: build a new one and call `set`. */
  doc: PatinaDocument;
  set(doc: PatinaDocument): void;
  /** Present when the editor belongs to a Session (mesh, engine, picking). */
  session: Session | null;
}

export interface CommandDef<S extends z.ZodType = z.ZodType, R = unknown> {
  id: string;
  title: string;
  description: string;
  params: S;
  /** Mutating commands go through undo history; queries and view state do not. */
  mutates: boolean;
  run(ctx: CommandContext, params: z.output<S>): R;
}

export function defineCommand<S extends z.ZodType, R>(def: CommandDef<S, R>): CommandDef<S, R> {
  return def;
}

export interface ExecuteOptions {
  /** Consecutive commands with the same key share one undo step (slider drags). */
  historyKey?: string;
}

export interface ChangeEvent {
  command: string;
  state: EditorState;
}

interface HistoryEntry {
  doc: PatinaDocument;
  selection: string | null;
  label: string;
  key?: string;
}

const HISTORY_LIMIT = 300;

/**
 * Document, selection and undo history, plus the command registry every surface goes through
 * (desktop UI, CLI, MCP, live bridge). Documents are immutable values, so an undo step is just the
 * previous document and texture caches keyed by object identity survive undo/redo.
 */
export class Editor {
  state: EditorState;
  session: Session | null = null;
  private registry = new Map<string, CommandDef>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<(e: ChangeEvent) => void>();
  dirty = false;

  constructor(commands: CommandDef[] = [], doc: PatinaDocument = createDocument()) {
    this.state = { doc, selection: null };
    for (const c of commands) this.register(c);
  }

  get doc(): PatinaDocument {
    return this.state.doc;
  }

  register(def: CommandDef): void {
    if (this.registry.has(def.id)) throw new Error(`Command "${def.id}" is already registered`);
    this.registry.set(def.id, def);
  }

  commands(filter?: string): CommandDef[] {
    const all = [...this.registry.values()];
    if (!filter) return all;
    const exact = this.registry.get(filter);
    if (exact) return [exact];
    const f = filter.toLowerCase();
    return all.filter((c) => c.id.toLowerCase().includes(f) || c.title.toLowerCase().includes(f) || c.description.toLowerCase().includes(f));
  }

  command(id: string): CommandDef {
    const c = this.registry.get(id);
    if (!c) {
      const near = this.commands(id.split(".")[0]).map((x) => x.id);
      throw new Error(`Unknown command "${id}".${near.length ? ` Did you mean: ${near.slice(0, 8).join(", ")}?` : " Run command_list to see all commands."}`);
    }
    return c;
  }

  execute<R = unknown>(id: string, params: unknown = {}, opts: ExecuteOptions = {}): R {
    if (id === "history.undo") return this.undo() as R;
    if (id === "history.redo") return this.redo() as R;
    const def = this.command(id);
    const parsed = def.params.safeParse(params ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "params"}: ${i.message}`).join("; ");
      throw new Error(`${id}: invalid params. ${issues}`);
    }
    const before: HistoryEntry = { doc: this.state.doc, selection: this.state.selection, label: def.title, key: opts.historyKey };
    let next = this.state.doc;
    const ctx: CommandContext = {
      editor: this,
      get doc() {
        return next;
      },
      set: (d) => {
        if (!def.mutates) throw new Error(`${id} is a query and cannot change the document`);
        next = d;
      },
      session: this.session,
    };
    const result = def.run(ctx, parsed.data) as R;
    if (next !== before.doc) {
      const top = this.undoStack[this.undoStack.length - 1];
      if (!(opts.historyKey && top?.key === opts.historyKey)) {
        this.undoStack.push(before);
        if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      }
      this.redoStack = [];
      this.state = { ...this.state, doc: next };
      this.pruneSelection();
      this.dirty = true;
      this.emit(id);
    } else if (before.selection !== this.state.selection) this.emit(id);
    return result;
  }

  /** Several commands as one undo step; rolls back all of them if any fails. */
  batch(steps: { command: string; params?: unknown }[]): unknown[] {
    const start: HistoryEntry = { doc: this.state.doc, selection: this.state.selection, label: "Batch" };
    const undoLen = this.undoStack.length;
    const key = `batch-${Math.random().toString(36).slice(2)}`;
    const results: unknown[] = [];
    try {
      steps.forEach((s, n) => {
        try {
          results.push(this.execute(s.command, s.params ?? {}, { historyKey: key }));
        } catch (e) {
          throw new Error(`step ${n + 1} (${s.command}): ${(e as Error).message}`);
        }
      });
    } catch (err) {
      this.state = { doc: start.doc, selection: start.selection };
      this.undoStack.length = undoLen;
      this.emit("batch");
      throw err;
    }
    if (this.undoStack.length > undoLen) this.undoStack.splice(undoLen, this.undoStack.length - undoLen, start);
    return results;
  }

  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.redoStack.push({ doc: this.state.doc, selection: this.state.selection, label: e.label });
    this.state = { doc: e.doc, selection: e.selection };
    this.pruneSelection();
    this.dirty = true;
    this.emit("history.undo");
    return true;
  }

  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.undoStack.push({ doc: this.state.doc, selection: this.state.selection, label: e.label });
    this.state = { doc: e.doc, selection: e.selection };
    this.pruneSelection();
    this.dirty = true;
    this.emit("history.redo");
    return true;
  }

  history(): { undo: string[]; redo: string[] } {
    return { undo: this.undoStack.map((e) => e.label), redo: this.redoStack.map((e) => e.label) };
  }

  select(id: string | null) {
    if (this.state.selection === id) return;
    this.state = { ...this.state, selection: id };
    this.emit("layer.select");
  }

  /** Replace the document (open file). Clears history. */
  load(doc: PatinaDocument): void {
    this.state = { doc, selection: null };
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.emit("doc.load");
  }

  subscribe(fn: (e: ChangeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private pruneSelection(): void {
    const id = this.state.selection;
    if (!id) return;
    const has = (ls: PatinaDocument["layers"]): boolean => ls.some((l) => l.id === id || (l.type === "folder" && has(l.children)));
    if (!has(this.state.doc.layers)) this.state = { ...this.state, selection: null };
  }

  private emit(command: string): void {
    for (const l of this.listeners) l({ command, state: this.state });
  }
}
