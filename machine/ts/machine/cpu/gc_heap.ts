import { HEAP_PAGE_SIZE, MAIN_RAM_SIZE, RAM_BASE } from '../../spec/bmsx/memory_map';
import type { CPU } from './cpu';
import type { Memory } from '../memory/memory';
import { HEAP_GC_CONTROL_OFFSET, HeapGcPages, heapClassIndex, type HeapAllocator } from './heap_allocator';
import { GC_GRAY_INDEX_BITS, GC_GRAY_INDEX_MASK, GC_COLOR_OFFSET, GC_COLOR_MASK, GC_OLD, GC_REMEMBERED, GC_RECORD_LINK, GC_RECORD_SHIFT } from './gc_object';
import * as Closure from './closure';
import { UPVALUE_HEAP_BYTES, UPVALUE_ADDRESS_MASK, UPVALUE_CHAIN_LIMIT, UPVALUE_NEXT, UPVALUE_OWNER, UPVALUE_RECORD_KIND, UPVALUE_VALUE_WORD } from './upvalue';
import * as Upvalue from './upvalue';
import { TableRecords } from './table';
import { THREAD_HEAP_BYTES, THREAD_RECORD_KIND } from './thread_record';
import { ThreadField, ThreadLayout, ThreadRecords, allocatedThreadBackingBytes } from './thread_record';
import { FRAME_WINDOW_MASK, FrameField, PROTECTED_CALL_BYTES, PROTECTED_CALL_HANDLER_BUILTIN, PROTECTED_CALL_KIND_MASK, ProtectedCallKind, ProtectedField } from './call_state';
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
export const GC_VISIT_HEADER_BYTE = 3;
export const GC_VISIT_MEMBER = 0x40;
const VISIT_LINK_LOW_BITS = 32 - GC_GRAY_INDEX_BITS;
const VISIT_LINK_HIGH_MASK = GC_GRAY_INDEX_MASK >>> VISIT_LINK_LOW_BITS;
export const GC_STEP_WORDS = 4096;
export const GC_ASSIST_BYTES = 256;
export const enum GcPhase { Pause, Mark, MarkAgain, Atomic, Sweep, Strings }
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
	private mode = 0;
	private minor = false; // Only physical state crosses a grant.
	private changed = false;
	private readonly traceEntry = (key: Value, value: Value): void => {
		this.markValue(key);
		if (this.mode === 0) this.markValue(value);
	};
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
	private readonly ephemeronEntry = (key: Value, value: Value): void => {
		if (this.alive(key) && this.markValue(value)) this.changed = true;
	};
	private readonly weakStrings = (key: Value, value: Value): void => {
		if (valueTag(key) === ValueTag.String) this.markString(valuePayload(key));
		if (valueTag(value) === ValueTag.String) this.markString(valuePayload(value));
	};
	public constructor(private readonly cpu: CPU, public readonly budget: LuaHeap, public readonly memory: Memory, public readonly arena: HeapAllocator, private readonly modeKey: number) {
		this.controlOffset = arena.managementOffset() + HEAP_GC_CONTROL_OFFSET;
		this.threads = new ThreadRecords(memory, arena);
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
	private visitList(list: number, kind: ValueTag.Table | typeof THREAD_RECORD_KIND, drain: boolean, visitor: (address: number) => number): number {
		let index = this.indexWord(list);
		let remaining = this.indexWord(list + GC_VISIT_COUNT);
		let work = 0;
		while (index !== 0 && remaining-- !== 0) {
			const address = RAM_BASE + (index << GC_RECORD_SHIFT);
			const meta = this.memory.readRamRecordByte(address + GC_VISIT_HEADER_BYTE);
			// Only the matching, linked record clocks the list port.
			if ((meta & GC_VISIT_MEMBER) === 0) break;
			if (kind === ValueTag.Table ? this.tableRecordAddress(address) !== address : this.threadRecordAddress(address) !== address) break;
			const low = this.memory.readRamRecordWord(address + GC_RECORD_LINK) >>> GC_GRAY_INDEX_BITS;
			index = low | ((meta & VISIT_LINK_HIGH_MASK) << VISIT_LINK_LOW_BITS);
			if (drain) this.setVisitLink(address, meta & ~GC_VISIT_MEMBER, 0);
			work += visitor(address);
		}
		if (drain) {
			this.memory.writeRamRecordPair(this.controlOffset + list, 0, 0);
			this.memory.writeRamRecordWord(this.controlOffset + list + GC_VISIT_COUNT, 0);
		}
		return work;
	}
	private readonly remarkRecord = (address: number): number => {
		if (this.markColor(address) === 3) this.enqueue(address, GC_RECORD_LINK, GC_CHANGED_HEAD);
		return 0;
	};
	private readonly visitEphemeron = (table: number): number => {
		if (this.tableMode(table) !== 1) return 0;
		this.tables.forEachStoredEntry(table, this.ephemeronEntry);
		return this.tables.scanSlots(table);
	};
	private readonly visitWeakEntries = (table: number): number => {
		const mode = this.tableMode(table);
		const slots = this.tables.scanSlots(table);
		this.tables.clearWeakEntries(table, (mode & 1) !== 0, (mode & 2) !== 0, this.alive);
		this.tables.forEachStoredEntry(table, this.weakStrings);
		return slots;
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
		if (table) {
			const meta = this.tables.metatableAddress(address);
			if (meta !== 0) this.markTable(meta);
			this.mode = this.tableMode(address);
			if (this.mode !== 0) this.appendVisit(GC_WEAK_VISITS, address);
			if ((this.mode & 1) === 0) this.tables.forEachStoredEntry(address, this.traceEntry);
			return (TableRecords.HEADER_BYTES >>> 2) + this.tables.scanSlots(address);
		}
		if (cell) {
			this.markValue(Upvalue.load(this.memory, address));
			return UPVALUE_HEAP_BYTES >>> 2;
		}
		if (closure) {
			const count = Closure.captureCount(this.memory, address);
			let work = 3 + count;
			for (let index = 0; index < count; ++index) work += this.markCell(this.cellRecordAddress(Closure.captureAddress(this.memory, address, index)));
			return work;
		}
		const layout = this.threadLayout;
		let cellWork = 0;
		if (!atomic) this.appendVisit(GC_THREAD_VISITS, address);
		this.markThread(this.memory.readRamRecordWord(address + ThreadField.Resumer));
		this.markClosure(this.memory.readRamRecordWord(address + ThreadField.Entry));
		this.markValue(valueFromTag(this.memory.readRamRecordByte(address + ThreadField.ErrorKind), this.memory.readRamRecordWord(address + ThreadField.ErrorWord)));
		this.threads.readLayout(address, layout);
		let liveTop = 0;
		if (layout.depth !== 0) {
			const current = this.threads.frameAddress(layout, layout.depth - 1);
			liveTop = (this.memory.readRamRecordWord(current + FrameField.StackBase) & FRAME_WINDOW_MASK)
				+ Math.min(this.memory.readRamRecordWord(current + FrameField.Top) & FRAME_WINDOW_MASK,
					this.memory.readRamRecordWord(current + FrameField.StackCapacity) & FRAME_WINDOW_MASK);
		}
		for (let depth = 0; depth < layout.depth; ++depth) {
			const frame = this.threads.frameAddress(layout, depth);
			this.markClosure(this.memory.readRamRecordWord(frame + FrameField.Closure));
			let cellAddress = this.memory.readRamRecordWord(frame + FrameField.OpenHead);
			for (let remaining = UPVALUE_CHAIN_LIMIT; cellAddress !== 0 && remaining !== 0; --remaining) {
				const cell = this.openCellAddress(cellAddress);
				if (cell === 0) break;
				cellWork += this.markCell(cell);
				const slot = this.memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD);
				if (slot < layout.capacity) liveTop = Math.max(liveTop, slot + 1);
				cellAddress = this.memory.readRamRecordWord(cell + UPVALUE_NEXT);
			}
		}
		const protectedBase = layout.protectedOffset;
		for (let index = 0; index < layout.protectedDepth; ++index) {
			const continuation = protectedBase + index * PROTECTED_CALL_BYTES;
			const flags = this.memory.readRamRecordWord(continuation + ProtectedField.Flags);
			if ((flags & PROTECTED_CALL_KIND_MASK) !== ProtectedCallKind.PCall && (flags & PROTECTED_CALL_HANDLER_BUILTIN) === 0)
				this.markClosure(this.memory.readRamRecordWord(continuation + ProtectedField.Handler));
		}
		const tags = layout.offset + layout.capacity * 4;
		for (let slot = 0; slot < liveTop; ++slot)
			this.markValue(valueFromTag(this.memory.readRamRecordByte(tags + slot), this.memory.readRamRecordWord(layout.offset + slot * 4)));
		this.threads.clearUnused(layout, liveTop);
		return cellWork + ceilDiv4(THREAD_HEAP_BYTES + allocatedThreadBackingBytes(layout.capacity, layout.frames, layout.continuations));
	}
	/** Called with the current trace queue empty; mutations stay separate until this pass. */
	private remark(t0: Value, t1: Value, t2: Value): number {
		this.diagnostics?.phase('rootsNanoseconds');
		this.visitList(GC_THREAD_VISITS, THREAD_RECORD_KIND, true, this.remarkRecord);
		this.visitList(GC_WEAK_VISITS, ValueTag.Table, false, this.remarkRecord);
		this.memory.writeRamRecordPair(this.controlOffset + GC_TRACE_HEAD, this.indexWord(GC_CHANGED_HEAD), 0);
		this.cpu.markHeapRoots(this); this.cpu.stringPool.markLocalRoots();
		this.markValue(t0); this.markValue(t1); this.markValue(t2);
		return this.cpu.collectionRootWordCount() + this.cpu.stringPool.takeMarkWork();
	}
	private atomic(t0: Value, t1: Value, t2: Value): number {
		this.diagnostics?.beginAtomic();
		let work = this.remark(t0, t1, t2);
		this.diagnostics?.phase('traceNanoseconds');
		work += this.resolveWeak();
		this.cpu.pruneStaticClosures();
		this.memory.writeRamRecordByte(this.controlOffset + 1, this.white() ^ 1);
		this.arena.beginObjectSweep(); this.setPhase(GcPhase.Sweep);
		return work;
	}

	private resolveWeak(): number {
		let work = 0;
		while (this.indexWord(GC_TRACE_HEAD) !== 0) work += this.trace(true) + this.cpu.stringPool.takeMarkWork();
		do {
			this.changed = false;
			work += this.visitList(GC_WEAK_VISITS, ValueTag.Table, false, this.visitEphemeron);
			while (this.indexWord(GC_TRACE_HEAD) !== 0) work += this.trace(true) + this.cpu.stringPool.takeMarkWork();
		} while (this.changed);
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
					if (this.minor && kind === ValueTag.Closure) this.cpu.retireStaticClosure(address);
					this.arena.free(address);
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
		this.arena.free(layout.block);
		this.arena.free(layout.frameBlock);
		if (layout.protectedBlock !== 0) this.arena.free(layout.protectedBlock);
		this.arena.free(address);
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
					while (this.indexWord(GC_TRACE_HEAD) !== 0 && work < GC_STEP_WORDS) work += this.trace(false) + this.cpu.stringPool.takeMarkWork();
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
					break;
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
