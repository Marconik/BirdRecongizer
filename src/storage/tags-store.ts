export type Tags = Record<string, string[]>;

export interface TagFileIO {
  read(): Promise<string | null>;
  write(text: string, expected: string | null): Promise<void>;
}

export class FileChangedError extends Error {}

export function splitLabels(text: string): string[] {
  return [...new Set(text.split(/[,，]/u).map(label => label.trim()).filter(Boolean))];
}

export function parseTags(text: string | null): Tags {
  const result: Tags = Object.create(null);
  if (text === null) return result;
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/u, '')); }
  catch { throw new Error('tags.json 不是有效的 JSON，原文件未被覆盖。请修正后重试。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('tags.json 顶层必须是文件名到标签数组的对象。');
  for (const [name, labels] of Object.entries(value)) {
    if (!Array.isArray(labels) || labels.some(label => typeof label !== 'string')) throw new Error(`tags.json 中「${name}」的值必须是字符串数组，原文件未被覆盖。`);
    result[name] = [...new Set(labels.map(label => label.trim()).filter(Boolean))];
  }
  return result;
}

export interface SaveState { pending: boolean; error: string | null }

/** One serialized writer per physical directory; updates merge only changed filenames. */
export class TagsStore {
  private tags: Tags = Object.create(null);
  private pending = new Map<string, { labels: string[]; version: number }>();
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private operation: Promise<void> | null = null;
  private stopped = false;
  private error: string | null = null;

  private io: TagFileIO;
  private onChange: (tags: Tags) => void;
  private onState: (state: SaveState) => void;
  private delay: number;

  constructor(io: TagFileIO, onChange: (tags: Tags) => void, onState: (state: SaveState) => void, delay = 250) {
    this.io = io;
    this.onChange = onChange;
    this.onState = onState;
    this.delay = delay;
  }

  get hasPending(): boolean { return this.pending.size > 0 || this.operation !== null; }
  get snapshot(): Tags {
    const value: Tags = Object.assign(Object.create(null), this.tags);
    for (const [name, edit] of this.pending) value[name] = [...edit.labels];
    return value;
  }

  private publish(): void {
    if (this.stopped) return;
    this.onChange(this.snapshot);
    this.onState({ pending: this.hasPending, error: this.error });
  }

  private fail(error: unknown): void {
    this.error = error instanceof Error ? error.message : '无法读写 tags.json，请检查文件夹权限。';
  }

  set(name: string, labels: string[]): void {
    if (this.stopped) throw new Error('文件夹已关闭');
    this.pending.set(name, { labels: [...labels], version: ++this.sequence });
    this.publish();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => undefined); }, this.delay);
  }

  async open(): Promise<void> { await this.refresh(true); }

  async refresh(create = false): Promise<void> {
    if (this.stopped || this.operation) return;
    const job = (async () => {
      try {
        const text = await this.io.read();
        this.tags = parseTags(text);
        if (text === null && create) await this.io.write('{}\n', null);
        this.error = null;
      } catch (error) { this.fail(error); throw error; }
    })();
    this.operation = job;
    try { await job; }
    finally { this.operation = null; this.publish(); }
    if (this.pending.size) await this.flush();
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.stopped) return;
    if (this.operation) {
      await this.operation;
      return this.flush();
    }
    if (!this.pending.size) return;
    const job = (async () => {
      try {
        while (this.pending.size) {
          let saved = false;
          for (let attempt = 0; attempt < 3 && !saved; attempt++) {
            const text = await this.io.read();
            const merged = parseTags(text);
            const edits = new Map(this.pending);
            for (const [name, edit] of edits) merged[name] = [...edit.labels];
            try { await this.io.write(`${JSON.stringify(merged, null, 2)}\n`, text); }
            catch (error) { if (error instanceof FileChangedError && attempt < 2) continue; throw error; }
            this.tags = merged;
            for (const [name, edit] of edits) if (this.pending.get(name)?.version === edit.version) this.pending.delete(name);
            saved = true;
          }
        }
        this.error = null;
      } catch (error) { this.fail(error); throw error; }
    })();
    this.operation = job;
    this.publish();
    try { await job; }
    finally { this.operation = null; this.publish(); }
  }

  dispose(): void { this.stopped = true; clearTimeout(this.timer); }
}
