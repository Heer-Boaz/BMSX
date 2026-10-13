export const BROWSER_INPUT_TRACE_CAPACITY = 2048;
export const BROWSER_INPUT_TRACE_TOUCH_IDS = 32;

/** Fixed storage: records and contact-id arrays are reused, not allocated per input event. */
export class BrowserInputTraceRecord {
	sequence = 0;
	time = 0;
	kind = '';
	phase = '';
	pointerId = -1;
	pointerType = '';
	primary = false;
	trusted = false;
	cancelable = false;
	prevented = false;
	x = 0;
	y = 0;
	width = 0;
	height = 0;
	geometryRevision = 0;
	nativeButtons = 0;
	pressure = 0;
	target = '';
	route = '';
	before = 0;
	after = 0;
	commonBefore = -1;
	commonAfter = -1;
	completed = true;
	touchCount = 0;
	changedTouchCount = 0;
	readonly touchIds = new Float64Array(BROWSER_INPUT_TRACE_TOUCH_IDS);
	readonly changedTouchIds = new Float64Array(BROWSER_INPUT_TRACE_TOUCH_IDS);
	message = '';
}

export class BrowserInputTraceBuffer {
	private readonly records: BrowserInputTraceRecord[];
	private nextIndex = 0;
	private recordCount = 0;
	private sequence = 0;
	private errors = 0;
	private generation = 0;
	private recordingFrozen = false;
	private retainedError = '';

	constructor(readonly capacity = BROWSER_INPUT_TRACE_CAPACITY) {
		this.records = Array.from({ length: capacity }, () => new BrowserInputTraceRecord());
	}

	get count(): number { return this.recordCount; }
	get total(): number { return this.sequence; }
	get errorCount(): number { return this.errors; }
	get revision(): number { return this.generation; }
	get frozen(): boolean { return this.recordingFrozen; }
	get overwritten(): number { return this.sequence - this.recordCount; }
	get lastError(): string { return this.retainedError; }

	reserve(kind: string, phase: string, time: number): BrowserInputTraceRecord {
		const record = this.records[this.nextIndex];
		this.nextIndex = (this.nextIndex + 1) % this.capacity;
		if (this.recordCount < this.capacity) this.recordCount += 1;
		record.sequence = ++this.sequence;
		record.time = time;
		record.kind = kind;
		record.phase = phase;
		record.pointerId = -1;
		record.pointerType = '';
		record.primary = false;
		record.trusted = false;
		record.cancelable = false;
		record.prevented = false;
		record.x = 0;
		record.y = 0;
		record.width = 0;
		record.height = 0;
		record.geometryRevision = 0;
		record.nativeButtons = 0;
		record.pressure = 0;
		record.target = '';
		record.route = '';
		record.before = 0;
		record.after = 0;
		record.commonBefore = -1;
		record.commonAfter = -1;
		record.completed = true;
		record.touchCount = 0;
		record.changedTouchCount = 0;
		record.message = '';
		this.generation += 1;
		return record;
	}

	recordError(kind: string, time: number, message: string): void {
		this.errors += 1;
		this.retainedError = message;
		this.generation += 1;
		if (!this.recordingFrozen) this.reserve(kind, 'error', time).message = message;
	}

	freeze(): void {
		this.recordingFrozen = true;
		this.generation += 1;
	}

	resume(): void {
		this.recordingFrozen = false;
		this.generation += 1;
	}

	/** Chronological index in the retained window. */
	get(index: number): BrowserInputTraceRecord {
		const first = (this.nextIndex - this.recordCount + this.capacity) % this.capacity;
		return this.records[(first + index) % this.capacity];
	}

	clear(): void {
		this.nextIndex = 0;
		this.recordCount = 0;
		this.sequence = 0;
		this.errors = 0;
		this.retainedError = '';
		this.generation += 1;
	}
}
