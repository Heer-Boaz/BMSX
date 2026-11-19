import { MAIN_RAM_SIZE } from '../../spec/bmsx/memory_map';
import type { CPU } from './cpu';
import type { Memory } from '../memory/memory';
import { HEAP_GC_CONTROL_OFFSET, heapAllocationBytes, type HeapAllocator } from './heap_allocator';
import { GcObject, GcKind } from './gc_object';
import { type Closure, type Upvalue, UPVALUE_HEAP_BYTES, UPVALUE_ADDRESS_MASK, UPVALUE_CHAIN_LIMIT, FunctionPrototypePool, CLOSURE_PROTOTYPE_ADDRESS, type FunctionPrototype } from './closure';
import { Table, TableRecords } from './table';
import { Thread, THREAD_HEAP_BYTES } from './thread';
import { ThreadField } from './thread_record';
import { ValueTag, valueTag, valuePayload, scalarValueHash, valueInteger, valueNil, type Value } from './value';
import { ValueSlots } from './value_slots';
import type { LuaHeap } from './lua_heap';
import { ceilDiv4 } from '../common/numeric';
import type { GcDiagnostics } from './gc_diagnostics';

const GC_RECORD_ALIGNMENT = 8;
const GC_RECORD_MASK = MAIN_RAM_SIZE - GC_RECORD_ALIGNMENT;
export const GC_STEP_WORDS = 4096;
export const GC_ASSIST_BYTES = 256;
export const enum GcPhase { Pause, Mark, MarkAgain, Atomic, Sweep, Strings }
// Two unconnected selector inputs do not clock the collector.
const GC_PHASE_SELECTOR = [GcPhase.Pause, GcPhase.Mark, GcPhase.MarkAgain, GcPhase.Atomic,
	GcPhase.Sweep, GcPhase.Strings, GcPhase.Pause, GcPhase.Pause];
