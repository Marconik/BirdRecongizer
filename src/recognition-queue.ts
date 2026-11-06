/** Pause stops dispatch; in-flight work is allowed to finish and save. */
export class RecognitionQueue<T> {
  private items: T[];
  private active = 0;
  private paused = false;
  private stopped = false;
  private cursor = 0;
  private concurrency: number;
  private run: (item: T) => Promise<void>;
  private changed: (pending: number, active: number, paused: boolean) => void;
  constructor(items: T[], concurrency: number, run: (item: T) => Promise<void>, changed: (pending: number, active: number, paused: boolean) => void) {
    this.items = items; this.concurrency = concurrency; this.run = run; this.changed = changed;
  }
  start(): void { if (!this.stopped) { this.paused = false; this.pump(); } }
  pause(): void { this.paused = true; this.publish(); }
  stop(): void { this.stopped = true; this.paused = true; }
  private publish(): void { if (!this.stopped) this.changed(this.items.length - this.cursor, this.active, this.paused); }
  private pump(): void {
    if (this.stopped) return;
    while (!this.paused && this.active < this.concurrency && this.cursor < this.items.length) {
      const item = this.items[this.cursor++]; this.active++;
      Promise.resolve().then(() => this.run(item)).catch(() => { this.pause(); }).finally(() => { this.active--; this.pump(); });
    }
    this.publish();
  }
}
