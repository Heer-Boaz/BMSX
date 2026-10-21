import type { IDisposable } from '../common/lifecycle';
import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import { GX_GTE_PLUS_COMMAND, GX_GTE_PLUS_CYCLES, GX_GTE_PLUS_CYCLES_BUSY, GX_GTE_PLUS_REGISTER_COUNT as PLUS_REGISTER_COUNT,
	type GxGteCommandObserver, type GxGtePlusObserver } from '../../machine/ts/machine/devices/gx/gte';
import { MAPPED_BUS_MASTER_DMA, type MappedBusSignals } from '../../machine/ts/machine/memory/bus_signals';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';
import { RuntimeRestoreOrigin } from '../../machine/ts/machine/runtime/save_state';
import type { Blua32SourceImage, RuntimeSourceState } from './sources';

const REGISTER_COUNT = 32;
const COMMAND_WORD_COUNT = REGISTER_COUNT * 4;
export type GteObservationKind = 'normal' | 'plus-accepted' | 'plus-published';

/** Metadata is borrowed until the corresponding ring slot is reused. */
export class GteCommandRecord {
	public kind: GteObservationKind = 'normal';
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
	public acceptedSequence: number | undefined;
	public acceptedCycles: number | undefined;
	public deadlineCycles: number | undefined;
}

/** An owned observation, not current device state or a borrow into the ring. */
export class GteCommandSnapshot extends GteCommandRecord {
	public readonly beforeData = new Uint32Array(REGISTER_COUNT);
	public readonly beforeControl = new Uint32Array(REGISTER_COUNT);
	public readonly afterData = new Uint32Array(REGISTER_COUNT);
	public readonly afterControl = new Uint32Array(REGISTER_COUNT);
	public readonly beforePlus = new Uint32Array(PLUS_REGISTER_COUNT);
	public readonly afterPlus = new Uint32Array(PLUS_REGISTER_COUNT);
}

