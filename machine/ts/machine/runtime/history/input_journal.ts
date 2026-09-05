import {
	INPUT_CONTROLLER_SNAPSHOT_WORD_COUNT,
	loadInputControllerSnapshotWords,
	storeInputControllerSnapshotWords,
	type InputControllerSnapshot,
	type InputControllerSampleContext,
} from '../../devices/input/contracts';

const RECORD_WORD_COUNT = 1 + INPUT_CONTROLLER_SNAPSHOT_WORD_COUNT;
const SUPERVISOR_LINE_HIGH = 4;

/** One record per ICU VBlank poll, including polls without an armed sample. */
export class InputJournal {
	public firstSequence = 0;
	public endSequence = 0;
	public replaySequence = 0;
	private cycles = new Float64Array(0);
	private words = new Uint32Array(0);
	private sampleFlags = 0;

	public get capacity(): number { return this.cycles.length; }
	public get storageBytes(): number { return this.cycles.byteLength + this.words.byteLength; }

	public reset(capacity: number): void {
		this.cycles = new Float64Array(capacity);
		this.words = new Uint32Array(capacity * RECORD_WORD_COUNT);
		this.firstSequence = 0;
		this.endSequence = 0;
		this.replaySequence = 0;
		this.sampleFlags = 0;
	}

	public recordSample(snapshot: InputControllerSnapshot, context: InputControllerSampleContext): void {
		this.sampleFlags = 1 | (context << 1);
		storeInputControllerSnapshotWords(snapshot, this.words, (this.endSequence % this.capacity) * RECORD_WORD_COUNT + 1);
	}

	public recordLine(cycles: number, high: boolean): void {
		const index = this.endSequence % this.capacity;
		this.cycles[index] = cycles;
		this.words[index * RECORD_WORD_COUNT] = this.sampleFlags | (high ? SUPERVISOR_LINE_HIGH : 0);
		this.sampleFlags = 0;
		this.endSequence += 1;
		if (this.endSequence - this.firstSequence > this.capacity) this.firstSequence += 1;
	}

	public replaySample(snapshot: InputControllerSnapshot): void {
		loadInputControllerSnapshotWords(snapshot, this.words, (this.replaySequence % this.capacity) * RECORD_WORD_COUNT + 1);
	}

	public replayLine(): boolean {
		const high = (this.words[(this.replaySequence % this.capacity) * RECORD_WORD_COUNT] & SUPERVISOR_LINE_HIGH) !== 0;
		this.replaySequence += 1;
		return high;
	}

	public cycleAt(sequence: number): number { return this.cycles[sequence % this.capacity]; }
	public flagsAt(sequence: number): number { return this.words[(sequence % this.capacity) * RECORD_WORD_COUNT]; }

	/** End-exclusive sequence of the last recorded boundary not after cycles. */
	public endAt(cycles: number): number {
		let first = this.firstSequence;
		let end = this.endSequence;
		while (first < end) {
			const middle = first + Math.trunc((end - first) / 2);
			if (this.cycleAt(middle) <= cycles) first = middle + 1;
			else end = middle;
		}
		return first;
	}

	public branch(): void { this.endSequence = this.replaySequence; }
}
