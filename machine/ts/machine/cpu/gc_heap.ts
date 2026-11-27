import { RAM_BASE } from '../../spec/bmsx/memory_map';
import type { Memory } from '../memory/memory';
import { HEAP_GC_CONTROL_OFFSET, type HeapAllocator } from './heap_allocator';
import { GC_COLOR_OFFSET, GC_COLOR_MASK, GC_OBJECT_LINK_BEFORE, GC_OBJECT_PREFIX, GC_RECORD_MASK } from './gc_object';
import { isOpen, UPVALUE_RECORD_KIND } from './upvalue';
import { TableRecords } from './table';
import { THREAD_RECORD_KIND, ThreadRecords } from './thread_record';
import { ValueTag } from './value';

export const GC_DIAGNOSTIC_OFFSET = 0x680;
export const enum GcDiagnosticField {
	Mode = 4, Index = 8, NewIndex = 12, Length = 16, Error = 20, FaultIds = 24,
	StringIndexTag = 28, StringIndexWord = 32,
}

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
const GC_PACE_BASIS = GC_OBJECT_HEAD + 12;
const GC_PACE_ESTIMATE = GC_PACE_BASIS + 4;
const GC_PACE_RUNWAY = GC_PACE_ESTIMATE + 4;
export const GC_PACE_PAID = GC_PACE_RUNWAY + 4;
const GC_PACE_PAY_AT = GC_PACE_PAID + 4;
const GC_FULL_EPOCHS = GC_PACE_PAY_AT + 4;
export const enum RemarkStage { None, Threads, Weak, Roots, Trace, ClearWeak }
export const GC_VISIT_HEADER_BYTE = 3;
export const GC_VISIT_MEMBER = 0x40;
export const enum GcPhase { Pause, Mark, MarkAgain, Atomic, Sweep, Strings }
export const enum GcRootBank { None, SystemGlobals, Globals, SystemConstants, Cart0Constants, Cart1Constants, Completion, End }
// Two unconnected selector inputs do not clock the collector.
const GC_PHASE_SELECTOR = [GcPhase.Pause, GcPhase.Mark, GcPhase.MarkAgain, GcPhase.Atomic,
	GcPhase.Sweep, GcPhase.Strings, GcPhase.Pause, GcPhase.Pause];
export function decodeGcPhase(word: number): GcPhase {
	return GC_PHASE_SELECTOR[word & 7];
}
export class GcHeap {
	protected readonly controlOffset: number;
	private readonly diagnosticOffset: number;
	public diagnosticWord(field: GcDiagnosticField): number {
		return this.memory.readRamRecordWord(this.diagnosticOffset + field);
	}
	public phase(): GcPhase {
		return decodeGcPhase(this.memory.readRamRecordByte(this.controlOffset));
	}
	public white(): number { return this.memory.readRamRecordByte(this.controlOffset + 1) & 1; }
	public constructor(public readonly memory: Memory, public readonly arena: HeapAllocator) {
		const management = arena.managementOffset();
		this.controlOffset = management + HEAP_GC_CONTROL_OFFSET;
		this.diagnosticOffset = management + GC_DIAGNOSTIC_OFFSET;
		this.threads = new ThreadRecords(memory);
		this.tables = new TableRecords(this);
	}
	public readonly tables: TableRecords;
	public readonly threads: ThreadRecords;
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
		return cell !== 0 && isOpen(this.memory, cell) ? cell : 0;
	}
	public threadRecordAddress(address: number): number {
		return this.objectRecordAddress(address, THREAD_RECORD_KIND);
	}
	public active(): boolean { return this.phase() !== GcPhase.Pause; }
	public finalMarkPending(): boolean { return this.phase() === GcPhase.Atomic; }
	public isAlive(address: number): boolean { return address !== 0 && !this.unmarked(this.memory.readRamRecordByte(address + GC_COLOR_OFFSET)); }
	protected markColor(address: number): number { return this.memory.readRamRecordByte(address + GC_COLOR_OFFSET) & GC_COLOR_MASK; }
	protected unmarked(flags: number): boolean { return (flags & GC_COLOR_MASK) === this.white(); }
	public sweepGarbage(address: number): boolean {
		return this.phase() === GcPhase.Sweep && this.markColor(address) === (this.white() ^ 1);
	}
	public changedHeadOffset(): number { return this.controlOffset + GC_CHANGED_HEAD; }

	public fullEpochs(): number { return this.memory.readRamRecordByte(this.controlOffset + GC_FULL_EPOCHS); }
	public epochWork(): number { return this.memory.readRamRecordWord(this.controlOffset + GC_EPOCH_WORK); }
	public workSinceEpoch(before: number): number {
		const finished = this.memory.readRamRecordWord(this.controlOffset + (this.active() ? GC_EPOCH_WORK : GC_LAST_EPOCH_WORK));
		return (finished - before) >>> 0;
	}
}
