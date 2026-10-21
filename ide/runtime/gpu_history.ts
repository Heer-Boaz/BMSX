import type { IDisposable } from '../common/lifecycle';
import { GX_GPU_COMMAND_MAX_UPLOAD_WORD_COUNT, GX_GPU_COMMAND_WORD_CAPACITY, type GxGpuCommandBufferView } from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import type { GxGpuOperationObserver } from '../../machine/ts/machine/devices/gx/gpu';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';
import { RuntimeRestoreOrigin } from '../../machine/ts/machine/runtime/save_state';

/** Borrowed metadata expires when its event slot is reused. No issuing CPU/GTE identity is inferred. */
export class GpuOperationRecord {
	public sequence = -1;
	public timeline = 0;
	public cycles = 0;
	public startCycles = 0;
	public completedTick = 0;
	public checkpoint = 0;
	public kind = 0;
	public opcode = 0;
	public wordCount = 0;
	public wordOffset = 0;
	public drawModeWord = 0;
	public vramYAddressExtensionWord = 0;
	public textureWindowWord = 0;
	public drawingAreaTopLeftWord = 0;
	public drawingAreaBottomRightWord = 0;
	public drawingOffsetWord = 0;
	public maskBitModeWord = 0;
	public skippedLineParity = 0;
}

/** A view reuses maximum-sized storage; an explicit export can allocate its exact word count. */
export class GpuOperationSnapshot extends GpuOperationRecord {
	public readonly words: Uint32Array;
	public constructor(wordCapacity = GX_GPU_COMMAND_MAX_UPLOAD_WORD_COUNT) { super(); this.words = new Uint32Array(wordCapacity); }
}

