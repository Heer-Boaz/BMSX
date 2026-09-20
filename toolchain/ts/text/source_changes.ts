/** One UTF-16 replacement, in the coordinates immediately before it is applied. */
export type SourceTextChange = {
	readonly offset: number;
	readonly deletedLength: number;
	readonly insertedLength: number;
};

export type SourceChangedSpan = {
	readonly oldStart: number;
	readonly oldEnd: number;
	readonly newStart: number;
	readonly newEnd: number;
};

export type SourceUnchangedGap = {
	readonly oldStart: number;
	readonly newStart: number;
	readonly length: number;
};

/**
 * Length-only composition from an analyzed source to its latest generation.
 * Stores surviving original runs as packed old-start/new-start/length triples.
 * Changed spans are their complement, so inserted text and edit history are not
 * retained. Replacements with identical text still invalidate their old span.
 */
export class SourceChangeMap {
	private constructor(
		public readonly oldLength: number,
		public readonly newLength: number,
		private readonly runs: readonly number[],
	) {}

	public static unchanged(length: number): SourceChangeMap {
		return new SourceChangeMap(length, length, length === 0 ? [] : [0, 0, length]);
	}

	/** Changes are applied in array order, not all against the input generation. */
	public append(changes: readonly SourceTextChange[]): SourceChangeMap {
		let runs = this.runs;
		let newLength = this.newLength;
		for (const change of changes) {
			const { offset, deletedLength, insertedLength } = change;
			if (deletedLength === 0 && insertedLength === 0) continue;
			const end = offset + deletedLength;
			const delta = insertedLength - deletedLength;
			const next: number[] = [];
			for (let index = 0; index < runs.length; index += 3) {
				const oldStart = runs[index];
				const newStart = runs[index + 1];
				const length = runs[index + 2];
				const before = Math.min(length, offset - newStart);
				if (before > 0) appendRun(next, oldStart, newStart, before);
				const afterStart = Math.max(newStart, end);
				const after = newStart + length - afterStart;
				if (after > 0) appendRun(next, oldStart + afterStart - newStart, afterStart + delta, after);
			}
			runs = next;
			newLength += delta;
		}
		return runs === this.runs ? this : new SourceChangeMap(this.oldLength, newLength, runs);
	}

	public *changes(): IterableIterator<SourceChangedSpan> {
		let oldStart = 0;
		let newStart = 0;
		for (let index = 0; index < this.runs.length; index += 3) {
			const oldEnd = this.runs[index];
			const newEnd = this.runs[index + 1];
			if (oldStart !== oldEnd || newStart !== newEnd) yield { oldStart, oldEnd, newStart, newEnd };
			oldStart = oldEnd + this.runs[index + 2];
			newStart = newEnd + this.runs[index + 2];
		}
		if (oldStart !== this.oldLength || newStart !== this.newLength) {
			yield { oldStart, oldEnd: this.oldLength, newStart, newEnd: this.newLength };
		}
	}

	public *gaps(): IterableIterator<SourceUnchangedGap> {
		for (let index = 0; index < this.runs.length; index += 3) {
			yield { oldStart: this.runs[index], newStart: this.runs[index + 1], length: this.runs[index + 2] };
		}
	}
}

function appendRun(runs: number[], oldStart: number, newStart: number, length: number): void {
	const last = runs.length - 3;
	if (last >= 0 && runs[last] + runs[last + 2] === oldStart && runs[last + 1] + runs[last + 2] === newStart) {
		runs[last + 2] += length;
	} else {
		runs.push(oldStart, newStart, length);
	}
}