/** Optional host evidence of actual command acceptance/publication. No guest instrumentation. */
export class RuntimeGteHistory implements GxGteCommandObserver, GxGtePlusObserver {
	private storage: { records: GteCommandRecord[]; words: Uint32Array; pendingPlus: GteCommandSnapshot } | undefined;
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
				words: new Uint32Array(this.capacity * COMMAND_WORD_COUNT), pendingPlus: new GteCommandSnapshot() };
		}
		if (this.observers++ === 0) {
			this.clear();
			this.runtime.machine.gxGte.setCommandObserver(this);
			this.runtime.machine.gxGte.setPlusObserver(this);
		}
		this.revision++;
		const storage = this.storage;
		return { dispose: () => {
			if (--this.observers === 0) {
				this.runtime.machine.gxGte.setCommandObserver(null);
				this.runtime.machine.gxGte.setPlusObserver(null);
				storage.pendingPlus.sequence = -1; storage.pendingPlus.image = null;
			}
			this.revision++;
		} };
	}

	/** Internal consumers use a sequence from the advertised retained window. */
	public at(sequence: number): Readonly<GteCommandRecord> { return this.storage!.records[sequence % this.capacity]; }

	/** Copy into the view's retained selection; following does not allocate per command/frame. */
	public copy(sequence: number, target: GteCommandSnapshot): void {
		const record = this.at(sequence);
		target.kind = record.kind;
		target.sequence = record.sequence; target.timeline = record.timeline;
		target.cycles = record.cycles; target.completedTick = record.completedTick;
		target.commandWord = record.commandWord; target.nominalCycles = record.nominalCycles;
		target.busSignals = record.busSignals; target.checkpoint = record.checkpoint;
		target.domain = record.domain; target.pc = record.pc; target.image = record.image;
		target.acceptedSequence = record.acceptedSequence; target.acceptedCycles = record.acceptedCycles;
		target.deadlineCycles = record.deadlineCycles;
		const words = this.storage!.words, start = sequence % this.capacity * COMMAND_WORD_COUNT;
		if (record.kind === 'normal') {
			for (let index = 0; index < REGISTER_COUNT; index++) {
				target.beforeData[index] = words[start + index];
				target.beforeControl[index] = words[start + REGISTER_COUNT + index];
				target.afterData[index] = words[start + REGISTER_COUNT * 2 + index];
				target.afterControl[index] = words[start + REGISTER_COUNT * 3 + index];
			}
		} else {
			for (let index = 0; index < PLUS_REGISTER_COUNT; index++) {
				target.beforePlus[index] = words[start + index];
				target.afterPlus[index] = words[start + PLUS_REGISTER_COUNT + index];
			}
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
		if (this.storage !== undefined) {
			for (const record of this.storage.records) record.image = null;
			this.storage.pendingPlus.sequence = -1; this.storage.pendingPlus.image = null;
		}
		this.firstSequence = this.endSequence;
		this.expired = 0;
		this.generation++;
		this.revision++;
	}

	public beginTimeline(): void {
		if (this.storage !== undefined) { this.storage.pendingPlus.sequence = -1; this.storage.pendingPlus.image = null; }
		this.timeline++; this.revision++;
	}

	/** Program replacement invalidates raw source identities, not a view's detached selection. */
	public didInstall(): void { this.clear(); this.beginTimeline(); }

	public didRestore(origin: RuntimeRestoreOrigin): void {
		if (origin !== RuntimeRestoreOrigin.HistorySeek) this.didInstall();
		else {
			if (this.storage !== undefined) { this.storage.pendingPlus.sequence = -1; this.storage.pendingPlus.image = null; }
			this.revision++;
		}
	}

	public dispose(): void {
		if (this.observing) {
			this.runtime.machine.gxGte.setCommandObserver(null);
			this.runtime.machine.gxGte.setPlusObserver(null);
		}
		this.storage = undefined;
	}

	public before(commandWord: number, busSignals: MappedBusSignals, data: ArrayLike<number>, control: ArrayLike<number>): void {
		const mode = this.runtime.history.mode;
		if (mode === HistoryMode.Replaying || mode === HistoryMode.Reviewing) return;
		this.reserve('normal', commandWord, this.runtime.machine.scheduler.currentNowCycles(), busSignals);
		const storage = this.storage!, start = this.endSequence % this.capacity * COMMAND_WORD_COUNT;
		storage.words.set(data, start); storage.words.set(control, start + REGISTER_COUNT);
	}

	private reserve(kind: GteObservationKind, commandWord: number, cycles: number, busSignals: MappedBusSignals): GteCommandRecord {
		const record = this.storage!.records[this.endSequence % this.capacity], cpu = this.runtime.machine.cpu;
		record.kind = kind; record.sequence = this.endSequence; record.timeline = this.timeline;
		record.cycles = cycles; record.completedTick = this.runtime.frameScheduler.lastTickSequence;
		record.commandWord = commandWord; record.busSignals = busSignals;
		record.checkpoint = this.runtime.history.recordingCheckpoint;
		record.domain = undefined; record.pc = undefined; record.image = null;
		record.acceptedSequence = undefined; record.acceptedCycles = undefined; record.deadlineCycles = undefined;
		if (kind !== 'plus-published' && (busSignals & MAPPED_BUS_MASTER_DMA) === 0 && this.runtime.machine.scheduler.isCpuSliceActive()) {
			record.domain = cpu.readLastExecutionDomain(); record.pc = cpu.readCurrentInstructionPc();
			const image = record.domain === -1 ? this.sources.currentBlua32Media.system
				: this.sources.currentBlua32Media.cartridgeSlots[record.domain];
			// Domain ownership also covers dynamically loaded RAM code, not just installed text.
			record.image = image !== null && record.pc >= image.layout.header.textAddress
				&& record.pc < image.layout.header.textAddress + image.layout.header.textByteCount ? image : null;
		}
		return record;
	}

	public after(_commandWord: number, _busSignals: MappedBusSignals, nominalCycles: number,
		data: ArrayLike<number>, control: ArrayLike<number>): void {
		const mode = this.runtime.history.mode;
		if (mode === HistoryMode.Replaying || mode === HistoryMode.Reviewing) return;
		const storage = this.storage!, sequence = this.endSequence, slot = sequence % this.capacity;
		storage.records[slot].nominalCycles = nominalCycles;
		const start = slot * COMMAND_WORD_COUNT;
		storage.words.set(data, start + REGISTER_COUNT * 2); storage.words.set(control, start + REGISTER_COUNT * 3);
		this.commit();
	}

	/** Acceptance captures operands once; later writable-input changes do not change this evidence. */
	public accepted(commandWord: number, busSignals: MappedBusSignals, acceptedCycle: number, completionCycle: number,
		words: ArrayLike<number>): void {
		const mode = this.runtime.history.mode;
		if (mode === HistoryMode.Replaying || mode === HistoryMode.Reviewing) return;
		const record = this.reserve('plus-accepted', commandWord, acceptedCycle, busSignals);
		record.deadlineCycles = completionCycle;
		record.nominalCycles = words[GX_GTE_PLUS_CYCLES] & ~GX_GTE_PLUS_CYCLES_BUSY;
		this.storage!.words.set(words, this.endSequence % this.capacity * COMMAND_WORD_COUNT);
		this.copy(this.endSequence, this.storage!.pendingPlus);
		this.commit();
	}

	/** Publication is an observed latch transition, not a timer synthesized by the debugger. */
	public published(completionCycle: number, publicationCycle: number, words: ArrayLike<number>): void {
		const mode = this.runtime.history.mode;
		if (mode === HistoryMode.Replaying || mode === HistoryMode.Reviewing) return;
		const storage = this.storage!, pending = storage.pendingPlus;
		const record = this.reserve('plus-published', words[GX_GTE_PLUS_COMMAND], publicationCycle, 0);
		record.deadlineCycles = completionCycle;
		record.nominalCycles = words[GX_GTE_PLUS_CYCLES] & ~GX_GTE_PLUS_CYCLES_BUSY;
		const start = this.endSequence % this.capacity * COMMAND_WORD_COUNT;
		if (pending.sequence >= 0) {
			record.acceptedSequence = pending.sequence; record.acceptedCycles = pending.cycles;
			record.domain = pending.domain; record.pc = pending.pc; record.image = pending.image;
			record.busSignals = pending.busSignals;
			storage.words.set(pending.beforePlus, start);
		}
		storage.words.set(words, start + PLUS_REGISTER_COUNT);
		pending.sequence = -1; pending.image = null;
		this.commit();
	}

	private commit(): void {
		this.endSequence++;
		if (this.count > this.capacity) { this.firstSequence++; this.expired++; }
		this.revision++;
	}
}
