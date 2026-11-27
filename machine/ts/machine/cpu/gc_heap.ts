import { MAIN_RAM_SIZE, RAM_BASE } from '../../spec/bmsx/memory_map';
import type { CPU } from './cpu';
import type { Memory } from '../memory/memory';
import { HEAP_GC_CONTROL_OFFSET, type HeapAllocator } from './heap_allocator';
import { GC_GRAY_INDEX_BITS, GC_GRAY_INDEX_MASK, GC_COLOR_OFFSET, GC_COLOR_MASK, GC_OBJECT_LINK_BEFORE, GC_OBJECT_PREFIX, GC_RECORD_LINK, GC_RECORD_MASK, GC_RECORD_SHIFT } from './gc_object';
import * as Closure from './closure';
import { UPVALUE_HEAP_BYTES, UPVALUE_NEXT, UPVALUE_OWNER, UPVALUE_RECORD_KIND, UPVALUE_VALUE_WORD } from './upvalue';
import * as Upvalue from './upvalue';
import { TableRecords, type TableStringProbe } from './table';
import type { StringId } from './string_pool';
import { THREAD_HEAP_BYTES, THREAD_RECORD_KIND, THREAD_STACK_SLOT_BYTES, ThreadField, ThreadLayout, ThreadRecords } from './thread_record';
import { FRAME_CONTROL_BYTES, FRAME_WINDOW_MASK, FrameField, PROTECTED_CALL_BYTES, PROTECTED_CALL_HANDLER_IMMUTABLE, PROTECTED_CALL_KIND_MASK, ProtectedCallKind, ProtectedField } from './call_state';
import { ValueTag, valueTag, valueTagHasGcEdge, valuePayload, valueNil, valueFromTag, type Value } from './value';
import type { ValueSlots } from './value_slots';
import { GC_STEP_WORDS, LuaAllocationRecovery, type LuaHeap } from './lua_heap';
import { LUA_OUT_OF_MEMORY_SIGNAL } from './errors';
import { ceilDiv4, toSignedWord } from '../common/numeric';
import type { GcDiagnostics } from './gc_diagnostics';

export const GC_WORK_WORD_CYCLES = 3;
export const GC_TRACE_HEAD = 4;
export const GC_CHANGED_HEAD = 8;
// Head, tail and extent; the first two words start on a pair boundary.
export const GC_THREAD_VISITS = 12;
export const GC_WEAK_VISITS = 28;
export const GC_VISIT_TAIL = 4;
export const GC_VISIT_COUNT = 8;
// The major trace owns one suspended record ahead of the gray queue.
export const GC_TRACE_RECORD = 0x34;
export const GC_TRACE_CURSOR = GC_TRACE_RECORD + 4;
export const GC_THREAD_TRACE_OPEN = GC_TRACE_CURSOR + 4;
const GC_THREAD_TRACE_TOP = GC_THREAD_TRACE_OPEN + 4;
// Remark revisits the weak list without consuming its head.
export const GC_REMARK_VISIT_INDEX = GC_THREAD_TRACE_TOP + 4;
export const GC_REMARK_VISIT_STATE = GC_REMARK_VISIT_INDEX + 4;
export const GC_MODE_META = GC_REMARK_VISIT_STATE + 4;
export const GC_MODE_NODE = GC_MODE_META + 4;
const GC_MODE_REMAINING = GC_MODE_NODE + 4;
export const GC_ROOT_CURSOR = GC_MODE_REMAINING + 4;
const GC_EPOCH_WORK = GC_ROOT_CURSOR + 4;
export const GC_LAST_EPOCH_WORK = GC_EPOCH_WORK + 4;
const GC_PHYSICAL_OCCUPIED_AT_TICK = GC_LAST_EPOCH_WORK + 4;
const GC_PHYSICAL_ASSIST = GC_PHYSICAL_OCCUPIED_AT_TICK + 4;
const GC_OBJECT_HEAD = GC_PHYSICAL_ASSIST + 4;
const GC_OBJECT_COUNT = GC_OBJECT_HEAD + 4;
const GC_SWEEP_LINK = GC_OBJECT_COUNT + 4;
const GC_PACE_BASIS = GC_SWEEP_LINK + 4;
const GC_PACE_ESTIMATE = GC_PACE_BASIS + 4;
const GC_PACE_RUNWAY = GC_PACE_ESTIMATE + 4;
export const GC_PACE_PAID = GC_PACE_RUNWAY + 4;
const GC_PACE_PAY_AT = GC_PACE_PAID + 4;
const GC_FULL_EPOCHS = GC_PACE_PAY_AT + 4;
// Capture lanes use four bytes each and Table entries require a separate tag.
const TRACE_CURSOR_BITS = GC_GRAY_INDEX_BITS + 1;
const TRACE_CURSOR_MASK = (1 << TRACE_CURSOR_BITS) - 1;
const TABLE_MODE_PENDING = 4 << TRACE_CURSOR_BITS;
const enum ThreadTraceStage { Frames, Protected, Values, Clear }
const enum RemarkStage { None, Threads, Weak, Roots, Trace, ClearWeak }
const THREAD_TRACE_OPEN_HEAD = 1; // An open cell's address is aligned.
export const GC_VISIT_HEADER_BYTE = 3;
export const GC_VISIT_MEMBER = 0x40;
const VISIT_LINK_LOW_BITS = 32 - GC_GRAY_INDEX_BITS;
const VISIT_LINK_HIGH_MASK = GC_GRAY_INDEX_MASK >>> VISIT_LINK_LOW_BITS;
export const enum GcPhase { Pause, Mark, MarkAgain, Atomic, Sweep, Strings }
export const enum GcRootBank { None, SystemGlobals, Globals, SystemConstants, Cart0Constants, Cart1Constants, Completion, ConcatOperands, End }
// Two unconnected selector inputs do not clock the collector.
const GC_PHASE_SELECTOR = [GcPhase.Pause, GcPhase.Mark, GcPhase.MarkAgain, GcPhase.Atomic,
	GcPhase.Sweep, GcPhase.Strings, GcPhase.Pause, GcPhase.Pause];
