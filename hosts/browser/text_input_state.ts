import type { TextInputState } from '../common/input/text';

const NO_CRLF: readonly number[] = [];

/** A textarea normalizes newlines; its bounded editing context must not rewrite source bytes. */
export class BrowserTextInputState {
	public readonly text: string;
	public readonly selectionStart: number;
	public readonly selectionEnd: number;
	private readonly crlf: readonly number[];
	private readonly offset: number;

	public constructor(state: TextInputState) {
		this.offset = state.offset;
		const source = state.text;
		let cursor = source.indexOf('\r');
		if (cursor < 0) {
			this.text = source;
			this.crlf = NO_CRLF;
		} else {
			const parts: string[] = [];
			const crlf: number[] = [];
			let start = 0;
			do {
				parts.push(source.slice(start, cursor), '\n');
				if (source.charCodeAt(cursor + 1) === 10) {
					crlf.push(cursor - crlf.length);
					start = cursor + 2;
				} else {
					start = cursor + 1;
				}
				cursor = source.indexOf('\r', start);
			} while (cursor >= 0);
			parts.push(source.slice(start));
			this.text = parts.join('');
			this.crlf = crlf;
		}
		this.selectionStart = this.nativePosition(state.selectionStart);
		this.selectionEnd = this.nativePosition(state.selectionEnd);
	}

	public ownerPosition(position: number): number {
		let low = 0;
		let high = this.crlf.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (this.crlf[middle] < position) low = middle + 1;
			else high = middle;
		}
		return this.offset + position + low;
	}

	/** Map a native caret through the edit, retaining untouched canonical line endings. */
	public ownerPositionAfterEdit(position: number, from: number, to: number, insertedLength: number): number {
		const ownerFrom = this.ownerPosition(from);
		if (position <= from) return this.ownerPosition(position);
		if (position < from + insertedLength) return ownerFrom + position - from;
		return this.ownerPosition(position - insertedLength + to - from)
			+ insertedLength - (this.ownerPosition(to) - ownerFrom);
	}

	private nativePosition(position: number): number {
		let low = 0;
		let high = this.crlf.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (this.crlf[middle] + middle < position) low = middle + 1;
			else high = middle;
		}
		return position - low;
	}
}
