import { clone } from "./ranges";
import { requireValue } from "./mapping";
export interface AnnotationRecord {
  phase: "creating" | "not_created" | "anchoring" | "verified";
  commentId?: string;
  replyId?: string;
  blockId: string;
  lastComment?: string;
  selectedText?: string;
  start?: number;
  end?: number;
}
export interface PendingPaper {
  itemKey: string;
  attempts: number;
  lastAttempt: number;
  reason: string;
}
export interface AnnotationDetail {
  annotationKey: string;
  status: "synced" | "unchanged" | "matched" | "pending" | "skipped";
  error?: string;
  selectedText?: string;
  commentId?: string;
}
export interface AnnotationHistory {
  time: string;
  itemKey: string;
  title: string;
  documentUrl?: string;
  outcome: string;
  details: AnnotationDetail[];
  errors: string[];
}
export interface AnnotationState {
  version: 2;
  records: Record<string, AnnotationRecord>;
  pending: Record<string, PendingPaper>;
  history: AnnotationHistory[];
  watched?: Record<string, number>;
}
export interface AnnotationStateRepository {
  load(): Promise<AnnotationState>;
  save(state: AnnotationState): Promise<void>;
}
export function emptyAnnotationState(): AnnotationState {
  return { version: 2, records: {}, pending: {}, history: [], watched: {} };
}
export class AnnotationStore implements AnnotationStateRepository {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly file?: string) {}
  private paths(): any {
    return ztoolkit.getGlobal("PathUtils");
  }
  private io(): any {
    return ztoolkit.getGlobal("IOUtils");
  }
  private path(): string {
    return (
      this.file ||
      this.paths().join(
        this.paths().profileDir,
        "zotero-feishu",
        "annotations.json",
      )
    );
  }
  async load(): Promise<AnnotationState> {
    await this.tail;
    let raw: string;
    try {
      raw = await this.io().readUTF8(this.path());
    } catch (error) {
      if (
        ["NotFoundError", "NS_ERROR_FILE_NOT_FOUND"].includes(
          (error as Error).name,
        )
      )
        return emptyAnnotationState();
      throw error;
    }
    try {
      const s = JSON.parse(raw);
      requireValue(
        s?.version === 2 &&
          s.records &&
          typeof s.records === "object" &&
          !Array.isArray(s.records) &&
          s.pending &&
          typeof s.pending === "object" &&
          !Array.isArray(s.pending) &&
          Array.isArray(s.history),
        "invalid annotation state",
      );
      s.watched ??= {};
      requireValue(
        typeof s.watched === "object" &&
          !Array.isArray(s.watched) &&
          Object.values(s.watched).every(
            (n) => typeof n === "number" && Number.isFinite(n),
          ),
        "invalid watched papers",
      );
      for (const r of Object.values(s.records) as AnnotationRecord[])
        requireValue(
          r &&
            ["creating", "not_created", "anchoring", "verified"].includes(
              r.phase,
            ) &&
            typeof r.blockId === "string",
          "invalid annotation record",
        );
      for (const p of Object.values(s.pending) as PendingPaper[])
        requireValue(
          p &&
            typeof p.itemKey === "string" &&
            Number.isInteger(p.attempts) &&
            p.attempts > 0 &&
            Number.isFinite(p.lastAttempt) &&
            typeof p.reason === "string",
          "invalid pending annotation paper",
        );
      for (const h of s.history as AnnotationHistory[])
        requireValue(
          h &&
            typeof h.time === "string" &&
            typeof h.itemKey === "string" &&
            typeof h.title === "string" &&
            typeof h.outcome === "string" &&
            Array.isArray(h.details) &&
            Array.isArray(h.errors),
          "invalid annotation history",
        );
      return clone(s);
    } catch {
      // Never reset corrupt state and create duplicate remote comments.
      throw new Error(
        "批注同步记录损坏，已停止写入。请保留 annotations.json 并检查备份。",
      );
    }
  }
  async save(s: AnnotationState): Promise<void> {
    const snapshot = clone(s);
    const turn = this.tail.then(async () => {
      const path = this.path(),
        io = this.io();
      await io.makeDirectory(this.paths().parent(path), {
        ignoreExisting: true,
      });
      await io.writeUTF8(path, JSON.stringify(snapshot, null, 2), {
        tmpPath: path + ".tmp",
        mode: "overwrite",
      });
      if (io.setPermissions) await io.setPermissions(path, 0o600);
    });
    this.tail = turn.catch(() => undefined);
    return turn;
  }
}
