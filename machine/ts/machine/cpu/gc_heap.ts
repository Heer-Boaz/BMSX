import type { CPU } from './cpu';
import { GcObject, GcKind, GarbageAllocation } from './gc_object';
import { Closure, Upvalue, UPVALUE_HEAP_BYTES } from './closure';
import { Table } from './table';
import { Thread, THREAD_HEAP_BYTES, THREAD_STACK_SLOT_BYTES } from './thread';
import { ValueTag, type ValueReference } from './value';
import { ValueSlots } from './value_slots';
import { ceilDiv4 } from '../common/numeric';
import type { GcDiagnostics } from './gc_diagnostics';

export const GC_STEP_WORDS = 4096;
export const GC_ASSIST_BYTES = 256;
export const enum GcPhase { Pause, Mark, MarkAgain, Atomic, Sweep, Strings }
export type GcState = {
	phase: GcPhase; white: number; sweep: number;
	allocations: number[]; colors: number[]; gray: number[]; grayAgain: number[]; threads: number[]; weak: number[];
};
export class GcHeap {
	public diagnostics: GcDiagnostics | null = null;
	public gray: GcObject | null = null;
	public grayAgain: GcObject | null = null;
	private objects: GcObject | null = null;
	private sweep: GcObject | null = null;
	private white = 0;
	private phase = GcPhase.Pause;
	private readonly threads: Thread[] = [];
	private readonly weak: Table[] = [];
	// An occupied entry holds its object; a free entry holds the next free id.
	// The single directory belongs to the heap, never to an individual Value.
	private readonly references: (GcObject | number)[] = [0];
	private freeReference = 0;
	private readonly scratch = new ValueSlots(1);
	private mode = 0;
	private changed = false;
	private readonly traceEntry = (kt: ValueTag, ks: number, kr: ValueReference, vt: ValueTag, vs: number, vr: ValueReference): void => {
		this.markValue(kt, ks, kr);
		if (this.mode === 0) this.markValue(vt, vs, vr);
	};
	private readonly alive = (tag: ValueTag, _scalar: number, ref: ValueReference): boolean =>
		tag !== ValueTag.Table && tag !== ValueTag.Closure && tag !== ValueTag.Thread || this.isAlive(ref!);
	private readonly ephemeronEntry = (kt: ValueTag, ks: number, kr: ValueReference, vt: ValueTag, vs: number, vr: ValueReference): void => {
		if (this.alive(kt, ks, kr) && this.markValue(vt, vs, vr)) this.changed = true;
	};
	private readonly weakStrings = (kt: ValueTag, ks: number, _kr: ValueReference, vt: ValueTag, vs: number): void => {
		if (kt === ValueTag.String) this.cpu.stringPool.markReachable(ks);
		if (vt === ValueTag.String) this.cpu.stringPool.markReachable(vs);
	};
	public constructor(private readonly cpu: CPU, private readonly modeKey: number) {}
	public reference(object: GcObject): number { return object.referenceId; }
	/** Consumes a live id produced by this heap; the Value tag supplies its kind. */
	public object(reference: number): GcObject { return this.references[reference] as GcObject; }
	public track(object: GcObject): void {
		if (this.freeReference !== 0) {
			object.referenceId = this.freeReference;
			this.freeReference = this.references[this.freeReference] as number;
			this.references[object.referenceId] = object;
		} else {
			object.referenceId = this.references.length;
			this.references.push(object);
		}
		object.restored = false;
		object.gcColor = this.white; object.gcOwner = this; object.gcGrayNext = null;
		object.gcPrevious = null; object.gcNext = this.objects;
		if (this.objects !== null) this.objects.gcPrevious = object;
		this.objects = object;
	}
	private releaseReference(object: GcObject): void {
		const reference = object.referenceId;
		this.references[reference] = this.freeReference;
		this.freeReference = reference;
		object.referenceId = 0;
	}
	private unlink(object: GcObject): void {
		if (object.gcPrevious !== null) object.gcPrevious.gcNext = object.gcNext;
		else this.objects = object.gcNext;
		if (object.gcNext !== null) object.gcNext.gcPrevious = object.gcPrevious;
		object.gcNext = null; object.gcPrevious = null; object.gcGrayNext = null;
	}
	public active(): boolean { return this.phase !== GcPhase.Pause; }
	public isAlive(object: GcObject): boolean { return object.gcColor !== this.white; }
	public sweepGarbage(object: GcObject): boolean {
		return this.phase === GcPhase.Sweep && object.gcColor === (this.white ^ 1);
	}
	public markObject(object: GcObject | null): boolean {
		if (object === null || object.gcColor !== this.white) return false;
		object.gcColor = 2; object.gcGrayNext = this.gray; this.gray = object;
		return true;
	}
	public markValue(tag: ValueTag, scalar: number, ref: ValueReference): boolean {
		switch (tag) {
			case ValueTag.Table: case ValueTag.Closure: case ValueTag.Thread: return this.markObject(ref!);
			case ValueTag.String: this.cpu.stringPool.markReachable(scalar); break;
		}
		return false;
	}
	public markSlot(slots: ValueSlots, index: number): void {
		this.markValue(slots.getTag(index), slots.getScalar(index), slots.getReference(index));
	}
	public allocationBytes(object: GcObject): number {
		switch (object.gcKind) {
			case GcKind.Table: return (object as Table).getTrackedHeapBytes();
			case GcKind.Closure: return (object as Closure).heapBytes;
			case GcKind.Upvalue: return UPVALUE_HEAP_BYTES;
			case GcKind.Thread: return THREAD_HEAP_BYTES + (object as Thread).stackRegisters.capacity() * THREAD_STACK_SLOT_BYTES;
			case GcKind.Garbage: return (object as GarbageAllocation).bytes;
		}
	}
	private tableMode(table: Table): number {
		if (table.metatable === null) return 0;
		table.metatable.loadStringKey(this.modeKey, this.scratch, 0);
		let mode = 0;
		if (this.scratch.getTag(0) === ValueTag.String) {
			const text = this.cpu.stringPool.toString(this.scratch.getStringId(0));
			for (let i = 0; i < text.length; ++i) {
				if (text.charCodeAt(i) === 107) mode |= 1;
				if (text.charCodeAt(i) === 118) mode |= 2;
			}
		}
		this.scratch.setNil(0);
		return mode;
	}
	private trace(atomic: boolean): number {
		const object = this.gray!;
		this.gray = object.gcGrayNext; object.gcGrayNext = null; object.gcColor = 3;
		const work = ceilDiv4(this.allocationBytes(object));
		switch (object.gcKind) {
			case GcKind.Table: {
				const table = object as Table;
				this.markObject(table.metatable);
				this.mode = this.tableMode(table);
				if (this.mode !== 0 && !table.gcWeakListed) { table.gcWeakListed = true; this.weak.push(table); }
				if ((this.mode & 1) === 0) table.forEachStoredEntry(this.traceEntry);
				break;
			}
			case GcKind.Closure:
				for (const upvalue of (object as Closure).upvalues) this.markObject(upvalue);
				break;
			case GcKind.Upvalue: {
				const upvalue = object as Upvalue;
				if (upvalue.open) this.markObject(upvalue.frame!.thread);
				else this.markValue(upvalue.valueTag, upvalue.valueScalar, upvalue.valueReference);
				break;
			}
			case GcKind.Thread: {
				const thread = object as Thread;
				if (!atomic) this.threads.push(thread);
				this.markObject(thread.resumer); this.markObject(thread.entry); this.markSlot(thread.error, 0);
				let liveTop = thread.currentFrame === null ? 0 : thread.currentFrame.stackBase + Math.min(thread.currentFrame.top, thread.currentFrame.stackCapacity);
				let frame = thread.firstFrame!;
				for (let depth = 0; depth < thread.frameDepth; ++depth, frame = frame.next!) {
					this.cpu.markHeapImage(frame.executionImage);
					this.markObject(frame.closure);
					for (let upvalue = frame.openUpvalueHead; upvalue !== null; upvalue = upvalue.nextOpen) {
						this.markObject(upvalue); liveTop = Math.max(liveTop, frame.stackBase + upvalue.index + 1);
					}
				}
				for (let i = 0; i < liveTop; ++i) this.markSlot(thread.stackRegisters, i);
				thread.stackRegisters.clear(thread.stackRegisters.capacity() - liveTop, liveTop);
				thread.trimFrames();
				break;
			}
		}
		return work;
	}
	/** Called with the current trace queue empty; mutations stay separate until this pass. */
	private remark(t0: ValueTag, s0: number, r0: ValueReference, t1: ValueTag, s1: number, r1: ValueReference, t2: ValueTag, s2: number, r2: ValueReference): number {
		this.diagnostics?.phase('rootsNanoseconds');
		for (const thread of this.threads) thread.writeBarrier();
		for (const table of this.weak) table.writeBarrier();
		this.threads.length = 0;
		this.gray = this.grayAgain; this.grayAgain = null;
		this.cpu.markHeapRoots(this); this.cpu.stringPool.markLocalRoots();
		this.markValue(t0, s0, r0); this.markValue(t1, s1, r1); this.markValue(t2, s2, r2);
		return this.cpu.collectionRootWordCount();
	}
	private atomic(t0: ValueTag, s0: number, r0: ValueReference, t1: ValueTag, s1: number, r1: ValueReference, t2: ValueTag, s2: number, r2: ValueReference): number {
		this.diagnostics?.beginAtomic();
		let work = this.remark(t0, s0, r0, t1, s1, r1, t2, s2, r2);
		this.diagnostics?.phase('traceNanoseconds');
		while (this.gray !== null) work += this.trace(true);
		do {
			this.changed = false;
			for (let i = 0; i < this.weak.length; ++i) {
				const table = this.weak[i];
				if (this.tableMode(table) !== 1) continue;
				work += ceilDiv4(table.getTrackedHeapBytes());
				table.forEachStoredEntry(this.ephemeronEntry);
			}
			while (this.gray !== null) work += this.trace(true);
		} while (this.changed);
		this.diagnostics?.phase('weakNanoseconds');
		for (const table of this.weak) {
			const mode = this.tableMode(table);
			work += ceilDiv4(table.getTrackedHeapBytes());
			table.clearWeakEntries((mode & 1) !== 0, (mode & 2) !== 0, this.alive);
			table.forEachStoredEntry(this.weakStrings); table.gcWeakListed = false;
		}
		this.cpu.pruneStaticClosures(); this.threads.length = 0; this.weak.length = 0;
		this.white ^= 1; this.sweep = this.objects; this.phase = GcPhase.Sweep;
		return work;
	}
	public step(t0 = ValueTag.Nil, s0 = NaN, r0: ValueReference = null, t1 = ValueTag.Nil, s1 = NaN, r1: ValueReference = null, t2 = ValueTag.Nil, s2 = NaN, r2: ValueReference = null, growingStack: Thread | null = null): number {
		this.diagnostics?.beginStep();
		try { return this.stepWork(t0, s0, r0, t1, s1, r1, t2, s2, r2, growingStack); }
		finally { this.diagnostics?.endStep(); }
	}
	private stepWork(t0: ValueTag, s0: number, r0: ValueReference, t1: ValueTag, s1: number, r1: ValueReference, t2: ValueTag, s2: number, r2: ValueReference, growingStack: Thread | null): number {
		let work = 0;
		if (this.phase === GcPhase.Pause) {
			if (this.diagnostics !== null) ++this.diagnostics.collections;
			this.diagnostics?.phase('rootsNanoseconds');
			this.phase = GcPhase.Mark; this.cpu.stringPool.beginReachabilityEpoch();
			this.cpu.markHeapRoots(this); work += this.cpu.collectionRootWordCount();
		}
		if (this.phase === GcPhase.Mark || this.phase === GcPhase.MarkAgain) {
			this.diagnostics?.phase('rootsNanoseconds');
			this.markValue(t0, s0, r0); this.markValue(t1, s1, r1); this.markValue(t2, s2, r2);
			this.cpu.stringPool.markLocalRoots();
		}
		while (work < GC_STEP_WORDS && this.active()) {
			switch (this.phase) {
				case GcPhase.Mark:
				case GcPhase.MarkAgain:
					this.diagnostics?.phase(this.phase === GcPhase.Mark ? 'traceNanoseconds' : 'markAgainNanoseconds');
					while (this.gray !== null && work < GC_STEP_WORDS) work += this.trace(false);
					if (work < GC_STEP_WORDS) {
						if (this.phase === GcPhase.Mark) {
							work += this.remark(t0, s0, r0, t1, s1, r1, t2, s2, r2);
							this.phase = GcPhase.MarkAgain;
						} else {
							this.phase = GcPhase.Atomic;
							return work;
						}
					}
					break;
				case GcPhase.Atomic:
					return this.atomic(t0, s0, r0, t1, s1, r1, t2, s2, r2);
				case GcPhase.Sweep:
					this.diagnostics?.phase('sweepNanoseconds');
					while (this.sweep !== null && work < GC_STEP_WORDS) {
						const object = this.sweep; this.sweep = object.gcNext;
						const bytes = this.allocationBytes(object); work += ceilDiv4(bytes);
						if (this.sweepGarbage(object)) {
							this.unlink(object);
							this.releaseReference(object);
							this.cpu.luaHeap.release(bytes);
						} else {
							object.gcColor = this.white;
							if (object.gcKind === GcKind.Thread && object !== growingStack) {
								const thread = object as Thread;
								const released = thread.shrinkStack();
								this.cpu.luaHeap.release(released * THREAD_STACK_SLOT_BYTES);
								if (released !== 0) work += thread.stackRegisters.capacity() * 4;
							}
						}
					}
					if (this.sweep === null && work < GC_STEP_WORDS) { this.grayAgain = null; this.phase = GcPhase.Strings; this.cpu.stringPool.beginSweep(); }
					break;
				case GcPhase.Strings:
					this.diagnostics?.phase('stringReclaimNanoseconds');
					work += this.cpu.stringPool.sweepStep(GC_STEP_WORDS - work);
					if (!this.cpu.stringPool.sweeping()) {
						this.phase = GcPhase.Pause; this.cpu.luaHeap.finishCollection();
					}
					break;
			}
		}
		return work;
	}
	public collect(t0 = ValueTag.Nil, s0 = NaN, r0: ValueReference = null, t1 = ValueTag.Nil, s1 = NaN, r1: ValueReference = null, t2 = ValueTag.Nil, s2 = NaN, r2: ValueReference = null, growingStack: Thread | null = null): number {
		if (this.diagnostics !== null) ++this.diagnostics.fullCollections;
		let work = 0;
		while (this.active()) work += this.step(t0, s0, r0, t1, s1, r1, t2, s2, r2, growingStack);
		do { work += this.step(t0, s0, r0, t1, s1, r1, t2, s2, r2, growingStack); } while (this.active());
		return work;
	}
	public captureState(ref: (object: GcObject) => number): GcState {
		const state: GcState = { phase: this.phase, white: this.white, sweep: this.sweep === null ? -1 : ref(this.sweep), allocations: [], colors: [], gray: [], grayAgain: [], threads: [], weak: [] };
		for (let object = this.objects; object !== null; object = object.gcNext) { state.allocations.push(ref(object)); state.colors.push(object.gcColor); }
		for (let object = this.gray; object !== null; object = object.gcGrayNext) state.gray.push(ref(object));
		for (let object = this.grayAgain; object !== null; object = object.gcGrayNext) state.grayAgain.push(ref(object));
		for (const object of this.threads) state.threads.push(ref(object));
		for (const object of this.weak) state.weak.push(ref(object));
		return state;
	}
	public finishRestore(): void {
		for (let object = this.objects; object !== null;) {
			const next = object.gcNext;
			if (object.restored) object.restored = false;
			else {
				this.unlink(object);
				this.releaseReference(object);
			}
			object = next;
		}
	}
	public restoreState(state: GcState, objects: GcObject[]): void {
		this.phase = state.phase; this.white = state.white; this.objects = null;
		let previous: GcObject | null = null;
		for (let i = 0; i < state.allocations.length; ++i) {
			const object = objects[state.allocations[i]];
			object.gcColor = state.colors[i]; object.gcPrevious = previous; object.gcNext = null;
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
		this.sweep = state.sweep < 0 ? null : objects[state.sweep];
	}
}
