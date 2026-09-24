export type TerminalEntryKind = 'input' | 'output' | 'result' | 'error' | 'notice';
export type TerminalEntry = { readonly id: number; readonly kind: TerminalEntryKind; readonly text: string };

/** Bounded session scrollback, independent of the view and the guest heap. */
export class TerminalTranscript {
	private readonly entries: TerminalEntry[] = [];
	private first = 0;
	public next = 0;
	public revision = 0;
	public constructor(public readonly capacity = 2048) {}
	public get start(): number { return this.first; }
	public entry(id: number): TerminalEntry { return this.entries[id % this.capacity]; }
	public append(kind: TerminalEntryKind, text: string): void {
		const id = this.next++;
		this.entries[id % this.capacity] = { id, kind, text };
		if (this.next - this.first > this.capacity) this.first++;
		this.revision++;
	}
	public clear(): void {
		this.entries.length = 0;
		this.first = this.next;
		this.revision++;
	}
}
