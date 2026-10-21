import type { IDisposable } from '../common/lifecycle';
import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import type { GxGteCommandObserver } from '../../machine/ts/machine/devices/gx/gte';
import { MAPPED_BUS_MASTER_DMA, type MappedBusSignals } from '../../machine/ts/machine/memory/bus_signals';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';
import { RuntimeRestoreOrigin } from '../../machine/ts/machine/runtime/save_state';
import type { Blua32SourceImage, RuntimeSourceState } from './sources';

const REGISTER_COUNT = 32;
const COMMAND_WORD_COUNT = REGISTER_COUNT * 4;

/** Metadata is borrowed until the corresponding ring slot is reused. */
export class GteCommandRecord {
	public sequence = -1;
	public timeline = 0;
	public cycles = 0;
	public completedTick = 0;
	public commandWord = 0;
	public nominalCycles = 0;
	public busSignals: MappedBusSignals = 0;
	public checkpoint = 0;
	public domain: ExecutionDomainId | undefined;
	public pc: number | undefined;
	public image: Blua32SourceImage | null = null;
}

/** An owned observation, not current device state or a borrow into the ring. */
export class GteCommandSnapshot extends GteCommandRecord {
	public readonly beforeData = new Uint32Array(REGISTER_COUNT);
	public readonly beforeControl = new Uint32Array(REGISTER_COUNT);
	public readonly afterData = new Uint32Array(REGISTER_COUNT);
	public readonly afterControl = new Uint32Array(REGISTER_COUNT);
}

/** Optional host evidence of actual normal COMMAND writes. No guest instrumentation. */
export class RuntimeGteHistory implements GxGteCommandObserver {
	private storage: { records: GteCommandRecord[]; words: Uint32Array } | undefined;
	private observers = 0;
	private timeline = 0;
	public revision = 0;
	public generation = 0;
	public firstSequence = 0;
	public endSequence = 0;
	public expired = 0;

	public constructor(private readonly runtime: Runtime, private readonly sources: RuntimeSourceState,
		public readonly capacity = 2048) {}

	public get observing(): boolean { return this.observers !== 0; }
	public get count(): number { return this.endSequence - this.firstSequence; }

	/** Retained inputs keep observation alive across source navigation, not pane attachment. */
	public observe(): IDisposable {
		if (this.storage === undefined) {
			this.storage = { records: Array.from({ length: this.capacity }, () => new GteCommandRecord()),
				words: new Uint32Array(this.capacity * COMMAND_WORD_COUNT) };
		}
		if (this.observers++ === 0) {
			this.clear();
			this.runtime.machine.gxGte.setCommandObserver(this);
		}
		this.revision++;
		return { dispose: () => {
			if (--this.observers === 0) this.runtime.machine.gxGte.setCommandObserver(null);
			this.revision++;
		} };
	}

	/** Internal consumers use a sequence from the advertised retained window. */
	public at(sequence: number): Readonly<GteCommandRecord> { return this.storage!.records[sequence % this.capacity]; }

	/** Copy into the view's retained selection; following does not allocate per command/frame. */
	public copy(sequence: number, target: GteCommandSnapshot): void {
		const record = this.at(sequence);
		target.sequence = record.sequence; target.timeline = record.timeline;
		target.cycles = record.cycles; target.completedTick = record.completedTick;
		target.commandWord = record.commandWord; target.nominalCycles = record.nominalCycles;
		target.busSignals = record.busSignals; target.checkpoint = record.checkpoint;
		target.domain = record.domain; target.pc = record.pc; target.image = record.image;
		const words = this.storage!.words, start = sequence % this.capacity * COMMAND_WORD_COUNT;
		for (let index = 0; index < REGISTER_COUNT; index++) {
			target.beforeData[index] = words[start + index];
			target.beforeControl[index] = words[start + REGISTER_COUNT + index];
			target.afterData[index] = words[start + REGISTER_COUNT * 2 + index];
			target.afterControl[index] = words[start + REGISTER_COUNT * 3 + index];
		}
	}

	/** Explicit pin/export may own another snapshot; ordinary following reuses copy(). */
	public snapshot(sequence: number): GteCommandSnapshot {
		const result = new GteCommandSnapshot();
		this.copy(sequence, result);
		return result;
	}

	/** Evidence may remain readable after ring expiry; physical navigation has its own lifetime. */
	public canSeek(record: Readonly<GteCommandRecord>): boolean {
		return this.runtime.history.canSeekFrom(record.checkpoint, record.cycles);
	}

	public clear(): void {
		if (this.storage !== undefined) for (const record of this.storage.records) record.image = null;
		this.firstSequence = this.endSequence;
		this.expired = 0;
		this.generation++;
		this.revision++;
	}

	public beginTimeline(): void { this.timeline++; this.revision++; }

	/** Program replacement invalidates raw source identities, not a view's detached selection. */
	public didInstall(): void { this.clear(); this.beginTimeline(); }

	public didRestore(origin: RuntimeRestoreOrigin): void {
		if (origin !== RuntimeRestoreOrigin.HistorySeek) this.didInstall();
		else this.revision++;
	}

	public dispose(): void {
		if (this.observing) this.runtime.machine.gxGte.setCommandObserver(null);
		this.storage = undefined;
	}

	public before(commandWord: number, busSignals: MappedBusSignals, data: ArrayLike<number>, control: ArrayLike<number>): void {
		const mode = this.runtime.history.mode;
		if (mode === HistoryMode.Replaying || mode === HistoryMode.Reviewing) return;
		const storage = this.storage!, sequence = this.endSequence, slot = sequence % this.capacity;
		const record = storage.records[slot], cpu = this.runtime.machine.cpu;
		record.sequence = sequence; record.timeline = this.timeline;
		record.cycles = this.runtime.machine.scheduler.currentNowCycles();
		record.completedTick = this.runtime.frameScheduler.lastTickSequence;
		record.commandWord = commandWord; record.busSignals = busSignals;
		record.checkpoint = this.runtime.history.recordingCheckpoint;
		if ((busSignals & MAPPED_BUS_MASTER_DMA) === 0 && this.runtime.machine.scheduler.isCpuSliceActive()) {
			record.domain = cpu.readLastExecutionDomain(); record.pc = cpu.readCurrentInstructionPc();
			const image = record.domain === -1 ? this.sources.currentBlua32Media.system
				: this.sources.currentBlua32Media.cartridgeSlots[record.domain];
			// Domain ownership also covers dynamically loaded RAM code, not just installed text.
			record.image = image !== null && record.pc >= image.layout.header.textAddress
				&& record.pc < image.layout.header.textAddress + image.layout.header.textByteCount ? image : null;
		} else { record.domain = undefined; record.pc = undefined; record.image = null; }
		const start = slot * COMMAND_WORD_COUNT;
		storage.words.set(data, start); storage.words.set(control, start + REGISTER_COUNT);
	}

	public after(_commandWord: number, _busSignals: MappedBusSignals, nominalCycles: number,
		data: ArrayLike<number>, control: ArrayLike<number>): void {
		const mode = this.runtime.history.mode;
		if (mode === HistoryMode.Replaying || mode === HistoryMode.Reviewing) return;
		const storage = this.storage!, sequence = this.endSequence++, slot = sequence % this.capacity;
		storage.records[slot].nominalCycles = nominalCycles;
		const start = slot * COMMAND_WORD_COUNT;
		storage.words.set(data, start + REGISTER_COUNT * 2); storage.words.set(control, start + REGISTER_COUNT * 3);
		if (this.count > this.capacity) { this.firstSequence++; this.expired++; }
		this.revision++;
	}
}
