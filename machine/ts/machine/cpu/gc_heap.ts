import { MAIN_RAM_SIZE, RAM_BASE } from '../../spec/bmsx/memory_map';
import type { CPU } from './cpu';
import type { Memory } from '../memory/memory';
import { HEAP_GC_CONTROL_OFFSET, type HeapAllocator } from './heap_allocator';
import { GC_GRAY_INDEX_BITS, GC_GRAY_INDEX_MASK, GC_COLOR_OFFSET, GC_COLOR_MASK, GC_OBJECT_LINK_BEFORE, GC_OBJECT_PREFIX, GC_RECORD_LINK, GC_RECORD_MASK, GC_RECORD_SHIFT } from './gc_object';
import * as Closure from './closure';
import { UPVALUE_HEAP_BYTES, UPVALUE_NEXT, UPVALUE_OWNER, UPVALUE_RECORD_KIND, UPVALUE_VALUE_WORD } from './upvalue';
import * as Upvalue from './upvalue';
import { TableRecords, type TableStringProbe } from './table';
import { THREAD_HEAP_BYTES, THREAD_RECORD_KIND, THREAD_STACK_SLOT_BYTES, ThreadField, ThreadLayout, ThreadRecords } from './thread_record';
import { FRAME_CONTROL_BYTES, FRAME_WINDOW_MASK, FrameField, PROTECTED_CALL_BYTES, PROTECTED_CALL_HANDLER_BUILTIN, PROTECTED_CALL_KIND_MASK, ProtectedCallKind, ProtectedField } from './call_state';
import { ValueTag, valueTag, valueTagHasGcEdge, valuePayload, valueNil, valueFromTag, type Value } from './value';
import type { ValueSlots } from './value_slots';
import { GC_STEP_WORDS, LuaAllocationRecovery, type LuaHeap } from './lua_heap';
import { LUA_OUT_OF_MEMORY_SIGNAL } from './errors';
import { ceilDiv4, toSignedWord } from '../common/numeric';
import type { GcDiagnostics } from './gc_diagnostics';

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
const GC_LAST_EPOCH_WORK = GC_EPOCH_WORK + 4;
const GC_PHYSICAL_OCCUPIED_AT_TICK = GC_LAST_EPOCH_WORK + 4;
const GC_PHYSICAL_ASSIST = GC_PHYSICAL_OCCUPIED_AT_TICK + 4;
const GC_OBJECT_HEAD = GC_PHYSICAL_ASSIST + 4;
const GC_OBJECT_COUNT = GC_OBJECT_HEAD + 4;
const GC_SWEEP_LINK = GC_OBJECT_COUNT + 4;
const GC_SWEEP_BASIS = GC_SWEEP_LINK + 4;
const GC_SWEEP_ESTIMATE = GC_SWEEP_BASIS + 4;
const GC_SWEEP_RUNWAY = GC_SWEEP_ESTIMATE + 4;
const GC_SWEEP_PAID = GC_SWEEP_RUNWAY + 4;
const GC_SWEEP_PAY_AT = GC_SWEEP_PAID + 4;
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
export const enum GcRootBank { None, SystemGlobals, Globals, SystemConstants, Cart0Constants, Cart1Constants, Completion, End }
// Two unconnected selector inputs do not clock the collector.
const GC_PHASE_SELECTOR = [GcPhase.Pause, GcPhase.Mark, GcPhase.MarkAgain, GcPhase.Atomic,
	GcPhase.Sweep, GcPhase.Strings, GcPhase.Pause, GcPhase.Pause];
