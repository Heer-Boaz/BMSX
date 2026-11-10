import { luaPow } from '../../spec/blua32/pow';
import { StringPool, type StringId } from './string_pool';
import {
	NO_BLOCKED_MAPPED_WRITE,
	type MappedPageBinding,
	type MappedPageInvalidator,
	type Memory,
	type MemoryByteView,
} from '../memory/memory';
import {
	MAPPED_BUS_MASTER_CPU,
	mappedBusSignalsForCartridgeSlot,
	type MappedBusSignals,
} from '../memory/bus_signals';
import { readLE32 } from '../../common/endian';
import type { IrqController } from '../devices/irq/controller';
import { BASE_CYCLES, OPCODE_USES_BX, OPCODE_USES_DISP, OPCODE_RK_OPERANDS, RK_OPERAND_B, RK_OPERAND_C, OpCode } from '../../spec/blua32/opcode';
import {
	cop0FieldImplemented,
	COP0_BAD_ADDRESS,
	COP0_CAUSE,
	COP0_EPC,
	COP0_EXEC,
	COP0_LUA_FAULT_REASON,
	COP0_STATUS,
	CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD,
	CPU_CAUSE_CODE_ADDRESS_ERROR_STORE,
	CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR,
	CPU_CAUSE_CODE_DATA_BUS_ERROR,
	CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE,
	CPU_CAUSE_CODE_RESERVED_INSTRUCTION,
	CPU_CAUSE_CODE_TRAP,
	CPU_CAUSE_IRQ,
	CPU_CAUSE_NMI,
	CPU_STATUS_CART_ENTRY,
	CPU_STATUS_INTERRUPT_ENABLE_CURRENT,
	CPU_STATUS_MODE_STACK_MASK,
	CPU_STATUS_RFE_RESTORE_MASK,
	CPU_STATUS_SYSTEM_ENTRY,
	CPU_STATUS_USER_MODE_CURRENT,
	LUA_FAULT_REASON_ASSIGN_NON_TABLE,
	LUA_FAULT_REASON_CALL_NON_FUNCTION,
	LUA_FAULT_REASON_EXPLICIT_ERROR,
	LUA_FAULT_REASON_INDEX_NIL,
	LUA_FAULT_REASON_INDEX_NON_TABLE,
	LUA_FAULT_REASON_INVALID_ARGUMENT,
	LUA_FAULT_REASON_ITERATE_NON_TABLE,
	LUA_FAULT_REASON_METATABLE_LOOP,
	LUA_FAULT_REASON_OUT_OF_MEMORY,
	LUA_FAULT_REASON_UNKNOWN,
	LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION,
} from '../../spec/blua32/cop0';
import { BASE_BX_BITS, BASE_OPERAND_A_BITS, BASE_OPERAND_BC_BITS, CLOSURE_ADDRESS_REGISTER_FLAG, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_LOW_BX, MAX_OPERAND_BITS, signExtend } from '../../spec/blua32/instruction_format';
import {
	BLUA32_CONSTANT_PAYLOAD_OFFSET,
	BLUA32_CONSTANT_RECORD_SIZE,
	BLUA32_CONSTANT_STRING_BYTE_COUNT_OFFSET,
	BLUA32_CONSTANT_TAG_OFFSET,
	BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
	BLUA32_FUNCTION_ALIGNMENT,
	BLUA32_FUNCTION_FLAGS_OFFSET,
	BLUA32_FUNCTION_MAX_STACK_OFFSET,
	BLUA32_FUNCTION_NUM_PARAMS_OFFSET,
	BLUA32_FUNCTION_RECORD_SIZE,
	BLUA32_FUNCTION_STATIC,
	BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET,
	BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
	BLUA32_FUNCTION_VARARG,
	BLUA32_GLOBAL_NAME_ADDRESS_OFFSET,
	BLUA32_GLOBAL_NAME_BYTE_COUNT_OFFSET,
	BLUA32_GLOBAL_NAME_RECORD_SIZE,
	BLUA32_IMAGE_CONSTANT_COUNT_OFFSET,
	BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET,
	BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_HEADER_SIZE,
	BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET,
	BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
	BLUA32_UPVALUE_INDEX_MASK,
	BLUA32_UPVALUE_IN_STACK_MASK,
	BLUA32_UPVALUE_RECORD_SIZE,
	Blua32ConstantTag,
} from '../../spec/blua32/image_format';
import {
	ExecutionAddressSpace,
	type Blua32ExecutionBoot,
} from '../execution_address_space';
import {
	EXECUTION_DOMAIN_COUNT,
	executionDomainBit,
	SYSTEM_EXECUTION_DOMAIN_ID,
	type ExecutionDomainId,
	type ExecutionDomainMask,
} from '../../spec/blua32/execution_domain';
import { MEMORY_ACCESS_KIND_ALIGNMENT_MASKS, MemoryAccessKind } from '../../spec/blua32/memory_access_kind';
import { ScratchBuffer } from '../../common/scratchbuffer';
import { luaFloorDivide, luaModulo } from '../../spec/blua32/numeric';
import { ceilDiv4 } from '../common/numeric';
import {
	MAPPED_PAGE_BYTE_MASK,
	MAPPED_PAGE_BYTE_SIZE,
} from '../memory/mapped_page';
import { BuiltinFunctionId, LUA_BOOT_PRIMITIVES } from '../../spec/blua32/builtin';
import {
	EMPTY_CALL_ARGS,
	VALUE_TAG,
	ValueTag,
	materializeValue,
	storedValueToString,
	valueFromNumber,
	valueTag,
	asStringId,
	valueTypeNameForLuaTag,
	BUILTIN_FUNCTIONS,
	type Value,
	type ValueReference,
	type StringValue,
} from './value';
import { LUA_OUT_OF_MEMORY_SIGNAL, LuaExecutionError, LuaThrownValueError } from './errors';
import { Table, TABLE_INDEX_CHAIN_EXHAUSTED } from './table';
import { Closure, EMPTY_CLOSURE_UPVALUES, type Upvalue } from './closure';
import { BuiltinArgsView, BuiltinResults, ValueSlots } from './value_slots';
import {
	DECODED_DISPATCH_BASE_CYCLES,
	DECODED_PAGE_WORDS,
	DECODED_DEPENDENCY_PREDECESSOR_WORDS,
	DECODED_REFRESH_DECODE,
	DECODED_REFRESH_FUSION,
	createDecodedInstructionPage,
	decodedDispatchCanFuse,
	decodedDispatchOp,
	DecodedDispatchOp,
	type Blua32ExecutionImage,
	type Blua32FunctionRecordLatch,
	type DecodedInstructionPage,
} from './execution_image';
import { ProtectedCallContinuation, ProtectedCallKind, type CallFrame } from './call_state';
import { CompiledCodeLookup } from './compiled_code_lookup';
import { Thread, ThreadStatus, THREAD_HEAP_BYTES, THREAD_STACK_SLOT_BYTES } from './thread';
import { LuaHeap, type LuaHeapState } from './lua_heap';
import {
	CpuExecutionBackend, CompiledBlockPage, CompiledCodeCache, CompiledBlockExit, COMPILED_BLOCK_THRESHOLD,
	COMPILED_BLOCK_MAX_INSTRUCTIONS,
	compiledBlockSupports, compiledBlockEndsBlock, compiledBlockComparison, compileJavaScriptBlock, linkCompiledBlock,
	type CompiledBlockExitSite,
} from './compiled_block';
import { CpuSnapshot, CpuSnapshotWriter, CpuSnapshotReader, CpuSnapshotObjectKind, CpuSnapshotClosure, CpuSnapshotTable, CpuSnapshotUpvalue, CpuSnapshotThread, CPU_SNAPSHOT_VALUE_WORDS, type CpuSnapshotObject, type CpuSnapshotValueWriter } from './snapshot';

// start repeated-sequence-acceptable -- Lua VM/table/register hot paths deliberately keep short copy/update sequences inline.
// start normalized-body-acceptable -- Specialized Lua VM accessors stay split so the fast paths avoid dispatch helpers.

const executionStringDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const CLOSURE_HEAP_BYTES = 16;
const CLOSURE_UPVALUE_SLOT_HEAP_BYTES = 8;
const UPVALUE_HEAP_BYTES = 24;

// Saved values are u32 offsets into the snapshot word arena. Object references
// (closureRef/openUpvalues) are ordinals in its object index.
export type CpuFrameState = {
	functionAddress: number;
	pc: number;
	closureRef: number;
	registers: number[];
	stackCapacity: number;
	varargs: number[];
	returnBase: number;
	returnCount: number;
	top: number;
	returnToCompletionLatch: boolean;
	callSitePc: number;
	isExceptionFrame: boolean;
	isNonMaskableExceptionFrame: boolean;
};

export type CpuProtectedCallState = {
	kind: ProtectedCallKind;
	callerFrameIndex: number;
	targetFrameIndex: number;
	returnsToProtectedParent: boolean;
	callBase: number;
	returnCount: number;
	handlerRegister: number;
};

export type CpuRootValueState = {
	key: StringId;
	value: number;
};

export type CpuThreadState = {
	status: ThreadStatus;
	entryRef: number;
	resumerRef: number;
	callBase: number;
	returnCount: number;
	stackCapacity: number;
	error: number;
	frames: CpuFrameState[];
	protectedCalls: CpuProtectedCallState[];
	openUpvalues: number[];
};

export type CpuRuntimeState = {
	executionCartridgeSlot: ExecutionDomainId;
	systemGlobals: CpuRootValueState[];
	globalSlots: CpuRootValueState[];
	executionResidencyMask: ExecutionDomainMask;
	nextObjectHashId: number;
	hardHalted: boolean;
	luaHeap: LuaHeapState;
	stringIndexTable: number;
	rootThreadRef: number;
	activeThreadRef: number;
	completionThreadRef: number;
	threads: CpuThreadState[];
	completionValues: number[];
	snapshot: CpuSnapshot;
	lastExecutionDomainId: ExecutionDomainId;
	lastPc: number;
	haltedUntilIrqFrameDepth: number;
	haltedUntilIrqThreadRef: number;
	interruptEventPending: boolean;
	memoryWriteBlocked: boolean;
	memoryWriteBlockedAddress: number;
	statusWord: number;
	causeWord: number;
	epcWord: number;
	badAddressWord: number;
	luaFaultReasonWord: number;
	exceptionDomainWord: number;
	nmiReturnCauseWord: number;
	nmiReturnEpcWord: number;
	nmiReturnBadAddressWord: number;
	nmiReturnLuaFaultReasonWord: number;
	nmiReturnExceptionDomainWord: number;
	nonMaskableInterruptPending: boolean;
	yieldRequested: boolean;
};

export const enum AcceptedInterruptKind {
	None,
	Maskable,
	NonMaskable,
}

export const enum RunResult {
	Halted,
	Yielded,
	ExecutionStopped,
}

/** Host-only configuration. Borrowed registers are read-only; never retain them or execute guest code. */
export type InstructionObserverBinding = {
	readonly points: readonly [ReadonlySet<number>, ReadonlySet<number>, ReadonlySet<number>];
	readonly observe: (domain: ExecutionDomainId, pc: number, registers: ValueSlots) => void;
};

export type ExecutionHook = (
	executionDomainId: ExecutionDomainId,
	pc: number,
) => boolean;

const TABLE_WEAK_KEYS = 1;
const TABLE_WEAK_VALUES = 2;
const TABLE_WEAK_KEY_CODE_UNIT = 0x6b;
const TABLE_WEAK_VALUE_CODE_UNIT = 0x76;

// Pool constant for frame reuse
const MAX_POOLED_FRAMES = 32;
export class CPU implements MappedPageInvalidator {
	/** Current runUntilDepth grant; consumed by the caller, not checkpoint state. */
	public instructionBudgetRemaining: number = 0;
	public lastPc: number = 0;
	public readonly rootThread = new Thread(null);
	public activeThread = this.rootThread;
	private completionThread = this.rootThread;
	public readonly memory: Memory;

	public readonly luaHeap: LuaHeap;
	public readonly stringPool: StringPool;
	private indexKey!: StringId;
	private modeKey!: StringId;
	private haltedUntilIrqFrameDepth = -1;
	private haltedUntilIrqThread: Thread | null = null;
	private interruptEventPending = false;
	private memoryWriteBlocked = false;
	private memoryWriteBlockedAddress = 0;
	private currentInstructionPc = 0;
	private lastExecutionDomainId: ExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	private hardHalted = false;
	private readonly cop0Words = new Uint32Array(COP0_EXEC + 1);
	private exceptionDomainWord = 0;
	private nmiReturnCauseWord = 0;
	private nmiReturnEpcWord = 0;
	private nmiReturnBadAddressWord = 0;
	private nmiReturnLuaFaultReasonWord = 0;
	private nmiReturnExceptionDomainWord = 0;
	private nonMaskableInterruptPending = false;
	private systemExceptionFunctionAddress = 0;
	private yieldRequested = false;
	private threadSwitchRequested = false;
	private executionHook: ExecutionHook | null = null;
	private instructionObserver: InstructionObserverBinding | null = null;
	private executionHookDomainMask: ExecutionDomainMask = 0;
	private preMaskableInterruptExecutionHookDomainMask: ExecutionDomainMask = 0;
	private runUntilDepthEntry = this.runUntilDepthNormal;
	private readonly compiledCodeCache = new CompiledCodeCache();
	private readonly registerBuiltinArgsScratch = new ScratchBuffer<BuiltinArgsView>(
		() => new BuiltinArgsView(),
		1,
	);
	private registerBuiltinArgsScratchIndex = 0;
	private readonly builtinResultsScratch = new ScratchBuffer<BuiltinResults>(
		() => new BuiltinResults(),
		1,
	);
	private builtinResultsScratchIndex = 0;
	private readonly localRoots: Value[] = [];
	private localRootScopeDepth = 0;
	private closureUpvalueWords = new Uint32Array(0);
	private readonly heapObjectStack: Array<Table | Closure | Thread> = [];
	private readonly heapUpvalueStack: Upvalue[] = [];
	private readonly heapWeakTables: Table[] = [];
	private readonly heapWeakTableModes: number[] = [];
	private readonly heapEphemeronTables: Table[] = [];
	private readonly heapSeen = new WeakMap<object, number>();
	private readonly heapSeenImages = new WeakMap<object, number>();
	private readonly tableScratch = new ValueSlots(2);
	private heapEpoch = 0;
	private heapTableWeakMode = 0;
	private heapEphemeronChanged = false;
	private readonly heapStoredValueIsAlive = (
		tag: ValueTag,
		_scalar: number,
		reference: ValueReference,
	): boolean => {
		switch (tag) {
			case ValueTag.Thread:
			case ValueTag.Table:
				return this.heapSeen.get(reference!) === this.heapEpoch;
			case ValueTag.Closure: {
				const closure = reference as Closure;
				return closure.heapBytes === 0 || this.heapSeen.get(closure) === this.heapEpoch;
			}
			default:
				return true;
		}
	};
	private readonly visitHeapTableEntry = (
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): void => {
		if ((this.heapTableWeakMode & TABLE_WEAK_KEYS) === 0) {
			this.pushHeapStoredValue(keyTag, keyScalar, keyReference);
		}
		if (this.heapTableWeakMode === 0) {
			this.pushHeapStoredValue(valueTag, valueScalar, valueReference);
		}
	};
	private readonly visitHeapEphemeronEntry = (
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): void => {
		if (!this.heapStoredValueIsAlive(keyTag, keyScalar, keyReference)) {
			return;
		}
		switch (valueTag) {
			case ValueTag.Thread:
			case ValueTag.Table:
				if (this.heapSeen.get(valueReference!) !== this.heapEpoch) {
					this.heapObjectStack.push(valueReference!);
					this.heapEphemeronChanged = true;
				}
				return;
			case ValueTag.Closure: {
				const closure = valueReference as Closure;
				if (closure.heapBytes !== 0 && this.heapSeen.get(closure) !== this.heapEpoch) {
					this.heapObjectStack.push(closure);
					this.heapEphemeronChanged = true;
				}
				return;
			}
			default:
				this.pushHeapStoredValue(valueTag, valueScalar, valueReference);
		}
	};
	private readonly markWeakEntryStrings = (
		keyTag: ValueTag,
		keyScalar: number,
		_keyReference: ValueReference,
		valueTag: ValueTag,
		valueScalar: number,
		_valueReference: ValueReference,
	): void => {
		if (keyTag === ValueTag.String) {
			this.stringPool.markReachable(keyScalar as StringId);
		}
		if (valueTag === ValueTag.String) {
			this.stringPool.markReachable(valueScalar as StringId);
		}
	};

	private pushHeapRegister(registers: ValueSlots, index: number): void {
		this.pushHeapStoredValue(
			registers.getTag(index),
			registers.getScalar(index),
			registers.getReference(index),
		);
	}

	private pushHeapStoredValue(tag: ValueTag, scalar: number, reference: ValueReference): void {
		switch (tag) {
			case ValueTag.Nil:
			case ValueTag.False:
			case ValueTag.True:
			case ValueTag.Number:
			case ValueTag.BuiltinFunction:
				return;
			case ValueTag.String:
				this.stringPool.markReachable(scalar as StringId);
				return;
			case ValueTag.Thread:
			case ValueTag.Table:
				this.heapObjectStack.push(reference as Table | Thread);
				return;
			case ValueTag.Closure: {
				const closure = reference as Closure;
				if (closure.heapBytes !== 0) {
					this.heapObjectStack.push(closure);
				}
				return;
			}
		}
	}

	private readonly executionImagesByDomain: Array<Blua32ExecutionImage | null> =
		new Array<Blua32ExecutionImage | null>(EXECUTION_DOMAIN_COUNT).fill(null);
	private systemImage!: Blua32ExecutionImage;
	private activeExecutionImage!: Blua32ExecutionImage;
	private executionBusSignals: MappedBusSignals = MAPPED_BUS_MASTER_CPU;
	private readonly mappedPageBinding: MappedPageBinding = {
		key: 0,
		cacheable: false,
		readBytes: null,
		readByteOffset: 0,
		writeWatches: null,
		writeWatchIndex: 0,
	};
	private readonly functionRecordLatch: Blua32FunctionRecordLatch = {
		image: null!,
		busSignals: MAPPED_BUS_MASTER_CPU,
		cacheableRead: false,
		address: 0,
		codeAddress: 0,
		numParams: 0,
		maxStack: 0,
		flags: 0,
		upvalueTableAddress: 0,
		upvalueCount: 0,
	};
	private readonly executionReadView: MemoryByteView = {
		bytes: new Uint8Array(0),
		byteOffset: 0,
		byteLength: 0,
	};
	private readonly executionTableView: MemoryByteView = {
		bytes: new Uint8Array(0),
		byteOffset: 0,
		byteLength: 0,
	};
	private readonly staticClosuresByAddress = new Map<number, Closure>();
	private stringIndexTable: Table | null = null;
	private systemGlobalNames: StringId[] = [];
	private readonly systemGlobalSlots = new ValueSlots(0);
	private systemGlobalSlotByKey: Map<StringId, number> = new Map();
	private globalNames: StringId[] = [];
	private readonly globalSlots = new ValueSlots(0);
	private globalSlotByKey: Map<StringId, number> = new Map();
	private readonly framePool: CallFrame[] = [];
	private completionValueSlots = new ValueSlots(8);
	private completionValueCount = 0;
	private nextObjectHashId = 1;
	private readonly luaFaultErrorStringIds: StringId[] = [];
	private readonly errorInErrorHandlingStringId: StringId;

