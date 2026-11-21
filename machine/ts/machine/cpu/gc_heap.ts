import { HEAP_PAGE_SIZE, MAIN_RAM_SIZE, RAM_BASE } from '../../spec/bmsx/memory_map';
import type { CPU } from './cpu';
import type { Memory } from '../memory/memory';
import { HEAP_GC_CONTROL_OFFSET, HeapGcPages, heapClassIndex, type HeapAllocator } from './heap_allocator';
import { GC_GRAY_INDEX_BITS, GC_GRAY_INDEX_MASK, GC_COLOR_OFFSET, GC_COLOR_MASK, GC_OLD, GC_REMEMBERED, GC_RECORD_LINK, GC_RECORD_SHIFT } from './gc_object';
import * as Closure from './closure';
import { UPVALUE_HEAP_BYTES, UPVALUE_ADDRESS_MASK, UPVALUE_NEXT, UPVALUE_OWNER, UPVALUE_RECORD_KIND, UPVALUE_VALUE_WORD } from './upvalue';
import * as Upvalue from './upvalue';
import { TableRecords, type TableStringProbe } from './table';
import { THREAD_HEAP_BYTES, THREAD_RECORD_KIND, THREAD_STACK_SLOT_BYTES, ThreadField, ThreadLayout, ThreadRecords, allocatedThreadBackingBytes } from './thread_record';
import { FRAME_CONTROL_BYTES, FRAME_WINDOW_MASK, FrameField, PROTECTED_CALL_BYTES, PROTECTED_CALL_HANDLER_BUILTIN, PROTECTED_CALL_KIND_MASK, ProtectedCallKind, ProtectedField } from './call_state';
import { ValueTag, valueTag, valueTagHasGcEdge, valuePayload, valueNil, valueFromTag, type Value } from './value';
import { ValueSlots } from './value_slots';
import type { LuaHeap } from './lua_heap';
import { ceilDiv4 } from '../common/numeric';
import type { GcDiagnostics } from './gc_diagnostics';
import { BLUA32_STRING_RECORD_KIND } from '../../spec/blua32/image_format';

const GC_RECORD_ALIGNMENT = 1 << GC_RECORD_SHIFT;
const GC_RECORD_MASK = MAIN_RAM_SIZE - GC_RECORD_ALIGNMENT;
const TABLE_SIZE_CLASS = heapClassIndex(TableRecords.HEADER_BYTES);
const CELL_SIZE_CLASS = heapClassIndex(UPVALUE_HEAP_BYTES);
const THREAD_SIZE_CLASS = heapClassIndex(THREAD_HEAP_BYTES);
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
export const GC_ROOT_CURSOR = GC_TRACE_CURSOR + 4;
export const GC_THREAD_TRACE_OPEN = GC_ROOT_CURSOR + 4;
const GC_THREAD_TRACE_TOP = GC_THREAD_TRACE_OPEN + 4;
const GC_THREAD_TRACE_BILLED = GC_THREAD_TRACE_TOP + 4;
// Remark revisits the weak list without consuming its head.
export const GC_REMARK_VISIT_INDEX = GC_THREAD_TRACE_BILLED + 4;
export const GC_REMARK_VISIT_STATE = GC_REMARK_VISIT_INDEX + 4;
export const GC_MODE_META = GC_REMARK_VISIT_STATE + 4;
export const GC_MODE_NODE = GC_MODE_META + 4;
const GC_MODE_REMAINING = GC_MODE_NODE + 4;
// Capture lanes use four bytes each and Table entries require a separate tag.
const TRACE_CURSOR_BITS = GC_GRAY_INDEX_BITS + 1;
const TRACE_CURSOR_MASK = (1 << TRACE_CURSOR_BITS) - 1;
const TABLE_MODE_PENDING = 4 << TRACE_CURSOR_BITS;
const enum ThreadTraceStage { Frames, Protected, Values, Clear, Padding }
const enum RemarkStage { None, Threads, Weak, Roots, Trace, ClearWeak }
const THREAD_TRACE_OPEN_HEAD = 1; // An open cell's address is aligned.
export const GC_VISIT_HEADER_BYTE = 3;
export const GC_VISIT_MEMBER = 0x40;
const VISIT_LINK_LOW_BITS = 32 - GC_GRAY_INDEX_BITS;
const VISIT_LINK_HIGH_MASK = GC_GRAY_INDEX_MASK >>> VISIT_LINK_LOW_BITS;
export const GC_STEP_WORDS = 4096;
export const GC_ASSIST_BYTES = 256;
export const enum GcPhase { Pause, Mark, MarkAgain, Atomic, Sweep, Strings }
export const enum GcRootBank { None, SystemGlobals, Globals, SystemConstants, Cart0Constants, Cart1Constants, End }
// Two unconnected selector inputs do not clock the collector.
const GC_PHASE_SELECTOR = [GcPhase.Pause, GcPhase.Mark, GcPhase.MarkAgain, GcPhase.Atomic,
	GcPhase.Sweep, GcPhase.Strings, GcPhase.Pause, GcPhase.Pause];
