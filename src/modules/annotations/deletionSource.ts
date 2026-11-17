import { requireValue } from "./mapping";

export interface AnnotationDeletionSource {
  isDeleted(key: string, fresh?: boolean): Promise<boolean>;
  invalidate(): void;
}

/** Absence from this computer is never evidence of a deletion. */
export class ZoteroAnnotationDeletions implements AnnotationDeletionSource {
  private cached?: { user: number; time: number; keys: Set<string> };
  constructor(
    private readonly dependencies = {
      user: () => Zotero.Users.getCurrentUserID(),
      apiKey: () => Zotero.Sync.Data.Local.getAPIKey(),
      client: (apiKey: string) => Zotero.Sync.Runner.getAPIClient({ apiKey }),
      now: () => Date.now(),
    },
  ) {}

  invalidate(): void {
    this.cached = undefined;
  }

  async isDeleted(key: string, fresh = false): Promise<boolean> {
    const user = this.dependencies.user();
    requireValue(user && /^[A-Z0-9]{8}$/.test(key), "无法确认 Zotero 删除来源");
    const apiKey = await this.dependencies.apiKey();
    requireValue(apiKey, "请先连接 Zotero 账号并完成数据同步，再同步批注删除");
    const client = this.dependencies.client(apiKey);
    if (
      fresh ||
      !this.cached ||
      this.cached.user !== user ||
      this.dependencies.now() - this.cached.time > 30000
    ) {
      const result = await client.getDeleted("user", user, 0);
      requireValue(
        result && Array.isArray(result.deleted?.items),
        "Zotero 删除日志不可用，保留飞书评论并等待重试",
      );
      this.cached = {
        user,
        time: this.dependencies.now(),
        keys: new Set(result.deleted.items),
      };
    }
    if (!this.cached!.keys.has(key)) return false;
    // Undo/restore can reuse a key. A currently existing cloud item wins over
    // an older deletion-log entry, even if this computer hasn't received it.
    const current = await client.getVersions("user", user, "item", {
      itemKey: key,
    });
    requireValue(current && current.versions, "无法复核 Zotero 批注删除状态");
    return !Object.prototype.hasOwnProperty.call(current.versions, key);
  }
}