/** Optional host evidence of emitted raster/transfer operations, not GP0 traffic or completion. */
export class RuntimeGpuHistory implements GxGpuOperationObserver {
	private storage: { records: GpuOperationRecord[]; words: Uint32Array } | undefined;
	private observers = 0;
	private timeline = 0;
	private wordCursor = 0;
	private firstWord = 0;
	public revision = 0;
	public generation = 0;
	public firstSequence = 0;
	public endSequence = 0;
	public expired = 0;
	public constructor(private readonly runtime: Runtime, public readonly capacity = 2048,
		public readonly wordCapacity = GX_GPU_COMMAND_WORD_CAPACITY) {}
	public get observing(): boolean { return this.observers !== 0; }
	public get count(): number { return this.endSequence - this.firstSequence; }
	public get wordCount(): number { return this.wordCursor - this.firstWord; }
	public observe(): IDisposable {
		if (this.storage === undefined) this.storage = { records: Array.from({ length: this.capacity }, () => new GpuOperationRecord()), words: new Uint32Array(this.wordCapacity) };
		if (this.observers++ === 0) { this.clear(); this.runtime.machine.gxGpu.setOperationObserver(this); }
		this.revision++;
		return { dispose: () => {
			if (--this.observers === 0) this.runtime.machine.gxGpu.setOperationObserver(null);
			this.revision++;
		} };
	}
	public at(sequence: number): Readonly<GpuOperationRecord> { return this.storage!.records[sequence % this.capacity]; }
	/** Consumers use an admitted retained sequence and a word range within that operation. */
	public copyWords(sequence: number, offset: number, target: Uint32Array | number[], count = target.length): void {
		const record = this.at(sequence), words = this.storage!.words;
		const start = (record.wordOffset + offset) % this.wordCapacity, tail = Math.min(count, this.wordCapacity - start);
		for (let index = 0; index < tail; index++) target[index] = words[start + index];
		for (let index = tail; index < count; index++) target[index] = words[index - tail];
	}
	public copy(sequence: number, target: GpuOperationSnapshot): void {
		const record = this.at(sequence);
		target.sequence = record.sequence; target.timeline = record.timeline;
		target.cycles = record.cycles; target.startCycles = record.startCycles;
		target.completedTick = record.completedTick; target.checkpoint = record.checkpoint;
		target.kind = record.kind; target.opcode = record.opcode;
		target.wordCount = record.wordCount; target.wordOffset = record.wordOffset;
		target.drawModeWord = record.drawModeWord; target.vramYAddressExtensionWord = record.vramYAddressExtensionWord;
		target.textureWindowWord = record.textureWindowWord;
		target.drawingAreaTopLeftWord = record.drawingAreaTopLeftWord; target.drawingAreaBottomRightWord = record.drawingAreaBottomRightWord;
		target.drawingOffsetWord = record.drawingOffsetWord; target.maskBitModeWord = record.maskBitModeWord;
		target.skippedLineParity = record.skippedLineParity;
		this.copyWords(sequence, 0, target.words, record.wordCount);
	}
	public snapshot(sequence: number): GpuOperationSnapshot {
		const result = new GpuOperationSnapshot(this.at(sequence).wordCount); this.copy(sequence, result); return result;
	}
	public canSeek(record: Readonly<GpuOperationRecord>): boolean { return this.runtime.history.canSeekFrom(record.checkpoint, record.cycles); }
	public clear(): void {
		this.firstSequence = this.endSequence; this.firstWord = this.wordCursor;
		this.expired = 0; this.generation++; this.revision++;
	}
	public beginTimeline(): void { this.timeline++; this.revision++; }
	public didInstall(): void { this.clear(); this.beginTimeline(); }
	public didRestore(origin: RuntimeRestoreOrigin): void {
		if (origin !== RuntimeRestoreOrigin.HistorySeek) this.didInstall();
		else this.revision++;
	}
	public dispose(): void { if (this.observing) this.runtime.machine.gxGpu.setOperationObserver(null); this.storage = undefined; }
	public emitted(buffer: GxGpuCommandBufferView, index: number, startCycle: number): void {
		const mode = this.runtime.history.mode;
		if (mode === HistoryMode.Replaying || mode === HistoryMode.Reviewing) return;
		const storage = this.storage!, count = buffer.commandWordCount[index];
		while (this.count === this.capacity || this.wordCount + count > this.wordCapacity) {
			const first = this.at(this.firstSequence++);
			this.firstWord = first.wordOffset + first.wordCount; this.expired++;
		}
		const record = storage.records[this.endSequence % this.capacity];
		record.sequence = this.endSequence; record.timeline = this.timeline;
		record.cycles = this.runtime.machine.scheduler.currentNowCycles(); record.startCycles = startCycle;
		record.completedTick = this.runtime.frameScheduler.lastTickSequence; record.checkpoint = this.runtime.history.recordingCheckpoint;
		record.kind = buffer.commandKind[index]; record.opcode = buffer.commandOpcode[index]; record.wordCount = count; record.wordOffset = this.wordCursor;
		record.drawModeWord = buffer.commandDrawModeWord[index]; record.vramYAddressExtensionWord = buffer.commandVramYAddressExtensionWord[index];
		record.textureWindowWord = buffer.commandTextureWindowWord[index];
		record.drawingAreaTopLeftWord = buffer.commandDrawingAreaTopLeftWord[index]; record.drawingAreaBottomRightWord = buffer.commandDrawingAreaBottomRightWord[index];
		record.drawingOffsetWord = buffer.commandDrawingOffsetWord[index]; record.maskBitModeWord = buffer.commandMaskBitModeWord[index];
		record.skippedLineParity = buffer.commandSkippedLineParity[index];
		const source = buffer.commandWordStart[index], start = this.wordCursor % this.wordCapacity, tail = Math.min(count, this.wordCapacity - start);
		for (let offset = 0; offset < tail; offset++) storage.words[start + offset] = buffer.words[source + offset];
		for (let offset = tail; offset < count; offset++) storage.words[offset - tail] = buffer.words[source + offset];
		this.wordCursor += count; this.endSequence++; this.revision++;
	}
}