export class GcHeap {
	public diagnostics: GcDiagnostics | null = null;
	// An inspector may end the lifetimes it observed; allocation never
	// creates host identities. A replacement invalidates the whole view.
	public onRecordRetirement: ((address: number | null) => void) | null = null;
	private readonly controlOffset: number;
	public phase(): GcPhase {
		return GC_PHASE_SELECTOR[this.memory.readRamRecordByte(this.controlOffset) & 7];
	}
	public white(): number { return this.memory.readRamRecordByte(this.controlOffset + 1) & 1; }
	private setPhase(phase: GcPhase): void { this.memory.writeRamRecordByte(this.controlOffset, phase); }
	private readonly scratch = new ValueSlots(1);
	private minor = false; // Only physical state crosses a grant.
	private readonly modeProbe: TableStringProbe = { node: -1, remaining: 0, value: valueNil() };
	private modeProbeWork = 0;
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
	public tableRecordAddress(address: number): number {
		const offset = address & (MAIN_RAM_SIZE - TableRecords.HEADER_BYTES);
		return this.arena.issuedObjectSlotClass(offset) === TABLE_SIZE_CLASS
			&& this.memory.readRamRecordByte(offset) === ValueTag.Table ? RAM_BASE + offset : 0;
	}
	public cellRecordAddress(address: number): number {
		const offset = address & UPVALUE_ADDRESS_MASK;
		return this.arena.issuedObjectSlotClass(offset) === CELL_SIZE_CLASS
			&& this.memory.readRamRecordByte(offset) === UPVALUE_RECORD_KIND ? RAM_BASE + offset : 0;
	}
	public closureRecordAddress(address: number): number {
		const offset = address & GC_RECORD_MASK;
		return offset < this.arena.managementOffset() && this.memory.readRamRecordByte(offset) === ValueTag.Closure && this.arena.issuedObjectStart(offset) ? RAM_BASE + offset : 0;
	}
	public openCellAddress(address: number): number {
		const cell = this.cellRecordAddress(address);
		return cell !== 0 && Upvalue.isOpen(this.memory, cell) ? cell : 0;
	}
	public threadRecordAddress(address: number): number {
		const offset = address & GC_RECORD_MASK;
		return (offset & (HEAP_PAGE_SIZE - 1)) % THREAD_HEAP_BYTES === 0 && this.arena.issuedObjectSlotClass(offset) === THREAD_SIZE_CLASS
			&& this.memory.readRamRecordByte(offset) === THREAD_RECORD_KIND ? RAM_BASE + offset : 0;
	}
	public active(): boolean { return this.phase() !== GcPhase.Pause; }
	public finalMarkPending(): boolean { return this.phase() === GcPhase.Atomic; }
	public isAlive(address: number): boolean { return address !== 0 && !this.unmarked(this.memory.readRamRecordByte(address + GC_COLOR_OFFSET)); }
	private markColor(address: number): number { return this.memory.readRamRecordByte(address + GC_COLOR_OFFSET) & GC_COLOR_MASK; }
	private unmarked(flags: number): boolean { return (flags & (GC_COLOR_MASK | (this.minor ? GC_OLD : 0))) === this.white(); }
	private setColor(address: number, color: number): void {
		const lane = address + GC_COLOR_OFFSET;
		this.memory.writeRamRecordByte(lane, (this.memory.readRamRecordByte(lane) & ~GC_COLOR_MASK) | color);
	}
	public markString(id: number): void { this.cpu.stringPool.markReachable(id, this.minor); }
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
	public writeValueBarrier(address: number, link: number, tag: ValueTag): void {
		if (valueTagHasGcEdge(tag)) this.writeBarrier(address, link);
	}
	public writeBarrier(address: number, link: number): void {
		let flags = this.memory.readRamRecordByte(address + GC_COLOR_OFFSET);
		if ((flags & (GC_OLD | GC_REMEMBERED)) === GC_OLD) {
			this.arena.trackGcPage(HeapGcPages.Remembered, address);
			flags |= GC_REMEMBERED;
			this.memory.writeRamRecordByte(address + GC_COLOR_OFFSET, flags);
		}
		if ((flags & GC_COLOR_MASK) === 3) this.enqueue(address, link, GC_CHANGED_HEAD);
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
		visitor: (address: number) => number, allowance = Infinity, stage = RemarkStage.None): number {
		const resumeWeak = stage === RemarkStage.Weak;
		let index = this.indexWord(resumeWeak ? GC_REMARK_VISIT_INDEX : list);
		let remaining = this.indexWord(resumeWeak ? GC_REMARK_VISIT_STATE : list + GC_VISIT_COUNT);
		let work = 0, visits = 0;
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
			work += visitor(address);
		}
		if (index === 0 || remaining === 0) index = remaining = 0;
		if (drain) {
			if (index === 0) this.memory.writeRamRecordPair(this.controlOffset + list, 0, 0);
			else this.memory.writeRamRecordWord(this.controlOffset + list, index);
			this.memory.writeRamRecordWord(this.controlOffset + list + GC_VISIT_COUNT, remaining);
		} else if (resumeWeak) {
			this.memory.writeRamRecordPair(this.controlOffset + GC_REMARK_VISIT_INDEX, index, (stage << GC_GRAY_INDEX_BITS) | remaining);
		}
		return stage === RemarkStage.None ? work : visits;
	}
	private readonly remarkRecord = (address: number): number => {
		if (this.markColor(address) === 3) this.enqueue(address, GC_RECORD_LINK, GC_CHANGED_HEAD);
		return 0;
	};
	private readonly visitWeakEntries = (table: number): number => {
		this.clearWeakRange(table, this.tableMode(table), 0, this.tables.storedSlotCount(table));
		return this.tables.scanSlots(table);
	};
	private readonly startWeakClear = (table: number): number => {
		this.memory.writeRamRecordPair(this.controlOffset + GC_TRACE_RECORD, table, TABLE_MODE_PENDING);
		return 0;
	};
	public markThread(address: number): boolean {
		const offset = address & GC_RECORD_MASK;
		if (offset >= this.arena.managementOffset() || (offset & (HEAP_PAGE_SIZE - 1)) % THREAD_HEAP_BYTES !== 0) return false;
		const header = this.memory.readRamRecordWord(offset);
		if ((header & 0xff) !== THREAD_RECORD_KIND || !this.unmarked(header >>> 8)
			|| this.arena.issuedObjectSlotClass(offset) !== THREAD_SIZE_CLASS) return false;
		this.enqueue(RAM_BASE + offset, GC_RECORD_LINK, GC_TRACE_HEAD);
		return true;
	}
	private markTable(address: number): boolean {
		const record = this.tableRecordAddress(address);
		if (record === 0 || !this.unmarked(this.memory.readRamRecordByte(record + GC_COLOR_OFFSET))) return false;
		this.enqueue(record, GC_RECORD_LINK, GC_TRACE_HEAD);
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
		const offset = address & GC_RECORD_MASK;
		if (offset >= this.arena.managementOffset()) return false;
		const header = this.memory.readRamRecordWord(offset);
		if ((header & 0xff) !== ValueTag.Closure || !this.unmarked(header >>> 8) || !this.arena.issuedObjectStart(offset)) return false;
		this.enqueue(RAM_BASE + offset, GC_RECORD_LINK, GC_TRACE_HEAD);
		return true;
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
	private tableMode(table: number): number {
		const meta = this.tables.metatableAddress(table);
		if (meta === 0) return 0;
		const record = this.tableRecordAddress(meta);
		if (record === 0) return 0;
		this.tables.loadStringKey(record, this.modeKey, this.scratch, 0);
		const mode = this.scratch.get(0);
		this.scratch.setNil(0);
		return this.weakModeBits(mode);
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
			this.modeProbeWork += this.tables.advanceStringProbe(address, this.modeKey, probe, limit);
			if (probe.node >= 0 && probe.remaining !== 0) {
				this.memory.writeRamRecordPair(this.controlOffset + GC_MODE_META, address, probe.node);
				this.memory.writeRamRecordWord(this.controlOffset + GC_MODE_REMAINING, probe.remaining);
				return -1;
			}
		}
		if (current !== 0) {
			this.memory.writeRamRecordPair(this.controlOffset + GC_MODE_META, 0, 0);
			this.memory.writeRamRecordWord(this.controlOffset + GC_MODE_REMAINING, 0);
		}
		return address === 0 ? 0 : this.weakModeBits(probe.value);
	}
	private trace(atomic: boolean, limit = 0x7fffffff): number {
		const index = this.indexWord(GC_TRACE_HEAD), offset = index << GC_RECORD_SHIFT, address = RAM_BASE + offset;
		const kind = offset < this.arena.managementOffset() ? this.memory.readRamRecordByte(address) : 0;
		const slotClass = kind === ValueTag.Table || kind === UPVALUE_RECORD_KIND || kind === THREAD_RECORD_KIND
			? this.arena.issuedObjectSlotClass(offset) : 0xff;
		const table = kind === ValueTag.Table && slotClass === TABLE_SIZE_CLASS && (offset & (TableRecords.HEADER_BYTES - 1)) === 0;
		const cell = kind === UPVALUE_RECORD_KIND && slotClass === CELL_SIZE_CLASS && (offset & (UPVALUE_HEAP_BYTES - 1)) === 0 && !Upvalue.isOpen(this.memory, address);
		const closure = kind === ValueTag.Closure && this.arena.issuedObjectStart(offset);
		const thread = kind === THREAD_RECORD_KIND && slotClass === THREAD_SIZE_CLASS && (offset & (HEAP_PAGE_SIZE - 1)) % THREAD_HEAP_BYTES === 0;
		// Only a queued color clocks the link, even for malformed cycles.
		if ((!table && !cell && !closure && !thread) || this.markColor(address) !== 2) {
			this.memory.writeRamRecordWord(this.controlOffset + GC_TRACE_HEAD, 0);
			return 0;
		}
		const link = address + (cell ? UPVALUE_NEXT : GC_RECORD_LINK);
		const packed = this.memory.readRamRecordWord(link);
		this.memory.writeRamRecordWord(this.controlOffset + GC_TRACE_HEAD, packed & GC_GRAY_INDEX_MASK);
		this.memory.writeRamRecordWord(link, cell ? 0 : packed & ~GC_GRAY_INDEX_MASK);
		const flags = this.memory.readRamRecordByte(address + GC_COLOR_OFFSET);
		if (this.minor && (flags & GC_OLD) !== 0) this.memory.writeRamRecordByte(address + GC_COLOR_OFFSET, GC_OLD | this.white());
		else this.setColor(address, 3);
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
		return this.traceThread(address, atomic, limit, 0, THREAD_TRACE_OPEN_HEAD, 0, 0);
	}
	private traceThread(address: number, atomic: boolean, limit: number, cursor: number, open: number,
		captureTop: number, billed: number): number {
		const resumed = billed !== 0, layout = this.threadLayout;
		const memory = this.memory, strings = this.cpu.stringPool;
		let work = 0;
		if (!resumed) {
			if (!atomic) this.appendVisit(GC_THREAD_VISITS, address);
			this.markThread(memory.readRamRecordWord(address + ThreadField.Resumer));
			this.markClosure(memory.readRamRecordWord(address + ThreadField.Entry));
			this.markValue(valueFromTag(memory.readRamRecordByte(address + ThreadField.ErrorKind), memory.readRamRecordWord(address + ThreadField.ErrorWord)));
			billed = THREAD_HEAP_BYTES >>> 2;
			work = billed + strings.takeMarkWork();
		}
		this.threads.readLayout(address, layout);
		let stage = cursor >>> TRACE_CURSOR_BITS, next = cursor & TRACE_CURSOR_MASK;
		// Only the logical indices survive this call; storage may grow while
		// another CPU grant owns the Thread.
		if (stage === ThreadTraceStage.Frames) {
			while (next < layout.depth && work < limit) {
				if (open === THREAD_TRACE_OPEN_HEAD) {
					const frame = this.threads.frameAddress(layout, next);
					this.markClosure(memory.readRamRecordWord(frame + FrameField.Closure));
					open = memory.readRamRecordWord(frame + FrameField.OpenHead);
					billed += FRAME_CONTROL_BYTES >>> 2; work += FRAME_CONTROL_BYTES >>> 2;
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
				billed += PROTECTED_CALL_BYTES >>> 2; work += PROTECTED_CALL_BYTES >>> 2;
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
				billed += words; work += words + strings.takeMarkWork();
			}
			if (next >= liveTop) {
				stage = atomic ? ThreadTraceStage.Clear : ThreadTraceStage.Padding; next = liveTop;
			}
		}
		if (stage === ThreadTraceStage.Clear) {
			while (next < layout.capacity && work < limit) {
				const stop = Math.min(layout.capacity, next + Math.max(1, ((limit - work) / 2) | 0));
				this.threads.clearStackRange(layout, next, stop);
				const words = ceilDiv4(stop * THREAD_STACK_SLOT_BYTES) - ceilDiv4(next * THREAD_STACK_SLOT_BYTES);
				billed += words; work += words;
				next = stop;
			}
			if (next >= layout.capacity) stage = ThreadTraceStage.Padding;
		}
		if (stage === ThreadTraceStage.Padding) {
			const total = ceilDiv4(THREAD_HEAP_BYTES + allocatedThreadBackingBytes(layout.capacity, layout.frames, layout.continuations));
			if (work < limit) {
				const words = Math.min(total - billed, limit - work);
				billed += words; work += words;
			}
			if (billed === total) {
				if (resumed) {
					memory.writeRamRecordPair(this.controlOffset + GC_TRACE_RECORD, 0, 0);
					memory.writeRamRecordWord(this.controlOffset + GC_THREAD_TRACE_OPEN, 0);
					memory.writeRamRecordPair(this.controlOffset + GC_THREAD_TRACE_TOP, 0, 0);
				}
				return work;
			}
		}
		memory.writeRamRecordPair(this.controlOffset + GC_TRACE_RECORD, address, (stage << TRACE_CURSOR_BITS) | next);
		memory.writeRamRecordWord(this.controlOffset + GC_THREAD_TRACE_OPEN, open);
		memory.writeRamRecordPair(this.controlOffset + GC_THREAD_TRACE_TOP, captureTop, billed);
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
				this.memory.readRamRecordWord(this.controlOffset + GC_THREAD_TRACE_TOP),
				this.memory.readRamRecordWord(this.controlOffset + GC_THREAD_TRACE_BILLED));
			default: return this.traceCaptures(record, cursor, Closure.captureCount(this.memory, record), 0, limit);
		}
	}
	private traceQuantum(atomic: boolean, limit: number, work: number): number {
		this.modeProbeWork = 0;
		const record = this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_RECORD);
		if (record !== 0) {
			work += this.resumeTrace(record, atomic, limit - work);
			if (this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_RECORD) !== 0) return work;
		}
		while (this.indexWord(GC_TRACE_HEAD) !== 0 && work + this.modeProbeWork < limit)
			work += this.trace(atomic, limit - work - this.modeProbeWork) + this.cpu.stringPool.takeMarkWork();
		return work;
	}
	private traceTable(address: number, limit: number, resumingMode = false): number {
		const meta = this.tables.metatableAddress(address);
		if (meta !== 0 && !resumingMode) this.markTable(meta);
		const words = resumingMode ? 0 : TableRecords.HEADER_BYTES >>> 2;
		let mode = 0;
		if (this.minor) mode = this.tableMode(address);
		else if (meta !== 0 || resumingMode) {
			const before = this.modeProbeWork;
			mode = this.probeTableMode(address, Math.max(0, limit - words));
			limit -= this.modeProbeWork - before;
		}
		if (mode < 0) {
			this.memory.writeRamRecordPair(this.controlOffset + GC_TRACE_RECORD, address, TABLE_MODE_PENDING);
			return words;
		}
		if (mode !== 0) this.appendVisit(GC_WEAK_VISITS, address);
		const slots = this.tables.scanSlots(address);
		if (resumingMode || words + slots * 2 > limit) return this.traceTableEntries(address, mode, 0, words, limit);
		this.traceTableEdges(address, mode);
		return words + slots;
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
		const scan = mode !== 3, strings = this.cpu.stringPool;
		while (next < end && work < limit) {
			const arrayEntry = next < array, entryWords = arrayEntry ? 1 : 2;
			const worst = entryWords * (scan ? 2 : 1);
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
	private traceRootBanks(limit: number): number {
		const cursor = this.memory.readRamRecordWord(this.controlOffset + GC_ROOT_CURSOR);
		let work = 0, next = cursor & TRACE_CURSOR_MASK;
		const strings = this.cpu.stringPool;
		for (let kind = cursor >>> TRACE_CURSOR_BITS; kind < GcRootBank.End; ++kind, next = 0) {
			const end = this.cpu.rootBankSlots(kind);
			const globals = kind < GcRootBank.SystemConstants;
			const words = globals ? 3 : 2, worst = words + (globals ? 2 : 1);
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
			this.memory.writeRamRecordWord(this.controlOffset + GC_ROOT_CURSOR, GcRootBank.SystemGlobals << TRACE_CURSOR_BITS);
		}
		return visits;
	}
	private remarkRoots(t0: Value, t1: Value, t2: Value, allowance: number, final: boolean): number {
		this.diagnostics?.phase('rootsNanoseconds');
		this.markValue(t0); this.markValue(t1); this.markValue(t2);
		this.cpu.stringPool.markLocalRoots();
		let work = this.cpu.stringPool.takeMarkWork();
		if (work < allowance) work += this.traceRootBanks(allowance - work);
		if (this.memory.readRamRecordWord(this.controlOffset + GC_ROOT_CURSOR) === 0) {
			this.setRemarkStage(final ? RemarkStage.Trace : RemarkStage.None);
			if (!final) this.setPhase(GcPhase.MarkAgain);
		}
		return work;
	}
	/** Only the stopped mutator may advance the final pass. */
	public finishFinalMark(t0: Value = valueNil(), t1: Value = valueNil(), t2: Value = valueNil()): number {
		let work = 0;
		while (this.finalMarkPending()) work += this.stepFinalMark(t0, t1, t2);
		return work;
	}

	public stepFinalMark(t0: Value = valueNil(), t1: Value = valueNil(), t2: Value = valueNil()): number {
		this.diagnostics?.beginAtomic();
		let limit = GC_STEP_WORDS, work = 0;
		if (this.remarkStage() === RemarkStage.None) this.setRemarkStage(RemarkStage.Threads);
		if (this.remarkStage() <= RemarkStage.Weak) {
			limit -= this.remarkVisits(limit);
			if (this.remarkStage() !== RemarkStage.Roots) return 0;
		}
		if (this.remarkStage() === RemarkStage.Roots) {
			work += this.remarkRoots(t0, t1, t2, limit, true);
			if (this.remarkStage() === RemarkStage.Roots || work >= limit) return work;
		}
		if (this.remarkStage() === RemarkStage.Trace) {
			this.diagnostics?.phase('traceNanoseconds');
			work = this.traceQuantum(true, limit, work);
			limit -= this.modeProbeWork;
			if (this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_RECORD) !== 0 || this.indexWord(GC_TRACE_HEAD) !== 0)
				return work;
			this.setRemarkStage(RemarkStage.ClearWeak);
			if (work >= limit) return work;
		}
		work += this.clearWeakQuantum(limit - work);
		if (this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_RECORD) !== 0 || this.indexWord(GC_WEAK_VISITS) !== 0) return work;
		this.memory.writeRamRecordByte(this.controlOffset + 1, this.white() ^ 1);
		this.arena.beginObjectSweep();
		this.setRemarkStage(RemarkStage.None);
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
		this.modeProbeWork = 0;
		while (work < limit) {
			let record = this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_RECORD);
			if (record === 0) {
				if (this.indexWord(GC_WEAK_VISITS) === 0) break;
				this.visitList(GC_WEAK_VISITS, ValueTag.Table, true, this.startWeakClear, 1);
				record = this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_RECORD);
				--limit; // Empty weak tables still consume a physical visit.
				if (record === 0 || work === limit) break;
			}
			let cursor = this.memory.readRamRecordWord(this.controlOffset + GC_TRACE_CURSOR);
			if (cursor === TABLE_MODE_PENDING) {
				const mode = this.probeTableMode(record, limit - work);
				limit -= this.modeProbeWork; this.modeProbeWork = 0;
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

	private resolveWeak(): number {
		let work = 0;
		while (this.indexWord(GC_TRACE_HEAD) !== 0) work += this.trace(true) + this.cpu.stringPool.takeMarkWork();
		this.diagnostics?.phase('weakNanoseconds');
		work += this.visitList(GC_WEAK_VISITS, ValueTag.Table, true, this.visitWeakEntries);
		return work + this.cpu.stringPool.takeMarkWork();
	}

	private readonly seedRemembered = (address: number): number => {
		const header = this.memory.readRamRecordWord(address), kind = header & 0xff;
		if ((header & (GC_REMEMBERED << 8)) !== 0) {
			if (kind === ValueTag.Table) this.enqueue(address, GC_RECORD_LINK, GC_TRACE_HEAD);
			else if (kind === UPVALUE_RECORD_KIND && !Upvalue.isOpen(this.memory, address))
				this.enqueue(address, UPVALUE_NEXT, GC_TRACE_HEAD);
		}
		return 1;
	};
	private readonly seedThread = (address: number): number => {
		const header = this.memory.readRamRecordWord(address);
		if ((header & (0xff | (GC_OLD << 8))) === (THREAD_RECORD_KIND | (GC_OLD << 8)))
			this.enqueue(address, GC_RECORD_LINK, GC_TRACE_HEAD);
		return 1;
	};
	private readonly sweepYoung = (address: number): number => this.sweepRecord(0, address);

	public collectYoung(t0: Value, t1: Value, t2: Value): number {
		this.diagnostics?.beginStep(true);
		if (this.diagnostics !== null) ++this.diagnostics.collections;
		this.diagnostics?.phase('rootsNanoseconds');
		this.minor = true;
		this.markString(this.modeKey);
		this.cpu.markHeapRoots(this);
		this.markValue(t0); this.markValue(t1); this.markValue(t2);
		this.cpu.stringPool.markLocalRoots(true);
		let work = this.cpu.collectionRootWordCount() + this.cpu.stringPool.takeMarkWork();
		work += this.arena.visitGcPages(HeapGcPages.Remembered, this.seedRemembered);
		work += this.arena.visitGcPages(HeapGcPages.Threads, this.seedThread);
		this.diagnostics?.phase('traceNanoseconds');
		work += this.resolveWeak();
		this.diagnostics?.phase('sweepNanoseconds');
		work += this.arena.visitGcPages(HeapGcPages.Young, this.sweepYoung);
		this.arena.clearGcPages(HeapGcPages.Young);
		this.arena.clearGcPages(HeapGcPages.Remembered);
		this.minor = false;
		this.diagnostics?.endStep();
		return work;
	}
	private readonly sweepRecord = (growingThread: number, address: number, compactThreads = false): number => {
		const white = this.white();
		const header = this.memory.readRamRecordWord(address), kind = header & 0xff, flags = (header >>> 8) & 0xff;
		if (this.minor && kind === BLUA32_STRING_RECORD_KIND) return 1 + this.cpu.stringPool.sweepYoungBucket(address);
		if (this.minor && (flags & GC_OLD) !== 0) return 1;
		const garbage = (flags & GC_COLOR_MASK) === (white ^ (this.minor ? 0 : 1));
		const survivor = white | (this.minor ? GC_OLD : flags & ~GC_COLOR_MASK);
		if (kind === ValueTag.Table || kind === UPVALUE_RECORD_KIND || kind === ValueTag.Closure) {
			if (garbage) {
				if (kind === ValueTag.Table) {
					this.tables.freeRecord(address);
					this.onRecordRetirement?.(address);
				} else {
				if (kind === ValueTag.Closure) this.cpu.retireStaticClosure(address);
					const bytes = kind === UPVALUE_RECORD_KIND ? UPVALUE_HEAP_BYTES
						: Closure.closureRecordBytes(Closure.captureCount(this.memory, address),
							(header & (Closure.CLOSURE_LATCHED_PROTOTYPE << (8 * Closure.CLOSURE_BINDING_FLAGS))) !== 0);
					this.budget.releaseRecord(address, bytes);
					if (kind === ValueTag.Closure) this.onRecordRetirement?.(address);
				}
				return -1;
			}
			this.memory.writeRamRecordByte(address + GC_COLOR_OFFSET, survivor);
			return 1;
		}
		if (kind !== THREAD_RECORD_KIND || this.threadRecordAddress(address) !== address) return 1;
		const layout = this.threadLayout;
		this.threads.readLayout(address, layout);
		const work = ceilDiv4(THREAD_HEAP_BYTES + allocatedThreadBackingBytes(layout.capacity, layout.frames, layout.continuations));
		if (!garbage) {
			this.memory.writeRamRecordByte(address + GC_COLOR_OFFSET, survivor);
			const copied = compactThreads && address !== growingThread ? this.threads.shrinkStack(address, layout) : 0;
			// Existing execution views follow raw relocation; they are never GC roots here.
			if (copied !== 0) this.cpu.rebindRelocatedThread(address);
			return work + 2 * ceilDiv4(copied);
		}
		this.cpu.retireThreadView(address);
		this.budget.releaseRecord(layout.block, layout.capacity * THREAD_STACK_SLOT_BYTES);
		this.budget.releaseRecord(layout.frameBlock, layout.frames * FRAME_CONTROL_BYTES);
		if (layout.protectedBlock !== 0) this.budget.releaseRecord(layout.protectedBlock, layout.continuations * PROTECTED_CALL_BYTES);
		this.budget.releaseRecord(address, THREAD_HEAP_BYTES);
		this.onRecordRetirement?.(address);
		return -work;
	};
	private readonly sweepAndCompact = (growingThread: number, address: number): number => this.sweepRecord(growingThread, address, true);
	public step(t0: Value = valueNil(), t1: Value = valueNil(), t2: Value = valueNil(), growingThread = 0, compactThreads = false): number {
		this.diagnostics?.beginStep();
		try { return this.stepWork(t0, t1, t2, growingThread, compactThreads); }
		finally { this.diagnostics?.endStep(); }
	}
	private stepWork(t0: Value, t1: Value, t2: Value, growingThread: number, compactThreads: boolean): number {
		let work = 0, limit = GC_STEP_WORDS;
		if (this.phase() !== GcPhase.Atomic && this.remarkStage() !== RemarkStage.None) {
			limit -= this.remarkVisits(limit);
			if (this.remarkStage() !== RemarkStage.Roots) return 0;
			work += this.remarkRoots(t0, t1, t2, limit, false);
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
				if (work < limit) work += this.traceRootBanks(limit - work);
			}
			this.markValue(t0); this.markValue(t1); this.markValue(t2);
			this.cpu.stringPool.markLocalRoots();
			work += this.cpu.stringPool.takeMarkWork();
		}
		while (work < limit && this.active()) {
			switch (this.phase()) {
				case GcPhase.Mark:
				case GcPhase.MarkAgain:
					this.diagnostics?.phase(this.phase() === GcPhase.Mark ? 'traceNanoseconds' : 'markAgainNanoseconds');
					work = this.traceQuantum(false, limit, work);
					limit -= this.modeProbeWork;
					if (work < limit) {
						if (this.phase() === GcPhase.Mark) {
							this.setRemarkStage(RemarkStage.Threads);
							limit -= this.remarkVisits(limit - work);
							if (this.remarkStage() !== RemarkStage.Roots) return work;
							work += this.remarkRoots(t0, t1, t2, limit - work, false);
							if (this.phase() === GcPhase.Mark) return work;
						} else {
							this.setPhase(GcPhase.Atomic);
							return work;
						}
					}
					break;
				case GcPhase.Atomic:
					// Explicit and space-exhausted collection stay synchronous.
					return work + this.finishFinalMark(t0, t1, t2);
				case GcPhase.Sweep:
					this.diagnostics?.phase('sweepNanoseconds');
					work += this.arena.sweepObjects(GC_STEP_WORDS - work, growingThread,
						compactThreads ? this.sweepAndCompact : this.sweepRecord);
					if (work < GC_STEP_WORDS && !this.arena.objectSweepActive()) { this.memory.writeRamRecordWord(this.changedHeadOffset(), 0); this.setPhase(GcPhase.Strings); this.cpu.stringPool.beginSweep(); }
					break;
				case GcPhase.Strings:
					this.diagnostics?.phase('stringReclaimNanoseconds');
					work += this.cpu.stringPool.sweepStep(GC_STEP_WORDS - work);
					if (!this.cpu.stringPool.sweeping()) {
						this.setPhase(GcPhase.Pause); this.budget.finishCollection();
					}
					return work;
			}
		}
		return work;
	}
	public collect(t0: Value = valueNil(), t1: Value = valueNil(), t2: Value = valueNil(), growingThread = 0): number {
		if (this.diagnostics !== null) ++this.diagnostics.fullCollections;
		let work = 0;
		while (this.active()) work += this.step(t0, t1, t2, growingThread, true);
		do { work += this.step(t0, t1, t2, growingThread, true); } while (this.active());
		return work;
	}
}