export function decodeGcPhase(word: number): GcPhase {
	return GC_PHASE_SELECTOR[word & 7];
}
// Incremental marking and reclamation price physical growth before a
// reservation. Pause has no cycle and Atomic belongs to the stopped mutator.
export function gcPacedPhase(phase: GcPhase): boolean {
	return phase !== GcPhase.Pause && phase !== GcPhase.Atomic;
}
export class GcHeap {
	public diagnostics: GcDiagnostics | null = null;
	// An inspector may end the lifetimes it observed; allocation never
	// creates host identities. A replacement invalidates the whole view.
	public onRecordRetirement: ((address: number | null) => void) | null = null;
	private readonly controlOffset: number;
	public phase(): GcPhase {
		return decodeGcPhase(this.memory.readRamRecordByte(this.controlOffset));
	}
	public white(): number { return this.memory.readRamRecordByte(this.controlOffset + 1) & 1; }
	private setPhase(phase: GcPhase): void { this.memory.writeRamRecordByte(this.controlOffset, phase); }
	private readonly modeProbe: TableStringProbe & { work: number } = { node: -1, remaining: 0, slot: -1, value: valueNil(), work: 0 };
	private readonly traceBoth = (key: Value, value: Value): void => { this.markValue(key); this.markValue(value); };
	private readonly traceKey = (key: Value): void => { this.markValue(key); };
	private readonly traceValue = (_key: Value, value: Value): void => { this.markValue(value); };
	private readonly alive = (value: Value): boolean => {
		const tag = valueTag(value);
		switch (tag) {
			case ValueTag.Table: {
				const address = this.tableRecordAddress(valuePayload(value));
				return this.isAlive(address);
			}
			case ValueTag.Closure: {
				const address = this.closureRecordAddress(valuePayload(value));
				return this.isAlive(address);
			}
			case ValueTag.Thread: {
				const address = this.threadRecordAddress(valuePayload(value));
				return this.isAlive(address);
			}
			default: return true;
		}
	};
	public constructor(private readonly cpu: CPU, public readonly budget: LuaHeap, public readonly memory: Memory,
		public readonly arena: HeapAllocator, private readonly modeKey: StringId, newIndexKey: StringId) {
		const management = arena.managementOffset();
		this.controlOffset = management + HEAP_GC_CONTROL_OFFSET;
		this.threads = new ThreadRecords(memory, arena, budget);
		this.tables = new TableRecords(this, newIndexKey);
	}
	public readonly tables: TableRecords;
	public readonly threads: ThreadRecords;
	private readonly threadLayout = new ThreadLayout();
	public publishObject(address: number): void {
		const head = this.controlOffset + GC_OBJECT_HEAD;
		const link = address - GC_OBJECT_LINK_BEFORE;
		this.memory.writeRamRecordWord(link, this.memory.readRamRecordWord(head));
		// A new object is already current-white. Keep the sweep frontier on the old list.
		const sweep = this.controlOffset + GC_SWEEP_LINK;
		if (this.memory.readRamRecordWord(sweep) === head) this.memory.writeRamRecordWord(sweep, link);
		this.memory.writeRamRecordPair(head, address, this.memory.readRamRecordWord(head + 4) + 1);
	}
	public visitObjectRecords<Context>(context: Context, visit: (context: Context, address: number) => void): void {
		for (let address = this.memory.readRamRecordWord(this.controlOffset + GC_OBJECT_HEAD);
			address !== 0; address = this.memory.readRamRecordWord(address - GC_OBJECT_LINK_BEFORE)) {
			visit(context, address);
		}
	}
	private objectRecordAddress(address: number, kind: number): number {
		const offset = address & GC_RECORD_MASK;
		return this.memory.readRamRecordByte(offset) === kind
			&& this.arena.issuedObjectStart(offset - GC_OBJECT_PREFIX) ? RAM_BASE + offset : 0;
	}
	public tableRecordAddress(address: number): number {
		return this.objectRecordAddress(address, ValueTag.Table);
	}
	public cellRecordAddress(address: number): number {
		return this.objectRecordAddress(address, UPVALUE_RECORD_KIND);
	}
	public closureRecordAddress(address: number): number {
		return this.objectRecordAddress(address, ValueTag.Closure);
	}
	public openCellAddress(address: number): number {
		const cell = this.cellRecordAddress(address);
		return cell !== 0 && Upvalue.isOpen(this.memory, cell) ? cell : 0;
	}
	public threadRecordAddress(address: number): number {
		return this.objectRecordAddress(address, THREAD_RECORD_KIND);
	}
	public active(): boolean { return this.phase() !== GcPhase.Pause; }
	public finalMarkPending(): boolean { return this.phase() === GcPhase.Atomic; }
	public isAlive(address: number): boolean { return address !== 0 && !this.unmarked(this.memory.readRamRecordByte(address + GC_COLOR_OFFSET)); }
	private markColor(address: number): number { return this.memory.readRamRecordByte(address + GC_COLOR_OFFSET) & GC_COLOR_MASK; }
	private unmarked(flags: number): boolean { return (flags & GC_COLOR_MASK) === this.white(); }
	private setColor(address: number, color: number): void {
		const lane = address + GC_COLOR_OFFSET;
		this.memory.writeRamRecordByte(lane, (this.memory.readRamRecordByte(lane) & ~GC_COLOR_MASK) | color);
	}
	public markString(id: number): void { this.cpu.stringPool.markReachable(id); }
	public sweepGarbage(address: number): boolean {
		return this.phase() === GcPhase.Sweep && this.markColor(address) === (this.white() ^ 1);
	}
	public changedHeadOffset(): number { return this.controlOffset + GC_CHANGED_HEAD; }
	private indexWord(queue: number): number { return this.memory.readRamRecordWord(this.controlOffset + queue) & GC_GRAY_INDEX_MASK; }
	private enqueue(address: number, link: number, queue: number): void {
		const previous = this.indexWord(queue);
		const otherBits = link === GC_RECORD_LINK ? this.memory.readRamRecordWord(address + link) & ~GC_GRAY_INDEX_MASK : 0;
		this.memory.writeRamRecordWord(address + link, otherBits | previous);
		this.setColor(address, 2);
		this.memory.writeRamRecordWord(this.controlOffset + queue, (address & GC_RECORD_MASK) >>> GC_RECORD_SHIFT);
	}
	public writeBarrier(address: number, link: number): void {
		if (this.markColor(address) === 3) this.enqueue(address, link, GC_CHANGED_HEAD);
	}

