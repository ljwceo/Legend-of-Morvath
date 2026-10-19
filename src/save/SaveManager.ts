import {
  migrate,
  saveDataSchema,
  SAVE_VERSION,
  type Migration,
  type SaveData,
  migrations,
} from './SaveData';

/** The part of `Storage` the save needs, so tests can pass an in-memory version. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const SAVE_KEY = 'legend-of-morvath.save';
const BACKUP_SUFFIX = '.backup';
const EXPORT_PREFIX = 'LOM1:';

/** The key under which the save as it was before a migration from `version` is kept. */
export function migrationBackupKey(key: string, version: number): string {
  return `${key}${BACKUP_SUFFIX}.v${version}`;
}

export type LoadResult =
  | { status: 'none' }
  /** `migratedFrom`: the stored version when it was older and migrations ran (a backup was kept). */
  | { status: 'ok'; save: SaveData; migratedFrom?: number }
  /** The stored save could not be read; a copy was kept under the backup key. */
  | { status: 'corrupt' }
  /** Made by a newer game version; left untouched so it is not lost. */
  | { status: 'newer'; version: number };

/** localStorage, or null when the browser blocks it (e.g. some private modes). */
export function browserStorage(): StorageLike | null {
  try {
    const storage = window.localStorage;
    const probe = `${SAVE_KEY}.probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/**
 * The one save slot. Loads (with migrations), writes, deletes and exports/imports the save.
 * Never throws on storage problems: methods report failure instead.
 */
export class SaveManager {
  constructor(
    private readonly storage: StorageLike | null,
    private readonly key: string = SAVE_KEY,
    private readonly migrationTable: Readonly<Record<number, Migration>> = migrations,
  ) {}

  /** False when nothing can be stored (the game still runs, without saving). */
  get available(): boolean {
    return this.storage !== null;
  }

  load(): LoadResult {
    let text: string | null;
    try {
      text = this.storage?.getItem(this.key) ?? null;
    } catch {
      return { status: 'none' };
    }
    if (text === null) return { status: 'none' };

    const result = this.parse(text);
    if (result.status === 'corrupt') this.keepBackup(text);
    // An older save is about to be overwritten in its new form on the next write: keep the
    // original once (G.4). A backup that is already there is never replaced, so a reload
    // before the first write, or a later migration, cannot lose the oldest copy.
    if (result.status === 'ok' && result.migratedFrom !== undefined) {
      this.keepMigrationBackup(text, result.migratedFrom);
    }
    return result;
  }

  /** Stores the save and stamps `updatedAt`. Returns false when storage failed (e.g. full). */
  write(save: SaveData, now: Date = new Date()): boolean {
    if (!this.storage) return false;
    save.updatedAt = now.toISOString();
    try {
      this.storage.setItem(this.key, JSON.stringify(save));
      return true;
    } catch {
      return false;
    }
  }

  /** Removes the save (Settings → delete, after confirming twice). The backups go too. */
  delete(): void {
    try {
      this.storage?.removeItem(this.key);
      this.storage?.removeItem(this.key + BACKUP_SUFFIX);
      for (let version = 1; version < SAVE_VERSION; version++) {
        this.storage?.removeItem(migrationBackupKey(this.key, version));
      }
    } catch {
      // Nothing else we can do; the next load will report what is there.
    }
  }

  /** A copyable text code of the save (debug only). Unicode-safe base64. */
  exportCode(save: SaveData): string {
    const bytes = new TextEncoder().encode(JSON.stringify(save));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return EXPORT_PREFIX + btoa(binary);
  }

  /** Reads an exported code; returns the (migrated) save or null when the code is invalid. */
  importCode(code: string): SaveData | null {
    const trimmed = code.trim();
    if (!trimmed.startsWith(EXPORT_PREFIX)) return null;
    try {
      const binary = atob(trimmed.slice(EXPORT_PREFIX.length));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const result = this.parse(new TextDecoder().decode(bytes));
      return result.status === 'ok' ? result.save : null;
    } catch {
      return null;
    }
  }

  private parse(text: string): LoadResult {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { status: 'corrupt' };
    }
    let migrated: ReturnType<typeof migrate>;
    try {
      migrated = migrate(raw, this.migrationTable);
    } catch {
      return { status: 'corrupt' };
    }
    if (!migrated.ok) {
      if (migrated.reason === 'newer') return { status: 'newer', version: migrated.version ?? 0 };
      return { status: 'corrupt' };
    }
    const checked = saveDataSchema.safeParse(migrated.save);
    if (!checked.success) return { status: 'corrupt' };
    const from = (raw as { version?: unknown }).version;
    return typeof from === 'number' && from < SAVE_VERSION
      ? { status: 'ok', save: checked.data, migratedFrom: from }
      : { status: 'ok', save: checked.data };
  }

  private keepMigrationBackup(text: string, from: number): void {
    const key = migrationBackupKey(this.key, from);
    try {
      if (this.storage?.getItem(key) === null) this.storage.setItem(key, text);
    } catch {
      // Storage full: the migrated save is still written over the original on the next save.
    }
  }

  private keepBackup(text: string): void {
    try {
      this.storage?.setItem(this.key + BACKUP_SUFFIX, text);
    } catch {
      // Storage full: the original stays in place until it is overwritten.
    }
  }
}
