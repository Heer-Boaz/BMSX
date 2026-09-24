import { writeWrappedSourceLine, type TextRangeMeasure } from '../../../common/text';
import type { TerminalEntryKind, TerminalTranscript } from '../../services/terminal/transcript';

export type TerminalRow = { readonly entry: number; readonly kind: TerminalEntryKind; readonly text: string };

/** Retain measured rows; a new line does not remeasure completed scrollback. */
export class TerminalProjection {
	public readonly rows: TerminalRow[] = [];
	private next = 0;
	private width = -1;
	private font: object | undefined;
	private readonly wrapped: string[] = [];
	public update(transcript: TerminalTranscript, width: number, font: object, measure: TextRangeMeasure): void {
		if (width !== this.width || font !== this.font) {
			this.width = width; this.font = font; this.rows.length = 0; this.next = transcript.start;
		}
		let removed = 0;
		while (removed < this.rows.length && this.rows[removed].entry < transcript.start) removed++;
		if (removed > 0) this.rows.splice(0, removed);
		this.next = Math.max(this.next, transcript.start);
		for (; this.next < transcript.next; this.next++) {
			const entry = transcript.entry(this.next);
			let first = true;
			for (const line of entry.text.split('\n')) {
				this.wrapped.length = 0;
				writeWrappedSourceLine(this.wrapped, entry.kind === 'input' ? `${first ? '>' : '.'} ${line}` : line, width, measure);
				for (const text of this.wrapped) this.rows.push({ entry: entry.id, kind: entry.kind, text });
				first = false;
			}
		}
	}
}