	private creditBarrierMarks(): void {
		// Account for mutator string marks before save or rewind can observe the heap.
		const work = this.cpu.stringPool.takeMarkWork();
		if (work !== 0) this.accountEpochWork(work);
	}
	// A GlobalBank has no weak lanes. Admission already classified this
	// pair as a collector edge; only a marking epoch needs the insertion.
	public writeGlobalRoot(tag: ValueTag, word: number): void {
		const phase = this.phase();
		if (phase < GcPhase.Mark || phase > GcPhase.Atomic) return;
		if (tag === ValueTag.String) {
			this.markString(word);
			this.creditBarrierMarks();
			return;
		}
		// Before the remark detaches Changed, it replaces (not merges) Trace.
		const stage = phase === GcPhase.MarkAgain ? RemarkStage.Roots : this.remarkStage();
		const beforeDetach = stage <= RemarkStage.Weak && (stage !== RemarkStage.None || phase === GcPhase.Atomic);
		this.markRecord(word, tag === ValueTag.Thread ? THREAD_RECORD_KIND : tag,
			beforeDetach ? GC_CHANGED_HEAD : GC_TRACE_HEAD);
	}
	// During the second pass, trace new strong edges without rescanning their
	// owner. Metatabled tables still need the collector to resolve weak lanes.
	// Only an insertion installs the supplied key as a new edge.
	public writeTableAssignment(address: number, tag: ValueTag, word: number, insertedKey?: Value): void {
		if (!valueTagHasGcEdge(tag) && (insertedKey === undefined || !valueTagHasGcEdge(valueTag(insertedKey)))) return;
		if (this.markColor(address) !== 3) return;
		if (this.phase() === GcPhase.MarkAgain && this.tables.metatableAddress(address) === 0) {
			if (insertedKey !== undefined) this.markValue(insertedKey);
			this.markValue(valueFromTag(tag, word));
			this.creditBarrierMarks();
		} else this.enqueue(address, GC_RECORD_LINK, GC_CHANGED_HEAD);
	}
	public writeClosedValue(address: number, tag: ValueTag, word: number): void {
		if (!valueTagHasGcEdge(tag) || this.markColor(address) !== 3) return;
		this.writeBlackClosedValue(address, tag, word);
	}
	public writeBlackClosedValue(address: number, tag: ValueTag, word: number): void {
		if (this.phase() === GcPhase.MarkAgain) {
			this.markValue(valueFromTag(tag, word));
			this.creditBarrierMarks();
		} else this.enqueue(address, UPVALUE_NEXT, GC_CHANGED_HEAD);
	}
	public tableEntriesMoved(address: number): void {
		const table = this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_RECORD);
		if (table !== address && this.memory.readRamRecordWord(this.controlOffset + GC_MODE_META) !== address) return;
		// An unvisited entry may now be behind the cursor. Resume on the
		// next pass rather than retrying this Table under the mutator.
		this.memory.writeRamRecordPair(this.controlOffset + GC_TRACE_RECORD, 0, 0);
		this.memory.writeRamRecordPair(this.controlOffset + GC_MODE_META, 0, 0);
		this.memory.writeRamRecordWord(this.controlOffset + GC_MODE_REMAINING, 0);
		if (this.markColor(table) === 3) this.enqueue(table, GC_RECORD_LINK, GC_CHANGED_HEAD);
	}
	private setVisitLink(address: number, meta: number, index: number): void {
		const gray = this.memory.readRamRecordWord(address + GC_RECORD_LINK) & GC_GRAY_INDEX_MASK;
		this.memory.writeRamRecordWord(address + GC_RECORD_LINK, gray | (index << GC_GRAY_INDEX_BITS));
		this.memory.writeRamRecordByte(address + GC_VISIT_HEADER_BYTE,
			(meta & ~VISIT_LINK_HIGH_MASK) | (index >>> VISIT_LINK_LOW_BITS));
	}
	private appendVisit(list: number, address: number): void {
		const meta = this.memory.readRamRecordByte(address + GC_VISIT_HEADER_BYTE);
		if ((meta & GC_VISIT_MEMBER) !== 0) return;
		const index = (address & GC_RECORD_MASK) >>> GC_RECORD_SHIFT;
		const tail = this.indexWord(list + GC_VISIT_TAIL);
		this.setVisitLink(address, meta | GC_VISIT_MEMBER, 0);
		if (tail !== 0) {
			const last = tail << GC_RECORD_SHIFT;
			this.setVisitLink(last, this.memory.readRamRecordByte(last + GC_VISIT_HEADER_BYTE), index);
		} else {
			this.memory.writeRamRecordWord(this.controlOffset + list, index);
		}
		this.memory.writeRamRecordWord(this.controlOffset + list + GC_VISIT_TAIL, index);
		const count = this.indexWord(list + GC_VISIT_COUNT);
		this.memory.writeRamRecordWord(this.controlOffset + list + GC_VISIT_COUNT, (count + 1) & GC_GRAY_INDEX_MASK);
	}
	private visitList(list: number, kind: ValueTag.Table | typeof THREAD_RECORD_KIND, drain: boolean,
		visitor: (address: number) => void, allowance: number, stage = RemarkStage.None): number {
		const resumeWeak = stage === RemarkStage.Weak;
		let index = this.indexWord(resumeWeak ? GC_REMARK_VISIT_INDEX : list);
		let remaining = this.indexWord(resumeWeak ? GC_REMARK_VISIT_STATE : list + GC_VISIT_COUNT);
		let visits = 0;
		while (index !== 0 && remaining !== 0 && visits < allowance) {
			const address = RAM_BASE + (index << GC_RECORD_SHIFT);
			const meta = this.memory.readRamRecordByte(address + GC_VISIT_HEADER_BYTE);
			// Only the matching, linked record clocks the list port.
			if ((meta & GC_VISIT_MEMBER) === 0
				|| (kind === ValueTag.Table ? this.tableRecordAddress(address) !== address : this.threadRecordAddress(address) !== address)) {
				index = 0; break;
			}
			--remaining;
			++visits;
			const low = this.memory.readRamRecordWord(address + GC_RECORD_LINK) >>> GC_GRAY_INDEX_BITS;
			index = low | ((meta & VISIT_LINK_HIGH_MASK) << VISIT_LINK_LOW_BITS);
			if (drain) this.setVisitLink(address, meta & ~GC_VISIT_MEMBER, 0);
			visitor(address);
		}
		if (index === 0 || remaining === 0) index = remaining = 0;
		if (drain) {
			if (index === 0) this.memory.writeRamRecordPair(this.controlOffset + list, 0, 0);
			else this.memory.writeRamRecordWord(this.controlOffset + list, index);
			this.memory.writeRamRecordWord(this.controlOffset + list + GC_VISIT_COUNT, remaining);
		} else if (resumeWeak) {
			this.memory.writeRamRecordPair(this.controlOffset + GC_REMARK_VISIT_INDEX, index, (stage << GC_GRAY_INDEX_BITS) | remaining);
		}
		return visits;
	}
	private readonly remarkRecord = (address: number): void => {
		if (this.markColor(address) === 3) this.enqueue(address, GC_RECORD_LINK, GC_CHANGED_HEAD);
	};
	private readonly startWeakClear = (table: number): void => {
		this.memory.writeRamRecordPair(this.controlOffset + GC_TRACE_RECORD, table, TABLE_MODE_PENDING);
	};
	public markThread(address: number): boolean {
		return this.markRecord(address, THREAD_RECORD_KIND);
	}
	private markTable(address: number): boolean {
		return this.markRecord(address, ValueTag.Table);
	}
	private markRecord(address: number, kind: number, queue = GC_TRACE_HEAD): boolean {
		const offset = address & GC_RECORD_MASK;
		const header = this.memory.readRamRecordWord(offset);
		if ((header & 0xff) !== kind || !this.unmarked(header >>> 8)) return false;
		if (!this.arena.issuedObjectStart(offset - GC_OBJECT_PREFIX)) return false;
		this.enqueue(RAM_BASE + offset, GC_RECORD_LINK, queue);
		return true;
	}
	private markCell(cell: number): number {
		if (cell === 0 || !this.unmarked(this.memory.readRamRecordByte(cell + GC_COLOR_OFFSET))) return 0;
		this.setColor(cell, 3);
		if (Upvalue.isOpen(this.memory, cell)) this.markThread(this.memory.readRamRecordWord(cell + UPVALUE_OWNER));
		this.markValue(Upvalue.load(this.memory, cell));
		return UPVALUE_HEAP_BYTES >>> 2;
	}
	public markClosure(address: number): boolean {
		return this.markRecord(address, ValueTag.Closure);
	}
	public markValue(value: Value): boolean {
		switch (valueTag(value)) {
			case ValueTag.Table: return this.markTable(valuePayload(value));
			case ValueTag.Closure: return this.markClosure(valuePayload(value));
			case ValueTag.Thread: return this.markThread(valuePayload(value));
			case ValueTag.String: this.markString(valuePayload(value)); break;
		}
		return false;
	}
	public markSlot(slots: ValueSlots, index: number): void { this.markValue(slots.get(index)); }
	public allocationBytes(address: number): number {
		return this.threads.allocationBytes(address);
	}
	private weakModeBits(mode: Value): number {
		if (valueTag(mode) !== ValueTag.String) return 0;
		const id = valuePayload(mode), pool = this.cpu.stringPool;
		const length = pool.byteLength(id);
		if (length !== 1 && length !== 2) return 0;
		const first = pool.byteAt(id, 0);
		if (length === 1) return first === 107 ? 1 : first === 118 ? 2 : 0;
		const second = pool.byteAt(id, 1);
		return (first === 107 && second === 118) || (first === 118 && second === 107) ? 3 : 0;
	}
	private probeTableMode(table: number, limit: number): number {
		const address = this.tableRecordAddress(this.tables.metatableAddress(table));
		const current = this.memory.readRamRecordWord(this.controlOffset + GC_MODE_META);
		const probe = this.modeProbe;
		if (address !== 0) {
			if (address === current) {
				probe.node = this.memory.readRamRecordWord(this.controlOffset + GC_MODE_NODE) | 0;
				probe.remaining = this.memory.readRamRecordWord(this.controlOffset + GC_MODE_REMAINING);
				probe.value = valueNil();
			} else this.tables.beginStringProbe(address, this.modeKey, probe);
			probe.work = this.tables.advanceStringProbe(address, this.modeKey, probe, limit);
			if (probe.node >= 0 && probe.remaining !== 0) {
				this.memory.writeRamRecordPair(this.controlOffset + GC_MODE_META, address, probe.node);
				this.memory.writeRamRecordWord(this.controlOffset + GC_MODE_REMAINING, probe.remaining);
				return -1;
			}
		} else probe.work = 0;
		if (current !== 0) {
			this.memory.writeRamRecordPair(this.controlOffset + GC_MODE_META, 0, 0);
			this.memory.writeRamRecordWord(this.controlOffset + GC_MODE_REMAINING, 0);
		}
		return address === 0 ? 0 : this.weakModeBits(probe.value);
	}
	private trace(atomic: boolean, limit: number): number {
		const index = this.indexWord(GC_TRACE_HEAD), offset = index << GC_RECORD_SHIFT, address = RAM_BASE + offset;
		const kind = offset < this.arena.managementOffset() ? this.memory.readRamRecordByte(address) : 0;
		const table = kind === ValueTag.Table;
		const cell = kind === UPVALUE_RECORD_KIND && !Upvalue.isOpen(this.memory, address);
		const closure = kind === ValueTag.Closure;
		const thread = kind === THREAD_RECORD_KIND;
		// Only a queued color clocks the link, even for malformed cycles.
		if ((!table && !cell && !closure && !thread) || this.markColor(address) !== 2
			|| !this.arena.issuedObjectStart(offset - GC_OBJECT_PREFIX)) {
			this.memory.writeRamRecordWord(this.controlOffset + GC_TRACE_HEAD, 0);
			return 0;
		}
		const link = address + (cell ? UPVALUE_NEXT : GC_RECORD_LINK);
		const packed = this.memory.readRamRecordWord(link);
		this.memory.writeRamRecordWord(this.controlOffset + GC_TRACE_HEAD, packed & GC_GRAY_INDEX_MASK);
		this.memory.writeRamRecordWord(link, cell ? 0 : packed & ~GC_GRAY_INDEX_MASK);
		this.setColor(address, 3);
		if (table) return this.traceTable(address, limit);
		if (cell) {
			this.markValue(Upvalue.load(this.memory, address));
			return UPVALUE_HEAP_BYTES >>> 2;
		}
		if (closure) {
			const count = Closure.captureCount(this.memory, address);
			// A capture word can discover a four-word cell and one String.
			if (3 + 6 * count > limit) return this.traceCaptures(address, 0, count, 3, limit);
			let work = 3 + count;
			for (let index = 0; index < count; ++index) work += this.markCell(this.cellRecordAddress(Closure.captureAddress(this.memory, address, index)));
			return work;
		}
		return this.traceThread(address, atomic, limit, 0, THREAD_TRACE_OPEN_HEAD, 0, false);
	}
	private traceThread(address: number, atomic: boolean, limit: number, cursor: number, open: number,
		captureTop: number, resumed: boolean): number {
		const layout = this.threadLayout;
		const memory = this.memory, strings = this.cpu.stringPool;
		let work = 0;
		if (!resumed) {
			if (!atomic) this.appendVisit(GC_THREAD_VISITS, address);
			this.markThread(memory.readRamRecordWord(address + ThreadField.Resumer));
			this.markClosure(memory.readRamRecordWord(address + ThreadField.Entry));
			this.markValue(valueFromTag(memory.readRamRecordByte(address + ThreadField.ErrorKind), memory.readRamRecordWord(address + ThreadField.ErrorWord)));
			work = (THREAD_HEAP_BYTES >>> 2) + strings.takeMarkWork();
		}
		this.threads.readLayout(address, layout);
		let stage = cursor >>> TRACE_CURSOR_BITS, next = cursor & TRACE_CURSOR_MASK;
		let complete = false;
		// Only the logical indices survive this call; storage may grow while
		// another CPU grant owns the Thread.
		if (stage === ThreadTraceStage.Frames) {
			while (next < layout.depth && work < limit) {
				if (open === THREAD_TRACE_OPEN_HEAD) {
					const frame = this.threads.frameAddress(layout, next);
					this.markClosure(memory.readRamRecordWord(frame + FrameField.Closure));
					open = memory.readRamRecordWord(frame + FrameField.OpenHead);
					work += FRAME_CONTROL_BYTES >>> 2;
				}
				while (open !== 0 && work < limit) {
					const cell = this.openCellAddress(open);
					// A returned frame's closed cell uses Next for a different queue.
					if (cell === 0) { open = 0; break; }
					const slot = memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD);
					if (slot < layout.capacity) captureTop = Math.max(captureTop, slot + 1);
					open = memory.readRamRecordWord(cell + UPVALUE_NEXT);
					work += Math.max(1, this.markCell(cell)) + strings.takeMarkWork();
				}
				if (open === 0) { ++next; open = THREAD_TRACE_OPEN_HEAD; }
			}
			if (next >= layout.depth) { stage = ThreadTraceStage.Protected; next = 0; open = 0; }
		}
		if (stage === ThreadTraceStage.Protected) {
			while (next < layout.protectedDepth && work < limit) {
				const continuation = layout.protectedOffset + next++ * PROTECTED_CALL_BYTES;
				const flags = memory.readRamRecordWord(continuation + ProtectedField.Flags);
				if ((flags & PROTECTED_CALL_KIND_MASK) !== ProtectedCallKind.PCall && (flags & PROTECTED_CALL_HANDLER_IMMUTABLE) === 0)
					this.markClosure(memory.readRamRecordWord(continuation + ProtectedField.Handler));
				work += PROTECTED_CALL_BYTES >>> 2;
			}
			if (next >= layout.protectedDepth) { stage = ThreadTraceStage.Values; next = 0; }
		}
		if (stage === ThreadTraceStage.Values) {
			let liveTop = captureTop;
			if (layout.depth !== 0) {
				const current = this.threads.frameAddress(layout, layout.depth - 1);
				const base = memory.readRamRecordWord(current + FrameField.StackBase) & FRAME_WINDOW_MASK;
				const top = memory.readRamRecordWord(current + FrameField.Top) & FRAME_WINDOW_MASK;
				const capacity = memory.readRamRecordWord(current + FrameField.StackCapacity) & FRAME_WINDOW_MASK;
				// Unadmitted CONCATN sources still reside in this frame during final marking.
				const pending = atomic ? this.cpu.pendingOperandTop(address) : 0;
				liveTop = Math.max(liveTop, base + Math.min(Math.max(top, pending), capacity));
			}
			const tags = layout.offset + layout.capacity * 4;
			while (next < liveTop && work < limit) {
				const stop = Math.min(liveTop, next + Math.max(1, ((limit - work) / 3) | 0));
				const words = ceilDiv4(stop * THREAD_STACK_SLOT_BYTES) - ceilDiv4(next * THREAD_STACK_SLOT_BYTES);
				for (; next < stop; ++next)
					this.markValue(valueFromTag(memory.readRamRecordByte(tags + next), memory.readRamRecordWord(layout.offset + next * 4)));
				work += words + strings.takeMarkWork();
			}
			if (next >= liveTop) {
				if (atomic) {
					stage = ThreadTraceStage.Clear;
					next = liveTop;
				} else complete = true;
			}
		}
		if (stage === ThreadTraceStage.Clear) {
			while (next < layout.capacity && work < limit) {
				const stop = Math.min(layout.capacity, next + Math.max(1, ((limit - work) / 2) | 0));
				this.threads.clearStackRange(layout, next, stop);
				const words = ceilDiv4(stop * THREAD_STACK_SLOT_BYTES) - ceilDiv4(next * THREAD_STACK_SLOT_BYTES);
				work += words;
				next = stop;
			}
			complete = next >= layout.capacity;
		}
		if (complete) {
			if (resumed) {
				memory.writeRamRecordPair(this.controlOffset + GC_TRACE_RECORD, 0, 0);
				memory.writeRamRecordPair(this.controlOffset + GC_THREAD_TRACE_OPEN, 0, 0);
			}
			return work;
		}
		memory.writeRamRecordPair(this.controlOffset + GC_TRACE_RECORD, address, (stage << TRACE_CURSOR_BITS) | next);
		memory.writeRamRecordPair(this.controlOffset + GC_THREAD_TRACE_OPEN, open, captureTop);
		return work;
	}
	private traceCaptures(closure: number, next: number, count: number, work: number, limit: number): number {
		const strings = this.cpu.stringPool;
		while (next < count && work < limit) {
			work += 1 + this.markCell(this.cellRecordAddress(Closure.captureAddress(this.memory, closure, next++)));
			work += strings.takeMarkWork();
		}
		// The capture lanes do not move after construction. The saved position
		// and the queued edges share the same RAM snapshot as the values.
		this.memory.writeRamRecordPair(this.controlOffset + GC_TRACE_RECORD,
			next < count ? closure : 0, next < count ? next : 0);
		return work;
	}
	private resumeTrace(record: number, atomic: boolean, limit: number): number {
		const cursor = this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_CURSOR);
		switch (this.memory.readRamRecordByte(record)) {
			case ValueTag.Table: return cursor === TABLE_MODE_PENDING ? this.traceTable(record, limit, true)
				: this.traceTableEntries(record, cursor >>> TRACE_CURSOR_BITS, cursor & TRACE_CURSOR_MASK, 0, limit);
			case THREAD_RECORD_KIND: return this.traceThread(record, atomic, limit, cursor,
				this.memory.readRamRecordWord(this.controlOffset + GC_THREAD_TRACE_OPEN),
				this.memory.readRamRecordWord(this.controlOffset + GC_THREAD_TRACE_TOP), true);
			default: return this.traceCaptures(record, cursor, Closure.captureCount(this.memory, record), 0, limit);
		}
	}
	private traceQuantum(atomic: boolean, limit: number, work: number): number {
		const record = this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_RECORD);
		if (record !== 0) {
			work += this.resumeTrace(record, atomic, limit - work);
			if (this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_RECORD) !== 0) return work;
		}
		while (this.indexWord(GC_TRACE_HEAD) !== 0 && work < limit)
			work += this.trace(atomic, limit - work) + this.cpu.stringPool.takeMarkWork();
		return work;
	}
	private traceTable(address: number, limit: number, resumingMode = false): number {
		const meta = this.tables.metatableAddress(address);
		if (meta !== 0 && !resumingMode) this.markTable(meta);
		let work = resumingMode ? 0 : TableRecords.HEADER_BYTES >>> 2;
		let mode = 0;
		if (meta !== 0 || resumingMode) {
			mode = this.probeTableMode(address, Math.max(0, limit - work));
			work += this.modeProbe.work;
		}
		if (mode < 0) {
			this.memory.writeRamRecordPair(this.controlOffset + GC_TRACE_RECORD, address, TABLE_MODE_PENDING);
			return work;
		}
		if (mode !== 0) this.appendVisit(GC_WEAK_VISITS, address);
		// Fully weak tables have no marking scan. Weak values leave only
		// hash keys to trace; array keys are implicit Integers.
		if (mode === 3) {
			if (resumingMode) this.memory.writeRamRecordPair(this.controlOffset + GC_TRACE_RECORD, 0, 0);
			return work;
		}
		const weakValues = (mode & 2) !== 0;
		const first = weakValues ? this.tables.arrayCapacity(address) : 0;
		const slots = weakValues ? 2 * this.tables.hashSize(address) : this.tables.scanSlots(address);
		if (resumingMode || work + slots * 2 > limit) return this.traceTableEntries(address, mode, first, work, limit);
		this.traceTableEdges(address, mode, first);
		return work + slots;
	}
	private traceTableEdges(table: number, mode: number, first = 0, end = 0x7fffffff): void {
		switch (mode) {
			case 0: this.tables.forEachStoredEntry(table, this.traceBoth, first, end); break;
			case 1: this.tables.forEachStoredEntry(table, this.traceValue, first, end); break;
			case 2: this.tables.forEachStoredEntry(table, this.traceKey, first, end); break;
		}
	}
	private traceTableEntries(table: number, mode: number, next: number, work: number, limit: number): number {
		const array = this.tables.arrayCapacity(table), end = this.tables.storedSlotCount(table);
		const strings = this.cpu.stringPool;
		while (next < end && work < limit) {
			const arrayEntry = next < array, entryWords = arrayEntry ? 1 : 2;
			const worst = entryWords * 2;
			const span = Math.max(1, ((limit - work) / worst) | 0);
			const stop = Math.min(arrayEntry ? array : end, next + span);
			this.traceTableEdges(table, mode, next, stop);
			work += (stop - next) * entryWords + strings.takeMarkWork();
			next = stop;
		}
		this.memory.writeRamRecordPair(this.controlOffset + GC_TRACE_RECORD, next < end ? table : 0,
			next < end ? (mode << TRACE_CURSOR_BITS) | next : 0);
		return work;
	}
	private traceRootBanks(limit: number, work: number, stop: GcRootBank): number {
		const cursor = this.memory.readRamRecordWord(this.controlOffset + GC_ROOT_CURSOR);
		let next = cursor & TRACE_CURSOR_MASK;
		const strings = this.cpu.stringPool;
		for (let kind = cursor >>> TRACE_CURSOR_BITS; kind < stop; ++kind, next = 0) {
			const end = this.cpu.rootBankSlots(kind);
			const globals = kind < GcRootBank.SystemConstants;
			const words = globals ? 3 : 1, worst = words + (globals ? 2 : 1);
			while (next < end) {
				if (work >= limit) {
					this.memory.writeRamRecordWord(this.controlOffset + GC_ROOT_CURSOR, (kind << TRACE_CURSOR_BITS) | next);
					return work;
				}
				const stop = Math.min(end, next + Math.max(1, ((limit - work) / worst) | 0));
				this.cpu.markRootBank(this, kind, next, stop);
				work += (stop - next) * words + strings.takeMarkWork();
				next = stop;
			}
		}
		this.memory.writeRamRecordWord(this.controlOffset + GC_ROOT_CURSOR, 0);
		this.cpu.markRootThreads(this);
		return work;
	}
	private remarkStage(): RemarkStage {
		return this.memory.readRamRecordWord(this.controlOffset + GC_REMARK_VISIT_STATE) >>> GC_GRAY_INDEX_BITS;
	}
	private setRemarkStage(stage: RemarkStage): void {
		this.memory.writeRamRecordWord(this.controlOffset + GC_REMARK_VISIT_STATE, stage << GC_GRAY_INDEX_BITS);
	}
	private remarkVisits(allowance: number): number {
		this.diagnostics?.phase('rootsNanoseconds');
		let stage = this.remarkStage(), visits = 0;
		if (stage === RemarkStage.Threads) {
			visits = this.visitList(GC_THREAD_VISITS, THREAD_RECORD_KIND, true, this.remarkRecord, allowance, stage);
			if (this.indexWord(GC_THREAD_VISITS) !== 0) return visits;
			stage = RemarkStage.Weak;
			this.memory.writeRamRecordPair(this.controlOffset + GC_REMARK_VISIT_INDEX, this.indexWord(GC_WEAK_VISITS),
				(stage << GC_GRAY_INDEX_BITS) | this.indexWord(GC_WEAK_VISITS + GC_VISIT_COUNT));
		}
		if (stage === RemarkStage.Weak) {
			visits += this.visitList(GC_WEAK_VISITS, ValueTag.Table, false, this.remarkRecord, allowance - visits, stage);
			if (this.indexWord(GC_REMARK_VISIT_INDEX) !== 0 || visits === allowance) return visits;
			// Transfer only after the visits: writes keep publishing to Changed
			// while no allocation can progress to the sweep.
			this.memory.writeRamRecordPair(this.controlOffset + GC_TRACE_HEAD, this.indexWord(GC_CHANGED_HEAD), 0);
			this.setRemarkStage(RemarkStage.Roots);
			this.cpu.markRootHead(this);
			// Global banks were scanned once; mutation now retains new edges.
			this.memory.writeRamRecordWord(this.controlOffset + GC_ROOT_CURSOR, GcRootBank.SystemConstants << TRACE_CURSOR_BITS);
		}
		return visits;
	}
	private remarkRoots(t0: Value, t1: Value, t2: Value, limit: number, work: number, final: boolean): number {
		this.diagnostics?.phase('rootsNanoseconds');
		this.markValue(t0); this.markValue(t1); this.markValue(t2);
		work += this.cpu.stringPool.takeMarkWork();
		// Pending Strings are leaves; only the stopped final pass needs their unread suffix.
		if (work < limit) work = this.traceRootBanks(limit, work, final ? GcRootBank.End : GcRootBank.ConcatOperands);
		if (this.memory.readRamRecordWord(this.controlOffset + GC_ROOT_CURSOR) === 0) {
			this.setRemarkStage(final ? RemarkStage.Trace : RemarkStage.None);
			if (!final) this.setPhase(GcPhase.MarkAgain);
		}
		return work;
	}
	/** Only the stopped mutator may advance the final pass. */
	public finishFinalMark(t0: Value = valueNil(), t1: Value = valueNil(), t2: Value = valueNil()): number {
		if (!this.finalMarkPending()) return 0;
		this.diagnostics?.beginStep();
		this.diagnostics?.beginAtomic();
		try {
			let work = 0;
			let scopedRoots = true;
			do {
				work += this.finalMarkWork(t0, t1, t2, scopedRoots, GC_STEP_WORDS);
				scopedRoots = this.remarkStage() <= RemarkStage.Weak;
			} while (this.finalMarkPending());
			return this.accountEpochWork(work);
		} finally { this.diagnostics?.endStep(); }
	}

	public stepFinalMark(limit = GC_STEP_WORDS): number {
		this.diagnostics?.beginStep();
		this.diagnostics?.beginAtomic();
		try {
			const work = this.finalMarkWork(valueNil(), valueNil(), valueNil(), false, limit);
			return this.accountEpochWork(work);
		}
		finally { this.diagnostics?.endStep(); }
	}
	private finalMarkWork(t0: Value, t1: Value, t2: Value, scopedRoots: boolean, limit: number): number {
		let work = 0;
		if (this.remarkStage() === RemarkStage.None) this.setRemarkStage(RemarkStage.Threads);
		if (this.remarkStage() <= RemarkStage.Weak) {
			work += this.remarkVisits(limit);
			if (this.remarkStage() !== RemarkStage.Roots) return work;
		}
		// Only a synchronous final pass can run inside a temporary host scope.
		// Earlier marking cannot reclaim this epoch, so no scoped cursor or
		// repeated visit is needed before the mutator stops.
		if (scopedRoots && this.remarkStage() < RemarkStage.ClearWeak) {
			this.cpu.markScopedRoots(this);
			this.cpu.stringPool.markLocalRoots();
			this.markValue(t0); this.markValue(t1); this.markValue(t2);
			work += this.cpu.stringPool.takeMarkWork();
		}
		return this.finalMarkTail(limit, work);
	}

	private finalMarkTail(limit: number, work: number): number {
		if (work >= limit) return work;
		if (this.remarkStage() === RemarkStage.Roots) {
			work = this.remarkRoots(valueNil(), valueNil(), valueNil(), limit, work, true);
			if (this.remarkStage() === RemarkStage.Roots || work >= limit) return work;
		}
		if (this.remarkStage() === RemarkStage.Trace) {
			this.diagnostics?.phase('traceNanoseconds');
			return this.finishAtomicTrace(limit, this.traceQuantum(true, limit, work));
		}
		return this.atomicWeakWork(limit, work);
	}

	private finishAtomicTrace(limit: number, work: number): number {
		if (this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_RECORD) !== 0 || this.indexWord(GC_TRACE_HEAD) !== 0)
			return work;
		this.setRemarkStage(RemarkStage.ClearWeak);
		return work >= limit ? work : this.atomicWeakWork(limit, work);
	}

	private atomicWeakWork(limit: number, work: number): number {
		return this.finishAtomicCollection(work + this.clearWeakQuantum(limit - work));
	}

	private finishAtomicCollection(work: number): number {
		if (this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_RECORD) !== 0 || this.indexWord(GC_WEAK_VISITS) !== 0) return work;
		this.memory.writeRamRecordByte(this.controlOffset + 1, this.white() ^ 1);
		this.memory.writeRamRecordWord(this.controlOffset + GC_SWEEP_LINK, this.controlOffset + GC_OBJECT_HEAD);
		this.setRemarkStage(RemarkStage.None);
		// Reprice the remaining runway against the post-mark reclamation work.
		this.beginPaceCredit(this.memory.readRamRecordWord(this.controlOffset + GC_OBJECT_COUNT) + this.cpu.stringPool.estimateSweepWork(), 0);
		this.setPhase(GcPhase.Sweep);
		return work;
	}
	private clearWeakQuantum(limit: number): number {
		this.diagnostics?.phase('weakNanoseconds');
		let work = 0;
		while (work < limit) {
			let record = this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_RECORD);
			if (record === 0) {
				if (this.indexWord(GC_WEAK_VISITS) === 0) break;
				work += this.visitList(GC_WEAK_VISITS, ValueTag.Table, true, this.startWeakClear, 1);
				record = this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_RECORD);
				if (record === 0 || work === limit) break;
			}
			let cursor = this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_CURSOR);
			if (cursor === TABLE_MODE_PENDING) {
				const mode = this.probeTableMode(record, limit - work);
				work += this.modeProbe.work;
				if (mode < 0) break;
				cursor = mode << TRACE_CURSOR_BITS;
			}
			const mode = cursor >>> TRACE_CURSOR_BITS;
			const array = this.tables.arrayCapacity(record), end = this.tables.storedSlotCount(record);
			let next = cursor & TRACE_CURSOR_MASK;
			while (next < end && work < limit) {
				const entryWords = next < array ? 1 : 2;
				const stop = Math.min(next < array ? array : end, next + Math.max(1, ((limit - work) / (2 * entryWords)) | 0));
				this.tables.clearWeakEntries(record, (mode & 1) !== 0, (mode & 2) !== 0, this.alive, next, stop);
				work += (stop - next) * entryWords + this.cpu.stringPool.takeMarkWork();
				next = stop;
			}
			this.memory.writeRamRecordPair(this.controlOffset + GC_TRACE_RECORD, next < end ? record : 0,
				next < end ? (mode << TRACE_CURSOR_BITS) | next : 0);
		}
		return work;
	}

	private sweepObjects(allowance: number, growingThread: number, compactThreads: boolean): number {
		const memory = this.memory;
		const cursor = this.controlOffset + GC_SWEEP_LINK;
		let link = memory.readRamRecordWord(cursor);
		if (link === 0) return 0;
		let address = memory.readRamRecordWord(link);
		const white = this.white();
		let work = 0;
		let removed = 0;
		while (address !== 0 && work < allowance) {
			// The cursor owns the link to the next record, not the record
			// being freed. Never retain an address into discarded storage.
			const nextLink = address - GC_OBJECT_LINK_BEFORE;
			const next = memory.readRamRecordWord(nextLink);
			const header = memory.readRamRecordWord(address);
			const garbage = ((header >>> 8) & GC_COLOR_MASK) === (white ^ 1);
			if (garbage) {
				memory.writeRamRecordWord(link, next);
				++removed;
			} else link = nextLink;
			work += this.sweepRecord(address, header, garbage, white, growingThread, compactThreads);
			address = next;
		}
		if (removed !== 0) {
			const count = this.controlOffset + GC_OBJECT_COUNT;
			memory.writeRamRecordWord(count, memory.readRamRecordWord(count) - removed);
		}
		memory.writeRamRecordWord(cursor, address !== 0 ? link : 0);
		return work;
	}

	private sweepRecord(address: number, header: number, garbage: boolean, white: number, growingThread: number, compactThreads: boolean): number {
		const kind = header & 0xff;
		if (!garbage) {
			this.memory.writeRamRecordByte(address + GC_COLOR_OFFSET, white);
			if (kind !== THREAD_RECORD_KIND || !compactThreads || address === growingThread) return 1;
			return 1 + this.compactThreadStack(address);
		}
		if (kind === ValueTag.Table) {
			this.tables.freeRecord(address);
			this.onRecordRetirement?.(address);
			return 1;
		}
		if (kind !== THREAD_RECORD_KIND) {
			if (kind === ValueTag.Closure && (header & (Closure.CLOSURE_CANONICAL << (8 * Closure.CLOSURE_BINDING_FLAGS))) !== 0)
				this.cpu.retireStaticClosure(address);
			const bytes = kind === UPVALUE_RECORD_KIND ? UPVALUE_HEAP_BYTES
				: Closure.closureRecordBytes(Closure.captureCount(this.memory, address),
					(header & (Closure.CLOSURE_LATCHED_PROTOTYPE << (8 * Closure.CLOSURE_BINDING_FLAGS))) !== 0);
			this.budget.releaseObject(address, bytes);
			if (kind === ValueTag.Closure) this.onRecordRetirement?.(address);
			return 1;
		}
		const layout = this.threadLayout;
		this.threads.readLayout(address, layout);
		this.cpu.retireThreadView(address);
		this.budget.releaseRecord(layout.block, layout.capacity * THREAD_STACK_SLOT_BYTES);
		this.budget.releaseRecord(layout.frameBlock, layout.frames * FRAME_CONTROL_BYTES);
		if (layout.protectedBlock !== 0) this.budget.releaseRecord(layout.protectedBlock, layout.continuations * PROTECTED_CALL_BYTES);
		this.budget.releaseObject(address, THREAD_HEAP_BYTES);
		this.onRecordRetirement?.(address);
		return 1;
	}

	private compactThreadStack(address: number): number {
		const layout = this.threadLayout;
		this.threads.readLayout(address, layout);
		const retained = this.threads.shrinkStack(address, layout);
		// Rebind the tag plane and reservations. Sweep charges retained extents, not host copies.
		if (retained !== 0) this.cpu.rebindRelocatedThread(address);
		return 2 * ceilDiv4(retained);
	}

	private accountEpochWork(work: number): number {
		const epochWork = this.memory.readRamRecordWord(this.controlOffset + GC_EPOCH_WORK) + work;
		if (this.active()) {
			this.memory.writeRamRecordWord(this.controlOffset + GC_EPOCH_WORK, epochWork);
		} else {
			this.memory.writeRamRecordPair(this.controlOffset + GC_EPOCH_WORK, 0, epochWork);
			this.memory.writeRamRecordWord(this.controlOffset + GC_PHYSICAL_ASSIST, 0);
		}
		return work;
	}

	/** Native reference for differential collector tests. */
	public assistPhysicalPressureAtTick(): void {
		if (this.cpu.tableRebuild.record) return;
		if (this.fullEpochs()) return;
		const occupied = this.arena.occupiedBytes();
		const previousOccupied = this.memory.readRamRecordWord(this.controlOffset + GC_PHYSICAL_OCCUPIED_AT_TICK);
		if (occupied !== previousOccupied) this.memory.writeRamRecordWord(this.controlOffset + GC_PHYSICAL_OCCUPIED_AT_TICK, occupied);
		const current = this.phase();
		if (current === GcPhase.Atomic) return;
		if (this.memory.readRamRecordWord(this.controlOffset + GC_PHYSICAL_ASSIST) === 0) {
			if (occupied <= previousOccupied) return;
			const demand = occupied - previousOccupied;
			const completed = this.memory.readRamRecordWord(this.controlOffset + GC_EPOCH_WORK);
			const previous = this.memory.readRamRecordWord(this.controlOffset + GC_LAST_EPOCH_WORK);
			const remaining = Math.max(previous, completed) - completed;
			// Atomic entry and exit can end a pulse early. Leave room for the next interval's growth.
			const quanta = (((remaining + GC_STEP_WORDS - 1) / GC_STEP_WORDS) >>> 0) + 3;
			if (this.arena.unoccupiedBytes() > demand * quanta) return;
			this.memory.writeRamRecordWord(this.controlOffset + GC_PHYSICAL_ASSIST, 1);
		}
		const idleMark = (current === GcPhase.Mark || current === GcPhase.MarkAgain) && this.cpu.isHaltedUntilIrq();
		this.step(valueNil(), valueNil(), valueNil(), 0, false, idleMark ? 4 * GC_STEP_WORDS : GC_STEP_WORDS);
	}

	private beginPaceCredit(estimate: number, runwayShift: number): void {
		// Price real allocation growth against the estimated work and a share
		// of the physical room at this frontier. This is not a contiguous-space guarantee.
		const occupied = this.arena.occupiedBytes();
		const runway = Math.max((this.arena.capacityBytes() - occupied) >>> runwayShift, 1);
		this.memory.writeRamRecordWord(this.controlOffset + GC_PACE_ESTIMATE, estimate);
		this.memory.writeRamRecordWord(this.controlOffset + GC_PACE_RUNWAY, runway);
		this.updatePaceCredit(occupied, 0, estimate, runway);
	}

	private updatePaceCredit(basis: number, paid: number, estimate: number, runway: number): void {
		// As on the native core, compute the next whole batch threshold
		// only when the collector changes the frontier.
		const batch = paid < estimate ? Math.min(512, estimate - paid) : 512;
		const product = (paid + batch) * runway;
		const next = toSignedWord(basis) + Math.trunc((product + estimate - 1) / estimate);
		this.memory.writeRamRecordWord(this.controlOffset + GC_PACE_BASIS, basis);
		this.memory.writeRamRecordWord(this.controlOffset + GC_PACE_PAID, paid);
		this.memory.writeRamRecordWord(this.controlOffset + GC_PACE_PAY_AT, Math.min(MAIN_RAM_SIZE, Math.max(0, next)));
	}

	public reservationAssistAllowance(requested: number): number | null {
		const occupiedAfterRequest = this.arena.occupiedBytes() + requested;
		const capacity = this.arena.capacityBytes();
		if (occupiedAfterRequest < this.memory.readRamRecordWord(this.controlOffset + GC_PACE_PAY_AT)
			&& occupiedAfterRequest < capacity) return null;
		let allowance = GC_STEP_WORDS;
		if (occupiedAfterRequest < capacity) {
			const growth = occupiedAfterRequest - toSignedWord(this.memory.readRamRecordWord(this.controlOffset + GC_PACE_BASIS));
			const work = growth * this.memory.readRamRecordWord(this.controlOffset + GC_PACE_ESTIMATE);
			const paid = this.memory.readRamRecordWord(this.controlOffset + GC_PACE_PAID);
			const runway = this.memory.readRamRecordWord(this.controlOffset + GC_PACE_RUNWAY);
			allowance = Math.min(GC_STEP_WORDS, Math.trunc(work / runway) - paid);
		}
		return allowance;
	}

	public assistBeforeReservation(requested: number, root0 = valueNil(), root1 = valueNil(), root2 = valueNil(), growingThread = 0,
		sourceCycles?: number): void {
		const allowance = this.reservationAssistAllowance(requested);
		if (allowance !== null) this.cpu.assistAllocation(root0, root1, root2, growingThread, allowance, sourceCycles);
	}

	public step(t0: Value = valueNil(), t1: Value = valueNil(), t2: Value = valueNil(), growingThread = 0, compactThreads = false,
		limit = GC_STEP_WORDS): number {
		// Explicit and space-exhausted collection can finish the final pass synchronously.
		if (this.finalMarkPending()) return this.finishFinalMark(t0, t1, t2);
		this.diagnostics?.beginStep();
		try {
			const occupied = this.arena.occupiedBytes();
			const work = this.stepWork(t0, t1, t2, growingThread, compactThreads, limit);
			return this.finishStepWork(occupied, work);
		}
		finally { this.diagnostics?.endStep(); }
	}

	private finishStepWork(occupiedBefore: number, work: number): number {
		if (this.active()) {
			// Every quantum, whichever assist ran it, pays the current pace,
			// including the first one after a cycle priced its runway.
			const basis = this.memory.readRamRecordWord(this.controlOffset + GC_PACE_BASIS);
			const paid = this.memory.readRamRecordWord(this.controlOffset + GC_PACE_PAID);
			this.updatePaceCredit(basis + this.arena.occupiedBytes() - occupiedBefore, paid + work,
				this.memory.readRamRecordWord(this.controlOffset + GC_PACE_ESTIMATE),
				this.memory.readRamRecordWord(this.controlOffset + GC_PACE_RUNWAY));
		}
		return this.accountEpochWork(work);
	}

	private beginStrings(): void {
		this.memory.writeRamRecordWord(this.changedHeadOffset(), 0);
		this.setPhase(GcPhase.Strings);
		this.cpu.stringPool.beginSweep();
	}

	private finishStrings(): void {
		if (!this.cpu.stringPool.sweeping()) {
			this.setPhase(GcPhase.Pause);
			this.budget.finishCollection();
		}
	}

	private stepWork(t0: Value, t1: Value, t2: Value, growingThread: number, compactThreads: boolean, limit: number): number {
		let work = 0;
		if (this.remarkStage() !== RemarkStage.None) {
			work += this.remarkVisits(limit);
			if (this.remarkStage() !== RemarkStage.Roots) return work;
			work = this.remarkRoots(t0, t1, t2, limit, work, false);
			if (this.phase() === GcPhase.Mark) return work;
		} else if (this.phase() === GcPhase.Pause || this.phase() === GcPhase.Mark || this.phase() === GcPhase.MarkAgain) {
			this.diagnostics?.phase('rootsNanoseconds');
			if (this.phase() === GcPhase.Pause) {
				if (this.diagnostics !== null) ++this.diagnostics.collections;
				this.setPhase(GcPhase.Mark); this.cpu.stringPool.beginReachabilityEpoch();
				this.cpu.markRootHead(this);
				this.beginInitialBanks();
			}
			if (this.memory.readRamRecordWord(this.controlOffset + GC_ROOT_CURSOR) !== 0) {
				work += this.cpu.stringPool.takeMarkWork();
				if (work < limit) {
					work = this.traceRootBanks(limit, work, GcRootBank.ConcatOperands);
				}
			}
			this.markValue(t0); this.markValue(t1); this.markValue(t2);
			work += this.cpu.stringPool.takeMarkWork();
		}
		while (work < limit && this.active()) {
			switch (this.phase()) {
				case GcPhase.Mark:
				case GcPhase.MarkAgain:
					this.diagnostics?.phase(this.phase() === GcPhase.Mark ? 'traceNanoseconds' : 'markAgainNanoseconds');
					work = this.finishMajorTrace(t0, t1, t2, limit, this.traceQuantum(false, limit, work));
					if (work >= limit || this.phase() !== GcPhase.MarkAgain) return work;
					break;
				case GcPhase.Atomic: return work;
				case GcPhase.Sweep:
					this.diagnostics?.phase('sweepNanoseconds');
					work += this.sweepObjects(limit - work, growingThread, compactThreads);
					if (work < limit && this.memory.readRamRecordWord(this.controlOffset + GC_SWEEP_LINK) === 0) this.beginStrings();
					break;
				case GcPhase.Strings:
					this.diagnostics?.phase('stringReclaimNanoseconds');
					work += this.cpu.stringPool.sweepStep(limit - work);
					this.finishStrings();
					return work;
			}
		}
		return work;
	}
	private finishMajorTrace(t0: Value, t1: Value, t2: Value, limit: number, work: number): number {
		if (work >= limit) return work;
		if (this.phase() === GcPhase.MarkAgain) {
			this.setPhase(GcPhase.Atomic);
			return work;
		}
		this.setRemarkStage(RemarkStage.Threads);
		work += this.remarkVisits(limit - work);
		if (this.remarkStage() !== RemarkStage.Roots) return work;
		return this.remarkRoots(t0, t1, t2, limit, work, false);
	}
	/** Latch the next retry policy before completing exactly one epoch. */
	public beginAllocationRecovery(next: LuaAllocationRecovery): LuaAllocationRecovery {
		if (next === LuaAllocationRecovery.Exhausted) throw LUA_OUT_OF_MEMORY_SIGNAL;
		const first = next === LuaAllocationRecovery.CurrentOrFresh;
		const continueCurrent = first && this.active();
		if (first && this.diagnostics !== null) ++this.diagnostics.fullCollections;
		return continueCurrent ? LuaAllocationRecovery.Fresh : LuaAllocationRecovery.Exhausted;
	}

	/** The owner retries its actual request after each recovered epoch. */
	public recoverAllocation(next: LuaAllocationRecovery, t0 = valueNil(), t1 = valueNil(),
		t2 = valueNil(), growingThread = 0): LuaAllocationRecovery {
		const afterEpoch = this.beginAllocationRecovery(next);
		// Recovery finishes just this epoch, without allocating to shrink live stacks.
		do { this.cpu.chargeCollectionWork(this.step(t0, t1, t2, growingThread, false, GC_STEP_WORDS)); } while (this.active());
		return afterEpoch;
	}

	public fullEpochs(): number { return this.memory.readRamRecordByte(this.controlOffset + GC_FULL_EPOCHS); }
	public epochWork(): number { return this.memory.readRamRecordWord(this.controlOffset + GC_EPOCH_WORK); }
	public workSinceEpoch(before: number): number {
		const finished = this.memory.readRamRecordWord(this.controlOffset + (this.active() ? GC_EPOCH_WORK : GC_LAST_EPOCH_WORK));
		return (finished - before) >>> 0;
	}
	public stoppedFinalMarkPending(): boolean { return this.finalMarkPending() && !this.cpu.tableRebuild.record && !this.fullEpochs(); }
	private beginInitialBanks(): void {
		this.memory.writeRamRecordWord(this.controlOffset + GC_ROOT_CURSOR, GcRootBank.SystemGlobals << TRACE_CURSOR_BITS);
		// Price the new cycle after marking the fixed roots. Half the space
		// remains available for growth through the final pass and sweep.
		const previous = this.memory.readRamRecordWord(this.controlOffset + GC_LAST_EPOCH_WORK);
		this.beginPaceCredit(previous !== 0 ? previous : Math.max(this.arena.occupiedBytes() >>> 2, 1), 1);
	}

	public collect(t0: Value = valueNil(), t1: Value = valueNil(), t2: Value = valueNil(), growingThread = 0): number {
		if (this.diagnostics !== null) ++this.diagnostics.fullCollections;
		let work = 0;
		while (this.active()) work += this.step(t0, t1, t2, growingThread, true);
		do { work += this.step(t0, t1, t2, growingThread, true); } while (this.active());
		return work;
	}
}