	constructor(
		memory: Memory,
		private readonly irqController: IrqController,
		private readonly executionAddressSpace: ExecutionAddressSpace,
		private readonly executionBackend = CpuExecutionBackend.JavaScript,
	) {
		this.memory = memory;
		this.cop0Words[COP0_STATUS] = CPU_STATUS_CART_ENTRY;
		this.luaHeap = new LuaHeap(this, memory.ramByteCount());
		this.stringPool = new StringPool(this.luaHeap);
		this.luaHeap.reserve(THREAD_HEAP_BYTES + 8 * THREAD_STACK_SLOT_BYTES);
		this.rootThread.hashId = this.allocateObjectHashId();
		this.rootThread.status = ThreadStatus.Running;
		this.indexKey = this.stringPool.intern('__index');
		this.modeKey = this.stringPool.intern('__mode');
		this.errorInErrorHandlingStringId = this.stringPool.intern('error in error handling', false);
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_UNKNOWN] = this.stringPool.intern('Attempted to get length of an unsupported value.', false);
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_CALL_NON_FUNCTION] = this.stringPool.intern('Attempted to call a non-function value.', false);
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_INDEX_NON_TABLE] = this.stringPool.intern('Attempted to index field on a non-table value.', false);
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_ASSIGN_NON_TABLE] = this.stringPool.intern('Attempted to assign to a non-table value.', false);
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_INDEX_NIL] = this.stringPool.intern('Table index is nil.', false);
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_METATABLE_LOOP] = this.stringPool.intern('Metatable __index loop detected.', false);
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_ITERATE_NON_TABLE] = this.stringPool.intern('Attempted to iterate a non-table value.', false);
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION] = this.stringPool.intern('xpcall error handler must be a function.', false);
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_OUT_OF_MEMORY] = this.stringPool.intern('Out of memory.', false);
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_INVALID_ARGUMENT] = this.stringPool.intern('Invalid argument.', false);
		this.memory.attachMappedPageInvalidator(this);
	}

	public allocateObjectHashId(): number {
		const hashId = this.nextObjectHashId;
		this.nextObjectHashId = (hashId + 1) >>> 0;
		return hashId;
	}

	public createTable(arraySize: number = 0, hashSize: number = 0): Table {
		const hashCapacity = Table.hashCapacity(hashSize);
		this.luaHeap.reserve(Table.trackedHeapBytesForCapacities(arraySize, hashCapacity));
		const table = new Table(this.luaHeap, arraySize, hashCapacity);
		table.hashId = this.allocateObjectHashId();
		if (this.localRootScopeDepth > 0) this.localRoots.push(table);
		return table;
	}

	/** Synchronous host materialization owns roots until VM call admission. */
	public acquireLocalRoots(): number {
		const base = this.localRoots.length;
		this.stringPool.beginLocalRoots();
		this.localRootScopeDepth += 1;
		return base;
	}

	public releaseLocalRoots(base: number): void {
		this.localRoots.length = base;
		this.localRootScopeDepth -= 1;
		this.stringPool.endLocalRoots();
	}

	private ensureStackCapacity(size: number): void {
		const stack = this.activeThread.stackRegisters;
		if (size <= stack.capacity()) {
			return;
		}
		let nextCapacity = 1 << (32 - Math.clz32(size - 1));
		if (nextCapacity < 8) {
			nextCapacity = 8;
		}
		this.luaHeap.reserve((nextCapacity - stack.capacity()) * THREAD_STACK_SLOT_BYTES);
		const next = new ValueSlots(nextCapacity);
		next.copyRangeFrom(stack, 0, 0, this.activeThread.stackTop);
		this.activeThread.stackRegisters = next;
		this.refreshFrameRegisterViews();
	}

	private refreshFrameRegisterViews(): void {
		const stack = this.activeThread.stackRegisters;
		const frames = this.activeThread.frames;
		for (let index = 0; index < frames.length; index += 1) {
			const frame = frames[index];
			frame.registers.rebind(stack, frame.stackBase, frame.stackCapacity);
		}
	}

	private clearCompletionValues(): void {
		this.completionValueSlots.clear(this.completionValueCount);
		this.completionValueCount = 0;
	}

	private latchCompletionValues(
		source: ValueSlots,
		sourceBase: number,
		sourceCount: number,
	): void {
		if (sourceCount > this.completionValueSlots.capacity()) {
			let capacity = this.completionValueSlots.capacity() * 2;
			while (capacity < sourceCount) {
				capacity *= 2;
			}
			this.completionValueSlots = new ValueSlots(capacity);
		} else {
			this.completionValueSlots.clear(this.completionValueCount);
		}
		this.completionValueSlots.copyRangeFrom(source, 0, sourceBase, sourceCount);
		this.completionValueCount = sourceCount;
	}

	private acquireRegisterBuiltinArgs(): BuiltinArgsView {
		const args = this.registerBuiltinArgsScratch.get(this.registerBuiltinArgsScratchIndex);
		this.registerBuiltinArgsScratchIndex += 1;
		return args;
	}

	private releaseRegisterBuiltinArgs(args: BuiltinArgsView): void {
		args.clear();
		this.registerBuiltinArgsScratchIndex -= 1;
	}

	private acquireBuiltinResults(): BuiltinResults {
		const results = this.builtinResultsScratch.get(this.builtinResultsScratchIndex);
		this.builtinResultsScratchIndex += 1;
		return results;
	}

	private releaseBuiltinResults(results: BuiltinResults): void {
		results.clear();
		this.builtinResultsScratchIndex -= 1;
	}

	private findOpenUpvalue(frame: CallFrame, index: number): Upvalue | null {
		let upvalue = frame.openUpvalueHead;
		while (upvalue && upvalue.index >= index) {
			if (upvalue.index === index) {
				return upvalue;
			}
			upvalue = upvalue.nextOpen;
		}
		return null;
	}

	private linkOpenUpvalue(frame: CallFrame, upvalue: Upvalue): void {
		let previous: Upvalue | null = null;
		let current = frame.openUpvalueHead;
		while (current && current.index > upvalue.index) {
			previous = current;
			current = current.nextOpen;
		}
		upvalue.nextOpen = current;
		if (!previous) {
			frame.openUpvalueHead = upvalue;
			return;
		}
		previous.nextOpen = upvalue;
	}

	// TODO: Admit function-valued __index through VM call/return continuations in
	// all indexed-read forms. Table-only resolution is an implementation limitation,
	// not the intended BLua contract; raw Table storage must not execute guest code.
	private loadTableIndex(
		baseTag: ValueTag,
		baseTable: Table | null,
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
		target: ValueSlots,
		targetIndex: number,
	): void {
		let table: Table;
		switch (baseTag) {
			case ValueTag.Table:
				table = baseTable!;
				break;
			case ValueTag.String:
				table = this.stringIndexTable!;
				break;
			default:
				throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
		}
		if (!table.metatable) {
			table.load(keyTag, keyScalar, keyReference, target, targetIndex);
			return;
		}
		if (!table.resolveIndex(
			this.indexKey,
			keyTag,
			keyScalar,
			keyReference,
			target,
			targetIndex,
		)) {
			throw new LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
		}
	}

	private loadTableIntegerIndex(
		baseTag: ValueTag,
		baseTable: Table | null,
		index: number,
		target: ValueSlots,
		targetIndex: number,
	): void {
		let table: Table;
		switch (baseTag) {
			case ValueTag.Table:
				table = baseTable!;
				break;
			case ValueTag.String:
				table = this.stringIndexTable!;
				break;
			default:
				throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
		}
		if (table.metatable) {
			if (!table.resolveIntegerIndex(
				this.indexKey,
				index,
				target,
				targetIndex,
			)) {
				throw new LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
			}
			return;
		}
		table.loadInteger(index, target, targetIndex);
	}

	private loadTableFieldIndexCached(
		page: DecodedInstructionPage,
		pageOffset: number,
		baseTag: ValueTag,
		baseTable: Table | null,
		key: StringId,
		target: ValueSlots,
		targetIndex: number,
	): void {
		let table: Table;
		switch (baseTag) {
			case ValueTag.Table:
				table = baseTable!;
				break;
			case ValueTag.String:
				table = this.stringIndexTable!;
				break;
			default:
				throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
		}
		if (table.metatable) {
			const predictedSlot = table.resolveStringIndexCached(
				this.indexKey,
				key,
				page.tableCacheSlots[pageOffset],
				target,
				targetIndex,
			);
			if (predictedSlot === TABLE_INDEX_CHAIN_EXHAUSTED) {
				throw new LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
			}
			page.tableCacheSlots[pageOffset] = predictedSlot;
			return;
		}
		page.tableCacheSlots[pageOffset] = table.loadStringKeyCached(
			key,
			page.tableCacheSlots[pageOffset],
			target,
			targetIndex,
		);
	}

	private storeTableIndex(
		baseTag: ValueTag,
		baseTable: Table | null,
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): void {
		switch (baseTag) {
			case ValueTag.Table:
				baseTable!.store(
					keyTag,
					keyScalar,
					keyReference,
					valueTag,
					valueScalar,
					valueReference,
				);
				return;
			default:
				throw new LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
		}
	}

	private storeTableIntegerIndex(
		baseTag: ValueTag,
		baseTable: Table | null,
		index: number,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): void {
		switch (baseTag) {
			case ValueTag.Table:
				baseTable!.storeInteger(index, valueTag, valueScalar, valueReference);
				return;
			default:
				throw new LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
		}
	}

	private storeTableFieldIndexCached(
		page: DecodedInstructionPage,
		pageOffset: number,
		baseTag: ValueTag,
		baseTable: Table | null,
		key: StringId,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): void {
		switch (baseTag) {
			case ValueTag.Table:
				page.tableCacheSlots[pageOffset] = baseTable!.storeStringKeyCached(
					key,
					page.tableCacheSlots[pageOffset],
					valueTag,
					valueScalar,
					valueReference,
				);
				return;
			default:
				throw new LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
		}
	}

	private acquireFrame(): CallFrame {
		if (this.framePool.length > 0) {
			return this.framePool.pop()!;
		}
		return {
			thread: this.activeThread,
			functionAddress: 0,
			executionImage: null!,
			decodedPage: null,
			decodedPageAddress: 0,
			decodedPageBusSignals: MAPPED_BUS_MASTER_CPU,
			pc: 0,
			varargBase: 0,
			varargCount: 0,
			stackBase: 0,
			stackCapacity: 0,
			registers: new ValueSlots(0),
			closure: null!,
			returnBase: 0,
			returnCount: 0,
			top: 0,
			returnToCompletionLatch: false,
			callSitePc: 0,
			isExceptionFrame: false,
			isNonMaskableExceptionFrame: false,
			openUpvalueHead: null,
		};
	}

	private releaseFrame(frame: CallFrame): void {
		frame.varargBase = 0;
		frame.varargCount = 0;
		frame.stackBase = 0;
		frame.stackCapacity = 0;
		frame.decodedPage = null;
		frame.decodedPageAddress = 0;
		frame.registers.rebind(this.rootThread.stackRegisters, 0, 0);
		frame.thread = this.rootThread;
		frame.isExceptionFrame = false;
		frame.isNonMaskableExceptionFrame = false;
		if (this.framePool.length < MAX_POOLED_FRAMES) {
			this.framePool.push(frame);
		}
	}

	private clearCallStack(): void {
		for (;;) {
			for (let index = 0; index < this.activeThread.protectedCallDepth; index += 1) {
				const continuation = this.activeThread.protectedCallContinuations.peek(index);
				continuation.caller = null;
				continuation.target = null;
			}
			this.activeThread.protectedCallDepth = 0;
			while (this.activeThread.frames.length > 0) {
				const frame = this.activeThread.frames.pop()!;
				this.closeUpvalues(frame);
				this.releaseFrame(frame);
			}
			this.activeThread.stackRegisters.clear(this.activeThread.stackTop);
			this.activeThread.stackTop = 0;
			const thread = this.activeThread;
			thread.status = ThreadStatus.Dead;
			thread.entry = null;
			thread.error.setNil(0);
			if (thread === this.rootThread) break;
			this.activeThread = thread.resumer === null ? this.rootThread : thread.resumer;
			thread.resumer = null;
		}
		this.rootThread.status = ThreadStatus.Running;
		this.completionThread = this.rootThread;
		this.threadSwitchRequested = false;
	}

	public reset(): void {
		this.compiledCodeCache.retireAll();
		const systemBoot = this.executionAddressSpace.resolveSystemDomain();
		const systemResetFunctionAddress = systemBoot.startupFunctionAddress;
		this.clearCompletionValues();
		this.clearCallStack();
		this.stringIndexTable = null;
		this.haltedUntilIrqFrameDepth = -1;
		this.haltedUntilIrqThread = null;
		this.interruptEventPending = false;
		this.memoryWriteBlocked = false;
		this.memoryWriteBlockedAddress = 0;
		this.hardHalted = false;
		this.cop0Words[COP0_STATUS] = CPU_STATUS_SYSTEM_ENTRY;
		this.cop0Words[COP0_CAUSE] = 0;
		this.cop0Words[COP0_EPC] = 0;
		this.cop0Words[COP0_BAD_ADDRESS] = 0;
		this.cop0Words[COP0_LUA_FAULT_REASON] = 0;
		this.exceptionDomainWord = 0;
		this.nmiReturnCauseWord = 0;
		this.nmiReturnEpcWord = 0;
		this.nmiReturnBadAddressWord = 0;
		this.nmiReturnLuaFaultReasonWord = 0;
		this.nmiReturnExceptionDomainWord = 0;
		this.nonMaskableInterruptPending = false;
		this.yieldRequested = false;
		this.staticClosuresByAddress.clear();
		this.memory.clearMappedPageWriteWatches();
		this.executionImagesByDomain.fill(null);
		this.systemImage = this.activateExecutionImage(systemBoot);
		this.executionImagesByDomain[SYSTEM_EXECUTION_DOMAIN_ID + 1] = this.systemImage;
		this.systemExceptionFunctionAddress = systemBoot.exceptionFunctionAddress;
		this.latchActiveExecutionImage(this.systemImage);
		this.pushFrame(
			this.staticClosureAtAddress(systemResetFunctionAddress),
			EMPTY_CALL_ARGS,
			0,
			0,
			false,
		);
		this.collectTrackedHeapBytes();
	}

	public installBootPrimitives(): void {
		for (let index = 0; index < LUA_BOOT_PRIMITIVES.length; index += 1) {
			const primitive = LUA_BOOT_PRIMITIVES[index];
			this.setSystemGlobalByKey(
				this.stringPool.intern(primitive.name),
				ValueTag.BuiltinFunction,
				primitive.id,
				null,
			);
		}
	}

	public clearExecutionEnvironment(): void {
		this.clearCompletionValues();
		this.clearCallStack();
		this.clearGlobalSlots();
	}

	private internExecutionString(
		executionDomainId: ExecutionDomainId,
		address: number,
		byteLength: number,
	): StringId {
		if (byteLength === 0) {
			return this.stringPool.intern('', false);
		}
		this.executionAddressSpace.bindReadOnlyView(
			executionDomainId,
			address,
			byteLength,
			this.executionReadView,
		);
		return this.stringPool.intern(
			executionStringDecoder.decode(this.executionReadView.bytes.subarray(
				this.executionReadView.byteOffset,
				this.executionReadView.byteOffset + this.executionReadView.byteLength,
			)),
			false,
		);
	}

	private decodeConstantPool(
		executionDomainId: ExecutionDomainId,
		tableAddress: number,
		constTags: Uint8Array,
		constScalars: Float64Array,
	): void {
		if (constTags.length === 0) {
			return;
		}
		this.executionAddressSpace.bindReadOnlyView(
			executionDomainId,
			tableAddress,
			constTags.length * BLUA32_CONSTANT_RECORD_SIZE,
			this.executionTableView,
		);
		const bytes = this.executionTableView.bytes;
		const byteOffset = this.executionTableView.byteOffset;
		const numberView = new DataView(
			bytes.buffer,
			bytes.byteOffset + byteOffset,
			this.executionTableView.byteLength,
		);
		constScalars.fill(NaN);
		for (let index = 0; index < constTags.length; index += 1) {
			const recordOffset = index * BLUA32_CONSTANT_RECORD_SIZE;
			const recordByteOffset = byteOffset + recordOffset;
			switch (readLE32(bytes, recordByteOffset + BLUA32_CONSTANT_TAG_OFFSET)) {
				case Blua32ConstantTag.Nil:
					constTags[index] = ValueTag.Nil;
					break;
				case Blua32ConstantTag.False:
					constTags[index] = ValueTag.False;
					break;
				case Blua32ConstantTag.True:
					constTags[index] = ValueTag.True;
					break;
				case Blua32ConstantTag.Number:
					constTags[index] = ValueTag.Number;
					constScalars[index] = valueFromNumber(numberView.getFloat64(
						recordOffset + BLUA32_CONSTANT_PAYLOAD_OFFSET,
						true,
					));
					break;
				case Blua32ConstantTag.String:
					constTags[index] = ValueTag.String;
					constScalars[index] = this.internExecutionString(
						executionDomainId,
						readLE32(bytes, recordByteOffset + BLUA32_CONSTANT_PAYLOAD_OFFSET),
						readLE32(bytes, recordByteOffset + BLUA32_CONSTANT_STRING_BYTE_COUNT_OFFSET),
					);
					break;
				default:
					throw new Error('BLua32 constant tag is invalid.');
			}
		}
	}

	private registerGlobalNames(
		executionDomainId: ExecutionDomainId,
		tableAddress: number,
		nameCount: number,
		system: boolean,
	): Uint32Array {
		const slotByKey = system ? this.systemGlobalSlotByKey : this.globalSlotByKey;
		const registeredNames = system ? this.systemGlobalNames : this.globalNames;
		const slots = new Uint32Array(nameCount);
		if (nameCount === 0) {
			return slots;
		}
		const values = system ? this.systemGlobalSlots : this.globalSlots;
		values.reserveCapacity(registeredNames.length + nameCount);
		this.executionAddressSpace.bindReadOnlyView(
			executionDomainId,
			tableAddress,
			nameCount * BLUA32_GLOBAL_NAME_RECORD_SIZE,
			this.executionTableView,
		);
		const bytes = this.executionTableView.bytes;
		const byteOffset = this.executionTableView.byteOffset;
		for (let index = 0; index < nameCount; index += 1) {
			const recordByteOffset = byteOffset + index * BLUA32_GLOBAL_NAME_RECORD_SIZE;
			const key = this.internExecutionString(
				executionDomainId,
				readLE32(bytes, recordByteOffset + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET),
				readLE32(bytes, recordByteOffset + BLUA32_GLOBAL_NAME_BYTE_COUNT_OFFSET),
			);
			let slot = slotByKey.get(key);
			if (slot === undefined) {
				slot = registeredNames.length;
				slotByKey.set(key, slot);
				registeredNames.push(key);
				values.setNil(slot);
			}
			slots[index] = slot;
		}
		return slots;
	}

	private activateExecutionImage(executionBoot: Blua32ExecutionBoot): Blua32ExecutionImage {
		const executionDomainId = executionBoot.executionDomainId;
		this.executionAddressSpace.bindReadOnlyView(
			executionDomainId,
			executionBoot.imageAddress,
			BLUA32_IMAGE_HEADER_SIZE,
			this.executionReadView,
		);
		const headerBytes = this.executionReadView.bytes;
		const headerByteOffset = this.executionReadView.byteOffset;
		const constantTableAddress = readLE32(
			headerBytes,
			headerByteOffset + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET,
		);
		const constantCount = readLE32(
			headerBytes,
			headerByteOffset + BLUA32_IMAGE_CONSTANT_COUNT_OFFSET,
		);
		const globalNameTableAddress = readLE32(
			headerBytes,
			headerByteOffset + BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
		);
		const globalNameCount = readLE32(
			headerBytes,
			headerByteOffset + BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET,
		);
		const systemGlobalNameTableAddress = readLE32(
			headerBytes,
			headerByteOffset + BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
		);
		const systemGlobalNameCount = readLE32(
			headerBytes,
			headerByteOffset + BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET,
		);
		const constTags = new Uint8Array(constantCount);
		const constScalars = new Float64Array(constantCount);
		this.decodeConstantPool(
			executionDomainId,
			constantTableAddress,
			constTags,
			constScalars,
		);
		const globalSlots = this.registerGlobalNames(
			executionDomainId,
			globalNameTableAddress,
			globalNameCount,
			false,
		);
		const systemGlobalSlots = this.registerGlobalNames(
			executionDomainId,
			systemGlobalNameTableAddress,
			systemGlobalNameCount,
			true,
		);
		const image: Blua32ExecutionImage = {
			executionDomainId,
			irqFunctionAddress: executionBoot.irqFunctionAddress,
			constTags,
			constScalars,
			globalSlots,
			systemGlobalSlots,
			decodedPages: new Map(),
			compiledCodeLookup: null,
		};
		return image;
	}

	private executionImageForDomain(executionDomainId: ExecutionDomainId): Blua32ExecutionImage | null {
		const imageIndex = executionDomainId + 1;
		const residentImage = this.executionImagesByDomain[imageIndex];
		if (residentImage) {
			return residentImage;
		}
		const executionBoot = this.executionAddressSpace.resolveDomain(executionDomainId);
		if (!executionBoot) {
			return null;
		}
		const image = this.activateExecutionImage(executionBoot);
		this.executionImagesByDomain[imageIndex] = image;
		return image;
	}

	private static executionBusSignalsForDomain(
		executionDomainId: ExecutionDomainId,
	): MappedBusSignals {
		return executionDomainId === SYSTEM_EXECUTION_DOMAIN_ID
			? MAPPED_BUS_MASTER_CPU
			: mappedBusSignalsForCartridgeSlot(executionDomainId);
	}

	private latchActiveExecutionImage(image: Blua32ExecutionImage): void {
		this.activeExecutionImage = image;
		this.executionBusSignals = CPU.executionBusSignalsForDomain(image.executionDomainId);
	}

	private staticClosureAtAddress(address: number): Closure {
		const existing = this.staticClosuresByAddress.get(address);
		if (existing) {
			return existing;
		}
		const closure = new Closure(address, EMPTY_CLOSURE_UPVALUES, 0);
		closure.hashId = this.allocateObjectHashId();
		this.staticClosuresByAddress.set(address, closure);
		return closure;
	}

	public replaceExecutionImage(executionBoot: Blua32ExecutionBoot): void {
		const imageIndex = executionBoot.executionDomainId + 1;
		const previousImage = this.executionImagesByDomain[imageIndex];
		if (previousImage !== null) {
			for (const page of previousImage.decodedPages.values()) {
				this.compiledCodeCache.retirePage(page);
			}
		}
		const image = this.activateExecutionImage(executionBoot);
		this.executionImagesByDomain[imageIndex] = image;
		if (executionBoot.executionDomainId === SYSTEM_EXECUTION_DOMAIN_ID) {
			this.systemImage = image;
			this.systemExceptionFunctionAddress = executionBoot.exceptionFunctionAddress;
		}
		if (this.activeExecutionImage === previousImage) {
			this.latchActiveExecutionImage(image);
		}
	}

	public isExecutionDomainResident(executionDomainId: ExecutionDomainId): boolean {
		return this.executionImagesByDomain[executionDomainId + 1] !== null;
	}

	private decodedPageForAddress(
		image: Blua32ExecutionImage,
		binding: MappedPageBinding,
	): DecodedInstructionPage {
		const existing = image.decodedPages.get(binding.key);
		if (existing !== undefined) {
			return existing;
		}
		const page = createDecodedInstructionPage(
			binding.cacheable,
			binding.writeWatches,
			binding.writeWatchIndex,
		);
		image.decodedPages.set(binding.key, page);
		return page;
	}

	private invalidateDecodedWords(key: number, firstWord: number, endWord: number): void {
		const firstPredecessor = Math.max(0, firstWord - DECODED_DEPENDENCY_PREDECESSOR_WORDS);
		const predecessorEnd = Math.min(firstWord, DECODED_PAGE_WORDS);
		for (let index = 0; index < this.executionImagesByDomain.length; index += 1) {
			const image = this.executionImagesByDomain[index];
			if (image === null) {
				continue;
			}
			const page = image.decodedPages.get(key);
			if (page !== undefined) {
				this.compiledCodeCache.retirePage(page, firstWord, endWord);
				for (let word = firstPredecessor; word < predecessorEnd; ++word) {
					if ((page.refreshState[word] & DECODED_REFRESH_DECODE) !== 0) continue;
					const ownEnd = word + page.widths[word];
					if (ownEnd > firstWord) page.refreshState[word] = DECODED_REFRESH_DECODE;
					else if (ownEnd + 2 > firstWord && decodedDispatchCanFuse(page.ops[word])
						&& (page.compiledBlocks === null || page.compiledBlocks.entries[word] === null)) {
						page.refreshState[word] |= DECODED_REFRESH_FUSION;
					}
				}
				if (firstWord < DECODED_PAGE_WORDS) page.refreshState.fill(DECODED_REFRESH_DECODE, firstWord, endWord);
			}
		}
	}

	public invalidateMappedWords(key: number, firstWord: number, endWord: number): void {
		this.invalidateDecodedWords(key, firstWord, endWord);
		if (firstWord < DECODED_DEPENDENCY_PREDECESSOR_WORDS && key >= MAPPED_PAGE_BYTE_SIZE) {
			this.invalidateDecodedWords(
				key - MAPPED_PAGE_BYTE_SIZE,
				DECODED_PAGE_WORDS + firstWord,
				DECODED_PAGE_WORDS + endWord,
			);
		}
	}

	public invalidateMappedRange(firstKey: number, endKey: number): void {
		const invalidationStart = firstKey >= MAPPED_PAGE_BYTE_SIZE
			? firstKey - MAPPED_PAGE_BYTE_SIZE
			: 0;
		for (let imageIndex = 0; imageIndex < this.executionImagesByDomain.length; imageIndex += 1) {
			const image = this.executionImagesByDomain[imageIndex];
			if (image === null) {
				continue;
			}
			for (const [key, page] of image.decodedPages) {
				if (key >= invalidationStart && key < endKey) {
					this.compiledCodeCache.retirePage(page);
					page.refreshState.fill(DECODED_REFRESH_DECODE);
				}
			}
		}
	}

	private decodedPageForFrame(frame: CallFrame, pc: number): DecodedInstructionPage {
		const pageAddress = (pc & ~MAPPED_PAGE_BYTE_MASK) >>> 0;
		const busSignals = mappedBusSignalsForCartridgeSlot(this.memory.cartridgeController.selectedSlot(this.executionBusSignals));
		const cached = frame.decodedPage;
		if (cached !== null
			&& frame.decodedPageAddress === pageAddress && frame.decodedPageBusSignals === busSignals) {
			return cached;
		}
		const binding = this.mappedPageBinding;
		this.memory.bindMappedPage(pageAddress, busSignals, binding);
		const page = this.decodedPageForAddress(frame.executionImage, binding);
		frame.decodedPage = page;
		frame.decodedPageAddress = pageAddress;
		frame.decodedPageBusSignals = busSignals;
		return page;
	}

	private decodeInstruction(
		frame: CallFrame,
		page: DecodedInstructionPage,
		pageOffset: number,
		pc: number,
		allowFusion: boolean,
	): boolean {
		let instructionCacheable = page.cacheable;
		let bodyPage: DecodedInstructionPage | null = null;
		let width = 1;
		let op: number;
		const faultSequence = this.memory.readBusFaultSequence();
		let wideA = 0;
		let wideB = 0;
		let wideC = 0;
		const sourceWord = this.memory.readMappedBusU32BE(pc, this.executionBusSignals);
		if (this.memory.readBusFaultSequence() !== faultSequence) {
			this.enterInstructionFetchException(frame, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, pc);
			return false;
		}
		let bodyWord = sourceWord;
		op = (sourceWord >>> 18) & 0x3f;
		let ext = sourceWord >>> 24;
		if (op === OpCode.WIDE) {
			width = 2;
			if (pageOffset === DECODED_PAGE_WORDS - 1) {
				bodyPage = this.decodedPageForFrame(frame, (pc + INSTRUCTION_BYTES) >>> 0);
				instructionCacheable = instructionCacheable && bodyPage.cacheable;
			}
			wideA = (sourceWord >>> 12) & 0x3f;
			wideB = (sourceWord >>> 6) & 0x3f;
			wideC = sourceWord & 0x3f;
			bodyWord = this.memory.readMappedBusU32BE(
				(pc + INSTRUCTION_BYTES) >>> 0,
				this.executionBusSignals,
			);
			if (this.memory.readBusFaultSequence() !== faultSequence) {
				this.enterInstructionFetchException(frame, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, pc);
				return false;
			}
			op = (bodyWord >>> 18) & 0x3f;
			ext = bodyWord >>> 24;
		}
		const unchanged = page.widths[pageOffset] !== 0
			&& page.sourceWords[pageOffset] === sourceWord
			&& page.bodyWords[pageOffset] === bodyWord
			&& page.widths[pageOffset] === width;
		if (!unchanged) {
			const aLow = (bodyWord >>> 12) & 0x3f;
			const bLow = (bodyWord >>> 6) & 0x3f;
			const cLow = bodyWord & 0x3f;
			page.widths[pageOffset] = width;
			page.sourceWords[pageOffset] = sourceWord;
			page.bodyWords[pageOffset] = bodyWord;
			page.ops[pageOffset] = op;
			if (OPCODE_USES_DISP[op] !== 0) {
				page.a[pageOffset] = (wideA << MAX_OPERAND_BITS) | aLow;
				page.b[pageOffset] = (wideB << MAX_OPERAND_BITS) | bLow;
				page.c[pageOffset] = (wideC << MAX_OPERAND_BITS) | cLow;
				page.disp[pageOffset] = ext;
				if (page.c[pageOffset] > MemoryAccessKind.F64LE
					&& (op === OpCode.LOAD_MEM_D || op === OpCode.STORE_MEM_D)) {
					page.ops[pageOffset] = DecodedDispatchOp.ReservedMemory;
				}
			} else if (OPCODE_USES_BX[op] !== 0) {
				page.a[pageOffset] = (wideA << MAX_OPERAND_BITS) | aLow;
				const bx = (wideB << BASE_BX_BITS) | (ext << MAX_BX_BITS) | (bodyWord & MAX_LOW_BX);
				switch (op) {
					case OpCode.KSMI:
						page.sbx[pageOffset] = signExtend(bx, BASE_BX_BITS + ((width - 1) * MAX_OPERAND_BITS));
						break;
					case OpCode.GETGL:
					case OpCode.SETGL:
						page.bx[pageOffset] = frame.executionImage.globalSlots[bx];
						break;
					case OpCode.GETSYS:
					case OpCode.SETSYS:
						page.bx[pageOffset] = frame.executionImage.systemGlobalSlots[bx];
						break;
					case OpCode.JMP:
					case OpCode.JMPIF:
					case OpCode.JMPIFNOT:
						page.bx[pageOffset] = (pc + width * INSTRUCTION_BYTES
							+ signExtend(bx, BASE_BX_BITS + ((width - 1) * MAX_OPERAND_BITS)) * INSTRUCTION_BYTES) >>> 0;
						break;
					case OpCode.CLOSURE:
						page.c[pageOffset] = (wideC << BASE_OPERAND_BC_BITS) | cLow;
					default:
						page.bx[pageOffset] = bx;
						break;
				}
			} else {
				page.a[pageOffset] = (wideA << BASE_OPERAND_A_BITS) | ((ext >>> 6) << MAX_OPERAND_BITS) | aLow;
				const rawB = (wideB << BASE_OPERAND_BC_BITS) | (((ext >>> 3) & 7) << MAX_OPERAND_BITS) | bLow;
				const rawC = (wideC << BASE_OPERAND_BC_BITS) | ((ext & 7) << MAX_OPERAND_BITS) | cLow;
				const rkOperands = OPCODE_RK_OPERANDS[op];
				page.b[pageOffset] = (rkOperands & RK_OPERAND_B) !== 0
					? signExtend(rawB, BASE_OPERAND_BC_BITS + ((width - 1) * MAX_OPERAND_BITS)) : rawB;
				page.c[pageOffset] = (rkOperands & RK_OPERAND_C) !== 0
					? signExtend(rawC, BASE_OPERAND_BC_BITS + ((width - 1) * MAX_OPERAND_BITS)) : rawC;
				if (op === OpCode.GETFIELD || op === OpCode.SETFIELD || op === OpCode.SELF || op === OpCode.GETT || op === OpCode.SETT) {
					page.tableCacheSlots[pageOffset] = -1;
				}
				if (rawC > MemoryAccessKind.F64LE && (op === OpCode.LOAD_MEM || op === OpCode.STORE_MEM)) {
					page.ops[pageOffset] = DecodedDispatchOp.ReservedMemory;
				}
			}
		}
		page.dispatchOps[pageOffset] = page.ops[pageOffset];
		page.dispatchCycles[pageOffset] = DECODED_DISPATCH_BASE_CYCLES[page.ops[pageOffset]];
		page.refreshState[pageOffset] = instructionCacheable ? 0 : DECODED_REFRESH_DECODE;
		if (instructionCacheable && page.writeWatches !== null) {
			page.writeWatches.armWord(page.writeWatchIndex, pageOffset);
			if (width === 2 && bodyPage === null) page.writeWatches.armWord(page.writeWatchIndex, pageOffset + 1);
		}
		if (instructionCacheable && bodyPage !== null && bodyPage.writeWatches !== null) {
			bodyPage.writeWatches.armWord(bodyPage.writeWatchIndex, 0);
		}
		const observed = this.instructionObserver?.points[frame.executionImage.executionDomainId + 1];
		if (observed?.has(pc)) {
			page.dispatchOps[pageOffset] = DecodedDispatchOp.Observe;
			page.dispatchCycles[pageOffset] = 0;
			return true;
		}
		if (instructionCacheable && this.executionBackend === CpuExecutionBackend.JavaScript
			&& compiledBlockSupports(page.ops[pageOffset])
			&& (compiledBlockEndsBlock(page.ops[pageOffset], page.b[pageOffset]) || pageOffset + width < DECODED_PAGE_WORDS)) {
			if (page.compiledBlocks === null) page.compiledBlocks = new CompiledBlockPage();
			page.compiledBlocks.visits[pageOffset] = 0;
			page.dispatchOps[pageOffset] = DecodedDispatchOp.CompiledWarm;
			return true;
		}
		const fusionCandidate = decodedDispatchCanFuse(op);
		if (!allowFusion) {
			if (fusionCandidate && instructionCacheable) {
				page.refreshState[pageOffset] = DECODED_REFRESH_FUSION;
			}
			return true;
		}
		if (!fusionCandidate || !instructionCacheable) {
			return true;
		}
		const nextPc = (pc + width * INSTRUCTION_BYTES) >>> 0;
		if (observed?.has(nextPc)) return true;
		const nextPage = this.decodedPageForFrame(frame, nextPc);
		if (!nextPage.cacheable) {
			return true;
		}
		const nextPageOffset = (nextPc & MAPPED_PAGE_BYTE_MASK) >>> 2;
		const nextRefreshState = nextPage.refreshState[nextPageOffset];
		if ((nextRefreshState & DECODED_REFRESH_DECODE) !== 0) {
			if (nextPageOffset === DECODED_PAGE_WORDS - 1) {
				page.refreshState[pageOffset] = DECODED_REFRESH_FUSION;
				return true;
			}
			// Lookahead may inspect only fully backed memory, never a faulting bus access.
			// The last-word exclusion above keeps a WIDE body in that same backing page.
			const binding = this.mappedPageBinding;
			this.memory.bindMappedPage(
				(nextPc & ~MAPPED_PAGE_BYTE_MASK) >>> 0,
				this.executionBusSignals,
				binding,
			);
			if (binding.readBytes === null) {
				return true;
			}
			if (!this.decodeInstruction(
				frame,
				nextPage,
				nextPageOffset,
				nextPc,
				false,
			)) {
				return false;
			}
			if ((nextPage.refreshState[nextPageOffset] & DECODED_REFRESH_DECODE) !== 0) {
				return true;
			}
		}
		page.dispatchOps[pageOffset] = decodedDispatchOp(
			op as OpCode,
			nextPage.ops[nextPageOffset] as OpCode,
		);
		return true;
	}

	private readFunctionRecord(
		image: Blua32ExecutionImage,
		address: number,
		busSignals: MappedBusSignals,
	): boolean {
		const latch = this.functionRecordLatch;
		latch.image = image;
		latch.busSignals = busSignals;
		latch.address = address;
		latch.cacheableRead = false;
		const view = this.executionReadView;
		if (this.memory.bindMappedReadView(address, BLUA32_FUNCTION_RECORD_SIZE, busSignals, view)) {
			latch.cacheableRead = true;
			const bytes = view.bytes;
			const recordByteOffset = view.byteOffset;
			latch.codeAddress = readLE32(
				bytes,
				recordByteOffset + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
			);
			latch.numParams = readLE32(
				bytes,
				recordByteOffset + BLUA32_FUNCTION_NUM_PARAMS_OFFSET,
			);
			latch.maxStack = readLE32(
				bytes,
				recordByteOffset + BLUA32_FUNCTION_MAX_STACK_OFFSET,
			);
			latch.flags = readLE32(
				bytes,
				recordByteOffset + BLUA32_FUNCTION_FLAGS_OFFSET,
			);
			latch.upvalueTableAddress = readLE32(
				bytes,
				recordByteOffset + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
			);
			latch.upvalueCount = readLE32(
				bytes,
				recordByteOffset + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET,
			);
			return true;
		}
		const faultSequence = this.memory.readBusFaultSequence();
		latch.codeAddress = this.memory.readMappedBusU32LE(
			(address + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET) >>> 0,
			busSignals,
		);
		latch.numParams = this.memory.readMappedBusU32LE(
			(address + BLUA32_FUNCTION_NUM_PARAMS_OFFSET) >>> 0,
			busSignals,
		);
		latch.maxStack = this.memory.readMappedBusU32LE(
			(address + BLUA32_FUNCTION_MAX_STACK_OFFSET) >>> 0,
			busSignals,
		);
		latch.flags = this.memory.readMappedBusU32LE(
			(address + BLUA32_FUNCTION_FLAGS_OFFSET) >>> 0,
			busSignals,
		);
		latch.upvalueTableAddress = this.memory.readMappedBusU32LE(
			(address + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET) >>> 0,
			busSignals,
		);
		latch.upvalueCount = this.memory.readMappedBusU32LE(
			(address + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET) >>> 0,
			busSignals,
		);
		return this.memory.readBusFaultSequence() === faultSequence;
	}

	private readFunctionRecordOnBus(
		ambientExecutionImage: Blua32ExecutionImage,
		address: number,
		busSignals: MappedBusSignals,
	): boolean {
		const executionDomainId = this.executionAddressSpace.domainIdOnBus(address, busSignals);
		const image = executionDomainId === null
			? ambientExecutionImage
			: this.executionImageForDomain(executionDomainId);
		return image !== null && this.readFunctionRecord(image, address, busSignals);
	}

	public isCartridgeExecutionActive(): boolean {
		return this.activeExecutionImage.executionDomainId >= 0;
	}

	public activeCartridgeSlot(): ExecutionDomainId {
		return this.activeExecutionImage.executionDomainId;
	}

	public readExecutionBusSignals(): MappedBusSignals {
		return this.executionBusSignals;
	}

	private executeFunctionAddress(functionAddress: number): void {
		if (!this.readFunctionRecordOnBus(
			this.activeExecutionImage,
			functionAddress,
			MAPPED_BUS_MASTER_CPU,
		)
			|| (this.functionRecordLatch.flags & BLUA32_FUNCTION_STATIC) === 0) {
			this.hardHalt();
			return;
		}
		const image = this.functionRecordLatch.image;
		this.clearCallStack();
		this.latchActiveExecutionImage(image);
		const cartridgeEntry = image.executionDomainId >= 0;
		this.cop0Words[COP0_STATUS] = cartridgeEntry ? CPU_STATUS_CART_ENTRY : CPU_STATUS_SYSTEM_ENTRY;
		this.haltedUntilIrqFrameDepth = -1;
		this.haltedUntilIrqThread = null;
		this.interruptEventPending = false;
		this.memoryWriteBlocked = false;
		this.memoryWriteBlockedAddress = 0;
		this.hardHalted = false;
		this.yieldRequested = false;
		const closure = this.staticClosureAtAddress(functionAddress);
		this.pushLatchedFrame(closure, EMPTY_CALL_ARGS, 0, 0, false);
	}

	public beginCompletionCall(closure: Closure, args: ReadonlyArray<Value> = EMPTY_CALL_ARGS): void {
		const roots = this.acquireLocalRoots();
		this.localRoots.push(closure);
		for (const arg of args) this.localRoots.push(arg);
		try {
			this.clearCompletionValues();
			this.completionThread = this.activeThread;
			this.yieldRequested = false;
			this.pushFrame(closure, args, 0, 0, true);
		} finally {
			this.releaseLocalRoots(roots);
		}
	}

	public beginCompletionCallInExecutionDomain(
		executionDomainId: ExecutionDomainId,
		functionAddress: number,
	): void {
		this.beginCompletionClosureInExecutionDomain(executionDomainId, this.staticClosureAtAddress(functionAddress));
	}

	public beginCompletionClosureInExecutionDomain(
		executionDomainId: ExecutionDomainId,
		closure: Closure,
		args: ReadonlyArray<Value> = EMPTY_CALL_ARGS,
	): void {
		const roots = this.acquireLocalRoots();
		this.localRoots.push(closure);
		for (const arg of args) this.localRoots.push(arg);
		try {
			this.clearCompletionValues();
			this.completionThread = this.activeThread;
			this.yieldRequested = false;
			this.readFunctionRecord(
				this.executionImageForDomain(executionDomainId)!,
				closure.functionAddress,
				CPU.executionBusSignalsForDomain(executionDomainId),
			);
			this.pushLatchedFrame(closure, args, 0, 0, true);
		} finally {
			this.releaseLocalRoots(roots);
		}
	}

	public requestYield(): void {
		this.yieldRequested = true;
	}

	public setInstructionObserver(binding: InstructionObserverBinding | null): void {
		this.instructionObserver = binding;
		// Also invalidate predecessors: an old fused dispatch may cross a newly observed PC.
		for (const image of this.executionImagesByDomain) {
			if (image === null) continue;
			for (const page of image.decodedPages.values()) {
				this.compiledCodeCache.retirePage(page);
				page.refreshState.fill(DECODED_REFRESH_DECODE);
			}
		}
	}

	public setExecutionHook(
		hook: ExecutionHook | null,
		domainMask: ExecutionDomainMask,
		preMaskableInterruptDomainMask: ExecutionDomainMask,
	): void {
		this.executionHook = hook;
		this.executionHookDomainMask = domainMask;
		this.preMaskableInterruptExecutionHookDomainMask = preMaskableInterruptDomainMask;
		this.runUntilDepthEntry = hook === null
			? this.runUntilDepthNormal
			: this.runUntilDepthInstrumented;
	}

	public haltUntilIrq(): void {
		if (this.interruptEventPending) {
			this.interruptEventPending = false;
			return;
		}
		this.haltedUntilIrqFrameDepth = this.activeThread.frames.length;
		this.haltedUntilIrqThread = this.activeThread;
		this.yieldRequested = false;
	}

	private hardHalt(): void {
		this.hardHalted = true;
		this.haltedUntilIrqFrameDepth = -1;
		this.haltedUntilIrqThread = null;
		this.yieldRequested = false;
	}


	public clearHaltUntilIrq(): void {
		this.haltedUntilIrqFrameDepth = -1;
		this.haltedUntilIrqThread = null;
		this.yieldRequested = false;
	}

	public isHaltedUntilIrq(): boolean {
		return this.haltedUntilIrqThread === this.activeThread && this.haltedUntilIrqFrameDepth === this.activeThread.frames.length;
	}

	public isMemoryWriteBlocked(): boolean {
		return this.memoryWriteBlocked;
	}

	public stalledMemoryWriteAddress(): number {
		return this.memoryWriteBlockedAddress;
	}

	public resumeMemoryWrite(address: number): void {
		// A device-ready edge releases only the instruction stalled on that raw MMIO target.
		if (this.memoryWriteBlocked && this.memoryWriteBlockedAddress === address) {
			this.memoryWriteBlocked = false;
		}
	}

	public abortStalledMemoryWrite(): void {
		this.memoryWriteBlocked = false;
	}

	private blockMappedWrite(frame: CallFrame, address: number): void {
		frame.pc = this.currentInstructionPc;
		this.memoryWriteBlocked = true;
		this.memoryWriteBlockedAddress = address;
		this.yieldRequested = false;
	}


	public isUserMode(): boolean {
		return (this.cop0Words[COP0_STATUS] & CPU_STATUS_USER_MODE_CURRENT) !== 0;
	}

	public requestNonMaskableInterrupt(): void {
		// NMI is an edge latch and can preempt the supervisor IRQ root reached
		// immediately before a system-request fence.
		this.nonMaskableInterruptPending = true;
	}

	public cancelNonMaskableInterrupt(): void {
		this.nonMaskableInterruptPending = false;
	}

	public canAcceptMaskableInterruptLine(): boolean {
		return (this.cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) !== 0
			&& this.irqController.hasAssertedMaskableInterruptLine();
	}

	public peekPendingInterrupt(): AcceptedInterruptKind {
		if (this.nonMaskableInterruptPending) {
			return AcceptedInterruptKind.NonMaskable;
		}
		if (this.canAcceptMaskableInterruptLine()) {
			return AcceptedInterruptKind.Maskable;
		}
		return AcceptedInterruptKind.None;
	}

	public enterPendingInterrupt(): boolean {
		if (this.nonMaskableInterruptPending) {
			this.nonMaskableInterruptPending = false;
			const hadHaltLatch = this.haltedUntilIrqFrameDepth >= 0;
			const returnCauseWord = this.cop0Words[COP0_CAUSE];
			const returnEpcWord = this.cop0Words[COP0_EPC];
			const returnBadAddressWord = this.cop0Words[COP0_BAD_ADDRESS];
			const returnLuaFaultReasonWord = this.cop0Words[COP0_LUA_FAULT_REASON];
			const returnExceptionDomainWord = this.exceptionDomainWord;
			this.enterException(
				this.systemExceptionFunctionAddress,
				CPU_CAUSE_NMI,
				this.activeThread.frames[this.activeThread.frames.length - 1].pc,
			);
			this.activeThread.frames[this.activeThread.frames.length - 1].isNonMaskableExceptionFrame = true;
			this.nmiReturnCauseWord = returnCauseWord;
			this.nmiReturnEpcWord = returnEpcWord;
			this.nmiReturnBadAddressWord = returnBadAddressWord;
			this.nmiReturnLuaFaultReasonWord = returnLuaFaultReasonWord;
			this.nmiReturnExceptionDomainWord = returnExceptionDomainWord;
			if (!hadHaltLatch) this.interruptEventPending = true;
			return true;
		}
		if (this.canAcceptMaskableInterruptLine()) {
			const image = this.isUserMode() ? this.activeExecutionImage : this.systemImage;
			const hadHaltLatch = this.haltedUntilIrqFrameDepth >= 0;
			this.enterException(
				image.irqFunctionAddress,
				CPU_CAUSE_IRQ,
				this.activeThread.frames[this.activeThread.frames.length - 1].pc,
			);
			if (!hadHaltLatch) this.interruptEventPending = true;
			return true;
		}
		return false;
	}

	private enterSynchronousException(interruptedFrame: CallFrame, causeWord: number): void {
		interruptedFrame.pc = this.currentInstructionPc;
		this.enterException(this.systemExceptionFunctionAddress, causeWord, this.currentInstructionPc);
	}

	private enterSynchronousAddressException(interruptedFrame: CallFrame, causeWord: number, address: number): void {
		this.cop0Words[COP0_BAD_ADDRESS] = address >>> 0;
		this.enterSynchronousException(interruptedFrame, causeWord);
	}

	private enterInstructionFetchException(interruptedFrame: CallFrame, causeWord: number, pc: number): void {
		this.instructionBudgetRemaining -= 1;
		interruptedFrame.pc = pc;
		this.enterException(this.systemExceptionFunctionAddress, causeWord, pc);
	}

	private enterLuaFaultException(
		reason: number,
		errorTag: ValueTag,
		errorScalar: number,
		errorReference: ValueReference,
	): void {
		this.cop0Words[COP0_LUA_FAULT_REASON] = reason;
		this.enterSynchronousException(this.activeThread.frames[this.activeThread.frames.length - 1], CPU_CAUSE_CODE_TRAP);
		this.activeThread.frames[this.activeThread.frames.length - 1].registers.setEncoded(
			0,
			errorTag,
			errorScalar,
			errorReference,
		);
	}

	private returnFromException(frame: CallFrame): void {
		if (this.isUserMode()) {
			this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
			return;
		}
		if (!frame.isExceptionFrame) {
			this.hardHalt();
			return;
		}
		const returnFromNmi = frame.isNonMaskableExceptionFrame;
		const returnPc = this.cop0Words[COP0_EPC];
		const caller = this.activeThread.frames[this.activeThread.frames.length - 2];
		this.closeUpvalues(frame);
		this.activeThread.frames.pop();
		this.activeThread.stackTop = frame.varargBase;
		this.releaseFrame(frame);
		this.cop0Words[COP0_STATUS] = ((this.cop0Words[COP0_STATUS] & ~CPU_STATUS_RFE_RESTORE_MASK)
			| ((this.cop0Words[COP0_STATUS] >> 2) & CPU_STATUS_RFE_RESTORE_MASK)) >>> 0;
		if (caller) {
			caller.pc = returnPc;
		}
		if (returnFromNmi) {
			this.cop0Words[COP0_CAUSE] = this.nmiReturnCauseWord;
			this.cop0Words[COP0_EPC] = this.nmiReturnEpcWord;
			this.cop0Words[COP0_BAD_ADDRESS] = this.nmiReturnBadAddressWord;
			this.cop0Words[COP0_LUA_FAULT_REASON] = this.nmiReturnLuaFaultReasonWord;
			this.exceptionDomainWord = this.nmiReturnExceptionDomainWord;
		}
	}

	private enterException(
		functionAddress: number,
		causeWord: number,
		epcWord: number,
	): void {
		this.exceptionDomainWord = this.activeThread.frames[this.activeThread.frames.length - 1].executionImage.executionDomainId >>> 0;
		this.cop0Words[COP0_EPC] = epcWord >>> 0;
		this.cop0Words[COP0_CAUSE] = causeWord >>> 0;
		this.cop0Words[COP0_STATUS] = ((this.cop0Words[COP0_STATUS] & ~CPU_STATUS_MODE_STACK_MASK)
			| ((this.cop0Words[COP0_STATUS] << 2) & CPU_STATUS_MODE_STACK_MASK)) >>> 0;
		this.clearHaltAfterAcceptedInterrupt();
		const closure = this.staticClosureAtAddress(functionAddress);
		const frame = this.pushFrame(closure, EMPTY_CALL_ARGS, 0, 0, false)!;
		frame.callSitePc = epcWord;
		frame.isExceptionFrame = true;
	}

	private clearHaltAfterAcceptedInterrupt(): void {
		this.haltedUntilIrqFrameDepth = -1;
		this.haltedUntilIrqThread = null;
		this.yieldRequested = false;
	}

	public getFrameDepth(): number {
		return this.activeThread.frames.length;
	}

	public runUntilDepth(targetDepth: number, instructionBudget: number, target: Thread = this.rootThread): RunResult {
		for (;;) {
			const result = this.runUntilDepthEntry(this.activeThread === target ? targetDepth : 0, instructionBudget);
			if (!this.threadSwitchRequested) return result;
			this.threadSwitchRequested = false;
			this.yieldRequested = false;
			instructionBudget = this.instructionBudgetRemaining;
			if (instructionBudget <= 0) return RunResult.Yielded;
		}
	}

	private runUntilDepthNormal(targetDepth: number, instructionBudget: number): RunResult {
		this.instructionBudgetRemaining = instructionBudget;
		const frames = this.activeThread.frames;
		while (frames.length > targetDepth) {
			try {
				while (frames.length > targetDepth) {
					if (this.hardHalted
						|| (this.haltedUntilIrqThread === this.activeThread && this.haltedUntilIrqFrameDepth === frames.length)
						|| this.memoryWriteBlocked) {
						return RunResult.Halted;
					}
					if (this.yieldRequested) {
						this.yieldRequested = false;
						return RunResult.Yielded;
					}
					if (this.instructionBudgetRemaining <= 0) {
						return RunResult.Yielded;
					}
					if (this.nonMaskableInterruptPending
						|| ((this.cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) !== 0
							&& this.irqController.hasAssertedMaskableInterruptLine())
					) {
						this.enterPendingInterrupt();
						continue;
					}
					const frame = frames[frames.length - 1];
					const image = frame.executionImage;
					const pc = frame.pc;
					if ((pc & (INSTRUCTION_BYTES - 1)) !== 0) {
						this.cop0Words[COP0_BAD_ADDRESS] = pc;
						this.enterInstructionFetchException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, pc);
						continue;
					}
					const page = this.decodedPageForFrame(frame, pc);
					const pageOffset = (pc & MAPPED_PAGE_BYTE_MASK) >>> 2;
					if (page.refreshState[pageOffset] !== 0
						&& !this.decodeInstruction(frame, page, pageOffset, pc, true)) {
						continue;
					}
					const width = page.widths[pageOffset];
					const dispatchOp = page.dispatchOps[pageOffset];
					this.currentInstructionPc = pc;
					frame.pc = (pc + (width * INSTRUCTION_BYTES)) >>> 0;
					this.lastExecutionDomainId = image.executionDomainId;
					this.lastPc = (pc + ((width - 1) * INSTRUCTION_BYTES)) >>> 0;
					this.instructionBudgetRemaining -= page.dispatchCycles[pageOffset];
					this.executeInstruction(
						frame,
						page,
						pageOffset,
						dispatchOp,
						targetDepth,
					);
				}
			} catch (error) {
				this.handleRunLoopError(error);
			}
		}
		return RunResult.Halted;
	}

	private runUntilDepthInstrumented(targetDepth: number, instructionBudget: number): RunResult {
		this.instructionBudgetRemaining = instructionBudget;
		const frames = this.activeThread.frames;
		const baseCycles = DECODED_DISPATCH_BASE_CYCLES;
		const executionHook = this.executionHook!;
		const executionDomainMask = this.executionHookDomainMask;
		const preMaskableInterruptExecutionDomainMask =
			this.preMaskableInterruptExecutionHookDomainMask;
		while (frames.length > targetDepth) {
			try {
				while (frames.length > targetDepth) {
					if (this.hardHalted
						|| (this.haltedUntilIrqThread === this.activeThread && this.haltedUntilIrqFrameDepth === frames.length)
						|| this.memoryWriteBlocked) {
						return RunResult.Halted;
					}
					if (this.yieldRequested) {
						this.yieldRequested = false;
						return RunResult.Yielded;
					}
					if (this.instructionBudgetRemaining <= 0) {
						return RunResult.Yielded;
					}
					if (this.nonMaskableInterruptPending) {
						this.enterPendingInterrupt();
						continue;
					}
					if ((this.cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) !== 0
						&& this.irqController.hasAssertedMaskableInterruptLine()) {
						const interruptedFrame = frames[frames.length - 1];
						const interruptedImage = interruptedFrame.executionImage;
						if ((preMaskableInterruptExecutionDomainMask
							& executionDomainBit(interruptedImage.executionDomainId)) !== 0
							&& executionHook(interruptedImage.executionDomainId, interruptedFrame.pc)) {
							return RunResult.ExecutionStopped;
						}
						this.enterPendingInterrupt();
						continue;
					}
					const frame = frames[frames.length - 1];
					const image = frame.executionImage;
					const pc = frame.pc;
					if ((executionDomainMask & executionDomainBit(image.executionDomainId)) !== 0
						&& executionHook(image.executionDomainId, pc)) {
						return RunResult.ExecutionStopped;
					}
					if ((pc & (INSTRUCTION_BYTES - 1)) !== 0) {
						this.cop0Words[COP0_BAD_ADDRESS] = pc;
						this.enterInstructionFetchException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, pc);
						continue;
					}
					const page = this.decodedPageForFrame(frame, pc);
					const pageOffset = (pc & MAPPED_PAGE_BYTE_MASK) >>> 2;
					if ((page.refreshState[pageOffset] & DECODED_REFRESH_DECODE) !== 0
						&& !this.decodeInstruction(frame, page, pageOffset, pc, false)) {
						continue;
					}
					const width = page.widths[pageOffset];
					const op = page.dispatchOps[pageOffset] === DecodedDispatchOp.Observe
						? DecodedDispatchOp.Observe : page.ops[pageOffset];
					this.currentInstructionPc = pc;
					frame.pc = (pc + (width * INSTRUCTION_BYTES)) >>> 0;
					this.lastExecutionDomainId = image.executionDomainId;
					this.lastPc = (pc + ((width - 1) * INSTRUCTION_BYTES)) >>> 0;
					this.instructionBudgetRemaining -= baseCycles[op];
					this.executeInstruction(
						frame,
						page,
						pageOffset,
						op,
						targetDepth,
					);
				}
			} catch (error) {
				this.handleRunLoopError(error);
			}
		}
		return RunResult.Halted;
	}

	private handleRunLoopError(error: unknown): void {
		if (error === LUA_OUT_OF_MEMORY_SIGNAL) {
			const errorStringId = this.luaFaultErrorStringIds[LUA_FAULT_REASON_OUT_OF_MEMORY];
			if (!this.handleThreadError(ValueTag.String, errorStringId, null)) {
				this.enterLuaFaultException(
					LUA_FAULT_REASON_OUT_OF_MEMORY,
					ValueTag.String,
					errorStringId,
					null,
				);
			}
		} else if (error instanceof LuaThrownValueError) {
			if (!this.handleThreadError(error.tag, error.scalar, error.reference)) {
				this.enterLuaFaultException(
					LUA_FAULT_REASON_EXPLICIT_ERROR,
					error.tag,
					error.scalar,
					error.reference,
				);
			}
		} else if (error instanceof LuaExecutionError) {
			const errorStringId = this.luaFaultErrorStringIds[error.reason];
			if (!this.handleThreadError(ValueTag.String, errorStringId, null)) {
				this.enterLuaFaultException(error.reason, ValueTag.String, errorStringId, null);
			}
		} else {
			throw error;
		}
	}

	private unwindToDepth(targetDepth: number): void {
		while (this.activeThread.frames.length > targetDepth) {
			const frame = this.activeThread.frames.pop()!;
			this.closeUpvalues(frame);
			this.activeThread.stackTop = frame.varargBase;
			this.releaseFrame(frame);
		}
		while (this.activeThread.protectedCallDepth > 0) {
			const continuation = this.activeThread.protectedCallContinuations.peek(this.activeThread.protectedCallDepth - 1);
			if (this.activeThread.frames.indexOf(continuation.caller!) >= 0) {
				break;
			}
			continuation.caller = null;
			continuation.target = null;
			this.activeThread.protectedCallDepth -= 1;
		}
	}

	private charge(cycles: number): void {
		this.instructionBudgetRemaining -= cycles;
	}

	private skipNextInstruction(frame: CallFrame): void {
		const pc = frame.pc;
		const page = this.decodedPageForFrame(frame, pc);
		const pageOffset = (pc & MAPPED_PAGE_BYTE_MASK) >>> 2;
		if ((page.refreshState[pageOffset] & DECODED_REFRESH_DECODE) !== 0
			&& !this.decodeInstruction(frame, page, pageOffset, pc, false)) {
			return;
		}
		const nextPc = (pc + page.widths[pageOffset] * INSTRUCTION_BYTES) >>> 0;
		frame.pc = nextPc;
	}

	public readFrameExecutionDomain(frameIndex: number): ExecutionDomainId {
		return this.activeThread.frames[frameIndex].executionImage.executionDomainId;
	}

	public readLastExecutionDomain(): ExecutionDomainId {
		return this.lastExecutionDomainId;
	}

	/** Instruction start (including WIDE), inspected only during CPU execution. */
	public readCurrentInstructionPc(): number {
		return this.currentInstructionPc;
	}

	public readFrameFunctionAddress(frameIndex: number): number {
		return this.activeThread.frames[frameIndex].functionAddress;
	}

	public readFramePc(frameIndex: number): number {
		return this.activeThread.frames[frameIndex].pc;
	}

	public readFrameCallSitePc(childFrameIndex: number): number {
		return this.activeThread.frames[childFrameIndex].callSitePc;
	}

	public completionCallPending(): boolean {
		for (let frameIndex = this.completionThread.frames.length - 1; frameIndex >= 0; frameIndex -= 1) {
			if (this.completionThread.frames[frameIndex].returnToCompletionLatch) {
				return true;
			}
		}
		return false;
	}

	public readFrameReturnsToCompletionLatch(frameIndex: number): boolean {
		return this.activeThread.frames[frameIndex].returnToCompletionLatch;
	}

	public abortCompletionCall(frameIndex: number): void {
		this.unwindToDepth(frameIndex);
		this.clearCompletionValues();
	}

	public readCompletionValues(target: Value[]): void {
		this.completionValueSlots.copyTo(target, this.completionValueCount);
	}

	public isExceptionFrame(frameIndex: number): boolean {
		return this.activeThread.frames[frameIndex].isExceptionFrame;
	}

	/** Frame depth reached after all currently active exception roots return. */
	public readExceptionReturnFrameDepth(): number {
		for (let frameIndex = 0; frameIndex < this.activeThread.frames.length; frameIndex += 1) {
			if (this.activeThread.frames[frameIndex].isExceptionFrame) return frameIndex;
		}
		return -1;
	}

	public isNonMaskableExceptionFrame(frameIndex: number): boolean {
		return this.activeThread.frames[frameIndex].isNonMaskableExceptionFrame;
	}

	public getFrameRegisterCount(frameIndex: number): number {
		return this.activeThread.frames[frameIndex].top;
	}

	public readFrameRegister(frameIndex: number, registerIndex: number): Value {
		return this.activeThread.frames[frameIndex].registers.get(registerIndex);
	}

	public getFrameUpvalueCount(frameIndex: number): number {
		return this.activeThread.frames[frameIndex].closure.upvalues.length;
	}

	public readFrameUpvalue(frameIndex: number, upvalueIndex: number): Value {
		return this.readClosureUpvalue(this.activeThread.frames[frameIndex].closure, upvalueIndex);
	}

	/** Read a retained closure without calling it or requiring an active frame. */
	public readClosureUpvalue(closure: Closure, upvalueIndex: number): Value {
		const upvalue = closure.upvalues[upvalueIndex];
		if (upvalue.open) {
			return upvalue.frame!.registers.get(upvalue.index);
		}
		return materializeValue(upvalue.valueTag, upvalue.valueScalar, upvalue.valueReference);
	}

	public readEpcWord(): number {
		return this.cop0Words[COP0_EPC];
	}

	public readCauseWord(): number {
		return this.cop0Words[COP0_CAUSE];
	}

	public readBadAddressWord(): number {
		return this.cop0Words[COP0_BAD_ADDRESS];
	}

	public readLuaFaultReasonWord(): number {
		return this.cop0Words[COP0_LUA_FAULT_REASON];
	}

	public readExceptionDomainWord(): number {
		return this.exceptionDomainWord;
	}

	public writeEpcWord(value: number): void {
		this.cop0Words[COP0_EPC] = value;
	}

	public readNmiReturnEpcWord(): number {
		return this.nmiReturnEpcWord;
	}

	public writeNmiReturnEpcWord(value: number): void {
		this.nmiReturnEpcWord = value;
	}

	public writeFrameExecution(
		frameIndex: number,
		executionDomainId: ExecutionDomainId,
		functionAddress: number,
		pc: number,
	): void {
		const image = this.executionImageForDomain(executionDomainId)!;
		this.readFunctionRecord(
			image,
			functionAddress,
			CPU.executionBusSignalsForDomain(executionDomainId),
		);
		const functionRecord = this.functionRecordLatch;
		const frame = this.activeThread.frames[frameIndex];
		if (functionRecord.maxStack > frame.stackCapacity) {
			this.ensureRegisterCapacity(frame, functionRecord.maxStack - 1);
		}
		if ((functionRecord.flags & BLUA32_FUNCTION_STATIC) !== 0
			&& functionRecord.upvalueCount === 0) {
			frame.closure = this.staticClosureAtAddress(functionAddress);
		} else {
			frame.closure.functionAddress = functionAddress;
		}
		frame.functionAddress = functionAddress;
		frame.executionImage = image;
		frame.decodedPage = null;
		frame.decodedPageAddress = 0;
		frame.pc = pc;
	}

	public writeFrameCallSitePc(childFrameIndex: number, pc: number): void {
		this.activeThread.frames[childFrameIndex].callSitePc = pc;
	}

	public setGlobalByKey(
		key: StringId,
		tag: ValueTag,
		scalar: number,
		reference: ValueReference,
	): void {
		let slot = this.globalSlotByKey.get(key);
		if (slot === undefined) {
			slot = this.globalNames.length;
			this.globalSlots.reserveCapacity(slot + 1);
			this.globalSlotByKey.set(key, slot);
			this.globalNames.push(key);
		}
		this.globalSlots.setEncoded(slot, tag, scalar, reference);
	}

	public setSystemGlobalByKey(
		key: StringId,
		tag: ValueTag,
		scalar: number,
		reference: ValueReference,
	): void {
		const slot = this.systemGlobalSlotByKey.get(key);
		if (slot === undefined) {
			throw new Error(`System global '${this.stringPool.toString(key)}' has no register slot.`);
		}
		this.systemGlobalSlots.setEncoded(slot, tag, scalar, reference);
	}

	public getSystemGlobalByKey(key: StringId): Value {
		return this.systemGlobalSlots.get(this.systemGlobalSlotByKey.get(key)!);
	}

	public clearGlobalSlots(): void {
		this.systemGlobalNames = [];
		this.systemGlobalSlots.clear(this.systemGlobalSlots.capacity());
		this.systemGlobalSlotByKey = new Map();
		this.globalNames = [];
		this.globalSlots.clear(this.globalSlots.capacity());
		this.globalSlotByKey = new Map();
	}

	public get globalSlotCount(): number {
		return this.globalNames.length;
	}

	public getGlobalByKey(key: StringId): Value {
		const globalSlot = this.globalSlotByKey.get(key);
		return globalSlot === undefined ? null : this.globalSlots.get(globalSlot);
	}

	private executeFusedNumericPair(
		frame: CallFrame,
		page: DecodedInstructionPage,
		pageOffset: number,
		op: DecodedDispatchOp,
	): void {
		const registers = frame.registers;
		const image = frame.executionImage;
		const a = page.a[pageOffset];
		const rkB = page.b[pageOffset];
		const rkC = page.c[pageOffset];
		const leftConstantIndex = -1 - rkB;
		const left = rkB < 0
			? image.constTags[leftConstantIndex] === ValueTag.Number
				? image.constScalars[leftConstantIndex] : NaN
			: registers.getNumber(rkB);
		const rightConstantIndex = -1 - rkC;
		const right = rkC < 0
			? image.constTags[rightConstantIndex] === ValueTag.Number
				? image.constScalars[rightConstantIndex] : NaN
			: registers.getNumber(rkC);
		const isAddShl = op === DecodedDispatchOp.FusedAddShl;
		let firstResult: number;
		if (isAddShl) {
			firstResult = left + right;
		} else if (op === DecodedDispatchOp.FusedShlBxor) {
			firstResult = left << (right & 31);
		} else {
			firstResult = left >> (right & 31);
		}
		this.setRegisterNumberFast(frame, registers, a, firstResult);
		if (this.instructionBudgetRemaining <= 0) {
			return;
		}
		const pc = frame.pc;
		const secondPage = this.decodedPageForFrame(frame, pc);
		const secondPageOffset = (pc & MAPPED_PAGE_BYTE_MASK) >>> 2;
		if ((secondPage.refreshState[secondPageOffset] & DECODED_REFRESH_DECODE) !== 0) {
			if (!this.decodeInstruction(
				frame,
				secondPage,
				secondPageOffset,
				pc,
				false,
			)) {
				return;
			}
		}
		const width = secondPage.widths[secondPageOffset];
		this.currentInstructionPc = pc;
		frame.pc = (pc + width * INSTRUCTION_BYTES) >>> 0;
		this.lastExecutionDomainId = image.executionDomainId;
		this.lastPc = (pc + ((width - 1) * INSTRUCTION_BYTES)) >>> 0;
		this.instructionBudgetRemaining -= BASE_CYCLES[
			isAddShl ? OpCode.SHL : OpCode.BXOR
		];
		const secondRkB = secondPage.b[secondPageOffset];
		const secondRkC = secondPage.c[secondPageOffset];
		const secondLeftConstantIndex = -1 - secondRkB;
		const secondLeft = secondRkB < 0
			? image.constTags[secondLeftConstantIndex] === ValueTag.Number
				? image.constScalars[secondLeftConstantIndex] : NaN
			: registers.getNumber(secondRkB);
		const secondRightConstantIndex = -1 - secondRkC;
		const secondRight = secondRkC < 0
			? image.constTags[secondRightConstantIndex] === ValueTag.Number
				? image.constScalars[secondRightConstantIndex] : NaN
			: registers.getNumber(secondRkC);
		const secondResult = isAddShl
			? secondLeft << (secondRight & 31)
			: secondLeft ^ secondRight;
		this.setRegisterNumberFast(
			frame,
			registers,
			secondPage.a[secondPageOffset],
			secondResult,
		);
	}

	private executeConcat(frame: CallFrame, a: number, rkB: number, rkC: number): void {
		const registers = frame.registers, image = frame.executionImage;
		let leftTag: ValueTag;
		let leftScalar: number;
		if (rkB < 0) {
			const constantIndex = -1 - rkB;
			leftTag = image.constTags[constantIndex];
			leftScalar = image.constScalars[constantIndex];
		} else {
			leftTag = registers.getTag(rkB);
			leftScalar = registers.getScalar(rkB);
		}
		let rightTag: ValueTag;
		let rightScalar: number;
		if (rkC < 0) {
			const constantIndex = -1 - rkC;
			rightTag = image.constTags[constantIndex];
			rightScalar = image.constScalars[constantIndex];
		} else {
			rightTag = registers.getTag(rkC);
			rightScalar = registers.getScalar(rkC);
		}
		const text = storedValueToString(
			leftTag,
			leftScalar,
			this.stringPool,
		) + storedValueToString(
			rightTag,
			rightScalar,
			this.stringPool,
		);
		const handle = this.stringPool.intern(text);
		this.setRegisterStringFast(frame, registers, a, handle);
	}

	private executeConcatRange(frame: CallFrame, a: number, b: number, c: number): void {
		const registers = frame.registers;
		let text = '';
		for (let index = 0; index < c; index += 1) {
			const registerIndex = b + index;
			text += storedValueToString(
				registers.getTag(registerIndex),
				registers.getScalar(registerIndex),
				this.stringPool,
			);
		}
		const handle = this.stringPool.intern(text);
		this.setRegisterStringFast(frame, registers, a, handle);
	}

	private executeClosure(frame: CallFrame, a: number, bx: number, c: number): void {
		const registers = frame.registers;
		const functionAddress = (c & CLOSURE_ADDRESS_REGISTER_FLAG) !== 0
			? registers.getNumber(bx) >>> 0
			: bx * BLUA32_FUNCTION_ALIGNMENT;
		if (!this.readFunctionRecordOnBus(
			this.activeExecutionImage,
			functionAddress,
			this.executionBusSignals,
		)) {
			this.hardHalt();
			return;
		}
		const closure = this.createClosure(frame);
		if (closure === null) {
			return;
		}
		this.setRegisterClosureFast(frame, registers, a, closure);
		return;
	}

	private executeCall(frame: CallFrame, a: number, b: number, c: number): boolean {
		const registers = frame.registers;
		const argCount = b === 0 ? Math.max(frame.top - a - 1, 0) : b - 1;
		switch (registers.getTag(a)) {
			case ValueTag.BuiltinFunction:
				this.runBuiltinFunction(registers.getBuiltinFunctionId(a), frame, a, c, argCount);
				return false;
			case ValueTag.Closure: {
				const pushed = this.pushFrameFromCaller(
					frame,
					registers.getClosure(a),
					a + 1,
					argCount,
					a,
					c,
					false,
					frame.pc - INSTRUCTION_BYTES,
				);
				return pushed !== null && this.functionRecordLatch.cacheableRead;
			}
			default:
				throw new LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
		}
	}

	private executeReturn(frame: CallFrame, a: number, b: number): boolean {
		const registers = frame.registers;
		const total = b === 0 ? Math.max(frame.top - a, 0) : b;
		this.closeUpvalues(frame);
		const frameIndex = this.activeThread.frames.length - 1;
		if (this.activeThread.protectedCallDepth > 0) {
			const continuationIndex = this.activeThread.protectedCallDepth - 1;
			const continuation = this.activeThread.protectedCallContinuations.peek(continuationIndex);
			if (continuation.target === frame) {
				this.finishProtectedCallFromRegisters(continuationIndex, registers, a, total);
				this.activeThread.frames.pop();
				this.activeThread.stackTop = frame.varargBase;
				this.releaseFrame(frame);
				return false;
			}
		}
		if (frame.returnToCompletionLatch) {
			this.latchCompletionValues(registers, a, total);
			this.activeThread.frames.pop();
			this.activeThread.stackTop = frame.varargBase;
			this.releaseFrame(frame);
			return false;
		}
		if (frameIndex === 0 && this.activeThread.resumer !== null) {
			const finished = this.activeThread;
			finished.status = ThreadStatus.Dead;
			this.returnToResumer(registers, a, total, true);
			finished.frames.pop();
			finished.stackTop = 0;
			this.releaseFrame(frame);
			return false;
		}
		if (frameIndex === 0) {
			this.latchCompletionValues(registers, a, total);
			this.activeThread.frames.pop();
			this.activeThread.stackTop = frame.varargBase;
			this.releaseFrame(frame);
			return true;
		}
		const caller = this.activeThread.frames[frameIndex - 1];
		this.writeReturnValuesFromRegisters(caller, frame.returnBase, frame.returnCount, registers, a, total);
		this.activeThread.frames.pop();
		this.activeThread.stackTop = frame.varargBase;
		this.releaseFrame(frame);
		return true;
	}

	private executeVararg(frame: CallFrame, a: number, b: number): void {
		const count = b === 0 ? frame.varargCount : b;
		if (count !== 0) {
			this.ensureRegisterCapacity(frame, a + count - 1);
			const copied = Math.min(count, frame.varargCount);
			frame.registers.copyRangeFrom(frame.thread.stackRegisters, a, frame.varargBase, copied);
			frame.registers.clear(count - copied, a + copied);
		}
		frame.top = b === 0 ? a + count : Math.max(frame.top, a + count);
	}

	private executeMemoryLoad(frame: CallFrame, destination: number, kind: MemoryAccessKind, address: number): void {
		if ((address & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[kind]) !== 0) {
			this.enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, address);
			return;
		}
		const faultSequence = this.memory.readBusFaultSequence();
		let value: number;
		switch (kind) {
			case MemoryAccessKind.Word: value = this.memory.readMappedWord(address); break;
			case MemoryAccessKind.U8: value = this.memory.readMappedU8(address); break;
			case MemoryAccessKind.U16LE: value = this.memory.readMappedU16LE(address); break;
			case MemoryAccessKind.U32LE: value = this.memory.readMappedU32LE(address); break;
			case MemoryAccessKind.F32LE: value = this.memory.readMappedF32LE(address); break;
			case MemoryAccessKind.F64LE: value = this.memory.readMappedF64LE(address); break;
		}
		if (this.memory.readBusFaultSequence() !== faultSequence) {
			this.enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
			return;
		}
		this.setRegisterNumberFast(frame, frame.registers, destination, value);
	}

	private executeMemoryStore(frame: CallFrame, source: number, kind: MemoryAccessKind, address: number): void {
		if ((address & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[kind]) !== 0) {
			this.enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, address);
			return;
		}
		if (!this.memory.mappedWriteReady(address)) {
			this.blockMappedWrite(frame, address);
			return;
		}
		const value = frame.registers.getNumber(source);
		const faultSequence = this.memory.readBusFaultSequence();
		switch (kind) {
			case MemoryAccessKind.Word: this.memory.writeMappedWord(address, value >>> 0); break;
			case MemoryAccessKind.U8: this.memory.writeMappedU8(address, value); break;
			case MemoryAccessKind.U16LE: this.memory.writeMappedU16LE(address, value); break;
			case MemoryAccessKind.U32LE: this.memory.writeMappedU32LE(address, value); break;
			case MemoryAccessKind.F32LE: this.memory.writeMappedF32LE(address, value); break;
			case MemoryAccessKind.F64LE: this.memory.writeMappedF64LE(address, value); break;
		}
		if (this.memory.readBusFaultSequence() !== faultSequence) {
			this.enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
		}
	}

	private executeWordStores(frame: CallFrame, addr: number, valueBase: number, valueCount: number): void {
		if ((addr & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[MemoryAccessKind.Word]) !== 0) {
			this.enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, addr);
			return;
		}
		const blockedAddress = this.memory.firstBlockedMappedWordWrite(addr, valueCount);
		if (blockedAddress !== NO_BLOCKED_MAPPED_WRITE) {
			this.blockMappedWrite(frame, blockedAddress);
			return;
		}
		this.charge(ceilDiv4(valueCount));
		const faultSequence = this.memory.readBusFaultSequence();
		let writeAddr = addr;
		for (let offset = 0; offset < valueCount; offset += 1) {
			this.memory.writeMappedWord(writeAddr, frame.registers.getNumber(valueBase + offset) >>> 0);
			if (this.memory.readBusFaultSequence() !== faultSequence) {
				this.enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
				return;
			}
			writeAddr = (writeAddr + 4) >>> 0;
		}
	}

	private executeCompiledBlock(frame: CallFrame, page: DecodedInstructionPage, word: number, targetDepth: number): void {
		let cache = page.compiledBlocks!;
		if (page.dispatchOps[word] === DecodedDispatchOp.CompiledWarm) {
			if (++cache.visits[word] === COMPILED_BLOCK_THRESHOLD) {
				if (this.compiledCodeCache.atCapacity()) {
					this.compiledCodeCache.retireAll();
					cache.visits[word] = COMPILED_BLOCK_THRESHOLD;
				}
				const pc = this.currentInstructionPc;
				const binding = this.mappedPageBinding;
				this.memory.bindMappedPage((pc & ~MAPPED_PAGE_BYTE_MASK) >>> 0, this.executionBusSignals, binding);
				let cursor = word;
				let finalWord = word;
				let nextPc = pc;
				let count = 0;
				let warmingSuccessor = false;
				while (cursor < DECODED_PAGE_WORDS && count < COMPILED_BLOCK_MAX_INSTRUCTIONS) {
					if ((page.refreshState[cursor] & DECODED_REFRESH_DECODE) !== 0) {
						if (binding.readBytes === null || cursor === DECODED_PAGE_WORDS - 1) break;
						if (!this.decodeInstruction(frame, page, cursor, nextPc, false)) return;
					}
					if ((page.refreshState[cursor] & DECODED_REFRESH_DECODE) !== 0
						|| page.dispatchOps[cursor] === DecodedDispatchOp.Observe
						|| !compiledBlockSupports(page.ops[cursor])) break;
					if (count !== 0 && binding.writeWatches !== null && cache.visits[cursor] + 1 < COMPILED_BLOCK_THRESHOLD) {
						warmingSuccessor = true;
						break;
					}
					++count;
					finalWord = cursor;
					nextPc = (nextPc + page.widths[cursor] * INSTRUCTION_BYTES) >>> 0;
					const terminal = compiledBlockEndsBlock(page.ops[cursor], page.b[cursor]);
					cursor += page.widths[cursor];
					if (terminal) break;
				}
				if (count >= 2 || (count === 1 && compiledBlockEndsBlock(page.ops[word], page.b[word]))) {
					let skippedInstructionWidth = 0;
					if (binding.readBytes !== null && compiledBlockComparison(page.ops[finalWord])
						&& cursor < DECODED_PAGE_WORDS && (page.refreshState[cursor] & DECODED_REFRESH_DECODE) === 0
						&& cursor + page.widths[cursor] <= DECODED_PAGE_WORDS) {
						// Keep the already fetched width in this body's source dependency.
						skippedInstructionWidth = page.widths[cursor];
					}
					const block = compileJavaScriptBlock(page, word, cursor, pc, frame.executionImage, this.memory, this.stringPool,
						this.globalSlots, this.systemGlobalSlots, this.cop0Words, skippedInstructionWidth);
					this.compiledCodeCache.install(page, word, block);
					const image = frame.executionImage;
					if (image.compiledCodeLookup === null) image.compiledCodeLookup = new CompiledCodeLookup();
					image.compiledCodeLookup.install((pc & ~MAPPED_PAGE_BYTE_MASK) >>> 0,
						this.memory.cartridgeController.selectedSlot(this.executionBusSignals), page);
				} else if (warmingSuccessor) {
					cache.visits[word] = 0;
				} else {
					page.dispatchOps[word] = page.ops[word];
				}
			}
		}
		let block = cache.entries[word];
		if (block === null || this.instructionBudgetRemaining < block.entryCycles - page.dispatchCycles[word]) {
			this.executeInstruction(frame, page, word, page.ops[word], targetDepth);
			return;
		}
		const frames = this.activeThread.frames;
		let remaining = this.instructionBudgetRemaining + page.dispatchCycles[word];
		for (;;) {
			const registers = frame.registers;
			const image = frame.executionImage;
			let current = block;
			let registerTop = frame.top;
			let exit: CompiledBlockExitSite;
			for (;;) {
				exit = current.exits[current.execute(registers, image.constScalars, page, frame)];
				remaining -= exit.cycles;
				registerTop = Math.max(exit.resetsRegisterTop ? frame.top : registerTop, exit.registerTop);
				if (exit.exit !== CompiledBlockExit.Continue) break;
				const target = exit.linkedBlock;
				if (target === null) {
					// Existing entries in this physical page require neither a future
					// instruction fetch nor a mapping/cache allocation to link.
					if ((exit.nextPc & ~MAPPED_PAGE_BYTE_MASK) === (exit.currentPc & ~MAPPED_PAGE_BYTE_MASK)) {
						const successor = cache.entries[(exit.nextPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
						if (successor !== null) linkCompiledBlock(exit, successor);
					}
					break;
				}
				if (remaining < target.entryCycles) break;
				current = target;
			}
			this.instructionBudgetRemaining = remaining;
			frame.pc = exit.nextPc;
			frame.top = registerTop;
			this.currentInstructionPc = exit.currentPc;
			this.lastExecutionDomainId = image.executionDomainId;
			this.lastPc = exit.lastPc;
			let redispatch = false;
			switch (exit.exit) {
				case CompiledBlockExit.Continue: break;
				case CompiledBlockExit.Halt: this.haltUntilIrq(); redispatch = true; break;
				case CompiledBlockExit.ControlFault:
					if (this.isUserMode()) this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
					else this.hardHalt();
					redispatch = true; break;
				case CompiledBlockExit.ControlBoundary: redispatch = true; break;
				case CompiledBlockExit.ExecuteFunction:
					this.executeFunctionAddress(registers.getNumber(exit.exitA) >>> 0); redispatch = true; break;
				case CompiledBlockExit.ExceptionReturn: this.returnFromException(frame); redispatch = true; break;
				case CompiledBlockExit.CreateClosure:
					this.executeClosure(frame, exit.exitA, exit.exitBx, exit.exitC); redispatch = true; break;
				case CompiledBlockExit.Concat:
					this.executeConcat(frame, exit.exitA, exit.exitB, exit.exitC); break;
				case CompiledBlockExit.ConcatRange:
					this.executeConcatRange(frame, exit.exitA, exit.exitB, exit.exitC); break;
				case CompiledBlockExit.Call:
					redispatch = !this.executeCall(frame, exit.exitA, exit.exitB, exit.exitC);
					break;
				case CompiledBlockExit.Return:
					redispatch = !this.executeReturn(frame, exit.exitA, exit.exitB);
					break;
				case CompiledBlockExit.SkipInstruction: this.skipNextInstruction(frame); redispatch = true; break;
				case CompiledBlockExit.Vararg: this.executeVararg(frame, exit.exitA, exit.exitB); break;
				case CompiledBlockExit.WriteUpvalue:
					this.copyRegisterToUpvalue(frame.closure.upvalues[exit.exitB], registers, exit.exitA); break;
				case CompiledBlockExit.InvalidConstant: throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				case CompiledBlockExit.InvalidLength: throw new LuaExecutionError(LUA_FAULT_REASON_UNKNOWN);
				case CompiledBlockExit.AllocateTable:
					this.setRegisterTableFast(frame, registers, exit.exitA, this.createTable(exit.exitB, exit.exitC));
					break;
				case CompiledBlockExit.ReadMemory:
				case CompiledBlockExit.WriteMemory:
				case CompiledBlockExit.WriteWords: {
					const address = ((this.readRKNumber(frame, exit.exitB) >>> 0) + (exit.displaced ? exit.displacement * 4 : 0)) >>> 0;
					if (exit.exit === CompiledBlockExit.ReadMemory) this.executeMemoryLoad(frame, exit.exitA, exit.exitC, address);
					else if (exit.exit === CompiledBlockExit.WriteWords) this.executeWordStores(frame, address, exit.exitA, exit.exitC);
					else this.executeMemoryStore(frame, exit.exitA, exit.exitC, address);
					redispatch = true; break;
				}
				case CompiledBlockExit.ReadField:
				case CompiledBlockExit.ReadInteger:
				case CompiledBlockExit.ReadIndex: {
					const tag = registers.getTag(exit.exitB), table = registers.getTable(exit.exitB);
					if (exit.exit === CompiledBlockExit.ReadField) {
						this.loadTableFieldIndexCached(page, exit.exitWord, tag, table,
							image.constScalars[exit.exitC] as StringId, registers, exit.exitA);
					} else if (exit.exit === CompiledBlockExit.ReadInteger) {
						this.loadTableIntegerIndex(tag, table, exit.exitC, registers, exit.exitA);
					} else {
						const c = exit.exitC, index = -c - 1;
						const keyTag = c < 0 ? image.constTags[index] : registers.getTag(c);
						const keyScalar = c < 0 ? image.constScalars[index] : registers.getScalar(c);
						if (keyTag === ValueTag.String) {
							this.loadTableFieldIndexCached(page, exit.exitWord, tag, table, keyScalar as StringId, registers, exit.exitA);
						} else {
							this.loadTableIndex(tag, table, keyTag, keyScalar, c < 0 ? null : registers.getReference(c), registers, exit.exitA);
						}
					}
					this.bumpRegisterTop(frame, exit.exitA);
					break;
				}
				case CompiledBlockExit.WriteField:
				case CompiledBlockExit.WriteInteger:
				case CompiledBlockExit.WriteIndex: {
					const c = exit.exitC;
					const index = -c - 1;
					const tag = registers.getTag(exit.exitA), table = registers.getTable(exit.exitA);
					const valueTag = c < 0 ? image.constTags[index] : registers.getTag(c);
					const valueScalar = c < 0 ? image.constScalars[index] : registers.getScalar(c);
					const valueReference = c < 0 ? null : registers.getReference(c);
					if (exit.exit === CompiledBlockExit.WriteField) {
						this.storeTableFieldIndexCached(page, exit.exitWord, tag, table,
							image.constScalars[exit.exitB] as StringId, valueTag, valueScalar, valueReference);
					} else if (exit.exit === CompiledBlockExit.WriteInteger) {
						this.storeTableIntegerIndex(tag, table, exit.exitB, valueTag, valueScalar, valueReference);
					} else {
						const b = exit.exitB, keyIndex = -b - 1;
						const keyTag = b < 0 ? image.constTags[keyIndex] : registers.getTag(b);
						const keyScalar = b < 0 ? image.constScalars[keyIndex] : registers.getScalar(b);
						if (keyTag === ValueTag.String) {
							this.storeTableFieldIndexCached(page, exit.exitWord, tag, table, keyScalar as StringId, valueTag, valueScalar, valueReference);
						} else {
							this.storeTableIndex(tag, table, keyTag, keyScalar, b < 0 ? null : registers.getReference(b), valueTag, valueScalar, valueReference);
						}
					}
					break;
				}
			}
			// Device/builtin operations may change execution control. Consume those
			// boundaries in the ordinary CPU loop, without re-running the opcode.
			if (redispatch && (this.hardHalted || this.yieldRequested || this.threadSwitchRequested || this.memoryWriteBlocked
				|| this.nonMaskableInterruptPending || ((this.cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) !== 0
					&& this.irqController.hasAssertedMaskableInterruptLine()))) return;
			// Warm continuations, including cross-page calls and builtins, keep the
			// same generated execution loop. No recursive block or opcode dispatch.
			remaining = this.instructionBudgetRemaining;
			if (frames.length <= targetDepth || remaining <= 0
				|| (this.haltedUntilIrqThread === this.activeThread && this.haltedUntilIrqFrameDepth === frames.length)) return;
			frame = frames[frames.length - 1];
			const pc = frame.pc;
			if ((pc & (INSTRUCTION_BYTES - 1)) !== 0) return;
			const lookup = frame.executionImage.compiledCodeLookup;
			if (lookup === null) return;
			const nextPage = lookup.find(pc, this.memory.cartridgeController.selectedSlot(this.executionBusSignals));
			if (nextPage === null) return;
			page = nextPage;
			const nextCache = page.compiledBlocks;
			if (nextCache === null) return;
			const next = nextCache.entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
			if (next === null || remaining < next.entryCycles) return;
			cache = nextCache;
			block = next;
		}
	}

	private executeInstruction(
		frame: CallFrame,
		page: DecodedInstructionPage,
		pageOffset: number,
		op: number,
		targetDepth: number,
	): void {
		const registers = frame.registers;
		const image = frame.executionImage;
		const a = page.a[pageOffset];
		switch (op) {
				case DecodedDispatchOp.CompiledWarm:
				case DecodedDispatchOp.Compiled:
					this.executeCompiledBlock(frame, page, pageOffset, targetDepth);
					return;
				case DecodedDispatchOp.Observe:
					this.instructionObserver!.observe(image.executionDomainId, this.currentInstructionPc, registers);
					// Observe has zero base cost; execute and charge the original instruction once.
					this.instructionBudgetRemaining -= DECODED_DISPATCH_BASE_CYCLES[page.ops[pageOffset]];
					this.executeInstruction(frame, page, pageOffset, page.ops[pageOffset], targetDepth);
					return;
				case DecodedDispatchOp.FusedShlBxor:
				case DecodedDispatchOp.FusedShrBxor:
				case DecodedDispatchOp.FusedAddShl:
					this.executeFusedNumericPair(frame, page, pageOffset, op);
					return;
				case OpCode.WIDE:
					this.hardHalt();
					return;
				case DecodedDispatchOp.ReservedMemory:
					this.enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
					return;
				case OpCode.MOV:
					this.copyRegisterFast(frame, registers, a, page.b[pageOffset]);
					return;
				case OpCode.LOADK: {
					this.setRegisterConstantFast(frame, registers, a, image, page.bx[pageOffset]);
					return;
				}
				case OpCode.KNIL:
					this.setRegisterNilFast(frame, registers, a);
					return;
				case OpCode.KFALSE:
					this.setRegisterBoolFast(frame, registers, a, false);
					return;
				case OpCode.KTRUE:
					this.setRegisterBoolFast(frame, registers, a, true);
					return;
				case OpCode.K0:
					this.setRegisterNumberFast(frame, registers, a, 0);
					return;
				case OpCode.K1:
					this.setRegisterNumberFast(frame, registers, a, 1);
					return;
				case OpCode.KM1:
					this.setRegisterNumberFast(frame, registers, a, -1);
					return;
				case OpCode.KSMI:
					this.setRegisterNumberFast(frame, registers, a, page.sbx[pageOffset]);
					return;
				case OpCode.LOADNIL: {
					const b = page.b[pageOffset];
					registers.clear(b, a);
					if (b !== 0) frame.top = Math.max(frame.top, a + b);
					return;
				}
				case OpCode.GETSYS:
					registers.copySlotFrom(this.systemGlobalSlots, a, page.bx[pageOffset]);
					this.bumpRegisterTop(frame, a);
					return;
				case OpCode.SETSYS:
					this.systemGlobalSlots.copySlotFrom(registers, page.bx[pageOffset], a);
					return;
				case OpCode.GETGL:
					registers.copySlotFrom(this.globalSlots, a, page.bx[pageOffset]);
					this.bumpRegisterTop(frame, a);
					return;
				case OpCode.SETGL:
					this.globalSlots.copySlotFrom(registers, page.bx[pageOffset], a);
					return;
				case OpCode.GETI: {
					const b = page.b[pageOffset];
					const baseTag = registers.getTag(b);
					const table = registers.getTable(b);
					if (baseTag === ValueTag.Table
						&& table.loadIntegerArrayKey(page.c[pageOffset], registers, a)) {
						this.bumpRegisterTop(frame, a);
						return;
					}
					this.loadTableIntegerIndex(
						baseTag,
						table,
						page.c[pageOffset],
						registers,
						a,
					);
					this.bumpRegisterTop(frame, a);
					return;
				}
				case OpCode.SETI: {
					const b = page.b[pageOffset];
					const baseTag = registers.getTag(a);
					const table = registers.getTable(a);
					const rkC = page.c[pageOffset];
					let valueTag: ValueTag;
					let valueScalar: number;
					let valueReference: ValueReference;
					if (rkC < 0) {
						const constantIndex = -1 - rkC;
						valueTag = image.constTags[constantIndex];
						valueScalar = image.constScalars[constantIndex];
						valueReference = null;
					} else {
						valueTag = registers.getTag(rkC);
						valueScalar = registers.getScalar(rkC);
						valueReference = registers.getReference(rkC);
					}
					if (baseTag === ValueTag.Table
						&& table.storeIntegerArrayKey(b, valueTag, valueScalar, valueReference)) {
						return;
					}
					this.storeTableIntegerIndex(
						baseTag,
						table,
						b,
						valueTag,
						valueScalar,
						valueReference,
					);
					return;
				}
				case OpCode.GETFIELD: {
					const b = page.b[pageOffset];
					this.loadTableFieldIndexCached(
						page,
						pageOffset,
						registers.getTag(b),
						registers.getTable(b),
						image.constScalars[page.c[pageOffset]] as StringId,
						registers,
						a,
					);
					this.bumpRegisterTop(frame, a);
					return;
				}
				case OpCode.SETFIELD: {
					const b = page.b[pageOffset];
					const rkC = page.c[pageOffset];
					let valueTag: ValueTag;
					let valueScalar: number;
					let valueReference: ValueReference;
					if (rkC < 0) {
						const constantIndex = -1 - rkC;
						valueTag = image.constTags[constantIndex];
						valueScalar = image.constScalars[constantIndex];
						valueReference = null;
					} else {
						valueTag = registers.getTag(rkC);
						valueScalar = registers.getScalar(rkC);
						valueReference = registers.getReference(rkC);
					}
					this.storeTableFieldIndexCached(
						page,
						pageOffset,
						registers.getTag(a),
						registers.getTable(a),
						image.constScalars[b] as StringId,
						valueTag,
						valueScalar,
						valueReference,
					);
					return;
				}
				case OpCode.SELF: {
					const b = page.b[pageOffset];
					const baseTag = registers.getTag(b);
					const baseTable = registers.getTable(b);
					const key = image.constScalars[page.c[pageOffset]] as StringId;
					registers.copySlot(a + 1, b);
					this.bumpRegisterTop(frame, a + 1);
					this.loadTableFieldIndexCached(
						page,
						pageOffset,
						baseTag,
						baseTable,
						key,
						registers,
						a,
					);
					this.bumpRegisterTop(frame, a);
					return;
				}
		case OpCode.HALT:
			this.haltUntilIrq();
			return;
				case OpCode.GETT: {
					const b = page.b[pageOffset];
					const rkC = page.c[pageOffset];
					let keyTag: ValueTag;
					let keyScalar: number;
					let keyReference: ValueReference;
					if (rkC < 0) {
						const constantIndex = -1 - rkC;
						keyTag = image.constTags[constantIndex];
						keyScalar = image.constScalars[constantIndex];
						keyReference = null;
					} else {
						keyTag = registers.getTag(rkC);
						keyScalar = registers.getScalar(rkC);
						keyReference = registers.getReference(rkC);
					}
					this.loadTableIndex(
						registers.getTag(b),
						registers.getTable(b),
						keyTag,
						keyScalar,
						keyReference,
						registers,
						a,
					);
					this.bumpRegisterTop(frame, a);
					return;
				}
				case OpCode.SETT: {
					const rkB = page.b[pageOffset];
					const rkC = page.c[pageOffset];
					let keyTag: ValueTag;
					let keyScalar: number;
					let keyReference: ValueReference;
					if (rkB < 0) {
						const constantIndex = -1 - rkB;
						keyTag = image.constTags[constantIndex];
						keyScalar = image.constScalars[constantIndex];
						keyReference = null;
					} else {
						keyTag = registers.getTag(rkB);
						keyScalar = registers.getScalar(rkB);
						keyReference = registers.getReference(rkB);
					}
					let valueTag: ValueTag;
					let valueScalar: number;
					let valueReference: ValueReference;
					if (rkC < 0) {
						const constantIndex = -1 - rkC;
						valueTag = image.constTags[constantIndex];
						valueScalar = image.constScalars[constantIndex];
						valueReference = null;
					} else {
						valueTag = registers.getTag(rkC);
						valueScalar = registers.getScalar(rkC);
						valueReference = registers.getReference(rkC);
					}
					this.storeTableIndex(
						registers.getTag(a),
						registers.getTable(a),
						keyTag,
						keyScalar,
						keyReference,
						valueTag,
						valueScalar,
						valueReference,
					);
					return;
				}
				case OpCode.NEWT:
					this.setRegisterTableFast(
						frame,
						registers,
						a,
						this.createTable(page.b[pageOffset], page.c[pageOffset]),
					);
					return;
				case OpCode.ADD:
				case OpCode.SUB:
				case OpCode.MUL:
				case OpCode.DIV:
				case OpCode.MOD:
				case OpCode.FLOORDIV:
				case OpCode.POW:
				case OpCode.BAND:
				case OpCode.BOR:
				case OpCode.BXOR:
				case OpCode.SHL:
				case OpCode.SHR:
				{
					const rkB = page.b[pageOffset];
					const rkC = page.c[pageOffset];
					const left = this.readRKNumber(frame, rkB);
					const right = this.readRKNumber(frame, rkC);
					switch (op) {
						case OpCode.ADD:
							this.setRegisterNumberFast(frame, registers, a, left + right);
							return;
						case OpCode.SUB:
							this.setRegisterNumberFast(frame, registers, a, left - right);
							return;
						case OpCode.MUL:
							this.setRegisterNumberFast(frame, registers, a, left * right);
							return;
						case OpCode.DIV:
							this.setRegisterNumberFast(frame, registers, a, left / right);
							return;
						case OpCode.MOD:
							this.setRegisterNumberFast(frame, registers, a, luaModulo(left, right));
							return;
						case OpCode.FLOORDIV:
							this.setRegisterNumberFast(frame, registers, a, luaFloorDivide(left, right));
							return;
						case OpCode.POW:
							this.setRegisterNumberFast(frame, registers, a, luaPow(left, right));
							return;
						case OpCode.BAND:
							this.setRegisterNumberFast(frame, registers, a, left & right);
							return;
						case OpCode.BOR:
							this.setRegisterNumberFast(frame, registers, a, left | right);
							return;
						case OpCode.BXOR:
							this.setRegisterNumberFast(frame, registers, a, left ^ right);
							return;
						case OpCode.SHL:
							this.setRegisterNumberFast(frame, registers, a, left << (right & 31));
							return;
						case OpCode.SHR:
							this.setRegisterNumberFast(frame, registers, a, left >> (right & 31));
							return;
					}
				}
				case OpCode.CONCAT:
					this.executeConcat(frame, a, page.b[pageOffset], page.c[pageOffset]); return;
				case OpCode.CONCATN:
					this.executeConcatRange(frame, a, page.b[pageOffset], page.c[pageOffset]); return;
				case OpCode.UNM: {
					const value = registers.getNumber(page.b[pageOffset]);
					this.setRegisterNumberFast(frame, registers, a, -value);
					return;
				}
				case OpCode.NOT:
					this.setRegisterBoolFast(
						frame,
						registers,
						a,
						!registers.isTruthy(page.b[pageOffset]),
					);
					return;
				case OpCode.LEN: {
					const b = page.b[pageOffset];
					switch (registers.getTag(b)) {
						case ValueTag.String: {
							const cp = this.stringPool.codepointCount(registers.getStringId(b));
							this.setRegisterNumberFast(frame, registers, a, cp);
							return;
						}
						case ValueTag.Table:
							this.setRegisterNumberFast(frame, registers, a, registers.getTable(b).arrayLength);
							return;
						default:
							throw new LuaExecutionError(LUA_FAULT_REASON_UNKNOWN);
					}
				}
				case OpCode.BNOT: {
					const value = registers.getNumber(page.b[pageOffset]);
					this.setRegisterNumberFast(frame, registers, a, ~value);
					return;
				}
				case OpCode.EQ: {
					const rkB = page.b[pageOffset];
					const rkC = page.c[pageOffset];
					const eq = this.readRKEquals(frame, rkB, rkC);
					if (eq !== (a !== 0)) {
						this.skipNextInstruction(frame);
					}
					return;
				}
				case OpCode.LT: {
					const rkB = page.b[pageOffset];
					const rkC = page.c[pageOffset];
					let leftTag: ValueTag;
					let leftScalar: number;
					if (rkB < 0) {
						const constantIndex = -1 - rkB;
						leftTag = image.constTags[constantIndex];
						leftScalar = image.constScalars[constantIndex];
					} else {
						leftTag = registers.getTag(rkB);
						leftScalar = registers.getScalar(rkB);
					}
					let rightTag: ValueTag;
					let rightScalar: number;
					if (rkC < 0) {
						const constantIndex = -1 - rkC;
						rightTag = image.constTags[constantIndex];
						rightScalar = image.constScalars[constantIndex];
					} else {
						rightTag = registers.getTag(rkC);
						rightScalar = registers.getScalar(rkC);
					}
					let ok = false;
					if (leftTag === ValueTag.Number) {
						ok = rightTag === ValueTag.Number && leftScalar < rightScalar;
					} else if (leftTag === ValueTag.String) {
						ok = rightTag === ValueTag.String && this.stringPool.compare(leftScalar as StringId, rightScalar as StringId) < 0;
					}
					if (ok !== (a !== 0)) {
						this.skipNextInstruction(frame);
					}
					return;
				}
				case OpCode.MFC0: {
					if (this.isUserMode()) {
						this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
						return;
					}
					const field = page.b[pageOffset];
					if (!cop0FieldImplemented(field)) { this.hardHalt(); return; }
					const value = field === COP0_EXEC ? 0 : this.cop0Words[field];
					this.setRegisterNumberFast(frame, registers, a, value);
					return;
				}
				case OpCode.MTC0: {
					if (this.isUserMode()) {
						this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
						return;
					}
					const value = registers.getNumber(a) >>> 0;
					switch (page.b[pageOffset]) {
						case COP0_STATUS: this.cop0Words[COP0_STATUS] = value; return;
						case COP0_EPC: this.cop0Words[COP0_EPC] = value; return;
						case COP0_EXEC: this.executeFunctionAddress(value); return;
						case COP0_BAD_ADDRESS:
						case COP0_LUA_FAULT_REASON:
						case COP0_CAUSE:
							return;
						default: this.hardHalt(); return;
					}
				}
				case OpCode.RFE:
					this.returnFromException(frame);
					return;
				case OpCode.LOADKR: {
					const constantIndex = registers.getNumber(page.b[pageOffset]) >>> 0;
					if (constantIndex >= image.constTags.length) {
						throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
					}
					this.setRegisterConstantFast(
						frame,
						registers,
						a,
						image,
						constantIndex,
					);
					return;
				}

				case OpCode.LE: {
					const rkB = page.b[pageOffset];
					const rkC = page.c[pageOffset];
					let leftTag: ValueTag;
					let leftScalar: number;
					if (rkB < 0) {
						const constantIndex = -1 - rkB;
						leftTag = image.constTags[constantIndex];
						leftScalar = image.constScalars[constantIndex];
					} else {
						leftTag = registers.getTag(rkB);
						leftScalar = registers.getScalar(rkB);
					}
					let rightTag: ValueTag;
					let rightScalar: number;
					if (rkC < 0) {
						const constantIndex = -1 - rkC;
						rightTag = image.constTags[constantIndex];
						rightScalar = image.constScalars[constantIndex];
					} else {
						rightTag = registers.getTag(rkC);
						rightScalar = registers.getScalar(rkC);
					}
					let ok = false;
					if (leftTag === ValueTag.Number) {
						ok = rightTag === ValueTag.Number && leftScalar <= rightScalar;
					} else if (leftTag === ValueTag.String) {
						ok = rightTag === ValueTag.String && this.stringPool.compare(leftScalar as StringId, rightScalar as StringId) <= 0;
					}
					if (ok !== (a !== 0)) {
						this.skipNextInstruction(frame);
					}
					return;
				}
				case OpCode.JMP: {
					frame.pc = page.bx[pageOffset];
					return;
				}
				case OpCode.JMPIF: {
					if (registers.isTruthy(a)) {
						frame.pc = page.bx[pageOffset];
					}
					return;
				}
				case OpCode.JMPIFNOT: {
					if (!registers.isTruthy(a)) {
						frame.pc = page.bx[pageOffset];
					}
					return;
				}
				case OpCode.CLOSURE:
					this.executeClosure(frame, a, page.bx[pageOffset], page.c[pageOffset]); return;
				case OpCode.GETUP: {
					const upvalue = frame.closure.upvalues[page.b[pageOffset]];
					this.copyUpvalueToRegister(frame, registers, a, upvalue);
					return;
				}
				case OpCode.SETUP: {
					const upvalue = frame.closure.upvalues[page.b[pageOffset]];
					this.copyRegisterToUpvalue(upvalue, registers, a);
					return;
				}
				case OpCode.VARARG: {
					this.executeVararg(frame, a, page.b[pageOffset]);
					return;
				}
				case OpCode.CALL:
					this.executeCall(frame, a, page.b[pageOffset], page.c[pageOffset]);
					return;
				case OpCode.RET:
					this.executeReturn(frame, a, page.b[pageOffset]);
					return;
				case OpCode.LOAD_MEM_D:
				case OpCode.STORE_MEM_D:
				case OpCode.LOAD_MEM:
				case OpCode.STORE_MEM: {
					const b = page.b[pageOffset];
					const c = page.c[pageOffset] as MemoryAccessKind;
					const displaced = op === OpCode.LOAD_MEM_D || op === OpCode.STORE_MEM_D;
					const addr = displaced ? ((registers.getNumber(b) >>> 0) + (page.disp[pageOffset] << 2)) >>> 0
						: this.readRKNumber(frame, b) >>> 0;
					if (op === OpCode.LOAD_MEM_D || op === OpCode.LOAD_MEM) this.executeMemoryLoad(frame, a, c, addr);
					else this.executeMemoryStore(frame, a, c, addr);
					return;
				}
				case OpCode.STORE_MEM_WORDS_D:
				case OpCode.STORE_MEM_WORDS: {
					const b = page.b[pageOffset];
					const address = op === OpCode.STORE_MEM_WORDS_D
						? ((registers.getNumber(b) >>> 0) + (page.disp[pageOffset] << 2)) >>> 0
						: this.readRKNumber(frame, b) >>> 0;
					this.executeWordStores(frame, address, a, page.c[pageOffset]);
					return;
				}
		}
	}

	private prepareFrameRegisters(frame: CallFrame, registerCount: number): ValueSlots {
		const capacity = Math.max(registerCount, 1);
		frame.stackBase = frame.varargBase + frame.varargCount;
		frame.stackCapacity = capacity;
		this.activeThread.stackTop = frame.stackBase + capacity;
		this.ensureStackCapacity(this.activeThread.stackTop);
		const registers = frame.registers;
		registers.rebind(this.activeThread.stackRegisters, frame.stackBase, frame.stackCapacity);
		registers.clear(frame.stackCapacity);
		return registers;
	}

	private pushFrame(
		closure: Closure,
		args: ReadonlyArray<Value>,
		returnBase: number,
		returnCount: number,
		returnToCompletionLatch: boolean,
	): CallFrame | null {
		if (!this.readFunctionRecordOnBus(
			this.activeExecutionImage,
			closure.functionAddress,
			this.executionBusSignals,
		)) {
			this.hardHalt();
			return null;
		}
		return this.pushLatchedFrame(
			closure,
			args,
			returnBase,
			returnCount,
			returnToCompletionLatch,
		);
	}

	private pushLatchedFrame(
		closure: Closure,
		args: ReadonlyArray<Value>,
		returnBase: number,
		returnCount: number,
		returnToCompletionLatch: boolean,
	): CallFrame {
		const functionRecord = this.functionRecordLatch;
		const frame = this.acquireFrame();
		frame.thread = this.activeThread;
		frame.functionAddress = closure.functionAddress;
		frame.executionImage = functionRecord.image;
		frame.decodedPage = null;
		frame.decodedPageAddress = 0;
		frame.pc = functionRecord.codeAddress;
		frame.closure = closure;
		frame.returnBase = returnBase;
		frame.returnCount = returnCount;
		frame.top = functionRecord.numParams;
		frame.returnToCompletionLatch = returnToCompletionLatch;
		frame.callSitePc = functionRecord.codeAddress;
		frame.varargBase = this.activeThread.stackTop;
		frame.varargCount = (functionRecord.flags & BLUA32_FUNCTION_VARARG) !== 0
			? Math.max(args.length - functionRecord.numParams, 0)
			: 0;
		const registers = this.prepareFrameRegisters(frame, functionRecord.maxStack);

		let argIndex = 0;
		for (let index = 0; index < functionRecord.numParams; index += 1) {
			registers.set(index, argIndex < args.length ? args[argIndex] : null);
			argIndex += 1;
		}
		if ((functionRecord.flags & BLUA32_FUNCTION_VARARG) !== 0) {
			for (let index = 0; index < frame.varargCount; index += 1) {
				this.activeThread.stackRegisters.set(frame.varargBase + index, args[argIndex + index]);
			}
		}
		this.activeThread.frames.push(frame);
		return frame;
	}

	private pushFrameFromCaller(caller: CallFrame, closure: Closure, argBase: number, argCount: number, returnBase: number, returnCount: number, returnToCompletionLatch: boolean, callSitePc: number): CallFrame | null {
		if (!this.readFunctionRecordOnBus(
			this.activeExecutionImage,
			closure.functionAddress,
			this.executionBusSignals,
		)) {
			this.hardHalt();
			return null;
		}
		const functionRecord = this.functionRecordLatch;
		const frame = this.acquireFrame();
		frame.thread = this.activeThread;
		frame.functionAddress = closure.functionAddress;
		frame.executionImage = functionRecord.image;
		frame.decodedPage = null;
		frame.decodedPageAddress = 0;
		frame.pc = functionRecord.codeAddress;
		frame.closure = closure;
		frame.returnBase = returnBase;
		frame.returnCount = returnCount;
		frame.top = functionRecord.numParams;
		frame.returnToCompletionLatch = returnToCompletionLatch;
		frame.callSitePc = callSitePc;
		frame.varargBase = this.activeThread.stackTop;
		frame.varargCount = (functionRecord.flags & BLUA32_FUNCTION_VARARG) !== 0
			? Math.max(argCount - functionRecord.numParams, 0)
			: 0;

		const callerRegisters = caller.registers;
		const registers = this.prepareFrameRegisters(frame, functionRecord.maxStack);
		const copiedCount = Math.min(functionRecord.numParams, argCount);
		if (copiedCount > 0) {
			registers.copyRangeFrom(callerRegisters, 0, argBase, copiedCount);
		}
		for (let index = copiedCount; index < functionRecord.numParams; index += 1) {
			registers.setNil(index);
		}
		if ((functionRecord.flags & BLUA32_FUNCTION_VARARG) !== 0) {
			for (let index = 0; index < frame.varargCount; index += 1) {
				this.activeThread.stackRegisters.copySlotFrom(
					callerRegisters,
					frame.varargBase + index,
					argBase + functionRecord.numParams + index,
				);
			}
		}
		this.activeThread.frames.push(frame);
		return frame;
	}

	private createClosure(frame: CallFrame): Closure | null {
		const functionRecord = this.functionRecordLatch;
		if ((functionRecord.flags & BLUA32_FUNCTION_STATIC) !== 0
			&& functionRecord.upvalueCount === 0) {
			return this.staticClosureAtAddress(functionRecord.address);
		}
		if (this.closureUpvalueWords.length < functionRecord.upvalueCount) {
			this.closureUpvalueWords = new Uint32Array(functionRecord.upvalueCount);
		}
		const upvalueWords = this.closureUpvalueWords;
		const upvalues = new Array<Upvalue>(functionRecord.upvalueCount);
		const faultSequence = this.memory.readBusFaultSequence();
		let newUpvalueCount = 0;
		for (let index = 0; index < functionRecord.upvalueCount; index += 1) {
			const word = this.memory.readMappedBusU32LE(
				(functionRecord.upvalueTableAddress
					+ index * BLUA32_UPVALUE_RECORD_SIZE) >>> 0,
				functionRecord.busSignals,
			);
			if (this.memory.readBusFaultSequence() !== faultSequence) {
				this.hardHalt();
				return null;
			}
			upvalueWords[index] = word;
			const upvalueIndex = word & BLUA32_UPVALUE_INDEX_MASK;
			if ((word & BLUA32_UPVALUE_IN_STACK_MASK) !== 0) {
				const upvalue = this.findOpenUpvalue(frame, upvalueIndex);
				if (upvalue) {
					upvalues[index] = upvalue;
				} else {
					newUpvalueCount += 1;
				}
				continue;
			}
			upvalues[index] = frame.closure.upvalues[upvalueIndex];
		}
		const heapBytes = CLOSURE_HEAP_BYTES + (upvalues.length * CLOSURE_UPVALUE_SLOT_HEAP_BYTES);
		this.luaHeap.reserve(heapBytes + (newUpvalueCount * UPVALUE_HEAP_BYTES));
		const closure = new Closure(functionRecord.address, upvalues, heapBytes);
		closure.hashId = this.allocateObjectHashId();
		for (let index = 0; index < functionRecord.upvalueCount; index += 1) {
			if (upvalues[index]) {
				continue;
			}
			const upvalue: Upvalue = {
				hashId: this.allocateObjectHashId(),
				open: true,
				index: upvalueWords[index] & BLUA32_UPVALUE_INDEX_MASK,
				frame,
				valueTag: ValueTag.Nil,
				valueScalar: NaN,
				valueReference: null,
				nextOpen: null,
			};
			this.linkOpenUpvalue(frame, upvalue);
			upvalues[index] = upvalue;
		}
		return closure;
	}

	private closeUpvalues(frame: CallFrame): void {
		let upvalue = frame.openUpvalueHead;
		frame.openUpvalueHead = null;
		while (upvalue) {
			const next = upvalue.nextOpen;
			upvalue.valueTag = frame.registers.getTag(upvalue.index);
			upvalue.valueScalar = frame.registers.getScalar(upvalue.index);
			upvalue.valueReference = frame.registers.getReference(upvalue.index);
			upvalue.open = false;
			upvalue.frame = null;
			upvalue.nextOpen = null;
			upvalue = next;
		}
	}

	private copyUpvalueToRegister(
		frame: CallFrame,
		registers: ValueSlots,
		registerIndex: number,
		upvalue: Upvalue,
	): void {
		if (upvalue.open) {
			registers.copySlotFrom(upvalue.frame!.registers, registerIndex, upvalue.index);
		} else {
			registers.setEncoded(
				registerIndex,
				upvalue.valueTag,
				upvalue.valueScalar,
				upvalue.valueReference,
			);
		}
		this.bumpRegisterTop(frame, registerIndex);
	}

	private copyRegisterToUpvalue(upvalue: Upvalue, registers: ValueSlots, registerIndex: number): void {
		if (upvalue.open) {
			upvalue.frame!.registers.copySlotFrom(registers, upvalue.index, registerIndex);
			return;
		}
		upvalue.valueTag = registers.getTag(registerIndex);
		upvalue.valueScalar = registers.getScalar(registerIndex);
		upvalue.valueReference = registers.getReference(registerIndex);
	}

	private writeReturnValuesFromRegisters(frame: CallFrame, base: number, count: number, source: ValueSlots, sourceBase: number, sourceCount: number): void {
		const targetCount = count === 0 ? sourceCount : count;
		if (targetCount > 0) {
			const registers = this.ensureRegisterCapacity(frame, base + targetCount - 1);
			const copiedCount = Math.min(sourceCount, targetCount);
			if (copiedCount > 0) {
				registers.copyRangeFrom(source, base, sourceBase, copiedCount);
			}
			for (let index = copiedCount; index < targetCount; index += 1) {
				registers.setNil(base + index);
			}
		}
		frame.top = base + targetCount;
	}

	private writeReturnValuesFromBuiltinResults(
		frame: CallFrame,
		base: number,
		count: number,
		values: BuiltinResults,
	): void {
		const targetCount = count === 0 ? values.length : count;
		if (targetCount > 0) {
			const registers = this.ensureRegisterCapacity(frame, base + targetCount - 1);
			const copiedCount = Math.min(values.length, targetCount);
			if (copiedCount > 0) {
				values.copyTo(registers, base, copiedCount);
			}
			for (let index = copiedCount; index < targetCount; index += 1) {
				registers.setNil(base + index);
			}
		}
		frame.top = base + targetCount;
	}

	private ensureRegisterCapacity(frame: CallFrame, index: number): ValueSlots {
		const registers = frame.registers;
		if (index >= frame.stackCapacity) {
			const frameIndex = this.activeThread.frames.indexOf(frame);
			if (frameIndex < 0) {
				throw new Error('Attempted to grow registers for a released frame.');
			}
			const needed = index + 1;
			const previousCapacity = frame.stackCapacity;
			let capacity = 1 << (32 - Math.clz32(needed - 1));
			if (capacity < 8) {
				capacity = 8;
			}
			const delta = capacity - previousCapacity;
			frame.stackCapacity = capacity;
			this.ensureStackCapacity(this.activeThread.stackTop + delta);
			if (delta > 0) {
				const stack = this.activeThread.stackRegisters;
				for (let i = this.activeThread.frames.length - 1; i > frameIndex; i -= 1) {
					const shifted = this.activeThread.frames[i];
					stack.moveRange(shifted.varargBase + delta, shifted.varargBase, shifted.varargCount + shifted.stackCapacity);
					shifted.varargBase += delta;
					shifted.stackBase += delta;
				}
			}
			this.activeThread.stackTop += delta;
			this.refreshFrameRegisterViews();
			for (let slot = previousCapacity; slot < frame.stackCapacity; slot += 1) {
				registers.setNil(slot);
			}
		}
		return registers;
	}

	private bumpRegisterTop(frame: CallFrame, index: number): void {
		const nextTop = index + 1;
		if (nextTop > frame.top) {
			frame.top = nextTop;
		}
	}

	private copyRegisterFast(frame: CallFrame, registers: ValueSlots, dst: number, src: number): void {
		registers.copySlot(dst, src);
		this.bumpRegisterTop(frame, dst);
	}

	private setRegisterNilFast(frame: CallFrame, registers: ValueSlots, index: number): void {
		registers.setNil(index);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterBoolFast(frame: CallFrame, registers: ValueSlots, index: number, value: boolean): void {
		registers.setBool(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterNumberFast(frame: CallFrame, registers: ValueSlots, index: number, value: number): void {
		registers.setNumber(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterStringFast(frame: CallFrame, registers: ValueSlots, index: number, value: StringId): void {
		registers.setStringId(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterTableFast(frame: CallFrame, registers: ValueSlots, index: number, value: Table): void {
		registers.setTable(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterClosureFast(frame: CallFrame, registers: ValueSlots, index: number, value: Closure): void {
		registers.setClosure(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterConstantFast(
		frame: CallFrame,
		registers: ValueSlots,
		registerIndex: number,
		image: Blua32ExecutionImage,
		constantIndex: number,
	): void {
		registers.setEncoded(
			registerIndex,
			image.constTags[constantIndex],
			image.constScalars[constantIndex],
			null,
		);
		this.bumpRegisterTop(frame, registerIndex);
	}


	private readRKEquals(frame: CallFrame, left: number, right: number): boolean {
		const image = frame.executionImage;
		const registers = frame.registers;
		let leftTag: ValueTag;
		let leftScalar: number;
		if (left < 0) {
			const constantIndex = -1 - left;
			leftTag = image.constTags[constantIndex];
			leftScalar = image.constScalars[constantIndex];
		} else {
			leftTag = registers.getTag(left);
			leftScalar = registers.getScalar(left);
		}
		let rightTag: ValueTag;
		let rightScalar: number;
		if (right < 0) {
			const constantIndex = -1 - right;
			rightTag = image.constTags[constantIndex];
			rightScalar = image.constScalars[constantIndex];
		} else {
			rightTag = registers.getTag(right);
			rightScalar = registers.getScalar(right);
		}
		if (leftTag !== rightTag) {
			return false;
		}
		switch (leftTag) {
			case ValueTag.Nil:
			case ValueTag.False:
			case ValueTag.True:
				return true;
			case ValueTag.Number:
				return leftScalar === rightScalar;
			case ValueTag.String:
			case ValueTag.BuiltinFunction:
				return leftScalar === rightScalar;
			case ValueTag.Table:
			case ValueTag.Closure:
			case ValueTag.Thread:
				return registers.getReference(left) === registers.getReference(right);
		}
	}

	private readRKNumber(frame: CallFrame, rk: number): number {
		if (rk < 0) {
			const constantIndex = -1 - rk;
			return frame.executionImage.constTags[constantIndex] === ValueTag.Number
				? frame.executionImage.constScalars[constantIndex]
				: NaN;
		}
		return frame.registers.getNumber(rk);
	}

	private callBuiltinFunction(id: BuiltinFunctionId, args: BuiltinArgsView, out: BuiltinResults): void {
		switch (id) {
			case BuiltinFunctionId.Next:
				this.runBuiltinNextValue(args, out);
				break;
			case BuiltinFunctionId.Type:
				this.runBuiltinType(
					args.length > 0 ? args.registers.getTag(args.base) : ValueTag.Nil,
					out,
				);
				break;
			case BuiltinFunctionId.SetMetatable:
				this.runBuiltinSetMetatable(args, out);
				break;
			case BuiltinFunctionId.GetMetatable:
				this.runBuiltinGetMetatable(args, out);
				break;
			case BuiltinFunctionId.RawGet:
				this.runBuiltinRawGet(args, out);
				break;
			case BuiltinFunctionId.RawSet:
				this.runBuiltinRawSet(args, out);
				break;
			case BuiltinFunctionId.GetGlobal: {
				if (args.length === 0 || args.registers.getTag(args.base) !== ValueTag.String) {
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				}
				const slot = this.globalSlotByKey.get(args.registers.getScalar(args.base));
				if (slot === undefined) out.push(ValueTag.Nil);
				else out.push(this.globalSlots.getTag(slot), this.globalSlots.getScalar(slot), this.globalSlots.getReference(slot));
				break;
			}
			case BuiltinFunctionId.SetGlobal: {
				if (args.length === 0 || args.registers.getTag(args.base) !== ValueTag.String) {
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				}
				const key = args.registers.getScalar(args.base);
				if (args.length < 2) this.setGlobalByKey(key, ValueTag.Nil, NaN, null);
				else this.setGlobalByKey(key, args.registers.getTag(args.base + 1), args.registers.getScalar(args.base + 1), args.registers.getReference(args.base + 1));
				break;
			}
			case BuiltinFunctionId.Select:
				this.runBuiltinSelect(args, out);
				break;
			case BuiltinFunctionId.FrameCount:
				out.push(ValueTag.Number, (args.registers.getReference(args.base) as Thread).frames.length);
				break;
			case BuiltinFunctionId.FrameHeader: {
				const thread = args.registers.getReference(args.base) as Thread;
				const frame = thread.frames[args.registers.getScalar(args.base + 1)];
				out.push(ValueTag.Number, frame.functionAddress);
				out.push(ValueTag.Number, frame.pc);
				out.push(ValueTag.Number, frame.callSitePc);
				out.push(frame.returnToCompletionLatch ? ValueTag.True : ValueTag.False);
				out.push(ValueTag.Number, frame.executionImage.executionDomainId >>> 0);
				out.push(frame.isExceptionFrame ? ValueTag.True : ValueTag.False);
				break;
			}
			case BuiltinFunctionId.GetFrameRegister:
			case BuiltinFunctionId.SetFrameRegister: {
				const thread = args.registers.getReference(args.base) as Thread;
				const registers = thread.frames[args.registers.getScalar(args.base + 1)].registers;
				const index = args.registers.getScalar(args.base + 2);
				if (id === BuiltinFunctionId.GetFrameRegister) out.push(registers.getTag(index), registers.getScalar(index), registers.getReference(index));
				else registers.copySlotFrom(args.registers, index, args.base + 3);
				break;
			}
			case BuiltinFunctionId.GetFrameUpvalue:
			case BuiltinFunctionId.SetFrameUpvalue: {
				const thread = args.registers.getReference(args.base) as Thread;
				const closure = thread.frames[args.registers.getScalar(args.base + 1)].closure;
				const upvalue = closure.upvalues[args.registers.getScalar(args.base + 2)];
				if (id === BuiltinFunctionId.SetFrameUpvalue) this.copyRegisterToUpvalue(upvalue, args.registers, args.base + 3);
				else if (upvalue.open) {
					const registers = upvalue.frame!.registers, index = upvalue.index;
					out.push(registers.getTag(index), registers.getScalar(index), registers.getReference(index));
				} else out.push(upvalue.valueTag, upvalue.valueScalar, upvalue.valueReference);
				break;
			}
			case BuiltinFunctionId.StringByte:
				this.runBuiltinStringByte(args, out);
				break;
			case BuiltinFunctionId.StringChar:
				this.runBuiltinStringChar(args, out);
				break;
			case BuiltinFunctionId.SetStringIndex:
				if (args.length === 0 || args.registers.getTag(args.base) !== ValueTag.Table) {
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				}
				this.stringIndexTable = args.registers.getTable(args.base);
				break;
			case BuiltinFunctionId.CoroutineCreate:
				if (args.length === 0 || args.registers.getTag(args.base) !== ValueTag.Closure) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				out.push(ValueTag.Thread, NaN, this.createThread(args.registers.getClosure(args.base)));
				break;
			case BuiltinFunctionId.CoroutineRunning:
				out.push(ValueTag.Thread, NaN, this.activeThread);
				out.push(this.activeThread === this.rootThread ? ValueTag.True : ValueTag.False);
				break;
			case BuiltinFunctionId.CoroutineStatus:
			case BuiltinFunctionId.CoroutineClose:
			case BuiltinFunctionId.CoroutineIsYieldable: {
				const thread = args.length === 0 && id === BuiltinFunctionId.CoroutineIsYieldable ? this.activeThread
					: args.length > 0 && args.registers.getTag(args.base) === ValueTag.Thread ? args.registers.getReference(args.base) as Thread : null;
				if (thread === null) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				if (id === BuiltinFunctionId.CoroutineIsYieldable) out.push(this.coroutineYieldable(thread) ? ValueTag.True : ValueTag.False);
				else if (id === BuiltinFunctionId.CoroutineStatus) {
					out.push(ValueTag.Number, thread.status);
				} else {
					const failed = thread.status === ThreadStatus.Failed;
					out.push(failed ? ValueTag.False : ValueTag.True);
					if (failed) out.push(thread.error.getTag(0), thread.error.getScalar(0), thread.error.getReference(0));
					this.closeThread(thread);
					thread.error.setNil(0);
				}
				break;
			}
			case BuiltinFunctionId.CoroutineResume:
			case BuiltinFunctionId.CoroutineYield:
				throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			case BuiltinFunctionId.CollectGarbage:
				this.collectTrackedHeapBytes();
				break;
			case BuiltinFunctionId.Error:
				this.runBuiltinError(args);
				break;
			case BuiltinFunctionId.PCall:
			case BuiltinFunctionId.XPCall:
				throw new Error('Protected calls execute as Lua CPU microcode.');
		}
	}

	public createThread(entry: Closure): Thread {
		this.luaHeap.reserve(THREAD_HEAP_BYTES + 8 * THREAD_STACK_SLOT_BYTES, ValueTag.Closure, NaN, entry);
		const thread = new Thread(entry);
		thread.hashId = this.allocateObjectHashId();
		if (this.localRootScopeDepth > 0) this.localRoots.push(thread);
		return thread;
	}

	private coroutineYieldable(thread: Thread): boolean {
		if (thread === this.rootThread) return false;
		for (const frame of thread.frames) if (frame.isExceptionFrame || frame.returnToCompletionLatch) return false;
		for (let index = 0; index < thread.protectedCallDepth; index += 1) {
			if (thread.protectedCallContinuations.peek(index).kind === ProtectedCallKind.XPCallHandler) return false;
		}
		return true;
	}

	private returnToResumer(source: ValueSlots, sourceBase: number, sourceCount: number, succeeded: boolean): void {
		const thread = this.activeThread;
		const resumer = thread.resumer!;
		this.activeThread = resumer;
		resumer.status = ThreadStatus.Running;
		const caller = resumer.frames[resumer.frames.length - 1];
		const count = resumer.returnCount === 0 ? sourceCount + 1 : resumer.returnCount;
		const registers = this.ensureRegisterCapacity(caller, resumer.callBase + count - 1);
		registers.setBool(resumer.callBase, succeeded);
		const copied = Math.min(sourceCount, count - 1);
		registers.copyRangeFrom(source, resumer.callBase + 1, sourceBase, copied);
		for (let index = copied + 1; index < count; index += 1) registers.setNil(resumer.callBase + index);
		caller.top = resumer.callBase + count;
		thread.resumer = null;
		this.threadSwitchRequested = true;
		this.yieldRequested = true;
	}

	private runCoroutineTransfer(id: BuiltinFunctionId, caller: CallFrame, callBase: number, returnCount: number, argCount: number): void {
		const thread = this.activeThread;
		if (id === BuiltinFunctionId.CoroutineYield) {
			if (!this.coroutineYieldable(thread)) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			thread.callBase = callBase;
			thread.returnCount = returnCount;
			thread.status = ThreadStatus.Suspended;
			this.returnToResumer(caller.registers, callBase + 1, argCount, true);
			return;
		}
		if (argCount === 0 || caller.registers.getTag(callBase + 1) !== ValueTag.Thread) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		const target = caller.registers.getReference(callBase + 1) as Thread;
		const exceptionActive = this.readExceptionReturnFrameDepth() !== -1;
		if (exceptionActive || (target.status !== ThreadStatus.New && target.status !== ThreadStatus.Suspended)) {
			const results = this.acquireBuiltinResults();
			try {
				results.push(ValueTag.False);
				results.push(ValueTag.String, this.stringPool.intern(exceptionActive ? 'cannot resume coroutine across a hardware exception' : 'cannot resume non-suspended coroutine'));
				this.writeReturnValuesFromBuiltinResults(caller, callBase, returnCount, results);
			} finally { this.releaseBuiltinResults(results); }
			return;
		}
		const fresh = target.status === ThreadStatus.New;
		thread.callBase = callBase;
		thread.returnCount = returnCount;
		thread.status = ThreadStatus.Normal;
		target.resumer = thread;
		target.status = ThreadStatus.Running;
		this.activeThread = target;
		if (fresh) {
			this.pushFrameFromCaller(caller, target.entry!, callBase + 2, argCount - 1, 0, 0, false, 0);
			target.entry = null;
		} else {
			const frame = target.frames[target.frames.length - 1];
			this.writeReturnValuesFromRegisters(frame, target.callBase, target.returnCount, caller.registers, callBase + 2, argCount - 1);
		}
		this.threadSwitchRequested = true;
		this.yieldRequested = true;
	}

	private handleThreadError(tag: ValueTag, scalar: number, reference: ValueReference): boolean {
		if (this.handleProtectedCallError(tag, scalar, reference)) return true;
		const thread = this.activeThread;
		if (thread.resumer === null) return false;
		for (const frame of thread.frames) if (frame.isExceptionFrame || frame.returnToCompletionLatch) return false;
		thread.status = ThreadStatus.Failed;
		thread.error.setEncoded(0, tag, scalar, reference);
		this.returnToResumer(thread.error, 0, 1, false);
		return true;
	}

	public closeThread(thread: Thread): void {
		if (thread.status === ThreadStatus.Running || thread.status === ThreadStatus.Normal) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		for (const frame of thread.frames) {
			this.closeUpvalues(frame);
			this.releaseFrame(frame);
		}
		thread.frames.length = 0;
		for (let index = 0; index < thread.protectedCallDepth; index += 1) {
			const continuation = thread.protectedCallContinuations.peek(index);
			continuation.caller = null;
			continuation.target = null;
		}
		thread.protectedCallDepth = 0;
		thread.stackRegisters.clear(thread.stackTop);
		thread.stackTop = 0;
		thread.entry = null;
		thread.status = ThreadStatus.Dead;
	}

	private runBuiltinFunction(id: BuiltinFunctionId, frame: CallFrame, callBase: number, returnCount: number, argCount: number): void {
		this.charge(BUILTIN_FUNCTIONS[id].cost.base);
		if (id === BuiltinFunctionId.PCall || id === BuiltinFunctionId.XPCall) {
			this.startProtectedCall(id, frame, callBase, returnCount, callBase + 1, argCount, false);
			return;
		}
		if (id === BuiltinFunctionId.CoroutineResume || id === BuiltinFunctionId.CoroutineYield) {
			this.runCoroutineTransfer(id, frame, callBase, returnCount, argCount);
			return;
		}
		const builtinArgs = this.acquireRegisterBuiltinArgs();
		const results = this.acquireBuiltinResults();
		try {
			builtinArgs.bind(frame.registers, callBase + 1, argCount);
			this.callBuiltinFunction(id, builtinArgs, results);
			if (this.activeThread.frames.length > 0 && this.activeThread.frames[this.activeThread.frames.length - 1] === frame) {
				this.writeReturnValuesFromBuiltinResults(frame, callBase, returnCount, results);
			}
		} finally {
			this.releaseRegisterBuiltinArgs(builtinArgs);
			this.releaseBuiltinResults(results);
		}
	}

	private startProtectedCall(
		id: BuiltinFunctionId.PCall | BuiltinFunctionId.XPCall,
		caller: CallFrame,
		callBase: number,
		returnCount: number,
		argumentBase: number,
		argumentCount: number,
		returnsToProtectedParent: boolean,
	): void {
		if (id === BuiltinFunctionId.XPCall) {
			const handlerTag = argumentCount > 1
				? caller.registers.getTag(argumentBase + 1)
				: ValueTag.Nil;
			if (handlerTag !== ValueTag.Closure
				&& handlerTag !== ValueTag.BuiltinFunction) {
				throw new LuaExecutionError(LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION);
			}
		}
		const continuationIndex = this.activeThread.protectedCallDepth;
		const continuation = this.activeThread.protectedCallContinuations.get(continuationIndex);
		this.activeThread.protectedCallDepth = continuationIndex + 1;
		continuation.kind = id === BuiltinFunctionId.PCall ? ProtectedCallKind.PCall : ProtectedCallKind.XPCallBody;
		continuation.caller = caller;
		continuation.target = null;
		continuation.returnsToProtectedParent = returnsToProtectedParent;
		continuation.callBase = callBase;
		continuation.returnCount = returnCount;
		continuation.handlerRegister = id === BuiltinFunctionId.XPCall ? argumentBase + 1 : -1;

		const targetArgumentOffset = id === BuiltinFunctionId.PCall ? 1 : 2;
		this.invokeProtectedTarget(
			continuationIndex,
			caller.registers,
			argumentBase,
			argumentCount > 0,
			argumentBase + targetArgumentOffset,
			Math.max(argumentCount - targetArgumentOffset, 0),
		);
	}

	private invokeProtectedTarget(
		continuationIndex: number,
		targetRegisters: ValueSlots,
		targetRegister: number,
		targetPresent: boolean,
		argumentBase: number,
		argumentCount: number,
	): void {
		const continuation = this.activeThread.protectedCallContinuations.peek(continuationIndex);
		const caller = continuation.caller!;
		const targetTag = targetPresent
			? targetRegisters.getTag(targetRegister)
			: ValueTag.Nil;
		switch (targetTag) {
			case ValueTag.Closure:
				continuation.target = this.pushFrameFromCaller(
					caller,
					targetRegisters.getClosure(targetRegister),
					argumentBase,
					argumentCount,
					0,
					0,
					false,
					caller.pc - INSTRUCTION_BYTES,
				);
				return;
			case ValueTag.BuiltinFunction: {
				const builtinId = targetRegisters.getBuiltinFunctionId(targetRegister);
				this.charge(BUILTIN_FUNCTIONS[builtinId].cost.base);
				if (builtinId === BuiltinFunctionId.PCall || builtinId === BuiltinFunctionId.XPCall) {
					this.startProtectedCall(builtinId, caller, continuation.callBase, 0, argumentBase, argumentCount, true);
					return;
				}
				const builtinArgs = this.acquireRegisterBuiltinArgs();
				const results = this.acquireBuiltinResults();
				try {
					builtinArgs.bind(caller.registers, argumentBase, argumentCount);
					this.callBuiltinFunction(builtinId, builtinArgs, results);
					this.finishProtectedCallFromBuiltinResults(continuationIndex, results);
				} finally {
					this.releaseRegisterBuiltinArgs(builtinArgs);
					this.releaseBuiltinResults(results);
				}
				return;
			}
			default:
				throw new LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
		}
	}

	private finishProtectedCallFromBuiltinResults(continuationIndex: number, values: BuiltinResults): void {
		const continuation = this.activeThread.protectedCallContinuations.peek(continuationIndex);
		if (continuation.kind === ProtectedCallKind.XPCallHandler) {
			if (values.length > 0) {
				this.finishProtectedCallWithError(
					continuationIndex,
					values.getTag(0),
					values.getScalar(0),
					values.getReference(0),
				);
			} else {
				this.finishProtectedCallWithError(
					continuationIndex,
					ValueTag.Nil,
					NaN,
					null,
				);
			}
			return;
		}
		const resultCount = this.writeProtectedResultsFromBuiltinResults(continuation, true, values);
		this.finishProtectedContinuation(continuationIndex, resultCount);
	}

	private finishProtectedCallFromRegisters(continuationIndex: number, source: ValueSlots, sourceBase: number, sourceCount: number): void {
		const continuation = this.activeThread.protectedCallContinuations.peek(continuationIndex);
		if (continuation.kind === ProtectedCallKind.XPCallHandler) {
			if (sourceCount > 0) {
				this.finishProtectedCallWithError(
					continuationIndex,
					source.getTag(sourceBase),
					source.getScalar(sourceBase),
					source.getReference(sourceBase),
				);
			} else {
				this.finishProtectedCallWithError(
					continuationIndex,
					ValueTag.Nil,
					NaN,
					null,
				);
			}
			return;
		}
		const resultCount = this.writeProtectedResultsFromRegisters(continuation, true, source, sourceBase, sourceCount);
		this.finishProtectedContinuation(continuationIndex, resultCount);
	}

	private finishProtectedCallWithError(
		continuationIndex: number,
		errorTag: ValueTag,
		errorScalar: number,
		errorReference: ValueReference,
	): void {
		const continuation = this.activeThread.protectedCallContinuations.peek(continuationIndex);
		const caller = continuation.caller!;
		const resultCount = continuation.returnCount === 0 ? 2 : continuation.returnCount;
		if (resultCount > 0) {
			const registers = this.ensureRegisterCapacity(caller, continuation.callBase + resultCount - 1);
			registers.setBool(continuation.callBase, false);
			if (resultCount > 1) {
				registers.setEncoded(
					continuation.callBase + 1,
					errorTag,
					errorScalar,
					errorReference,
				);
				for (let index = 2; index < resultCount; index += 1) {
					registers.setNil(continuation.callBase + index);
				}
			}
		}
		caller.top = continuation.callBase + resultCount;
		this.finishProtectedContinuation(continuationIndex, resultCount);
	}

	private writeProtectedResultsFromBuiltinResults(
		continuation: ProtectedCallContinuation,
		prefix: boolean,
		values: BuiltinResults,
	): number {
		const caller = continuation.caller!;
		const resultCount = continuation.returnCount === 0 ? values.length + 1 : continuation.returnCount;
		if (resultCount > 0) {
			const registers = this.ensureRegisterCapacity(caller, continuation.callBase + resultCount - 1);
			registers.setBool(continuation.callBase, prefix);
			const copiedCount = Math.min(values.length, resultCount - 1);
			if (copiedCount > 0) {
				values.copyTo(registers, continuation.callBase + 1, copiedCount);
			}
			for (let index = copiedCount + 1; index < resultCount; index += 1) {
				registers.setNil(continuation.callBase + index);
			}
		}
		caller.top = continuation.callBase + resultCount;
		return resultCount;
	}

	private writeProtectedResultsFromRegisters(
		continuation: ProtectedCallContinuation,
		prefix: boolean,
		source: ValueSlots,
		sourceBase: number,
		sourceCount: number,
	): number {
		const caller = continuation.caller!;
		const resultCount = continuation.returnCount === 0 ? sourceCount + 1 : continuation.returnCount;
		if (resultCount > 0) {
			const registers = this.ensureRegisterCapacity(caller, continuation.callBase + resultCount - 1);
			const copiedCount = Math.min(sourceCount, resultCount - 1);
			if (copiedCount > 0) {
				if (registers === source) {
					registers.moveRange(continuation.callBase + 1, sourceBase, copiedCount);
				} else {
					registers.copyRangeFrom(source, continuation.callBase + 1, sourceBase, copiedCount);
				}
			}
			registers.setBool(continuation.callBase, prefix);
			for (let index = copiedCount + 1; index < resultCount; index += 1) {
				registers.setNil(continuation.callBase + index);
			}
		}
		caller.top = continuation.callBase + resultCount;
		return resultCount;
	}

	private finishProtectedContinuation(continuationIndex: number, resultCount: number): void {
		const continuation = this.activeThread.protectedCallContinuations.peek(continuationIndex);
		const caller = continuation.caller!;
		const callBase = continuation.callBase;
		const returnsToProtectedParent = continuation.returnsToProtectedParent;
		continuation.target = null;
		continuation.caller = null;
		this.activeThread.protectedCallDepth = continuationIndex;
		if (returnsToProtectedParent) {
			this.finishProtectedCallFromRegisters(continuationIndex - 1, caller.registers, callBase, resultCount);
		}
	}

	private handleProtectedCallError(
		errorTag: ValueTag,
		errorScalar: number,
		errorReference: ValueReference,
	): boolean {
		for (;;) {
			if (this.activeThread.protectedCallDepth === 0) {
				return false;
			}
			const continuationIndex = this.activeThread.protectedCallDepth - 1;
			const continuation = this.activeThread.protectedCallContinuations.peek(continuationIndex);
			const caller = continuation.caller!;
			const callerIndex = this.activeThread.frames.indexOf(caller);
			for (let frameIndex = this.activeThread.frames.length - 1; frameIndex > callerIndex; frameIndex -= 1) {
				// Completion roots return to their latch, not the interrupted caller.
				const frame = this.activeThread.frames[frameIndex];
				if (frame.isExceptionFrame || frame.returnToCompletionLatch) {
					return false;
				}
			}
			this.unwindToDepth(callerIndex + 1);
			if (continuation.kind !== ProtectedCallKind.XPCallBody) {
				if (continuation.kind === ProtectedCallKind.XPCallHandler) {
					this.finishProtectedCallWithError(
						continuationIndex,
						ValueTag.String,
						this.errorInErrorHandlingStringId,
						null,
					);
				} else {
					this.finishProtectedCallWithError(
						continuationIndex,
						errorTag,
						errorScalar,
						errorReference,
					);
				}
				return true;
			}

			continuation.kind = ProtectedCallKind.XPCallHandler;
			continuation.target = null;
			const handlerRegister = continuation.handlerRegister;
			const registers = this.ensureRegisterCapacity(caller, continuation.callBase);
			registers.setEncoded(
				continuation.callBase,
				errorTag,
				errorScalar,
				errorReference,
			);
			this.bumpRegisterTop(caller, continuation.callBase);
			try {
				this.invokeProtectedTarget(
					continuationIndex,
					caller.registers,
					handlerRegister,
					true,
					continuation.callBase,
					1,
				);
				return true;
			} catch (handlerError) {
				if (handlerError instanceof LuaThrownValueError) {
					errorTag = handlerError.tag;
					errorScalar = handlerError.scalar;
					errorReference = handlerError.reference;
					continue;
				}
				if (handlerError instanceof LuaExecutionError) {
					errorTag = ValueTag.String;
					errorScalar = this.luaFaultErrorStringIds[handlerError.reason];
					errorReference = null;
					continue;
				}
				throw handlerError;
			}
		}
	}

	private runBuiltinNextValue(args: BuiltinArgsView, out: BuiltinResults): void {
		const registers = args.registers;
		const base = args.base;
		if (args.length === 0 || registers.getTag(base) !== ValueTag.Table) {
			throw new LuaExecutionError(LUA_FAULT_REASON_ITERATE_NON_TABLE);
		}
		const table = registers.getTable(base);
		const found = args.length > 1
			? table.next(
				registers.getTag(base + 1),
				registers.getScalar(base + 1),
				registers.getReference(base + 1),
				out,
				0,
			)
			: table.next(ValueTag.Nil, NaN, null, out, 0);
		if (!found) {
			out.push(ValueTag.Nil);
		}
	}

	private runBuiltinType(tag: ValueTag, out: BuiltinResults): void {
		out.push(ValueTag.String, this.stringPool.intern(valueTypeNameForLuaTag(tag)));
	}

	private runBuiltinSetMetatable(args: BuiltinArgsView, out: BuiltinResults): void {
		const registers = args.registers;
		if (args.length === 0 || registers.getTag(args.base) !== ValueTag.Table) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		const target = registers.getTable(args.base);
		let metatable: Table | null = null;
		if (args.length > 1) {
			const metatableIndex = args.base + 1;
			const metatableTag = registers.getTag(metatableIndex);
			if (metatableTag === ValueTag.Table) {
				metatable = registers.getTable(metatableIndex);
			} else if (metatableTag !== ValueTag.Nil) {
				throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			}
		}
		target.metatable = metatable;
		out.push(ValueTag.Table, NaN, target);
	}

	private runBuiltinGetMetatable(args: BuiltinArgsView, out: BuiltinResults): void {
		if (args.length === 0 || args.registers.getTag(args.base) !== ValueTag.Table) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		const metatable = args.registers.getTable(args.base).metatable;
		if (metatable) {
			out.push(ValueTag.Table, NaN, metatable);
		} else {
			out.push(ValueTag.Nil);
		}
	}

	private runBuiltinRawGet(args: BuiltinArgsView, out: BuiltinResults): void {
		const registers = args.registers;
		if (args.length === 0 || registers.getTag(args.base) !== ValueTag.Table) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		const table = registers.getTable(args.base);
		if (args.length > 1) {
			const keyIndex = args.base + 1;
			table.load(
				registers.getTag(keyIndex),
				registers.getScalar(keyIndex),
				registers.getReference(keyIndex),
				out,
				0,
			);
			return;
		}
		table.load(ValueTag.Nil, NaN, null, out, 0);
	}

	private runBuiltinRawSet(args: BuiltinArgsView, out: BuiltinResults): void {
		const registers = args.registers;
		const base = args.base;
		if (args.length === 0 || registers.getTag(base) !== ValueTag.Table) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		const target = registers.getTable(base);
		let keyTag = ValueTag.Nil;
		let keyScalar = NaN;
		let keyReference: ValueReference = null;
		if (args.length > 1) {
			const keyIndex = base + 1;
			keyTag = registers.getTag(keyIndex);
			keyScalar = registers.getScalar(keyIndex);
			keyReference = registers.getReference(keyIndex);
		}
		let storedTag = ValueTag.Nil;
		let storedScalar = NaN;
		let storedReference: ValueReference = null;
		if (args.length > 2) {
			const valueIndex = base + 2;
			storedTag = registers.getTag(valueIndex);
			storedScalar = registers.getScalar(valueIndex);
			storedReference = registers.getReference(valueIndex);
		}
		target.store(
			keyTag,
			keyScalar,
			keyReference,
			storedTag,
			storedScalar,
			storedReference,
		);
		out.push(ValueTag.Table, NaN, target);
	}

	private runBuiltinSelect(args: BuiltinArgsView, out: BuiltinResults): void {
		const registers = args.registers;
		const base = args.base;
		const count = args.length - 1;
		let selectorTag = ValueTag.Nil;
		let selectorScalar = NaN;
		if (args.length > 0) {
			selectorTag = registers.getTag(base);
			selectorScalar = registers.getScalar(base);
		}
		if (selectorTag === ValueTag.String
			&& this.stringPool.toString(selectorScalar as StringId) === '#') {
			out.push(ValueTag.Number, count);
			return;
		}
		if (selectorTag !== ValueTag.Number) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		const startSelector = selectorScalar | 0;
		const start = startSelector >= 0
			? startSelector
			: count + startSelector + 1;
		for (let index = start; index <= count; index += 1) {
			if (index >= 1 && index < args.length) {
				const valueIndex = base + index;
				out.push(
					registers.getTag(valueIndex),
					registers.getScalar(valueIndex),
					registers.getReference(valueIndex),
				);
			}
		}
	}

	private runBuiltinStringByte(args: BuiltinArgsView, out: BuiltinResults): void {
		const registers = args.registers;
		const base = args.base;
		if (args.length === 0 || registers.getTag(base) !== ValueTag.String) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		const sourceId = registers.getStringId(base);
		let position = 1;
		if (args.length > 1) {
			const positionIndex = base + 1;
			const positionTag = registers.getTag(positionIndex);
			if (positionTag !== ValueTag.Nil) {
				if (positionTag !== ValueTag.Number) {
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				}
				position = registers.getScalar(positionIndex) | 0;
			}
		}
		if (position < 1 || position > this.stringPool.codepointCount(sourceId)) {
			out.push(ValueTag.Nil);
			return;
		}
		out.push(ValueTag.Number, this.stringPool.codepointAt(sourceId, position - 1));
	}

	private runBuiltinStringChar(args: BuiltinArgsView, out: BuiltinResults): void {
		const registers = args.registers;
		let result = '';
		for (let index = 0; index < args.length; index += 1) {
			const valueIndex = args.base + index;
			if (registers.getTag(valueIndex) !== ValueTag.Number) {
				throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			}
			const codepoint = registers.getScalar(valueIndex) >>> 0;
			if (codepoint > 0x10ffff || (codepoint >= 0xd800 && codepoint <= 0xdfff)) {
				throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			}
			result += String.fromCodePoint(codepoint);
		}
		out.push(ValueTag.String, this.stringPool.intern(result));
	}

	private runBuiltinError(args: BuiltinArgsView): never {
		if (args.length === 0) {
			throw new LuaThrownValueError(ValueTag.Nil, NaN, null);
		}
		const registers = args.registers;
		const index = args.base;
		throw new LuaThrownValueError(
			registers.getTag(index),
			registers.getScalar(index),
			registers.getReference(index),
		);
	}

	/** Reusing storage relinquishes the previous state backed by that snapshot. */
	public captureRuntimeState(snapshot = new CpuSnapshot()): CpuRuntimeState {
		const writer = new CpuSnapshotWriter(snapshot);
		const objectOrdinals = new Map<CpuSnapshotObject, number>();
		const pendingObjects: CpuSnapshotObject[] = [];
		const pendingKinds: CpuSnapshotObjectKind[] = [];
		const captureObject = (object: CpuSnapshotObject, kind: CpuSnapshotObjectKind): number => {
			const found = objectOrdinals.get(object);
			if (found !== undefined) return found;
			const id = writer.addObject();
			objectOrdinals.set(object, id);
			pendingObjects.push(object);
			pendingKinds.push(kind);
			return id;
		};
		const writeValue: CpuSnapshotValueWriter = (offset, tag, scalar, reference): void => {
			writer.setWord(offset, tag);
			switch (tag) {
				case ValueTag.Number: writer.setNumber(offset + 1, scalar); return;
				case ValueTag.Nil:
				case ValueTag.False:
				case ValueTag.True: writer.setWord(offset + 1, 0); break;
				case ValueTag.String:
				case ValueTag.BuiltinFunction: writer.setWord(offset + 1, scalar); break;
				case ValueTag.Table: writer.setWord(offset + 1, captureObject(reference as Table, CpuSnapshotObjectKind.Table)); break;
				case ValueTag.Closure: writer.setWord(offset + 1, captureObject(reference as Closure, CpuSnapshotObjectKind.Closure)); break;
				case ValueTag.Thread: writer.setWord(offset + 1, captureObject(reference as Thread, CpuSnapshotObjectKind.Thread)); break;
			}
			writer.setWord(offset + 2, 0);
		};
		const captureStoredValueState = (tag: ValueTag, scalar: number, reference: ValueReference): number => {
			const offset = writer.reserveWords(CPU_SNAPSHOT_VALUE_WORDS);
			writeValue(offset, tag, scalar, reference);
			return offset;
		};

		const threads: CpuThreadState[] = [];
		const captureThread = (thread: Thread): number => {
			const frames = new Array<CpuFrameState>(thread.frames.length);
			for (let frameIndex = 0; frameIndex < thread.frames.length; frameIndex += 1) {
				const frame = thread.frames[frameIndex];
				const closureRef = captureObject(frame.closure, CpuSnapshotObjectKind.Closure);
				// top delimits open CALL/RET ranges, not the reserved registerfile.
				const registers = new Array<number>(frame.stackCapacity);
				for (let registerIndex = 0; registerIndex < frame.stackCapacity; registerIndex += 1) {
					registers[registerIndex] = captureStoredValueState(
						frame.registers.getTag(registerIndex),
						frame.registers.getScalar(registerIndex),
						frame.registers.getReference(registerIndex),
					);
				}
				const varargs = new Array<number>(frame.varargCount);
				for (let varargIndex = 0; varargIndex < frame.varargCount; varargIndex += 1) {
					const slot = frame.varargBase + varargIndex;
					varargs[varargIndex] = captureStoredValueState(
						thread.stackRegisters.getTag(slot),
						thread.stackRegisters.getScalar(slot),
						thread.stackRegisters.getReference(slot),
					);
				}
				frames[frameIndex] = {
					functionAddress: frame.functionAddress,
					pc: frame.pc,
					closureRef,
					registers,
					stackCapacity: frame.stackCapacity,
					varargs,
					returnBase: frame.returnBase,
					returnCount: frame.returnCount,
					top: frame.top,
					returnToCompletionLatch: frame.returnToCompletionLatch,
					callSitePc: frame.callSitePc,
					isExceptionFrame: frame.isExceptionFrame,
					isNonMaskableExceptionFrame: frame.isNonMaskableExceptionFrame,
				};
			}
			const protectedCalls = new Array<CpuProtectedCallState>(thread.protectedCallDepth);
			for (let index = 0; index < thread.protectedCallDepth; index += 1) {
				const continuation = thread.protectedCallContinuations.peek(index);
				const caller = continuation.caller!;
				protectedCalls[index] = {
					kind: continuation.kind,
					callerFrameIndex: thread.frames.indexOf(caller),
					targetFrameIndex: continuation.target === null ? -1 : thread.frames.indexOf(continuation.target),
					returnsToProtectedParent: continuation.returnsToProtectedParent,
					callBase: continuation.callBase,
					returnCount: continuation.returnCount,
					handlerRegister: continuation.handlerRegister,
				};
			}

			const openUpvalues: number[] = [];
			for (let frameIndex = 0; frameIndex < thread.frames.length; frameIndex += 1) {
				let upvalue = thread.frames[frameIndex].openUpvalueHead;
				while (upvalue) {
					openUpvalues.push(captureObject(upvalue, CpuSnapshotObjectKind.Upvalue));
					upvalue = upvalue.nextOpen;
				}
			}
			const index = threads.length;
			threads.push({
				status: thread.status,
				entryRef: thread.entry === null ? -1 : captureObject(thread.entry, CpuSnapshotObjectKind.Closure),
				resumerRef: thread.resumer === null ? -1 : captureObject(thread.resumer, CpuSnapshotObjectKind.Thread),
				callBase: thread.callBase, returnCount: thread.returnCount,
				stackCapacity: thread.stackRegisters.capacity(),
				error: captureStoredValueState(thread.error.getTag(0), thread.error.getScalar(0), thread.error.getReference(0)),
				frames, protectedCalls, openUpvalues,
			});
			return index;
		};
		const rootThreadRef = captureObject(this.rootThread, CpuSnapshotObjectKind.Thread);
		const activeThreadRef = captureObject(this.activeThread, CpuSnapshotObjectKind.Thread);
		const completionThreadRef = captureObject(this.completionThread, CpuSnapshotObjectKind.Thread);
		const haltedUntilIrqThreadRef = this.haltedUntilIrqThread === null ? -1 : captureObject(this.haltedUntilIrqThread, CpuSnapshotObjectKind.Thread);

		const systemGlobals: CpuRootValueState[] = [];
		for (let slot = 0; slot < this.systemGlobalNames.length; slot += 1) {
			systemGlobals.push({
				key: this.systemGlobalNames[slot],
				value: captureStoredValueState(
					this.systemGlobalSlots.getTag(slot),
					this.systemGlobalSlots.getScalar(slot),
					this.systemGlobalSlots.getReference(slot),
				),
			});
		}

		const globalSlots: CpuRootValueState[] = [];
		for (let slot = 0; slot < this.globalNames.length; slot += 1) {
			globalSlots.push({
				key: this.globalNames[slot],
				value: captureStoredValueState(
					this.globalSlots.getTag(slot),
					this.globalSlots.getScalar(slot),
					this.globalSlots.getReference(slot),
				),
			});
		}


		const completionValues = new Array<number>(this.completionValueCount);
		for (let index = 0; index < this.completionValueCount; index += 1) {
			completionValues[index] = captureStoredValueState(
				this.completionValueSlots.getTag(index),
				this.completionValueSlots.getScalar(index),
				this.completionValueSlots.getReference(index),
			);
		}

		const stringIndexTable = captureStoredValueState(
			this.stringIndexTable ? ValueTag.Table : ValueTag.Nil,
			NaN,
			this.stringIndexTable,
		);

		// Materialization order affects later object hashes even for an unrooted
		// static closure. Preserve the entire cache, in physical-address order.
		const canonicalClosures = Array.from(this.staticClosuresByAddress.values());
		canonicalClosures.sort((left, right) => left.functionAddress - right.functionAddress);
		for (const closure of canonicalClosures) {
			captureObject(closure, CpuSnapshotObjectKind.Closure);
		}
		// Reserve ordinals at each edge, then drain in ordinal order. Guest graph
		// depth must not consume the host call stack.
		for (let id = 0; id < pendingObjects.length; id += 1) {
			const object = pendingObjects[id];
			const kind = pendingKinds[id];
			let offset: number;
			switch (kind) {
				case CpuSnapshotObjectKind.Thread: {
					const thread = object as Thread;
					offset = writer.reserveWords(CpuSnapshotThread.Size);
					writer.setWord(offset + CpuSnapshotThread.Kind, kind);
					writer.setWord(offset + CpuSnapshotThread.HashId, thread.hashId);
					writer.setWord(offset + CpuSnapshotThread.Index, captureThread(thread));
					break;
				}
				case CpuSnapshotObjectKind.Table:
					offset = (object as Table).captureSnapshot(writer, writeValue);
					break;
				case CpuSnapshotObjectKind.Closure: {
					const closure = object as Closure;
					offset = writer.reserveWords(CpuSnapshotClosure.Data + closure.upvalues.length);
					writer.setWord(offset + CpuSnapshotClosure.Kind, kind);
					writer.setWord(offset + CpuSnapshotClosure.HashId, closure.hashId);
					writer.setWord(offset + CpuSnapshotClosure.FunctionAddress, closure.functionAddress);
					writer.setWord(offset + CpuSnapshotClosure.Canonical, closure.heapBytes === 0 ? 1 : 0);
					writer.setWord(offset + CpuSnapshotClosure.UpvalueCount, closure.upvalues.length);
					for (let index = 0; index < closure.upvalues.length; index += 1) {
						writer.setWord(offset + CpuSnapshotClosure.Data + index, captureObject(closure.upvalues[index], CpuSnapshotObjectKind.Upvalue));
					}
					break;
				}
				case CpuSnapshotObjectKind.Upvalue: {
					const upvalue = object as Upvalue;
					offset = writer.reserveWords(CpuSnapshotUpvalue.Value + CPU_SNAPSHOT_VALUE_WORDS);
					writer.setWord(offset + CpuSnapshotUpvalue.Kind, kind);
					writer.setWord(offset + CpuSnapshotUpvalue.HashId, upvalue.hashId);
					writer.setWord(offset + CpuSnapshotUpvalue.Open, upvalue.open ? 1 : 0);
					writer.setWord(offset + CpuSnapshotUpvalue.Index, upvalue.index);
					writer.setWord(offset + CpuSnapshotUpvalue.ThreadRef, upvalue.open ? captureObject(upvalue.frame!.thread, CpuSnapshotObjectKind.Thread) : -1);
					writer.setWord(offset + CpuSnapshotUpvalue.FrameIndex, upvalue.open ? upvalue.frame!.thread.frames.indexOf(upvalue.frame!) : -1);
					if (upvalue.open) {
						const registers = upvalue.frame!.registers;
						writeValue(offset + CpuSnapshotUpvalue.Value, registers.getTag(upvalue.index), registers.getScalar(upvalue.index), registers.getReference(upvalue.index));
					} else {
						writeValue(offset + CpuSnapshotUpvalue.Value, upvalue.valueTag, upvalue.valueScalar, upvalue.valueReference);
					}
					break;
				}
			}
			writer.setObjectWord(id, offset);
		}
		let executionResidencyMask = 0;
		for (let index = 0; index < this.executionImagesByDomain.length; index += 1) {
			if (this.executionImagesByDomain[index] !== null) {
				executionResidencyMask |= 1 << index;
			}
		}
		writer.finish();
		return {
			executionCartridgeSlot: this.activeExecutionImage.executionDomainId,
			systemGlobals,
			globalSlots,
			executionResidencyMask,
			nextObjectHashId: this.nextObjectHashId,
			hardHalted: this.hardHalted,
			luaHeap: this.luaHeap.captureState(),
			stringIndexTable,
			rootThreadRef, activeThreadRef, completionThreadRef, threads,
			completionValues,
			snapshot,
			lastExecutionDomainId: this.lastExecutionDomainId,
			lastPc: this.lastPc,
			haltedUntilIrqFrameDepth: this.haltedUntilIrqFrameDepth,
			haltedUntilIrqThreadRef,
			interruptEventPending: this.interruptEventPending,
			memoryWriteBlocked: this.memoryWriteBlocked,
			memoryWriteBlockedAddress: this.memoryWriteBlockedAddress,
			statusWord: this.cop0Words[COP0_STATUS],
			causeWord: this.cop0Words[COP0_CAUSE],
			epcWord: this.cop0Words[COP0_EPC],
			badAddressWord: this.cop0Words[COP0_BAD_ADDRESS],
			luaFaultReasonWord: this.cop0Words[COP0_LUA_FAULT_REASON],
			exceptionDomainWord: this.exceptionDomainWord,
			nmiReturnCauseWord: this.nmiReturnCauseWord,
			nmiReturnEpcWord: this.nmiReturnEpcWord,
			nmiReturnBadAddressWord: this.nmiReturnBadAddressWord,
			nmiReturnLuaFaultReasonWord: this.nmiReturnLuaFaultReasonWord,
			nmiReturnExceptionDomainWord: this.nmiReturnExceptionDomainWord,
			nonMaskableInterruptPending: this.nonMaskableInterruptPending,
			yieldRequested: this.yieldRequested,
		};
	}

	public restoreRuntimeState(state: CpuRuntimeState): void {
		const snapshot = state.snapshot;
		const restoredObjects = new Array<CpuSnapshotObject>(snapshot.objectCount);
		this.clearCompletionValues();
		this.clearCallStack();
		const canonicalAddresses = new Set<number>();
		for (let index = 0; index < snapshot.objectCount; index += 1) {
			const offset = snapshot.objectWord(index);
			if (snapshot.word(offset) === CpuSnapshotObjectKind.Closure && snapshot.word(offset + CpuSnapshotClosure.Canonical) !== 0) {
				canonicalAddresses.add(snapshot.word(offset + CpuSnapshotClosure.FunctionAddress));
			}
		}
		for (const address of this.staticClosuresByAddress.keys()) {
			if (!canonicalAddresses.has(address)) this.staticClosuresByAddress.delete(address);
		}
		// Allocate every identity before resolving edges, including cycles and weak references.
		for (let index = 0; index < snapshot.objectCount; index += 1) {
			const offset = snapshot.objectWord(index);
			switch (snapshot.word(offset)) {
				case CpuSnapshotObjectKind.Thread: {
					const thread = index === state.rootThreadRef ? this.rootThread : new Thread(null);
					const saved = state.threads[snapshot.word(offset + CpuSnapshotThread.Index)];
					thread.hashId = snapshot.word(offset + CpuSnapshotThread.HashId);
					thread.stackRegisters = new ValueSlots(saved.stackCapacity);
					thread.stackTop = 0;
					thread.frames.length = 0;
					thread.status = saved.status;
					thread.callBase = saved.callBase;
					thread.returnCount = saved.returnCount;
					restoredObjects[index] = thread;
					break;
				}
				case CpuSnapshotObjectKind.Table: {
					const arrayCapacity = snapshot.word(offset + CpuSnapshotTable.ArrayCapacity);
					const hashSize = snapshot.word(offset + CpuSnapshotTable.HashSize);
					this.luaHeap.restoreAllocate(Table.trackedHeapBytesForCapacities(arrayCapacity, hashSize));
					const table = new Table(this.luaHeap, arrayCapacity, hashSize);
					table.hashId = snapshot.word(offset + CpuSnapshotTable.HashId);
					restoredObjects[index] = table;
					break;
				}
				case CpuSnapshotObjectKind.Closure: {
					const functionAddress = snapshot.word(offset + CpuSnapshotClosure.FunctionAddress);
					let closure: Closure;
					if (snapshot.word(offset + CpuSnapshotClosure.Canonical) !== 0) {
						closure = this.staticClosureAtAddress(functionAddress);
					} else {
						const upvalues = new Array<Upvalue>(snapshot.word(offset + CpuSnapshotClosure.UpvalueCount));
						const heapBytes = CLOSURE_HEAP_BYTES + upvalues.length * CLOSURE_UPVALUE_SLOT_HEAP_BYTES;
						this.luaHeap.restoreAllocate(heapBytes);
						closure = new Closure(functionAddress, upvalues, heapBytes);
					}
					closure.hashId = snapshot.word(offset + CpuSnapshotClosure.HashId);
					restoredObjects[index] = closure;
					break;
				}
				case CpuSnapshotObjectKind.Upvalue:
					this.luaHeap.restoreAllocate(UPVALUE_HEAP_BYTES);
					restoredObjects[index] = {
						hashId: snapshot.word(offset + CpuSnapshotUpvalue.HashId),
						open: false,
						index: snapshot.int(offset + CpuSnapshotUpvalue.Index),
						frame: null,
						valueTag: ValueTag.Nil,
						valueScalar: NaN,
						valueReference: null,
						nextOpen: null,
					};
					break;
			}
		}
		const reader = new CpuSnapshotReader(snapshot, restoredObjects);
		for (let index = 0; index < snapshot.objectCount; index += 1) {
			const offset = snapshot.objectWord(index);
			switch (snapshot.word(offset)) {
				case CpuSnapshotObjectKind.Table:
					(restoredObjects[index] as Table).restoreSnapshot(reader, offset);
					break;
				case CpuSnapshotObjectKind.Closure: {
					const closure = restoredObjects[index] as Closure;
					for (let slot = 0; slot < closure.upvalues.length; slot += 1) {
						closure.upvalues[slot] = restoredObjects[snapshot.word(offset + CpuSnapshotClosure.Data + slot)] as Upvalue;
					}
					break;
				}
				case CpuSnapshotObjectKind.Upvalue: {
					const upvalue = restoredObjects[index] as Upvalue;
					upvalue.open = snapshot.word(offset + CpuSnapshotUpvalue.Open) !== 0;
					reader.readValue(offset + CpuSnapshotUpvalue.Value);
					upvalue.valueTag = reader.tag;
					upvalue.valueScalar = reader.scalar;
					upvalue.valueReference = reader.reference;
					break;
				}
			}
		}

		// Constant/string and global-slot caches must not retain entries first
		// encountered in the discarded future. Rebuild from the same media.
		this.memory.clearMappedPageWriteWatches();
		this.executionImagesByDomain.fill(null);
		this.clearGlobalSlots();
		this.systemGlobalSlots.reserveCapacity(state.systemGlobals.length);
		for (let slot = 0; slot < state.systemGlobals.length; slot += 1) {
			const entry = state.systemGlobals[slot];
			this.systemGlobalNames.push(entry.key);
			this.systemGlobalSlotByKey.set(entry.key, slot);
			reader.readValue(entry.value);
			this.systemGlobalSlots.setEncoded(slot, reader.tag, reader.scalar, reader.reference);
		}
		this.globalSlots.reserveCapacity(state.globalSlots.length);
		for (let slot = 0; slot < state.globalSlots.length; slot += 1) {
			const entry = state.globalSlots[slot];
			this.globalNames.push(entry.key);
			this.globalSlotByKey.set(entry.key, slot);
			reader.readValue(entry.value);
			this.globalSlots.setEncoded(slot, reader.tag, reader.scalar, reader.reference);
		}
		for (let index = 0; index < this.executionImagesByDomain.length; index += 1) {
			if ((state.executionResidencyMask & (1 << index)) !== 0) {
				this.executionImageForDomain((index - 1) as ExecutionDomainId);
			}
		}
		this.systemImage = this.executionImagesByDomain[SYSTEM_EXECUTION_DOMAIN_ID + 1]!;
		const executionImage = this.executionImagesByDomain[state.executionCartridgeSlot + 1]!;
		this.latchActiveExecutionImage(executionImage);

		for (let objectIndex = 0; objectIndex < snapshot.objectCount; objectIndex += 1) {
			const offset = snapshot.objectWord(objectIndex);
			if (snapshot.word(offset) !== CpuSnapshotObjectKind.Thread) continue;
			const saved = state.threads[snapshot.word(offset + CpuSnapshotThread.Index)];
			const thread = restoredObjects[objectIndex] as Thread;
			this.activeThread = thread;
			thread.entry = saved.entryRef < 0 ? null : restoredObjects[saved.entryRef] as Closure;
			thread.resumer = saved.resumerRef < 0 ? null : restoredObjects[saved.resumerRef] as Thread;
			reader.readValue(saved.error);
			thread.error.setEncoded(0, reader.tag, reader.scalar, reader.reference);
			for (let frameIndex = 0; frameIndex < saved.frames.length; frameIndex += 1) {
				const frameState = saved.frames[frameIndex];
				this.readFunctionRecordOnBus(
					executionImage,
					frameState.functionAddress,
					this.executionBusSignals,
				);
				const functionRecord = this.functionRecordLatch;
				const frame = this.acquireFrame();
				frame.thread = this.activeThread;
				frame.functionAddress = frameState.functionAddress;
				frame.executionImage = functionRecord.image;
				frame.pc = frameState.pc;
				frame.closure = restoredObjects[frameState.closureRef] as Closure;
				frame.returnBase = frameState.returnBase;
				frame.returnCount = frameState.returnCount;
				frame.returnToCompletionLatch = frameState.returnToCompletionLatch;
				frame.callSitePc = frameState.callSitePc;
				frame.isExceptionFrame = frameState.isExceptionFrame;
				frame.isNonMaskableExceptionFrame = frameState.isNonMaskableExceptionFrame;
				frame.varargBase = this.activeThread.stackTop;
				frame.varargCount = frameState.varargs.length;
				const registers = this.prepareFrameRegisters(frame, frameState.stackCapacity);
				for (let registerIndex = 0; registerIndex < frameState.registers.length; registerIndex += 1) {
					reader.readValue(frameState.registers[registerIndex]);
					registers.setEncoded(
						registerIndex,
						reader.tag,
						reader.scalar,
						reader.reference,
					);
				}
				for (let varargIndex = 0; varargIndex < frameState.varargs.length; varargIndex += 1) {
					reader.readValue(frameState.varargs[varargIndex]);
					this.activeThread.stackRegisters.setEncoded(
						frame.varargBase + varargIndex,
						reader.tag,
						reader.scalar,
						reader.reference,
					);
				}
				frame.top = frameState.top;
				this.activeThread.frames.push(frame);
			}
			for (let index = 0; index < saved.protectedCalls.length; index += 1) {
				const continuationState = saved.protectedCalls[index];
				const continuation = this.activeThread.protectedCallContinuations.get(index);
				continuation.kind = continuationState.kind;
				continuation.caller = this.activeThread.frames[continuationState.callerFrameIndex];
				continuation.target = continuationState.targetFrameIndex < 0 ? null : this.activeThread.frames[continuationState.targetFrameIndex];
				continuation.returnsToProtectedParent = continuationState.returnsToProtectedParent;
				continuation.callBase = continuationState.callBase;
				continuation.returnCount = continuationState.returnCount;
				continuation.handlerRegister = continuationState.handlerRegister;
			}
			this.activeThread.protectedCallDepth = saved.protectedCalls.length;

		}
		for (let objectIndex = 0; objectIndex < snapshot.objectCount; objectIndex += 1) {
			const offset = snapshot.objectWord(objectIndex);
			if (snapshot.word(offset) !== CpuSnapshotObjectKind.Thread) continue;
			const saved = state.threads[snapshot.word(offset + CpuSnapshotThread.Index)];
			for (let index = 0; index < saved.openUpvalues.length; index += 1) {
				const offset = snapshot.objectWord(saved.openUpvalues[index]);
				const upvalue = restoredObjects[saved.openUpvalues[index]] as Upvalue;
				const owner = restoredObjects[snapshot.int(offset + CpuSnapshotUpvalue.ThreadRef)] as Thread;
				const frame = owner.frames[snapshot.int(offset + CpuSnapshotUpvalue.FrameIndex)];
				upvalue.open = true;
				upvalue.index = snapshot.int(offset + CpuSnapshotUpvalue.Index);
				upvalue.frame = frame;
				upvalue.valueTag = ValueTag.Nil;
				upvalue.valueScalar = NaN;
				upvalue.valueReference = null;
				this.linkOpenUpvalue(frame, upvalue);
			}

		}
		this.activeThread = restoredObjects[state.activeThreadRef] as Thread;
		this.completionThread = restoredObjects[state.completionThreadRef] as Thread;
		this.threadSwitchRequested = false;
		reader.readValue(state.stringIndexTable);
		this.stringIndexTable = reader.reference as Table | null;
		if (state.completionValues.length > this.completionValueSlots.capacity()) {
			let capacity = this.completionValueSlots.capacity() * 2;
			while (capacity < state.completionValues.length) {
				capacity *= 2;
			}
			this.completionValueSlots = new ValueSlots(capacity);
		}
		for (let index = 0; index < state.completionValues.length; index += 1) {
			reader.readValue(state.completionValues[index]);
			this.completionValueSlots.setEncoded(
				index,
				reader.tag,
				reader.scalar,
				reader.reference,
			);
		}
		this.completionValueCount = state.completionValues.length;
		this.lastExecutionDomainId = state.lastExecutionDomainId;
		this.lastPc = state.lastPc;
		this.haltedUntilIrqFrameDepth = state.haltedUntilIrqFrameDepth;
		this.haltedUntilIrqThread = state.haltedUntilIrqThreadRef === -1 ? null : restoredObjects[state.haltedUntilIrqThreadRef] as Thread;
		this.interruptEventPending = state.interruptEventPending;
		this.memoryWriteBlocked = state.memoryWriteBlocked;
		this.memoryWriteBlockedAddress = state.memoryWriteBlockedAddress;
		this.cop0Words[COP0_STATUS] = state.statusWord;
		this.cop0Words[COP0_CAUSE] = state.causeWord;
		this.cop0Words[COP0_EPC] = state.epcWord;
		this.cop0Words[COP0_BAD_ADDRESS] = state.badAddressWord;
		this.cop0Words[COP0_LUA_FAULT_REASON] = state.luaFaultReasonWord;
		this.exceptionDomainWord = state.exceptionDomainWord;
		this.nmiReturnCauseWord = state.nmiReturnCauseWord;
		this.nmiReturnEpcWord = state.nmiReturnEpcWord;
		this.nmiReturnBadAddressWord = state.nmiReturnBadAddressWord;
		this.nmiReturnLuaFaultReasonWord = state.nmiReturnLuaFaultReasonWord;
		this.nmiReturnExceptionDomainWord = state.nmiReturnExceptionDomainWord;
		this.nonMaskableInterruptPending = state.nonMaskableInterruptPending;
		this.yieldRequested = state.yieldRequested;
		this.hardHalted = state.hardHalted;
		this.nextObjectHashId = state.nextObjectHashId;
		this.luaHeap.restoreState(state.luaHeap);
	}

	private tableWeakMode(table: Table): number {
		const metatable = table.metatable;
		if (!metatable) {
			return 0;
		}
		metatable.loadStringKey(this.modeKey, this.tableScratch, 0);
		if (this.tableScratch.getTag(0) !== ValueTag.String) {
			this.tableScratch.setNil(0);
			return 0;
		}
		const modeId = this.tableScratch.getStringId(0);
		this.tableScratch.setNil(0);
		const mode = this.stringPool.toString(modeId);
		let weakMode = 0;
		for (let index = 0; index < mode.length; index += 1) {
			switch (mode.charCodeAt(index)) {
				case TABLE_WEAK_KEY_CODE_UNIT:
					weakMode |= TABLE_WEAK_KEYS;
					break;
				case TABLE_WEAK_VALUE_CODE_UNIT:
					weakMode |= TABLE_WEAK_VALUES;
					break;
			}
		}
		return weakMode;
	}

	private pushHeapImage(image: Blua32ExecutionImage): void {
		if (this.heapSeenImages.get(image) === this.heapEpoch) {
			return;
		}
		this.heapSeenImages.set(image, this.heapEpoch);
		for (let index = 0; index < image.constTags.length; index += 1) {
			if (image.constTags[index] === ValueTag.String) {
				this.stringPool.markReachable(image.constScalars[index] as StringId);
			}
		}
	}

	private traceThread(thread: Thread): void {
		if (thread.entry !== null) this.heapObjectStack.push(thread.entry);
		if (thread.resumer !== null) this.heapObjectStack.push(thread.resumer);
		this.pushHeapRegister(thread.error, 0);
		for (let frameIndex = 0; frameIndex < thread.frames.length; frameIndex += 1) {
			const frame = thread.frames[frameIndex];
			this.pushHeapImage(frame.executionImage);
			if (frame.closure.heapBytes !== 0) {
				this.heapObjectStack.push(frame.closure);
			}
			for (let registerIndex = 0; registerIndex < frame.stackCapacity; registerIndex += 1) {
				this.pushHeapRegister(frame.registers, registerIndex);
			}
			for (let index = 0; index < frame.varargCount; index += 1) {
				this.pushHeapRegister(thread.stackRegisters, frame.varargBase + index);
			}
			let upvalue = frame.openUpvalueHead;
			while (upvalue) {
				this.heapUpvalueStack.push(upvalue);
				upvalue = upvalue.nextOpen;
			}
		}
	}

	public collectTrackedHeapBytes(
		root0Tag: ValueTag = ValueTag.Nil,
		root0Scalar: number = NaN,
		root0Reference: ValueReference = null,
		root1Tag: ValueTag = ValueTag.Nil,
		root1Scalar: number = NaN,
		root1Reference: ValueReference = null,
		root2Tag: ValueTag = ValueTag.Nil,
		root2Scalar: number = NaN,
		root2Reference: ValueReference = null,
	): number {
		this.heapEpoch += 1;
		const seen = this.heapSeen;
		let total = 0;
		const objectStack = this.heapObjectStack;
		const upvalueStack = this.heapUpvalueStack;
		const weakTables = this.heapWeakTables;
		const weakTableModes = this.heapWeakTableModes;
		const ephemeronTables = this.heapEphemeronTables;
		objectStack.length = 0;
		upvalueStack.length = 0;
		weakTables.length = 0;
		weakTableModes.length = 0;
		ephemeronTables.length = 0;
		this.stringPool.beginReachabilityEpoch();
		this.stringPool.markReachable(this.indexKey);
		this.stringPool.markReachable(this.modeKey);
		this.stringPool.markReachable(this.errorInErrorHandlingStringId);
		for (let reason = 0; reason < this.luaFaultErrorStringIds.length; reason += 1) {
			if (reason !== LUA_FAULT_REASON_EXPLICIT_ERROR) this.stringPool.markReachable(this.luaFaultErrorStringIds[reason]);
		}

		for (let slot = 0; slot < this.systemGlobalNames.length; slot += 1) {
			this.stringPool.markReachable(this.systemGlobalNames[slot]);
			this.pushHeapRegister(this.systemGlobalSlots, slot);
		}
		for (let slot = 0; slot < this.globalNames.length; slot += 1) {
			this.stringPool.markReachable(this.globalNames[slot]);
			this.pushHeapRegister(this.globalSlots, slot);
		}
		if (this.stringIndexTable) {
			objectStack.push(this.stringIndexTable);
		}
		for (let index = 0; index < this.completionValueCount; index += 1) {
			this.pushHeapRegister(this.completionValueSlots, index);
		}
		for (const value of this.localRoots) {
			const tag = valueTag(value);
			switch (tag) {
				case ValueTag.String:
					this.stringPool.markReachable(asStringId(value as StringValue));
					break;
				case ValueTag.Table:
				case ValueTag.Thread:
				case ValueTag.Closure:
					this.pushHeapStoredValue(tag, NaN, value as NonNullable<ValueReference>);
					break;
			}
		}
		for (let scratchIndex = 0; scratchIndex < this.builtinResultsScratchIndex; scratchIndex += 1) {
			const scratch = this.builtinResultsScratch.peek(scratchIndex);
			for (let valueIndex = 0; valueIndex < scratch.length; valueIndex += 1) {
				this.pushHeapStoredValue(
					scratch.getTag(valueIndex),
					scratch.getScalar(valueIndex),
					scratch.getReference(valueIndex),
				);
			}
		}
		for (let index = 0; index < this.executionImagesByDomain.length; index += 1) {
			const image = this.executionImagesByDomain[index];
			if (image !== null) {
				this.pushHeapImage(image);
			}
		}
		objectStack.push(this.rootThread, this.activeThread, this.completionThread);
		if (this.haltedUntilIrqThread !== null) objectStack.push(this.haltedUntilIrqThread);
		this.pushHeapStoredValue(root0Tag, root0Scalar, root0Reference);
		this.pushHeapStoredValue(root1Tag, root1Scalar, root1Reference);
		this.pushHeapStoredValue(root2Tag, root2Scalar, root2Reference);
		for (;;) {
			while (objectStack.length > 0 || upvalueStack.length > 0) {
				if (upvalueStack.length > 0) {
					const upvalue = upvalueStack.pop()!;
					if (seen.get(upvalue) === this.heapEpoch) {
						continue;
					}
					seen.set(upvalue, this.heapEpoch);
					total += UPVALUE_HEAP_BYTES;
					if (upvalue.open) {
						this.pushHeapRegister(upvalue.frame!.registers, upvalue.index);
						objectStack.push(upvalue.frame!.thread);
					} else {
						this.pushHeapStoredValue(
							upvalue.valueTag,
							upvalue.valueScalar,
							upvalue.valueReference,
						);
					}
					continue;
				}
				const object = objectStack.pop()!;
				switch (object[VALUE_TAG]) {
					case ValueTag.Thread: {
						const thread = object as Thread;
						if (seen.get(thread) === this.heapEpoch) continue;
						seen.set(thread, this.heapEpoch);
						total += THREAD_HEAP_BYTES + thread.stackRegisters.capacity() * THREAD_STACK_SLOT_BYTES;
						this.traceThread(thread);
						continue;
					}
					case ValueTag.Table: {
						const table = object as Table;
						if (seen.get(table) === this.heapEpoch) {
							continue;
						}
						seen.set(table, this.heapEpoch);
						total += table.getTrackedHeapBytes();
						if (table.metatable) {
							objectStack.push(table.metatable);
						}
						this.heapTableWeakMode = this.tableWeakMode(table);
						if (this.heapTableWeakMode !== 0) {
							weakTables.push(table);
							weakTableModes.push(this.heapTableWeakMode);
							if (this.heapTableWeakMode === TABLE_WEAK_KEYS) {
								ephemeronTables.push(table);
							}
						}
						if ((this.heapTableWeakMode & TABLE_WEAK_KEYS) === 0) {
							table.forEachStoredEntry(this.visitHeapTableEntry);
						}
						continue;
					}
					case ValueTag.Closure: {
						const closure = object as Closure;
						if (seen.get(closure) === this.heapEpoch) {
							continue;
						}
						seen.set(closure, this.heapEpoch);
						total += closure.heapBytes;
						for (let index = 0; index < closure.upvalues.length; index += 1) {
							upvalueStack.push(closure.upvalues[index]);
						}
						continue;
					}
				}
			}
			this.heapEphemeronChanged = false;
			for (let index = 0; index < ephemeronTables.length; index += 1) {
				ephemeronTables[index].forEachStoredEntry(this.visitHeapEphemeronEntry);
			}
			if (!this.heapEphemeronChanged) {
				break;
			}
		}
		for (let index = 0; index < weakTables.length; index += 1) {
			const weakMode = weakTableModes[index];
			const table = weakTables[index];
			table.clearWeakEntries(
				(weakMode & TABLE_WEAK_KEYS) !== 0,
				(weakMode & TABLE_WEAK_VALUES) !== 0,
				this.heapStoredValueIsAlive,
			);
			table.forEachStoredEntry(this.markWeakEntryStrings);
		}
		this.stringPool.reclaimUnreachable();
		total += this.stringPool.trackedLuaHeapBytes();
		weakTables.length = 0;
		weakTableModes.length = 0;
		ephemeronTables.length = 0;
		this.luaHeap.finishCollection(total);
		return total;
	}

}

// end normalized-body-acceptable
// end repeated-sequence-acceptable