export type GcState = {
	allocations: number[]; gray: number[]; grayAgain: number[]; threads: number[]; weak: number[];
};
export class GcHeap {
	public diagnostics: GcDiagnostics | null = null;
	public gray: GcObject | null = null;
	public grayAgain: GcObject | null = null;
	private objects: GcObject | null = null;
	private readonly controlOffset: number;
	public phase(): GcPhase {
		return GC_PHASE_SELECTOR[this.memory.readRamRecordByte(this.controlOffset) & 7];
	}
	public white(): number { return this.memory.readRamRecordByte(this.controlOffset + 1) & 1; }
	private setPhase(phase: GcPhase): void { this.memory.writeRamRecordByte(this.controlOffset, phase); }
	private readonly threads: Thread[] = [];
	private readonly weak: Table[] = [];
	private readonly prototypes = new FunctionPrototypePool();
	private readonly scratch = new ValueSlots(1);
	private mode = 0;
	private changed = false;
	private readonly traceEntry = (key: Value, value: Value): void => {
		this.markValue(key);
		if (this.mode === 0) this.markValue(value);
	};
	private readonly alive = (value: Value): boolean => {
		const tag = valueTag(value);
		switch (tag) {
			case ValueTag.Table: return this.isAlive(this.tableAt(valuePayload(value)));
			case ValueTag.Closure: return this.isAlive(this.closureAt(valuePayload(value)));
			case ValueTag.Thread: return this.isAlive(this.threadAt(valuePayload(value)));
			default: return true;
		}
	};
	private readonly ephemeronEntry = (key: Value, value: Value): void => {
		if (this.alive(key) && this.markValue(value)) this.changed = true;
	};
	private readonly weakStrings = (key: Value, value: Value): void => {
		if (valueTag(key) === ValueTag.String) this.cpu.stringPool.markReachable(valuePayload(key));
		if (valueTag(value) === ValueTag.String) this.cpu.stringPool.markReachable(valuePayload(value));
	};
	public constructor(private readonly cpu: CPU, public readonly budget: LuaHeap, public readonly memory: Memory, public readonly arena: HeapAllocator, private readonly modeKey: number) {
		this.controlOffset = arena.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	}
	public readonly tables = new TableRecords(this);
	// Host attachments share one position for each aligned physical record start.
	private readonly records = new Array<GcObject | null>(MAIN_RAM_SIZE / GC_RECORD_ALIGNMENT).fill(null);
	public tableAt(address: number): Table | null {
		const object = this.records[(address & (MAIN_RAM_SIZE - TableRecords.HEADER_BYTES)) >>> 3];
		return object?.gcKind === GcKind.Table ? object as Table : null;
	}
	public cellAt(address: number): Upvalue | null {
		const object = this.records[(address & UPVALUE_ADDRESS_MASK) >>> 3];
		return object?.gcKind === GcKind.Upvalue ? object as Upvalue : null;
	}
	public closureAt(address: number): Closure | null {
		const object = this.records[(address & GC_RECORD_MASK) >>> 3];
		return object?.gcKind === GcKind.Closure ? object as Closure : null;
	}
	public openCellAt(address: number): Upvalue | null {
		const cell = this.cellAt(address);
		return cell?.open ? cell : null;
	}
	public threadAt(address: number): Thread | null {
		const object = this.records[(address & GC_RECORD_MASK) >>> 3];
		return object?.gcKind === GcKind.Thread ? object as Thread : null;
	}
	public forgetPhysicalRecords(): void { this.records.fill(null); }
	public reference(object: GcObject): number { return object.address; }
	public hash(value: Value): number {
		switch (valueTag(value)) {
			case ValueTag.Table: case ValueTag.Closure: case ValueTag.Thread: return scalarValueHash(valueInteger(valuePayload(value)));
			default: return scalarValueHash(value);
		}
	}
	public track(object: GcObject): void {
		if (object.gcKind === GcKind.Closure) {
			const closure = object as Closure;
			closure.prototypeRecord = this.prototypes.retain(closure.prototypeRecord);
		}
		this.records[(object.address & GC_RECORD_MASK) >>> 3] = object;
		object.restored = false;
		object.gcOwner = this; object.gcGrayNext = null;
		object.gcPrevious = null; object.gcNext = this.objects;
		if (this.objects !== null) this.objects.gcPrevious = object;
		this.objects = object;
	}
	public rebindClosurePrototype(closure: Closure, record: Readonly<FunctionPrototype>): void {
		const previous = closure.prototypeRecord;
		closure.prototypeRecord = this.prototypes.retain(record);
		this.memory.writeRamRecordWord(closure.address + CLOSURE_PROTOTYPE_ADDRESS, record.functionAddress);
		this.prototypes.release(previous);
	}
	private releaseHostMetadata(object: GcObject): void {
		if (object.gcKind === GcKind.Closure) this.prototypes.release((object as Closure).prototypeRecord);
	}
	private unlink(object: GcObject): void {
		if (object.gcPrevious !== null) object.gcPrevious.gcNext = object.gcNext;
		else this.objects = object.gcNext;
		if (object.gcNext !== null) object.gcNext.gcPrevious = object.gcPrevious;
		object.gcNext = null; object.gcPrevious = null; object.gcGrayNext = null;
	}
	public active(): boolean { return this.phase() !== GcPhase.Pause; }
	public isAlive(object: GcObject | null): boolean { return object !== null && object.gcColor !== this.white(); }
	public sweepGarbage(object: GcObject): boolean {
		return this.phase() === GcPhase.Sweep && object.gcColor === (this.white() ^ 1);
	}
	public markObject(object: GcObject | null): boolean {
		if (object === null || object.gcColor !== this.white()) return false;
		object.gcColor = 2; object.gcGrayNext = this.gray; this.gray = object;
		return true;
	}
	public markValue(value: Value): boolean {
		switch (valueTag(value)) {
			case ValueTag.Table: return this.markObject(this.tableAt(valuePayload(value)));
			case ValueTag.Closure: return this.markObject(this.closureAt(valuePayload(value)));
			case ValueTag.Thread: return this.markObject(this.threadAt(valuePayload(value)));
			case ValueTag.String: this.cpu.stringPool.markReachable(valuePayload(value)); break;
		}
		return false;
	}
	public markSlot(slots: ValueSlots, index: number): void { this.markValue(slots.get(index)); }
	public visitThreads(visit: (thread: Thread) => void): void {
		for (let object = this.objects; object !== null; object = object.gcNext)
			if (object.gcKind === GcKind.Thread) visit(object as Thread);
	}
	public armThreadStackWatches(): void {
		this.visitThreads(thread => { thread.armStackWatch(); thread.armFrameWindowWatches(); });
	}
	public observeStackWrites(first: number, end: number): void {
		for (let address = first & -THREAD_HEAP_BYTES; address < end; address += THREAD_HEAP_BYTES) {
			const descriptor = address + ThreadField.StackBlock, depth = address + ThreadField.FrameDepth;
			const cursorWrite = first <= depth && depth < end;
			if (!cursorWrite && (end <= descriptor || first >= descriptor + 16)) continue;
			const thread = this.threadAt(address);
			if (thread !== null) {
				if (cursorWrite) {
					this.cpu.bindPhysicalFrames(thread);
					thread.armStackWatch();
				} else thread.observeStackWrite();
			}
		}
		this.visitThreads(thread => thread.observeFrameWindowWrites(first, end));
	}
	public allocationBytes(object: GcObject): number {
		switch (object.gcKind) {
			case GcKind.Table: return this.tables.getTrackedHeapBytes((object as Table).address);
			case GcKind.Closure: return (object as Closure).heapBytes;
			case GcKind.Upvalue: return UPVALUE_HEAP_BYTES;
			case GcKind.Thread: return THREAD_HEAP_BYTES + heapAllocationBytes((object as Thread).backingByteLength());

		}
	}
	private tableMode(table: Table): number {
		const meta = this.tables.metatableAddress(table.address);
		if (meta === 0) return 0;
		this.tables.loadStringKey(meta, this.modeKey, this.scratch, 0);
		let mode = 0;
		if (this.scratch.getTag(0) === ValueTag.String) {
			const id = this.scratch.getStringId(0), pool = this.cpu.stringPool;
			const length = pool.byteLength(id);
			for (let i = 0; i < length; ++i) {
				const byte = pool.byteAt(id, i);
				if (byte === 107) mode |= 1;
				if (byte === 118) mode |= 2;
			}
		}
		this.scratch.setNil(0);
		return mode;
	}
	private trace(atomic: boolean): number {
		const object = this.gray!;
		this.gray = object.gcGrayNext; object.gcGrayNext = null; object.gcColor = 3;
		switch (object.gcKind) {
			case GcKind.Table: {
				const table = object as Table;
				this.markObject(table.metatable);
				this.mode = this.tableMode(table);
				if (this.mode !== 0 && !table.gcWeakListed) { table.gcWeakListed = true; this.weak.push(table); }
				if ((this.mode & 1) === 0) this.tables.forEachStoredEntry(table.address, this.traceEntry);
				return (TableRecords.HEADER_BYTES >>> 2) + this.tables.scanSlots(table.address);
			}
			case GcKind.Closure: {
				const closure = object as Closure;
				for (let index = 0; index < closure.upvalueCount; ++index) {
					this.markObject(this.cellAt(closure.captureAddress(index)));
				}
				return 3 + closure.upvalueCount;
			}
			case GcKind.Upvalue: {
				const upvalue = object as Upvalue;
				if (upvalue.open) this.markObject(this.threadAt(upvalue.ownerAddress));
				this.markValue(upvalue.value);
				break;
			}
			case GcKind.Thread: {
				const thread = object as Thread;
				if (!atomic) this.threads.push(thread);
				this.markObject(thread.resumer); this.markObject(thread.entry); this.markValue(thread.error);
				let liveTop = thread.currentFrame === null ? 0 : thread.currentFrame.stackBase + Math.min(thread.currentFrame.top, thread.currentFrame.stackCapacity);
				let frame = thread.firstFrame!;
				for (let depth = 0; depth < thread.frameDepth; ++depth, frame = frame.next!) {
					this.cpu.markHeapImage(frame.executionImage);
					this.markObject(this.closureAt(frame.closureAddress));
					let address = frame.openUpvalueHead;
					for (let remaining = UPVALUE_CHAIN_LIMIT; address !== 0 && remaining !== 0; --remaining) {
						const upvalue = this.openCellAt(address);
						if (upvalue === null) break;
						this.markObject(upvalue);
						const slot = upvalue.stackSlot;
						if (slot < thread.stackRegisters.capacity()) liveTop = Math.max(liveTop, slot + 1);
						address = upvalue.nextAddress;
					}
				}
				for (let i = 0; i < liveTop; ++i) this.markSlot(thread.stackRegisters, i);
				if (liveTop < thread.stackRegisters.capacity())
					thread.stackRegisters.clear(thread.stackRegisters.capacity() - liveTop, liveTop);
				thread.trimFrames();
				break;
			}
		}
		return ceilDiv4(this.allocationBytes(object));
	}
	/** Called with the current trace queue empty; mutations stay separate until this pass. */
	private remark(t0: Value, t1: Value, t2: Value): number {
		this.diagnostics?.phase('rootsNanoseconds');
		for (const thread of this.threads) thread.writeBarrier();
		for (const table of this.weak) table.writeBarrier();
		this.threads.length = 0;
		this.gray = this.grayAgain; this.grayAgain = null;
		this.cpu.markHeapRoots(this); this.cpu.stringPool.markLocalRoots();
		this.markValue(t0); this.markValue(t1); this.markValue(t2);
		return this.cpu.collectionRootWordCount() + this.cpu.stringPool.takeMarkWork();
	}
	private atomic(t0: Value, t1: Value, t2: Value): number {
		this.diagnostics?.beginAtomic();
		let work = this.remark(t0, t1, t2);
		this.diagnostics?.phase('traceNanoseconds');
		while (this.gray !== null) work += this.trace(true) + this.cpu.stringPool.takeMarkWork();
		do {
			this.changed = false;
			for (let i = 0; i < this.weak.length; ++i) {
				const table = this.weak[i];
				if (this.tableMode(table) !== 1) continue;
				work += this.tables.scanSlots(table.address);
				this.tables.forEachStoredEntry(table.address, this.ephemeronEntry);
			}
			while (this.gray !== null) work += this.trace(true) + this.cpu.stringPool.takeMarkWork();
		} while (this.changed);
		this.diagnostics?.phase('weakNanoseconds');
		for (const table of this.weak) {
			const mode = this.tableMode(table);
			work += this.tables.scanSlots(table.address);
			this.tables.clearWeakEntries(table.address, (mode & 1) !== 0, (mode & 2) !== 0, this.alive);
			this.tables.forEachStoredEntry(table.address, this.weakStrings); table.gcWeakListed = false;
		}
		this.cpu.pruneStaticClosures(); this.threads.length = 0; this.weak.length = 0;
		this.memory.writeRamRecordByte(this.controlOffset + 1, this.white() ^ 1);
		this.arena.beginObjectSweep(); this.setPhase(GcPhase.Sweep);
		return work + this.cpu.stringPool.takeMarkWork();
	}
	private readonly sweepRecord = (growingStack: Thread | null, address: number): number => {
		const index = (address & GC_RECORD_MASK) >>> 3;
		const object = this.records[index];
		if (object === null) return 1;
		const thread = object.gcKind === GcKind.Thread ? object as Thread : null;
		const work = thread !== null ? ceilDiv4(this.allocationBytes(thread)) : 1;
		const white = this.white();
		if (object.gcColor !== (white ^ 1)) {
			object.gcColor = white;
			return work + (thread !== null && thread !== growingStack ? 2 * ceilDiv4(thread.shrinkStack()) : 0);
		}

		this.records[index] = null;
		if (object.gcKind === GcKind.Table) {
			this.tables.freeRecord(address);
		} else {
			if (thread !== null) thread.freeStack();
			this.arena.free(address);
		}
		this.unlink(object);
		this.releaseHostMetadata(object);
		return -work;
	};
	public step(t0: Value = valueNil(), t1: Value = valueNil(), t2: Value = valueNil(), growingStack: Thread | null = null): number {
		this.diagnostics?.beginStep();
		try { return this.stepWork(t0, t1, t2, growingStack); }
		finally { this.diagnostics?.endStep(); }
	}
	private stepWork(t0: Value, t1: Value, t2: Value, growingStack: Thread | null): number {
		let work = 0;
		if (this.phase() === GcPhase.Pause) {
			if (this.diagnostics !== null) ++this.diagnostics.collections;
			this.diagnostics?.phase('rootsNanoseconds');
			this.setPhase(GcPhase.Mark); this.cpu.stringPool.beginReachabilityEpoch();
			this.cpu.markHeapRoots(this); work += this.cpu.collectionRootWordCount();
		}
		if (this.phase() === GcPhase.Mark || this.phase() === GcPhase.MarkAgain) {
			this.diagnostics?.phase('rootsNanoseconds');
			this.markValue(t0); this.markValue(t1); this.markValue(t2);
			this.cpu.stringPool.markLocalRoots();
			work += this.cpu.stringPool.takeMarkWork();
		}
		while (work < GC_STEP_WORDS && this.active()) {
			switch (this.phase()) {
				case GcPhase.Mark:
				case GcPhase.MarkAgain:
					this.diagnostics?.phase(this.phase() === GcPhase.Mark ? 'traceNanoseconds' : 'markAgainNanoseconds');
					while (this.gray !== null && work < GC_STEP_WORDS) work += this.trace(false) + this.cpu.stringPool.takeMarkWork();
					if (work < GC_STEP_WORDS) {
						if (this.phase() === GcPhase.Mark) {
							work += this.remark(t0, t1, t2);
							this.setPhase(GcPhase.MarkAgain);
						} else {
							this.setPhase(GcPhase.Atomic);
							return work;
						}
					}
					break;
				case GcPhase.Atomic:
					return this.atomic(t0, t1, t2);
				case GcPhase.Sweep:
					this.diagnostics?.phase('sweepNanoseconds');
					work += this.arena.sweepObjects(GC_STEP_WORDS - work, growingStack, this.sweepRecord);
					if (work < GC_STEP_WORDS && !this.arena.objectSweepActive()) { this.grayAgain = null; this.setPhase(GcPhase.Strings); this.cpu.stringPool.beginSweep(); }
					break;
				case GcPhase.Strings:
					this.diagnostics?.phase('stringReclaimNanoseconds');
					work += this.cpu.stringPool.sweepStep(GC_STEP_WORDS - work);
					if (!this.cpu.stringPool.sweeping()) {
						this.setPhase(GcPhase.Pause); this.budget.finishCollection();
					}
					break;
			}
		}
		return work;
	}
	public collect(t0: Value = valueNil(), t1: Value = valueNil(), t2: Value = valueNil(), growingStack: Thread | null = null): number {
		if (this.diagnostics !== null) ++this.diagnostics.fullCollections;
		let work = 0;
		while (this.active()) work += this.step(t0, t1, t2, growingStack);
		do { work += this.step(t0, t1, t2, growingStack); } while (this.active());
		return work;
	}
	public captureState(ref: (object: GcObject) => number): GcState {
		const state: GcState = { allocations: [], gray: [], grayAgain: [], threads: [], weak: [] };
		for (let object = this.objects; object !== null; object = object.gcNext) state.allocations.push(ref(object));
		for (let object = this.gray; object !== null; object = object.gcGrayNext) state.gray.push(ref(object));
		for (let object = this.grayAgain; object !== null; object = object.gcGrayNext) state.grayAgain.push(ref(object));
		for (const object of this.threads) state.threads.push(ref(object));
		for (const object of this.weak) state.weak.push(ref(object));
		return state;
	}
	public bindRestoredRecords(state: GcState, objects: readonly GcObject[]): void {
		for (let object = this.objects; object !== null;) {
			const next = object.gcNext;
			if (object.restored) object.restored = false;
			else {
				this.unlink(object);
				this.releaseHostMetadata(object);
			}
			object = next;
		}
		for (const index of state.allocations) {
			const object = objects[index];
			this.records[(object.address & GC_RECORD_MASK) >>> 3] = object;
		}
	}
	public restoreState(state: GcState, objects: GcObject[]): void {
		this.objects = null;
		let previous: GcObject | null = null;
		for (let i = 0; i < state.allocations.length; ++i) {
			const object = objects[state.allocations[i]];
			object.gcPrevious = previous; object.gcNext = null;
			object.gcGrayNext = null; object.gcOwner = this;
			if (previous !== null) previous.gcNext = object; else this.objects = object;
			previous = object;
		}
		this.gray = null;
		for (let i = state.gray.length - 1; i >= 0; --i) {
			const object = objects[state.gray[i]]; object.gcGrayNext = this.gray; this.gray = object;
		}
		this.grayAgain = null;
		for (let i = state.grayAgain.length - 1; i >= 0; --i) {
			const object = objects[state.grayAgain[i]]; object.gcGrayNext = this.grayAgain; this.grayAgain = object;
		}
		this.threads.length = 0; this.weak.length = 0;
		for (const ref of state.threads) this.threads.push(objects[ref] as Thread);
		for (const ref of state.weak) { const table = objects[ref] as Table; table.gcWeakListed = true; this.weak.push(table); }
	}
}