export function decodeGcPhase(word: number): GcPhase {
	return GC_PHASE_SELECTOR[word & 7];
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
	private readonly modeProbe: TableStringProbe & { work: number } = { node: -1, remaining: 0, value: valueNil(), work: 0 };
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
	private readonly weakStrings = (key: Value, value: Value): void => {
		if (valueTag(key) === ValueTag.String) this.markString(valuePayload(key));
		if (valueTag(value) === ValueTag.String) this.markString(valuePayload(value));
	};
	public constructor(private readonly cpu: CPU, public readonly budget: LuaHeap, public readonly memory: Memory, public readonly arena: HeapAllocator, private readonly modeKey: number) {
		this.controlOffset = arena.managementOffset() + HEAP_GC_CONTROL_OFFSET;
		this.threads = new ThreadRecords(memory, arena, budget);
	}
	public readonly tables = new TableRecords(this);
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
		const record = this.objectRecordAddress(address, kind);
		if (record === 0 || !this.unmarked(this.memory.readRamRecordByte(record + GC_COLOR_OFFSET))) return false;
		this.enqueue(record, GC_RECORD_LINK, queue);
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
				if ((flags & PROTECTED_CALL_KIND_MASK) !== ProtectedCallKind.PCall && (flags & PROTECTED_CALL_HANDLER_BUILTIN) === 0)
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
				liveTop = Math.max(liveTop, base + Math.min(top, capacity));
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
	private traceRootBanks(limit: number, work: number): number {
		const cursor = this.memory.readRamRecordWord(this.controlOffset + GC_ROOT_CURSOR);
		let next = cursor & TRACE_CURSOR_MASK;
		const strings = this.cpu.stringPool;
		for (let kind = cursor >>> TRACE_CURSOR_BITS; kind < GcRootBank.End; ++kind, next = 0) {
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
		if (work < limit) work = this.traceRootBanks(limit, work);
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
				work += this.finalMarkWork(t0, t1, t2, scopedRoots);
				scopedRoots = this.remarkStage() <= RemarkStage.Weak;
			} while (this.finalMarkPending());
			return this.accountEpochWork(work);
		} finally { this.diagnostics?.endStep(); }
	}

	public stepFinalMark(): number {
		this.diagnostics?.beginStep();
		this.diagnostics?.beginAtomic();
		try { return this.accountEpochWork(this.finalMarkWork(valueNil(), valueNil(), valueNil(), false)); }
		finally { this.diagnostics?.endStep(); }
	}
	private finalMarkWork(t0: Value, t1: Value, t2: Value, scopedRoots: boolean): number {
		const limit = GC_STEP_WORDS;
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
		if (work >= limit) return work;
		if (this.remarkStage() === RemarkStage.Roots) {
			work = this.remarkRoots(valueNil(), valueNil(), valueNil(), limit, work, true);
			if (this.remarkStage() === RemarkStage.Roots || work >= limit) return work;
		}
		if (this.remarkStage() === RemarkStage.Trace) {
			this.diagnostics?.phase('traceNanoseconds');
			work = this.traceQuantum(true, limit, work);
			if (this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_RECORD) !== 0 || this.indexWord(GC_TRACE_HEAD) !== 0)
				return work;
			this.setRemarkStage(RemarkStage.ClearWeak);
			if (work >= limit) return work;
		}
		work += this.clearWeakQuantum(limit - work);
		if (this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_RECORD) !== 0 || this.indexWord(GC_WEAK_VISITS) !== 0) return work;
		this.memory.writeRamRecordByte(this.controlOffset + 1, this.white() ^ 1);
		this.memory.writeRamRecordWord(this.controlOffset + GC_SWEEP_LINK, this.controlOffset + GC_OBJECT_HEAD);
		this.setRemarkStage(RemarkStage.None);
		const occupied = this.arena.occupiedBytes();
		const estimate = this.memory.readRamRecordWord(this.controlOffset + GC_OBJECT_COUNT) + this.cpu.stringPool.estimateSweepWork();
		const runway = Math.max(this.arena.capacityBytes() - occupied, 1);
		this.memory.writeRamRecordWord(this.controlOffset + GC_SWEEP_ESTIMATE, estimate);
		this.memory.writeRamRecordWord(this.controlOffset + GC_SWEEP_RUNWAY, runway);
		this.updateSweepCredit(occupied, 0, estimate, runway);
		this.setPhase(GcPhase.Sweep);
		return work;
	}
	private clearWeakRange(table: number, mode: number, first: number, end: number): void {
		this.tables.clearWeakEntries(table, (mode & 1) !== 0, (mode & 2) !== 0, this.alive, first, end);
		this.tables.forEachStoredEntry(table, this.weakStrings, first, end);
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
				this.clearWeakRange(record, mode, next, stop);
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
			const layout = this.threadLayout;
			this.threads.readLayout(address, layout);
			const copied = this.threads.shrinkStack(address, layout);
			// Existing execution views follow raw relocation; they are never GC roots here.
			if (copied !== 0) this.cpu.rebindRelocatedThread(address);
			return 1 + 2 * ceilDiv4(copied);
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

	public assistPhysicalPressureAtTick(): void {
		const occupied = this.arena.occupiedBytes();
		const previousOccupied = this.memory.readRamRecordWord(this.controlOffset + GC_PHYSICAL_OCCUPIED_AT_TICK);
		if (occupied !== previousOccupied) this.memory.writeRamRecordWord(this.controlOffset + GC_PHYSICAL_OCCUPIED_AT_TICK, occupied);
		if (this.finalMarkPending()) return;
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
		this.step();
	}

	private updateSweepCredit(basis: number, paid: number, estimate: number, runway: number): void {
		// As on the native core, compute the next whole batch threshold
		// only when the collector changes the frontier.
		const batch = paid < estimate ? Math.min(512, estimate - paid) : 512;
		const product = (paid + batch) * runway;
		const next = toSignedWord(basis) + Math.trunc((product + estimate - 1) / estimate);
		this.memory.writeRamRecordWord(this.controlOffset + GC_SWEEP_BASIS, basis);
		this.memory.writeRamRecordWord(this.controlOffset + GC_SWEEP_PAID, paid);
		this.memory.writeRamRecordWord(this.controlOffset + GC_SWEEP_PAY_AT, Math.min(MAIN_RAM_SIZE, Math.max(0, next)));
	}

	public assistSweepBeforeReservation(requested: number): void {
		const occupiedAfterRequest = this.arena.occupiedBytes() + requested;
		const capacity = this.arena.capacityBytes();
		if (occupiedAfterRequest < this.memory.readRamRecordWord(this.controlOffset + GC_SWEEP_PAY_AT)
			&& occupiedAfterRequest < capacity) return;
		let allowance = GC_STEP_WORDS;
		if (occupiedAfterRequest < capacity) {
			const growth = occupiedAfterRequest - toSignedWord(this.memory.readRamRecordWord(this.controlOffset + GC_SWEEP_BASIS));
			const work = growth * this.memory.readRamRecordWord(this.controlOffset + GC_SWEEP_ESTIMATE);
			const paid = this.memory.readRamRecordWord(this.controlOffset + GC_SWEEP_PAID);
			const runway = this.memory.readRamRecordWord(this.controlOffset + GC_SWEEP_RUNWAY);
			allowance = Math.min(GC_STEP_WORDS, Math.trunc(work / runway) - paid);
		}
		this.step(valueNil(), valueNil(), valueNil(), 0, false, allowance);
	}

	public step(t0: Value = valueNil(), t1: Value = valueNil(), t2: Value = valueNil(), growingThread = 0, compactThreads = false,
		limit = GC_STEP_WORDS): number {
		// Explicit and space-exhausted collection can finish the final pass synchronously.
		if (this.finalMarkPending()) return this.finishFinalMark(t0, t1, t2);
		this.diagnostics?.beginStep();
		try {
			if (this.phase() < GcPhase.Sweep) return this.accountEpochWork(this.stepWork(t0, t1, t2, growingThread, compactThreads, limit));
			const occupied = this.arena.occupiedBytes();
			const work = this.stepWork(t0, t1, t2, growingThread, compactThreads, limit);
			if (this.active()) {
				const basis = this.memory.readRamRecordWord(this.controlOffset + GC_SWEEP_BASIS);
				const paid = this.memory.readRamRecordWord(this.controlOffset + GC_SWEEP_PAID);
				this.updateSweepCredit(basis + this.arena.occupiedBytes() - occupied, paid + work,
					this.memory.readRamRecordWord(this.controlOffset + GC_SWEEP_ESTIMATE),
					this.memory.readRamRecordWord(this.controlOffset + GC_SWEEP_RUNWAY));
			}
			return this.accountEpochWork(work);
		}
		finally { this.diagnostics?.endStep(); }
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
				this.memory.writeRamRecordWord(this.controlOffset + GC_ROOT_CURSOR, GcRootBank.SystemGlobals << TRACE_CURSOR_BITS);
			}
			if (this.memory.readRamRecordWord(this.controlOffset + GC_ROOT_CURSOR) !== 0) {
				work += this.cpu.stringPool.takeMarkWork();
				if (work < limit) work = this.traceRootBanks(limit, work);
			}
			this.markValue(t0); this.markValue(t1); this.markValue(t2);
			work += this.cpu.stringPool.takeMarkWork();
		}
		while (work < limit && this.active()) {
			switch (this.phase()) {
				case GcPhase.Mark:
				case GcPhase.MarkAgain:
					this.diagnostics?.phase(this.phase() === GcPhase.Mark ? 'traceNanoseconds' : 'markAgainNanoseconds');
					work = this.traceQuantum(false, limit, work);
					if (work < limit) {
						if (this.phase() === GcPhase.Mark) {
							this.setRemarkStage(RemarkStage.Threads);
							work += this.remarkVisits(limit - work);
							if (this.remarkStage() !== RemarkStage.Roots) return work;
							work = this.remarkRoots(t0, t1, t2, limit, work, false);
							if (this.phase() === GcPhase.Mark) return work;
						} else {
							this.setPhase(GcPhase.Atomic);
							return work;
						}
					}
					break;
				case GcPhase.Atomic: return work;
				case GcPhase.Sweep:
					this.diagnostics?.phase('sweepNanoseconds');
					work += this.sweepObjects(limit - work, growingThread, compactThreads);
					if (work < limit && this.memory.readRamRecordWord(this.controlOffset + GC_SWEEP_LINK) === 0) {
						this.memory.writeRamRecordWord(this.changedHeadOffset(), 0);
						this.setPhase(GcPhase.Strings);
						this.cpu.stringPool.beginSweep();
					}
					break;
				case GcPhase.Strings:
					this.diagnostics?.phase('stringReclaimNanoseconds');
					work += this.cpu.stringPool.sweepStep(limit - work);
					if (!this.cpu.stringPool.sweeping()) {
						this.setPhase(GcPhase.Pause); this.budget.finishCollection();
					}
					return work;
			}
		}
		return work;
	}
	/** The owner retries its actual request after each recovered epoch. */
	public recoverAllocation(next: LuaAllocationRecovery, t0 = valueNil(), t1 = valueNil(),
		t2 = valueNil(), growingThread = 0): LuaAllocationRecovery {
		if (next === LuaAllocationRecovery.Exhausted) throw LUA_OUT_OF_MEMORY_SIGNAL;
		const first = next === LuaAllocationRecovery.CurrentOrFresh;
		const continueCurrent = first && this.active();
		if (first && this.diagnostics !== null) ++this.diagnostics.fullCollections;
		// Recovery finishes just this epoch, without allocating to shrink live stacks.
		do { this.step(t0, t1, t2, growingThread); } while (this.active());
		return continueCurrent ? LuaAllocationRecovery.Fresh : LuaAllocationRecovery.Exhausted;
	}

	public collect(t0: Value = valueNil(), t1: Value = valueNil(), t2: Value = valueNil(), growingThread = 0): number {
		if (this.diagnostics !== null) ++this.diagnostics.fullCollections;
		let work = 0;
		while (this.active()) work += this.step(t0, t1, t2, growingThread, true);
		do { work += this.step(t0, t1, t2, growingThread, true); } while (this.active());
		return work;
	}
}
