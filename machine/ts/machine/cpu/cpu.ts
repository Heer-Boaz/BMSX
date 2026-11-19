import { ValueMoveKind } from '../../spec/blua32/instruction_format';
import { GcHeap, type GcState } from './gc_heap';
import { GarbageAllocation, GcKind } from './gc_object';
import { PendingMemoryKind, type PendingMemoryOperation } from './memory_operation';
import { valueAdd, valueSubtract, valueMultiply, valueDivide, valueFloorDivide, valueModulo, valuePower, valueNegate, integerOperand, wordOperand, } from './value_arithmetic';
import { numberToF32Bits } from '../../common/float32';
import { ValueStorage } from './value_storage';
import { CART_ROM_BASE } from '../../spec/bmsx/memory_map';
import { StringPool, type StringId } from './string_pool';
import {
	NO_BLOCKED_MAPPED_WRITE,
	type MappedPageBinding,
	type MappedPageInvalidator,
	type Memory,
	type MemoryByteView,
} from '../memory/memory';
import {
	MAPPED_BUS_INSTRUCTION_FETCH,
	MAPPED_BUS_MASTER_CPU,
	mappedBusSignalsForCartridgeSlot,
	type MappedBusSignals,
} from '../memory/bus_signals';
import { readLE32 } from '../../common/endian';
import type { IrqController } from '../devices/irq/controller';
import { BASE_CYCLES, TABLE_INDEX_VISIT_CYCLES, TABLE_LENGTH_PROBE_CYCLES, OPCODE_USES_BX, OPCODE_USES_DISP, OPCODE_RK_OPERANDS, RK_OPERAND_B, RK_OPERAND_C, OpCode, decodeValueCount } from '../../spec/blua32/opcode';
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
	LUA_FAULT_REASON_INVALID_NEXT_KEY,
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
	BLUA32_GLOBAL_NAME_RECORD_SIZE,
	BLUA32_IMAGE_CONSTANT_COUNT_OFFSET,
	BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET,
	BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_HEADER_SIZE,
	BLUA32_IMAGE_MAGIC,
	BLUA32_IMAGE_MAGIC_OFFSET,
	BLUA32_IMAGE_VERSION,
	BLUA32_IMAGE_VERSION_OFFSET,
	BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET,
	BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET,
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
import { luaShiftLeft, luaShiftRight, NumericOrder } from '../../spec/blua32/numeric';
import {
	MAPPED_PAGE_BYTE_MASK,
	MAPPED_PAGE_BYTE_SIZE,
} from '../memory/mapped_page';
import { BuiltinFunctionId, GarbageCollectionOperation, LUA_BOOT_PRIMITIVES } from '../../spec/blua32/builtin';
import {
	EMPTY_CALL_ARGS,
	ValueTag,
	valueTable, valueClosure, valueNil, valueInteger, valueFloat, valueFloatBits, valuePayload, valueFromTag, valueToByteString,
	valueIsInteger, valueIsFloat, valueIsNumber, asInteger, asFloat, compareNumbers, valuesEqual, valueBuiltinFunction, valueString, valueBool, valueThread, asThread,
	valueTag, valueToInteger,
	valueTypeNameForLuaTag,
	type Value,
} from './value';
import { LUA_OUT_OF_MEMORY_SIGNAL, LuaExecutionError, LuaThrownValueError } from './errors';
import { Table, TableRecords, TableHeader, TableLookupStatus, type TableLookupResult, type TableLengthWork } from './table';
import { Closure, Upvalue, UPVALUE_CHAIN_LIMIT, UPVALUE_HEAP_BYTES, sameFunctionPrototype } from './closure';
import { ValueSlots } from './value_slots';
import { BuiltinArgsView, BuiltinResults, BUILTIN_FUNCTIONS } from './builtin_values';
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
import { ProtectedCallKind, ProtectedField, PROTECTED_CALL_KIND_MASK, PROTECTED_CALL_PARENT, type CallFrame } from './call_state';
import { CompiledCodeLookup } from './compiled_code_lookup';
import { Thread, ThreadStatus, THREAD_HEAP_BYTES, THREAD_INITIAL_BACKING_BYTES } from './thread';
import { ThreadField } from './thread_record';
import { LuaHeap, type LuaHeapState } from './lua_heap';
import { HeapAllocator } from './heap_allocator';
import {
	CpuExecutionBackend, CompiledBlockExit, COMPILED_BLOCK_THRESHOLD,
	COMPILED_BLOCK_MAX_INSTRUCTIONS,
	compiledBlockSupports, compiledBlockEndsBlock, compiledBlockComparison, compiledBlockHasContinuation,
	type CompiledBlockExitSite, type CompiledBlockSource,
} from './compiled_block';
import { CompiledBlockPage, CompiledCodeCache, linkCompiledBlock } from './compiled_code_cache';
import { compileJavaScriptRegion, type CompiledRegion, type CompiledRegionRunState } from './compiled_region';
import { CpuSnapshot, CpuSnapshotWriter, CpuSnapshotReader, CpuSnapshotObjectKind, CpuSnapshotClosure, CpuSnapshotTable, CpuSnapshotUpvalue, CpuSnapshotThread, CPU_SNAPSHOT_VALUE_WORDS, type CpuSnapshotObject, type CpuSnapshotValueWriter } from './snapshot';

// start repeated-sequence-acceptable -- Lua VM/table/register hot paths deliberately keep short copy/update sequences inline.
// start normalized-body-acceptable -- Specialized Lua VM accessors stay split so the fast paths avoid dispatch helpers.



// These activation fields have not yet moved to the guest stack record.
export type CpuRootValueState = {
	key: StringId;
	value: number;
};

export type CpuRuntimeState = {
	executionCartridgeSlot: ExecutionDomainId;
	programExecutionDomainId: ExecutionDomainId;
	systemGlobals: CpuRootValueState[];
	globalSlots: CpuRootValueState[];
	executionResidencyMask: ExecutionDomainMask;
	nextObjectHashId: number;
	hardHalted: boolean;
	luaHeap: LuaHeapState;
	gc: GcState;
	stringIndexTable: number;
	rootThreadRef: number;
	activeThreadRef: number;
	completionThreadRef: number;
	completionValues: number[];
	snapshot: CpuSnapshot;
	lastExecutionDomainId: ExecutionDomainId;
	lastPc: number;
	haltedUntilIrqFrameDepth: number;
	haltedUntilIrqThreadRef: number;
	interruptEventPending: boolean;
	memoryWriteBlocked: boolean;
	memoryWriteBlockedAddress: number;
	pendingMemory: PendingMemoryOperation;
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


export class CPU implements MappedPageInvalidator {
	/** Current runUntilDepth grant; consumed by the caller, not checkpoint state. */
	public instructionBudgetRemaining: number = 0;
	public lastPc: number = 0;
	public readonly rootThread: Thread;
	public activeThread: Thread;
	private completionThread: Thread;
	public readonly memory: Memory;

	public readonly luaHeap: LuaHeap;
	public readonly heapAllocator: HeapAllocator;
	public readonly gc: GcHeap;
	public readonly stringPool: StringPool;
	private indexKey!: StringId;
	private modeKey!: StringId;
	private haltedUntilIrqFrameDepth = -1;
	private haltedUntilIrqThread: Thread | null = null;
	private interruptEventPending = false;
	private memoryWriteBlocked = false;
	private memoryWriteBlockedAddress = 0;
	private readonly pendingMemory: PendingMemoryOperation = { kind: PendingMemoryKind.None, instructionPc: 0, nextPc: 0, address: 0, accessKind: MemoryAccessKind.Word, registerIndex: 0, wordCount: 0 };
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
	private readonly tableLengthWork: TableLengthWork = { probes: 0 };
	private readonly compiledRunState: CompiledRegionRunState = {
		remainingCycles: 0, registerTop: 0, memoryAddress: 0, stackOffset: 0, stackBytes: 0, lengthWork: this.tableLengthWork,
	};
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
	private closureCellAddresses = new Uint32Array(0);
	private captureAddresses = new Uint32Array(0);
	private readonly tableScratch = new ValueSlots(2);
	private readonly tableLookupResult: TableLookupResult = {
		values: this.tableScratch, slot: -1, extraVisits: 0, status: TableLookupStatus.Resolved,
	};
	private heapEpoch = 0;
	private readonly heapSeenImages = new WeakMap<object, number>();

	private readonly executionImagesByDomain: Array<Blua32ExecutionImage | null> =
		new Array<Blua32ExecutionImage | null>(EXECUTION_DOMAIN_COUNT).fill(null);
	private systemImage!: Blua32ExecutionImage;
	private activeExecutionImage!: Blua32ExecutionImage;
	private activeExecutionDomainId: ExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	private programExecutionDomainId: ExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
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
		functionAddress: 0,
		codeAddress: 0,
		numParams: 0,
		maxStack: 0,
		flags: 0,
		upvalueTableAddress: 0,
		recordUpvalueCount: 0,
		executionDomainId: SYSTEM_EXECUTION_DOMAIN_ID,
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
	private readonly staticClosuresByAddress = new Map<number, Closure[]>();
	private stringIndexTable: Value = valueNil();
	private systemGlobalNames: StringId[] = [];
	private readonly systemGlobalSlots = new ValueSlots(0);
	private systemGlobalSlotByKey: Map<StringId, number> = new Map();
	private globalNames: StringId[] = [];
	private readonly globalSlots = new ValueSlots(0);
	private globalSlotByKey: Map<StringId, number> = new Map();
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
		this.heapAllocator = new HeapAllocator(memory);
		this.luaHeap = new LuaHeap(this);
		this.stringPool = new StringPool(this.luaHeap, this.memory, this.heapAllocator);
		this.indexKey = this.stringPool.intern('__index');
		this.modeKey = this.stringPool.intern('__mode');
		this.gc = new GcHeap(this, this.luaHeap, memory, this.heapAllocator, this.modeKey);
		this.errorInErrorHandlingStringId = this.stringPool.intern('error in error handling');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_UNKNOWN] = this.stringPool.intern('Attempted to get length of an unsupported value.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_CALL_NON_FUNCTION] = this.stringPool.intern('Attempted to call a non-function value.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_INDEX_NON_TABLE] = this.stringPool.intern('Attempted to index field on a non-table value.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_ASSIGN_NON_TABLE] = this.stringPool.intern('Attempted to assign to a non-table value.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_INDEX_NIL] = this.stringPool.intern('Table index is nil.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_METATABLE_LOOP] = this.stringPool.intern('Metatable __index loop detected.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_ITERATE_NON_TABLE] = this.stringPool.intern('Attempted to iterate a non-table value.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION] = this.stringPool.intern('xpcall error handler must be a function.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_OUT_OF_MEMORY] = this.stringPool.intern('Out of memory.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_INVALID_ARGUMENT] = this.stringPool.intern('Invalid argument.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_INVALID_NEXT_KEY] = this.stringPool.intern("invalid key to 'next'");
		this.rootThread = this.createThread(null);
		this.rootThread.status = ThreadStatus.Running;
		this.activeThread = this.rootThread;
		this.completionThread = this.rootThread;
		this.memory.attachMappedPageInvalidator(this);
	}

	public allocateObjectHashId(): number {
		const hashId = this.nextObjectHashId;
		this.nextObjectHashId = (hashId + 1) >>> 0;
		return hashId;
	}

	public createTable(arraySize: number = 0, hashSize: number = 0): Table {
		const hashCapacity = TableRecords.hashCapacity(hashSize);
		const address = this.luaHeap.allocateRecord(TableRecords.HEADER_BYTES, false, TableRecords.storageBytes(arraySize, hashCapacity), TableHeader.Storage);
		const table = new Table(this.gc, address);
		this.gc.tables.initialize(address, arraySize, hashCapacity);
		table.hashId = this.allocateObjectHashId();
		this.gc.track(table);
		if (this.localRootScopeDepth > 0) this.localRoots.push(valueTable(this.gc.reference(table)));
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

	private ensureStackCapacity(size: number, root: Value, frameEntry = false, exception = false): void {
		const thread = this.activeThread, current = thread.stackRegisters.capacity();
		const next = size <= current ? current : Math.max(8, 1 << (32 - Math.clz32(size - 1)));
		if (frameEntry) thread.reserveFrame(next, root, exception);
		else if (next !== current) thread.resizeStack(next, root);
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
		const slot = (frame.stackBase + index) >>> 0;
		let address = frame.openUpvalueHead;
		for (let remaining = UPVALUE_CHAIN_LIMIT; address !== 0 && remaining !== 0; --remaining) {
			const upvalue = this.gc.openCellAt(address);
			if (upvalue === null) break;
			const current = upvalue.stackSlot;
			if (current <= slot) return current === slot ? upvalue : null;
			address = upvalue.nextAddress;
		}
		return null;
	}

	private linkOpenUpvalue(frame: CallFrame, upvalue: Upvalue, slot: number): void {
		let previous: Upvalue | null = null;
		let next = frame.openUpvalueHead;
		for (let remaining = UPVALUE_CHAIN_LIMIT; next !== 0 && remaining !== 0; --remaining) {
			const current = this.gc.openCellAt(next);
			if (current === null || current.stackSlot <= slot) break;
			previous = current;
			next = current.nextAddress;
		}
		upvalue.bind(frame.thread.address, slot, next);
		if (previous === null) frame.openUpvalueHead = upvalue.address;
		else previous.nextAddress = upvalue.address;
	}

	// TODO: Admit function-valued __index through VM call/return continuations in
	// all indexed-read forms. Table-only resolution is an implementation limitation,
	// not the intended BLua contract; raw Table storage must not execute guest code.
	private loadTableIndex(base: Value, key: Value, target: ValueSlots, targetIndex: number): void {
		let address: number;
		switch (valueTag(base)) {
			case ValueTag.Table: address = valuePayload(base); break;
			case ValueTag.String: address = valuePayload(this.stringIndexTable); break;
			default: throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
		}
		if (this.gc.tables.metatableAddress(address) === 0) { this.gc.tables.load(address, valueTag(key), valuePayload(key), target, targetIndex); return; }
		const result = this.tableLookupResult;
		this.gc.tables.resolveIndex(address, this.indexKey, valueTag(key), valuePayload(key), result);
		this.instructionBudgetRemaining -= result.extraVisits * TABLE_INDEX_VISIT_CYCLES;
		if (result.status === TableLookupStatus.ChainExhausted) throw new LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
		target.copySlotFrom(result.values, targetIndex, 0); result.values.setNil(0);
	}
	private loadTableIntegerIndex(base: Value, key: number, target: ValueSlots, targetIndex: number): void {
		let address: number;
		switch (valueTag(base)) {
			case ValueTag.Table: address = valuePayload(base); break;
			case ValueTag.String: address = valuePayload(this.stringIndexTable); break;
			default: throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
		}
		if (this.gc.tables.metatableAddress(address) === 0) { this.gc.tables.loadInteger(address, key, target, targetIndex); return; }
		const result = this.tableLookupResult;
		this.gc.tables.resolveIntegerIndex(address, this.indexKey, key, result);
		this.instructionBudgetRemaining -= result.extraVisits * TABLE_INDEX_VISIT_CYCLES;
		if (result.status === TableLookupStatus.ChainExhausted) throw new LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
		target.copySlotFrom(result.values, targetIndex, 0); result.values.setNil(0);
	}
	private loadTableFieldIndexCached(base: Value, page: DecodedInstructionPage, pageOffset: number, key: StringId, target: ValueSlots, targetIndex: number): void {
		let address: number;
		switch (valueTag(base)) {
			case ValueTag.Table: address = valuePayload(base); break;
			case ValueTag.String: address = valuePayload(this.stringIndexTable); break;
			default: throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
		}
		if (this.gc.tables.metatableAddress(address) === 0) { page.tableCacheSlots[pageOffset] = this.gc.tables.loadStringKeyCached(address, key, page.tableCacheSlots[pageOffset], target, targetIndex); return; }
		const result = this.tableLookupResult;
		this.gc.tables.resolveStringIndexCached(address, this.indexKey, key, page.tableCacheSlots[pageOffset], result);
		this.instructionBudgetRemaining -= result.extraVisits * TABLE_INDEX_VISIT_CYCLES;
		if (result.status === TableLookupStatus.ChainExhausted) throw new LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
		page.tableCacheSlots[pageOffset] = result.slot;
		target.copySlotFrom(result.values, targetIndex, 0); result.values.setNil(0);
	}
	private storeTableIndex(base: Value, key: Value, value: Value): void {
		if (valueTag(base) !== ValueTag.Table) throw new LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
		this.gc.tables.set(valuePayload(base), key, value);
	}
	private storeTableIntegerIndex(base: Value, index: number, value: Value): void {
		if (valueTag(base) !== ValueTag.Table) throw new LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
		this.gc.tables.setInteger(valuePayload(base), index, value);
	}
	private storeTableFieldIndexCached(base: Value, page: DecodedInstructionPage, pageOffset: number, key: StringId, value: Value): void {
		if (valueTag(base) !== ValueTag.Table) throw new LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
		page.tableCacheSlots[pageOffset] = this.gc.tables.storeStringKeyCached(valuePayload(base), key, page.tableCacheSlots[pageOffset], valueTag(value), valuePayload(value));
	}

	private clearCallStack(): void {
		this.abortStalledMemoryWrite();
		for (;;) {
			this.activeThread.protectedDepth = 0;
			while (this.activeThread.frameDepth > 0) {
				const frame = this.activeThread.currentFrame!;
				this.closeUpvalues(frame);
				frame.thread.leaveFrame();
			}
			this.activeThread.stackRegisters.clear(this.activeThread.stackRegisters.capacity());
			this.activeThread.stackTop = 0;
			const thread = this.activeThread;
			thread.status = ThreadStatus.Dead;
			thread.entry = null;
			thread.error = valueNil();
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
		this.stringIndexTable = valueNil();
		this.haltedUntilIrqFrameDepth = -1;
		this.haltedUntilIrqThread = null;
		this.interruptEventPending = false;
		this.memoryWriteBlocked = false;
		this.memoryWriteBlockedAddress = 0;
		this.pendingMemory.kind = PendingMemoryKind.None;
		this.hardHalted = false;
		this.programExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
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
		this.gc.armThreadStackWatches();
		if (!this.setProgramHeapFloor(systemBoot.staticEnd)) { this.hardHalt(); return; }
		this.executionImagesByDomain.fill(null);
		this.stringPool.clearRomTables();
		this.systemImage = this.activateExecutionImage(systemBoot);
		this.executionImagesByDomain[SYSTEM_EXECUTION_DOMAIN_ID + 1] = this.systemImage;
		this.systemExceptionFunctionAddress = systemBoot.exceptionFunctionAddress;
		this.latchActiveExecutionImage(SYSTEM_EXECUTION_DOMAIN_ID, this.systemImage);
		if (!this.readFunctionRecordOnBus(this.systemImage, systemResetFunctionAddress, this.executionBusSignals)) {
			this.hardHalt();
			return;
		}
		this.pushFrame(
			this.staticClosureFromLatch(),
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
				valueBuiltinFunction(primitive.id),
			);
		}
	}

	public clearExecutionEnvironment(): void {
		this.clearCompletionValues();
		this.clearCallStack();
		this.clearGlobalSlots();
	}


	private decodeConstantPool(
		executionDomainId: ExecutionDomainId,
		tableAddress: number,
		constTags: Uint8Array,
		constWords: Uint32Array,
		restoring: boolean,
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
				case Blua32ConstantTag.Integer:
					constTags[index] = ValueTag.Integer;
					constWords[index] = readLE32(bytes, recordByteOffset + BLUA32_CONSTANT_PAYLOAD_OFFSET); break;
				case Blua32ConstantTag.Float:
					constTags[index] = ValueTag.Float;
					constWords[index] = readLE32(bytes, recordByteOffset + BLUA32_CONSTANT_PAYLOAD_OFFSET); break;
				case Blua32ConstantTag.String:
					constTags[index] = ValueTag.String;
					constWords[index] = this.stringPool.resolveImageRecord(
						executionDomainId,
						readLE32(bytes, recordByteOffset + BLUA32_CONSTANT_PAYLOAD_OFFSET),
						restoring,
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
		restoring: boolean,
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
			const key = this.stringPool.resolveImageRecord(
				executionDomainId,
				readLE32(bytes, recordByteOffset + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET),
				restoring,
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

	private readExecutionImageHeader(executionBoot: Blua32ExecutionBoot) {
		this.executionAddressSpace.bindReadOnlyView(
			executionBoot.executionDomainId,
			executionBoot.imageAddress,
			BLUA32_IMAGE_HEADER_SIZE,
			this.executionReadView,
		);
		const { bytes, byteOffset } = this.executionReadView;
		if (readLE32(bytes, byteOffset + BLUA32_IMAGE_MAGIC_OFFSET) !== BLUA32_IMAGE_MAGIC
			|| readLE32(bytes, byteOffset + BLUA32_IMAGE_VERSION_OFFSET) !== BLUA32_IMAGE_VERSION) {
			throw new Error('BLua32 image format is unsupported.');
		}
		return {
			constantTableAddress: readLE32(bytes, byteOffset + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET),
			constantCount: readLE32(bytes, byteOffset + BLUA32_IMAGE_CONSTANT_COUNT_OFFSET),
			globalNameTableAddress: readLE32(bytes, byteOffset + BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET),
			globalNameCount: readLE32(bytes, byteOffset + BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET),
			systemGlobalNameTableAddress: readLE32(bytes, byteOffset + BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET),
			systemGlobalNameCount: readLE32(bytes, byteOffset + BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET),
			stringBucketAddress: readLE32(bytes, byteOffset + BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET),
			stringBucketCount: readLE32(bytes, byteOffset + BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET),
		};
	}

	private activateExecutionImage(executionBoot: Blua32ExecutionBoot): Blua32ExecutionImage {
		const header = this.readExecutionImageHeader(executionBoot);
		this.stringPool.activateRomTable(executionBoot.executionDomainId, header.stringBucketAddress, header.stringBucketCount);
		return this.materializeExecutionImage(executionBoot, header);
	}

	private materializeExecutionImage(
		executionBoot: Blua32ExecutionBoot,
		header: ReturnType<CPU['readExecutionImageHeader']>,
		restoring = false,
	): Blua32ExecutionImage {
		const executionDomainId = executionBoot.executionDomainId;
		const { constantTableAddress, constantCount, globalNameTableAddress, globalNameCount,
			systemGlobalNameTableAddress, systemGlobalNameCount } = header;
		const constStorage = new ValueStorage(constantCount);
		const constTags = constStorage.tags;
		const constWords = constStorage.words;
		this.decodeConstantPool(
			executionDomainId,
			constantTableAddress,
			constTags,
			constWords,
			restoring,
		);
		const globalSlots = this.registerGlobalNames(
			executionDomainId,
			globalNameTableAddress,
			globalNameCount,
			false, restoring,
		);
		const systemGlobalSlots = this.registerGlobalNames(
			executionDomainId,
			systemGlobalNameTableAddress,
			systemGlobalNameCount,
			true, restoring,
		);
		const image: Blua32ExecutionImage = {
			executionDomainId,
			irqFunctionAddress: executionBoot.irqFunctionAddress,
			staticEnd: executionBoot.staticEnd,
			constTags,
			constWords,
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

	private latchActiveExecutionImage(domain: ExecutionDomainId, image: Blua32ExecutionImage | null): void {
		this.activeExecutionDomainId = domain;
		this.activeExecutionImage = image!;
		this.executionBusSignals = CPU.executionBusSignalsForDomain(domain);
	}

	private resumeFrameBank(): void {
		const frame = this.activeThread.currentFrame;
		if (frame === null) return;
		const domain = frame.savedExecutionBank;
		if (domain === this.activeExecutionDomainId && frame.executionImage === this.activeExecutionImage) return;
		const image = this.executionImageForDomain(domain);
		if (image !== frame.executionImage) {
			frame.executionImage = image!;
			frame.decodedPage = null;
			frame.decodedPageAddress = 0;
			frame.compilationEntry = true;
		}
		this.latchActiveExecutionImage(domain, image);
	}

	private staticClosureFromLatch(): Closure {
		const record = this.functionRecordLatch;
		let closures = this.staticClosuresByAddress.get(record.functionAddress);
		if (closures !== undefined) {
			let match: Closure | null = null;
			for (const closure of closures) {
				if (sameFunctionPrototype(closure.prototypeRecord, record)
					&& (match === null || closure.hashId < match.hashId)) match = closure;
			}
			if (match !== null) return match;
		}
		const closure = new Closure(this.memory, this.luaHeap.allocateClosureRecord(0), record, 0, true);
		closure.initializeRecord();
		closure.hashId = this.allocateObjectHashId();
		this.gc.track(closure);
		closures = this.staticClosuresByAddress.get(record.functionAddress);
		if (closures === undefined) {
			closures = [];
			this.staticClosuresByAddress.set(record.functionAddress, closures);
		}
		closures.push(closure);
		return closure;
	}

	public reindexCanonicalClosures(): void {
		const closures = Array.from(this.staticClosuresByAddress.values()).flat();
		this.staticClosuresByAddress.clear();
		for (const closure of closures) {
			let versions = this.staticClosuresByAddress.get(closure.prototypeRecord.functionAddress);
			if (versions === undefined) {
				versions = [];
				this.staticClosuresByAddress.set(closure.prototypeRecord.functionAddress, versions);
			}
			versions.push(closure);
		}
	}

	public replaceExecutionImages(...executionBoots: Blua32ExecutionBoot[]): void {
		const headers = executionBoots.map(boot => this.readExecutionImageHeader(boot));
		// All media is already mounted. Rebind every index before looking up
		// any constants: a lookup can touch the table of another changed image.
		for (let i = 0; i < executionBoots.length; ++i) {
			const { executionDomainId, staticEnd } = executionBoots[i];
			if (executionDomainId === this.programExecutionDomainId && !this.heapAllocator.setFloor(staticEnd)) {
				throw new Error('Replacement program static storage overlaps live language-heap pages.');
			}
			const { stringBucketAddress, stringBucketCount } = headers[i];
			this.stringPool.activateRomTable(executionDomainId, stringBucketAddress, stringBucketCount);
		}
		for (let i = 0; i < executionBoots.length; ++i) {
			const boot = executionBoots[i], domain = boot.executionDomainId, imageIndex = domain + 1;
			const previous = this.executionImagesByDomain[imageIndex];
			if (previous !== null) {
				for (const page of previous.decodedPages.values()) {
					this.compiledCodeCache.retirePage(page);
				}
			}
			const image = this.materializeExecutionImage(boot, headers[i]);
			this.executionImagesByDomain[imageIndex] = image;
			if (domain === SYSTEM_EXECUTION_DOMAIN_ID) {
				this.systemImage = image;
				this.systemExceptionFunctionAddress = boot.exceptionFunctionAddress;
			}
			if (previous !== null) {
				this.gc.visitThreads(thread => {
					for (let frame = thread.firstFrame; frame !== null; frame = frame.next) {
						if (frame.executionImage !== previous) continue;
						frame.executionImage = image;
						frame.decodedPage = null;
						frame.decodedPageAddress = 0;
						frame.compilationEntry = true;
					}
				});
			}
			if (this.activeExecutionDomainId === domain) {
				this.latchActiveExecutionImage(domain, image);
				const frame = this.activeThread.currentFrame;
				if (frame !== null && frame.executionImage === null) frame.executionImage = image;
			}
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

	public bindPhysicalFrames(thread: Thread): void {
		thread.bindFrameViews();
		for (let frame = thread.currentFrame; frame !== null; frame = frame.previous)
			frame.executionImage = this.executionImagesByDomain[frame.savedExecutionBank + 1]!;
	}

	public invalidateMappedViews(key: number, firstWord: number, endWord: number): void {
		this.gc.observeStackWrites(key + firstWord * 4, key + endWord * 4);
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
		frame.compilationEntry = true;
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
		const sourceWord = this.memory.readMappedBusU32LE(pc, this.executionBusSignals | MAPPED_BUS_INSTRUCTION_FETCH);
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
			bodyWord = this.memory.readMappedBusU32LE(
				(pc + INSTRUCTION_BYTES) >>> 0,
				this.executionBusSignals | MAPPED_BUS_INSTRUCTION_FETCH,
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
			&& compiledBlockSupports(page.ops[pageOffset], page.c[pageOffset])) {
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
		latch.functionAddress = address;
		latch.executionDomainId = image.executionDomainId;
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
			latch.recordUpvalueCount = readLE32(
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
		latch.recordUpvalueCount = this.memory.readMappedBusU32LE(
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
		return this.activeExecutionDomainId >= 0;
	}

	public activeCartridgeSlot(): ExecutionDomainId {
		return this.activeExecutionDomainId;
	}

	public readExecutionBusSignals(): MappedBusSignals {
		return this.executionBusSignals;
	}

	private executeFunctionAddress(functionAddress: number): void {
		// The target image's static storage must be free of live heap pages before
		// its activation or startup can write there.
		const targetDomainId = this.executionAddressSpace.domainIdOnBus(functionAddress, MAPPED_BUS_MASTER_CPU);
		const targetBoot = targetDomainId === null ? null : this.executionAddressSpace.resolveDomain(targetDomainId);
		const staticEnd = targetDomainId === null ? this.activeExecutionImage.staticEnd : targetBoot?.staticEnd;
		if (staticEnd !== undefined && !this.setProgramHeapFloor(staticEnd)) {
			this.hardHalt();
			return;
		}
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
		this.latchActiveExecutionImage(image.executionDomainId, image);
		this.programExecutionDomainId = image.executionDomainId;
		const cartridgeEntry = image.executionDomainId >= 0;
		this.cop0Words[COP0_STATUS] = cartridgeEntry ? CPU_STATUS_CART_ENTRY : CPU_STATUS_SYSTEM_ENTRY;
		this.haltedUntilIrqFrameDepth = -1;
		this.haltedUntilIrqThread = null;
		this.interruptEventPending = false;
		this.memoryWriteBlocked = false;
		this.memoryWriteBlockedAddress = 0;
		this.pendingMemory.kind = PendingMemoryKind.None;
		this.hardHalted = false;
		this.yieldRequested = false;
		const closure = this.staticClosureFromLatch();
		this.pushFrame(closure, EMPTY_CALL_ARGS, 0, 0, false);
	}

	private setProgramHeapFloor(staticEnd: number): boolean {
		if (this.heapAllocator.setFloor(staticEnd)) {
			return true;
		}
		this.luaHeap.collectRuntime();
		return this.heapAllocator.setFloor(staticEnd);
	}

	public beginCompletionCall(closure: Closure, args: ReadonlyArray<Value> = EMPTY_CALL_ARGS): void {
		// Call injection takes over the physical instruction stream. The suspended
		// frame retains its PC; an unaccepted endpoint access must not follow it.
		this.abortStalledMemoryWrite();
		const roots = this.acquireLocalRoots();
		this.localRoots.push(valueClosure(this.gc.reference(closure)));
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
		if (!this.readFunctionRecord(this.executionImageForDomain(executionDomainId)!, functionAddress, CPU.executionBusSignalsForDomain(executionDomainId))) {
			this.hardHalt();
			return;
		}
		this.beginCompletionCall(this.staticClosureFromLatch());
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
		this.haltedUntilIrqFrameDepth = this.activeThread.frameDepth;
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
		return this.haltedUntilIrqThread === this.activeThread && this.haltedUntilIrqFrameDepth === this.activeThread.frameDepth;
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
		this.pendingMemory.kind = PendingMemoryKind.None;
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
		if (this.pendingMemory.kind !== PendingMemoryKind.None) return false;
		if (this.nonMaskableInterruptPending) {
			this.nonMaskableInterruptPending = false;
			const hadHaltLatch = this.haltedUntilIrqFrameDepth >= 0;
			const returnCauseWord = this.cop0Words[COP0_CAUSE];
			const returnEpcWord = this.cop0Words[COP0_EPC];
			const returnBadAddressWord = this.cop0Words[COP0_BAD_ADDRESS];
			const returnLuaFaultReasonWord = this.cop0Words[COP0_LUA_FAULT_REASON];
			const returnExceptionDomainWord = this.exceptionDomainWord;
			this.enterException(
				this.systemImage,
				this.systemExceptionFunctionAddress,
				CPU_CAUSE_NMI,
				this.activeThread.currentFrame!.pc,
			);
			this.nmiReturnCauseWord = returnCauseWord;
			this.nmiReturnEpcWord = returnEpcWord;
			this.nmiReturnBadAddressWord = returnBadAddressWord;
			this.nmiReturnLuaFaultReasonWord = returnLuaFaultReasonWord;
			this.nmiReturnExceptionDomainWord = returnExceptionDomainWord;
			if (!hadHaltLatch) this.interruptEventPending = true;
			return true;
		}
		if (this.canAcceptMaskableInterruptLine()) {
			const image = this.isUserMode() ? this.executionImageForDomain(this.programExecutionDomainId)! : this.systemImage;
			const hadHaltLatch = this.haltedUntilIrqFrameDepth >= 0;
			this.enterException(
				image,
				image.irqFunctionAddress,
				CPU_CAUSE_IRQ,
				this.activeThread.currentFrame!.pc,
			);
			if (!hadHaltLatch) this.interruptEventPending = true;
			return true;
		}
		return false;
	}

	private enterSynchronousException(interruptedFrame: CallFrame, causeWord: number): CallFrame | null {
		interruptedFrame.pc = this.currentInstructionPc;
		return this.enterException(this.systemImage, this.systemExceptionFunctionAddress, causeWord, this.currentInstructionPc);
	}

	private enterSynchronousAddressException(interruptedFrame: CallFrame, causeWord: number, address: number): void {
		this.cop0Words[COP0_BAD_ADDRESS] = address >>> 0;
		this.enterSynchronousException(interruptedFrame, causeWord);
	}

	private enterInstructionFetchException(interruptedFrame: CallFrame, causeWord: number, pc: number): void {
		this.instructionBudgetRemaining -= 1;
		interruptedFrame.pc = pc;
		this.enterException(this.systemImage, this.systemExceptionFunctionAddress, causeWord, pc);
	}

	private enterLuaFaultException(reason: number, error: Value): void {
		this.cop0Words[COP0_LUA_FAULT_REASON] = reason;
		const frame = this.enterSynchronousException(this.activeThread.currentFrame!, CPU_CAUSE_CODE_TRAP);
		if (frame !== null) frame.registers.set(0, error);
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
		const caller = frame.previous;
		this.charge(this.closeUpvalues(frame));
		frame.thread.leaveFrame();
		this.resumeFrameBank();
		this.cop0Words[COP0_STATUS] = ((this.cop0Words[COP0_STATUS] & ~CPU_STATUS_RFE_RESTORE_MASK)
			| ((this.cop0Words[COP0_STATUS] >> 2) & CPU_STATUS_RFE_RESTORE_MASK)) >>> 0;
		if (caller) {
			caller.pc = returnPc;
			caller.compilationEntry = true;
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
		vectorImage: Blua32ExecutionImage,
		functionAddress: number,
		causeWord: number,
		epcWord: number,
	): CallFrame | null {
		this.exceptionDomainWord = this.activeExecutionDomainId >>> 0;
		this.cop0Words[COP0_EPC] = epcWord >>> 0;
		this.cop0Words[COP0_CAUSE] = causeWord >>> 0;
		this.cop0Words[COP0_STATUS] = ((this.cop0Words[COP0_STATUS] & ~CPU_STATUS_MODE_STACK_MASK)
			| ((this.cop0Words[COP0_STATUS] << 2) & CPU_STATUS_MODE_STACK_MASK)) >>> 0;
		this.clearHaltAfterAcceptedInterrupt();
		if (!this.readFunctionRecordOnBus(vectorImage, functionAddress, CPU.executionBusSignalsForDomain(vectorImage.executionDomainId))) {
			this.hardHalt();
			return null;
		}
		try {
			const closure = this.staticClosureFromLatch();
			const frame = this.pushFrame(closure, EMPTY_CALL_ARGS, 0, 0, false, true);
			frame.callSitePc = epcWord;
			frame.enterException(causeWord === CPU_CAUSE_NMI);
			return frame;
		} catch (error) {
			if (error !== LUA_OUT_OF_MEMORY_SIGNAL) throw error;
			this.hardHalt();
			return null;
		}
	}

	private clearHaltAfterAcceptedInterrupt(): void {
		this.haltedUntilIrqFrameDepth = -1;
		this.haltedUntilIrqThread = null;
		this.yieldRequested = false;
	}

	public getFrameDepth(): number {
		return this.activeThread.frameDepth;
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
		const thread = this.activeThread;
		while (thread.frameDepth > targetDepth) {
			try {
				if (this.instructionBudgetRemaining > 0 && !this.memoryWriteBlocked && !this.hardHalted
					&& !this.yieldRequested && !this.isHaltedUntilIrq()) this.resumePendingMemoryOperation();
				while (thread.frameDepth > targetDepth) {
					if (this.hardHalted
						|| (this.haltedUntilIrqThread === this.activeThread && this.haltedUntilIrqFrameDepth === thread.frameDepth)
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
					const frame = thread.currentFrame!;
					const image = frame.executionImage;
					if (image !== null && this.activeExecutionImage !== image) this.latchActiveExecutionImage(image.executionDomainId, image);
					if (this.nonMaskableInterruptPending
						|| ((this.cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) !== 0
							&& this.irqController.hasAssertedMaskableInterruptLine())
					) {
						this.enterPendingInterrupt();
						continue;
					}
					const pc = frame.pc;
					if ((pc & (INSTRUCTION_BYTES - 1)) !== 0) {
						this.cop0Words[COP0_BAD_ADDRESS] = pc;
						this.enterInstructionFetchException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, pc);
						continue;
					}
					if (image === null) {
						this.cop0Words[COP0_BAD_ADDRESS] = pc;
						this.enterInstructionFetchException(frame, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, pc);
						continue;
					}
					const page = this.decodedPageForFrame(frame, pc);
					const pageOffset = (pc & MAPPED_PAGE_BYTE_MASK) >>> 2;
					const refreshState = page.refreshState[pageOffset];
					const rewritten = (refreshState & DECODED_REFRESH_DECODE) !== 0
						&& page.widths[pageOffset] !== 0;
					if (refreshState !== 0
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
						rewritten,
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
		const thread = this.activeThread;
		const baseCycles = DECODED_DISPATCH_BASE_CYCLES;
		const executionHook = this.executionHook!;
		const executionDomainMask = this.executionHookDomainMask;
		const preMaskableInterruptExecutionDomainMask =
			this.preMaskableInterruptExecutionHookDomainMask;
		while (thread.frameDepth > targetDepth) {
			try {
				if (this.instructionBudgetRemaining > 0 && !this.memoryWriteBlocked && !this.hardHalted
					&& !this.yieldRequested && !this.isHaltedUntilIrq()) this.resumePendingMemoryOperation();
				while (thread.frameDepth > targetDepth) {
					if (this.hardHalted
						|| (this.haltedUntilIrqThread === this.activeThread && this.haltedUntilIrqFrameDepth === thread.frameDepth)
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
					const frame = thread.currentFrame!;
					const image = frame.executionImage;
					if (image !== null && this.activeExecutionImage !== image) this.latchActiveExecutionImage(image.executionDomainId, image);
					if (this.nonMaskableInterruptPending) {
						this.enterPendingInterrupt();
						continue;
					}
					if ((this.cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) !== 0
						&& this.irqController.hasAssertedMaskableInterruptLine()) {
						const interruptedFrame = thread.currentFrame!;
						if ((preMaskableInterruptExecutionDomainMask
							& executionDomainBit(this.activeExecutionDomainId)) !== 0
							&& executionHook(this.activeExecutionDomainId, interruptedFrame.pc)) {
							return RunResult.ExecutionStopped;
						}
						this.enterPendingInterrupt();
						continue;
					}
					const pc = frame.pc;
					if ((executionDomainMask & executionDomainBit(this.activeExecutionDomainId)) !== 0
						&& executionHook(this.activeExecutionDomainId, pc)) {
						return RunResult.ExecutionStopped;
					}
					if ((pc & (INSTRUCTION_BYTES - 1)) !== 0) {
						this.cop0Words[COP0_BAD_ADDRESS] = pc;
						this.enterInstructionFetchException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, pc);
						continue;
					}
					if (image === null) {
						this.cop0Words[COP0_BAD_ADDRESS] = pc;
						this.enterInstructionFetchException(frame, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, pc);
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
			const value = valueString(this.luaFaultErrorStringIds[LUA_FAULT_REASON_OUT_OF_MEMORY]);
			if (!this.handleThreadError(value)) this.enterLuaFaultException(LUA_FAULT_REASON_OUT_OF_MEMORY, value);
		} else if (error instanceof LuaThrownValueError) {
			if (!this.handleThreadError(error.value)) this.enterLuaFaultException(LUA_FAULT_REASON_EXPLICIT_ERROR, error.value);
		} else if (error instanceof LuaExecutionError) {
			const value = valueString(this.luaFaultErrorStringIds[error.reason]);
			if (!this.handleThreadError(value)) this.enterLuaFaultException(error.reason, value);
		} else throw error;
	}

	private unwindToDepth(targetDepth: number, chargeCaptures: boolean): void {
		const unwinding = this.activeThread.frameDepth > targetDepth;
		if (unwinding) this.abortStalledMemoryWrite();
		while (this.activeThread.frameDepth > targetDepth) {
			const frame = this.activeThread.currentFrame!;
			const closed = this.closeUpvalues(frame);
			if (chargeCaptures) this.charge(closed);
			frame.thread.leaveFrame();
		}
		if (unwinding) this.resumeFrameBank();
		let depth = this.activeThread.protectedDepth;
		while (depth > 0 && this.activeThread.protectedWord(depth - 1, ProtectedField.Caller) >= this.activeThread.frameDepth) --depth;
		this.activeThread.protectedDepth = depth;
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
		return this.activeThread.frameAtDepth(frameIndex).savedExecutionBank;
	}

	public readLastExecutionDomain(): ExecutionDomainId {
		return this.lastExecutionDomainId;
	}

	/** Instruction start (including WIDE), inspected only during CPU execution. */
	public readCurrentInstructionPc(): number {
		return this.currentInstructionPc;
	}

	public readFrameFunctionAddress(frameIndex: number): number {
		return this.activeThread.frameAtDepth(frameIndex).functionAddress;
	}

	public readFramePc(frameIndex: number): number {
		return this.activeThread.frameAtDepth(frameIndex).pc;
	}

	public readFrameCallSitePc(childFrameIndex: number): number {
		return this.activeThread.frameAtDepth(childFrameIndex).callSitePc;
	}

	public completionCallPending(): boolean {
		for (let frame = this.completionThread.currentFrame; frame !== null; frame = frame.previous) {
			if (frame.returnToCompletionLatch) {
				return true;
			}
		}
		return false;
	}

	public readFrameReturnsToCompletionLatch(frameIndex: number): boolean {
		return this.activeThread.frameAtDepth(frameIndex).returnToCompletionLatch;
	}

	public abortCompletionCall(frameIndex: number): void {
		this.unwindToDepth(frameIndex, false);
		this.clearCompletionValues();
	}

	public readCompletionValues(target: Value[]): void {
		this.completionValueSlots.copyTo(target, this.completionValueCount);
	}

	public isExceptionFrame(frameIndex: number): boolean {
		return this.activeThread.frameAtDepth(frameIndex).isExceptionFrame;
	}

	/** Frame depth reached after all currently active exception roots return. */
	public readExceptionReturnFrameDepth(): number {
		let frame = this.activeThread.firstFrame;
		for (let frameIndex = 0; frameIndex < this.activeThread.frameDepth; frameIndex += 1, frame = frame!.next) {
			if (frame!.isExceptionFrame) return frameIndex;
		}
		return -1;
	}

	public isNonMaskableExceptionFrame(frameIndex: number): boolean {
		return this.activeThread.frameAtDepth(frameIndex).isNonMaskableExceptionFrame;
	}

	public getFrameRegisterCount(frameIndex: number): number {
		return this.activeThread.frameAtDepth(frameIndex).top;
	}

	public readFrameRegister(frameIndex: number, registerIndex: number): Value {
		return this.activeThread.frameAtDepth(frameIndex).registers.get(registerIndex);
	}

	public getFrameUpvalueCount(frameIndex: number): number {
		return this.activeThread.frameAtDepth(frameIndex).captureCount;
	}

	public readFrameUpvalue(frameIndex: number, upvalueIndex: number): Value {
		return Upvalue.load(this.memory, this.activeThread.frameAtDepth(frameIndex).captureAddress(upvalueIndex));
	}

	/** Read a retained closure without calling it or requiring an active frame. */
	public readClosureUpvalue(closure: Closure, index: number): Value {
		return Upvalue.load(this.memory, closure.captureAddress(index));
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
		const frame = this.activeThread.frameAtDepth(frameIndex);
		if (frame === this.activeThread.currentFrame) this.abortStalledMemoryWrite();
		this.readFunctionRecord(image, functionAddress, CPU.executionBusSignalsForDomain(executionDomainId));
		const registerCount = Math.max(this.functionRecordLatch.maxStack, this.functionRecordLatch.numParams);
		if (registerCount > frame.stackCapacity) {
			this.ensureRegisterCapacity(frame, registerCount - 1);
		}
		frame.functionAddress = functionAddress;
		frame.executionImage = image;
		frame.savedExecutionBank = executionDomainId;
		if (frame === this.activeThread.currentFrame) this.latchActiveExecutionImage(executionDomainId, image);
		frame.decodedPage = null;
		frame.decodedPageAddress = 0;
		frame.compilationEntry = true;
		frame.pc = pc;
	}

	public writeFrameCallSitePc(childFrameIndex: number, pc: number): void {
		this.activeThread.frameAtDepth(childFrameIndex).callSitePc = pc;
	}

	public setGlobalByKey(
		key: StringId, value: Value,
	): void {
		let slot = this.globalSlotByKey.get(key);
		if (slot === undefined) {
			slot = this.globalNames.length;
			this.globalSlots.reserveCapacity(slot + 1);
			this.globalSlotByKey.set(key, slot);
			this.globalNames.push(key);
		}
		this.globalSlots.set(slot, value);
	}

	public setSystemGlobalByKey(
		key: StringId, value: Value,
	): void {
		const slot = this.systemGlobalSlotByKey.get(key);
		if (slot === undefined) {
			throw new Error(`System global '${this.stringPool.toString(key)}' has no register slot.`);
		}
		this.systemGlobalSlots.set(slot, value);
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
		return globalSlot === undefined ? valueNil() : this.globalSlots.get(globalSlot);
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
		const left = this.readRKValue(frame, rkB), right = this.readRKValue(frame, rkC);
		const isAddShl = op === DecodedDispatchOp.FusedAddShl;
		const firstResult = isAddShl ? valueAdd(left, right) : valueInteger(op === DecodedDispatchOp.FusedShlBxor
			? luaShiftLeft(integerOperand(left), integerOperand(right)) : luaShiftRight(integerOperand(left), integerOperand(right)));
		this.setRegisterValueFast(frame, registers, a, firstResult);
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
		const secondLeft = integerOperand(this.readRKValue(frame, secondRkB));
		const secondRight = integerOperand(this.readRKValue(frame, secondRkC));
		const secondResult = isAddShl ? luaShiftLeft(secondLeft, secondRight) : secondLeft ^ secondRight;
		this.setRegisterIntegerFast(frame, registers, secondPage.a[secondPageOffset], secondResult);
	}

	private executeConcat(frame: CallFrame, a: number, rkB: number, rkC: number): void {
		const left = this.readRKValue(frame, rkB), right = this.readRKValue(frame, rkC);
		const l = valueToByteString(left, this.stringPool), r = valueToByteString(right, this.stringPool);
		this.charge(l.length + r.length);
		this.setRegisterStringFast(frame, frame.registers, a, this.stringPool.intern(l + r));
	}
	private executeConcatRange(frame: CallFrame, a: number, b: number, c: number): void {
		let text = '', byteWork = 0;
		for (let i = 0; i < c; ++i) {
			const part = valueToByteString(frame.registers.get(b + i), this.stringPool);
			text += part; byteWork += part.length;
		}
		this.charge(c + byteWork);
		this.setRegisterStringFast(frame, frame.registers, a, this.stringPool.intern(text));
	}

	private executeClosure(frame: CallFrame, a: number, bx: number, c: number): void {
		const registers = frame.registers;
		const functionAddress = (c & CLOSURE_ADDRESS_REGISTER_FLAG) !== 0
			? wordOperand(registers.get(bx))
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
		const argCount = decodeValueCount(b, Math.max(frame.top - a - 1, 0));
		switch (registers.getTag(a)) {
			case ValueTag.BuiltinFunction:
				this.runBuiltinFunction(registers.getBuiltinFunctionId(a), frame, a, c, argCount);
				return false;
			case ValueTag.Closure: {
				const closure = this.gc.closureAt(registers.getPayload(a));
				if (closure === null) throw new LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
				const pushed = this.pushFrameFromCaller(
					frame,
					closure,
					a + 1,
					argCount,
					a,
					c,
					false,
					frame.pc - INSTRUCTION_BYTES,
				);
				return pushed !== null;
			}
			default:
				throw new LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
		}
	}

	private executeReturn(frame: CallFrame, a: number, b: number): boolean {
		const registers = frame.registers;
		const total = decodeValueCount(b, Math.max(frame.top - a, 0));
		this.charge(this.closeUpvalues(frame));
		const frameIndex = this.activeThread.frameDepth - 1;
		if (frame.protectedContinuationIndex >= 0) {
			this.finishProtectedCallFromRegisters(frame.protectedContinuationIndex, registers, a, total);
			frame.thread.leaveFrame();
			this.resumeFrameBank();
			return false;
		}
		if (frame.returnToCompletionLatch) {
			this.latchCompletionValues(registers, a, total);
			this.charge(total);
			frame.thread.leaveFrame();
			this.resumeFrameBank();
			return false;
		}
		if (frameIndex === 0 && this.activeThread.resumer !== null) {
			const finished = this.activeThread;
			finished.status = ThreadStatus.Dead;
			this.returnToResumer(registers, a, total);
			finished.stackTop = 0;
			frame.thread.leaveFrame();
			return false;
		}
		if (frameIndex === 0) {
			this.latchCompletionValues(registers, a, total);
			this.charge(total);
			frame.thread.leaveFrame();
			this.resumeFrameBank();
			return true;
		}
		const caller = frame.previous!;
		this.writeReturnValuesFromRegisters(caller, frame.returnBase, frame.returnCount, registers, a, total);
		frame.thread.leaveFrame();
		this.resumeFrameBank();
		return true;
	}

	private executeVararg(frame: CallFrame, a: number, b: number): void {
		const count = decodeValueCount(b, frame.varargCount);
		if (count !== 0) {
			this.ensureRegisterCapacity(frame, a + count - 1);
			const copied = Math.min(count, frame.varargCount);
			frame.registers.copyRangeFrom(frame.thread.stackRegisters, a, frame.varargBase, copied);
			frame.registers.clear(count - copied, a + copied);
		}
		this.charge(count);
		if (b === 0) frame.top = a + count;
		else if (count !== 0) frame.top = Math.max(frame.top, a + count);
	}

	private executeMemoryLoad(frame: CallFrame, destination: number, kind: MemoryAccessKind, address: number): void {
		if ((address & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[kind]) !== 0) {
			this.enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, address);
			return;
		}
		const faultSequence = this.memory.readBusFaultSequence();
		let value: Value;
		switch (kind) {
			case MemoryAccessKind.Word: value = valueInteger(this.memory.readMappedWord(address) | 0); break;
			case MemoryAccessKind.U8: value = valueInteger(this.memory.readMappedU8(address)); break;
			case MemoryAccessKind.U16LE: value = valueInteger(this.memory.readMappedU16LE(address)); break;
			case MemoryAccessKind.U32LE: value = valueInteger(this.memory.readMappedU32LE(address) | 0); break;
			case MemoryAccessKind.F32LE: value = valueFloatBits(this.memory.readMappedU32LE(address)); break;
			case MemoryAccessKind.F64LE: value = valueFloat(this.memory.readMappedF64LE(address)); break;
		}
		if (this.memory.readBusFaultSequence() !== faultSequence) {
			this.enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
			return;
		}
		this.setRegisterValueFast(frame, frame.registers, destination, value);
	}

	private executeMemoryStore(frame: CallFrame, source: number, kind: MemoryAccessKind, address: number): void {
		if ((address & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[kind]) !== 0) {
			this.enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, address);
			return;
		}
		this.continueMemoryStore(frame, source, kind, address);
	}

	private continueMemoryStore(frame: CallFrame, source: number, kind: MemoryAccessKind, address: number): void {
		if (!this.memory.mappedWriteReady(address)) {
			const operation = this.pendingMemory;
			operation.kind = PendingMemoryKind.Store;
			operation.instructionPc = this.currentInstructionPc;
			operation.nextPc = frame.pc;
			operation.address = address;
			operation.accessKind = kind;
			operation.registerIndex = source;
			operation.wordCount = 0;
			this.blockMappedWrite(frame, address);
			return;
		}
		const value = frame.registers.get(source);
		const faultSequence = this.memory.readBusFaultSequence();
		switch (kind) {
			case MemoryAccessKind.Word: this.memory.writeMappedWord(address, wordOperand(value)); break;
			case MemoryAccessKind.U8: this.memory.writeMappedU8(address, wordOperand(value)); break;
			case MemoryAccessKind.U16LE: this.memory.writeMappedU16LE(address, wordOperand(value)); break;
			case MemoryAccessKind.U32LE: this.memory.writeMappedU32LE(address, wordOperand(value)); break;
			case MemoryAccessKind.F32LE:
				if (!valueIsNumber(value)) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				this.memory.writeMappedU32LE(address, valueIsFloat(value) ? valuePayload(value) : numberToF32Bits(asInteger(value))); break;
			case MemoryAccessKind.F64LE:
				if (!valueIsNumber(value)) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				this.memory.writeMappedF64LE(address, valueIsInteger(value) ? asInteger(value) : asFloat(value)); break;
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
		this.continueWordStores(frame, addr, valueBase, valueCount);
	}

	private continueWordStores(frame: CallFrame, addr: number, valueBase: number, valueCount: number): void {
		const blockedAddress = this.memory.firstBlockedMappedWordWrite(addr, valueCount);
		if (blockedAddress !== NO_BLOCKED_MAPPED_WRITE) {
			const operation = this.pendingMemory;
			operation.kind = PendingMemoryKind.WordStores;
			operation.instructionPc = this.currentInstructionPc;
			operation.nextPc = frame.pc;
			operation.address = addr;
			operation.accessKind = MemoryAccessKind.Word;
			operation.registerIndex = valueBase;
			operation.wordCount = valueCount;
			this.blockMappedWrite(frame, blockedAddress);
			return;
		}
		this.charge(valueCount);
		const faultSequence = this.memory.readBusFaultSequence();
		let writeAddr = addr;
		for (let offset = 0; offset < valueCount; offset += 1) {
			this.memory.writeMappedWord(writeAddr, wordOperand(frame.registers.get(valueBase + offset)));
			if (this.memory.readBusFaultSequence() !== faultSequence) {
				this.enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
				return;
			}
			writeAddr = (writeAddr + 4) >>> 0;
		}
	}

	private resumePendingMemoryOperation(): void {
		const operation = this.pendingMemory;
		if (operation.kind === PendingMemoryKind.None) return;
		const kind = operation.kind, accessKind = operation.accessKind;
		const address = operation.address, registerIndex = operation.registerIndex, wordCount = operation.wordCount;
		const frame = this.activeThread.currentFrame!;
		this.currentInstructionPc = operation.instructionPc;
		frame.pc = operation.nextPc;
		operation.kind = PendingMemoryKind.None;
		if (kind === PendingMemoryKind.Store) this.continueMemoryStore(frame, registerIndex, accessKind, address);
		else this.continueWordStores(frame, address, registerIndex, wordCount);
	}

	private prepareCompiledRegion(frame: CallFrame, page: DecodedInstructionPage, word: number): void {
		const pc = this.currentInstructionPc;
		const pagePc = (pc & ~MAPPED_PAGE_BYTE_MASK) >>> 0;
		const binding = this.mappedPageBinding;
		this.memory.bindMappedPage(pagePc, this.executionBusSignals, binding);
		const roots = new Uint8Array(DECODED_PAGE_WORDS), queued = new Uint8Array(DECODED_PAGE_WORDS);
		const available = new Uint8Array(DECODED_PAGE_WORDS), leaders = new Uint8Array(DECODED_PAGE_WORDS);
		const pending: number[] = [];
		const owners = new Array<CompiledRegion | null>(DECODED_PAGE_WORDS).fill(null);
		const merged = new Set<CompiledRegion>();
		const enqueue = (pc: number, leader: boolean): void => {
			const offset = (pc - pagePc) >>> 0;
			if (offset >= MAPPED_PAGE_BYTE_MASK + 1) return;
			const next = offset / INSTRUCTION_BYTES;
			// A WIDE prefix and an independent entry into its body may share
			// the same sequential successor. Emit that successor only once.
			if (leader || queued[next] !== 0) leaders[next] = 1;
			if (queued[next] === 0) { queued[next] = 1; pending.push(next); }
		};
		roots[word] = 1; enqueue(pc, true);
		const cache = page.compiledBlocks!;
		for (let entry = 0; entry < DECODED_PAGE_WORDS; ++entry) {
			const block = cache.entries[entry];
			if (block !== null) owners.fill(block.region, entry, Math.min(entry + block.sourceWords, DECODED_PAGE_WORDS));
		}
		for (let next = 0; next < pending.length; ++next) {
			const cursor = pending[next], pc = (pagePc + cursor * INSTRUCTION_BYTES) >>> 0;
			const owner = owners[cursor];
			if (owner !== null && !merged.has(owner)) {
				merged.add(owner); leaders[cursor] = 1;
				for (const block of owner.entries) {
					roots[block.firstWord] = 1;
					enqueue(pagePc + block.firstWord * INSTRUCTION_BYTES, true);
				}
			}
			if ((page.refreshState[cursor] & DECODED_REFRESH_DECODE) !== 0) {
				if (binding.readBytes === null || cursor === DECODED_PAGE_WORDS - 1) continue;
				if (!this.decodeInstruction(frame, page, cursor, pc, false)) return;
			}
			const op = page.ops[cursor];
			if ((page.refreshState[cursor] & DECODED_REFRESH_DECODE) !== 0
				|| page.dispatchOps[cursor] === DecodedDispatchOp.Observe || !compiledBlockSupports(op, page.c[cursor])) continue;
			if (roots[cursor] === 0 && binding.writeWatches !== null && cache.visits[cursor] + 1 < COMPILED_BLOCK_THRESHOLD) continue;
			available[cursor] = 1;
			const successor = cursor + page.widths[cursor], successorPc = (pagePc + successor * INSTRUCTION_BYTES) >>> 0;
			if (compiledBlockComparison(op)) {
				if (binding.readBytes !== null && successor < DECODED_PAGE_WORDS) {
					if ((page.refreshState[successor] & DECODED_REFRESH_DECODE) !== 0 && successor < DECODED_PAGE_WORDS - 1
						&& !this.decodeInstruction(frame, page, successor, successorPc, false)) return;
					if ((page.refreshState[successor] & DECODED_REFRESH_DECODE) === 0
						&& successor + page.widths[successor] <= DECODED_PAGE_WORDS) {
						enqueue((successorPc + page.widths[successor] * INSTRUCTION_BYTES) >>> 0, true);
						if (page.ops[successor] === OpCode.JMP && page.dispatchOps[successor] !== DecodedDispatchOp.Observe) {
							// This edge executes the fused JMP, not a separate entry.
							// An independent predecessor can still enqueue the JMP itself.
							enqueue(page.bx[successor], true);
							continue;
						}
					}
				}
				enqueue(successorPc, true);
			} else if (op === OpCode.JMP || op === OpCode.JMPIF || op === OpCode.JMPIFNOT) {
				enqueue(page.bx[cursor], true);
				if (op !== OpCode.JMP) enqueue(successorPc, true);
			} else if (!compiledBlockEndsBlock(op, page.b[cursor])) enqueue(successorPc, false);
			else if (compiledBlockHasContinuation(op, page.b[cursor])) enqueue(successorPc, true);
		}
		if (available[word] === 0) { page.dispatchOps[word] = page.ops[word]; return; }
		const plans: CompiledBlockSource[] = [];
		for (let entry = 0; entry < DECODED_PAGE_WORDS; ++entry) {
			if (leaders[entry] === 0 || available[entry] === 0) continue;
			let cursor = entry, count = 0;
			for (;;) {
				++count;
				const successor = cursor + page.widths[cursor];
				if (compiledBlockEndsBlock(page.ops[cursor], page.b[cursor]) || successor >= DECODED_PAGE_WORDS
					|| available[successor] === 0 || leaders[successor] !== 0) break;
				if (count === COMPILED_BLOCK_MAX_INSTRUCTIONS) { leaders[successor] = 1; break; }
				cursor = successor;
			}
			const endWord = cursor + page.widths[cursor];
			let skippedInstructionWidth = 0;
			if (binding.readBytes !== null && compiledBlockComparison(page.ops[cursor]) && endWord < DECODED_PAGE_WORDS
				&& (page.refreshState[endWord] & DECODED_REFRESH_DECODE) === 0
				&& endWord + page.widths[endWord] <= DECODED_PAGE_WORDS) skippedInstructionWidth = page.widths[endWord];
			let segmentFirst = entry;
			for (let word = entry; word < endWord; word += page.widths[word]) {
				const next = word + page.widths[word], final = next === endWord;
				if (!final && !compiledBlockHasContinuation(page.ops[word], page.b[word])) continue;
				plans.push({ firstWord: segmentFirst, endWord: next, pc: (pagePc + segmentFirst * INSTRUCTION_BYTES) >>> 0,
					skippedInstructionWidth: final ? skippedInstructionWidth : 0, fallthrough: !final });
				segmentFirst = next;
			}
		}
		for (const region of merged) this.compiledCodeCache.retireRegion(page, region);
		const region = compileJavaScriptRegion(page, plans, frame.executionImage, this.memory, this.stringPool,
			this.globalSlots, this.systemGlobalSlots, this.cop0Words, this.gc);
		this.compiledCodeCache.install(page, region);
		for (const block of region.entries) {
			page.dispatchCycles[block.firstWord] = BASE_CYCLES[page.ops[block.firstWord]];
			page.refreshState[block.firstWord] &= ~DECODED_REFRESH_FUSION;
		}
		const image = frame.executionImage;
		if (image.compiledCodeLookup === null) image.compiledCodeLookup = new CompiledCodeLookup();
		image.compiledCodeLookup.install(pagePc, this.memory.cartridgeController.selectedSlot(this.executionBusSignals), page);
	}

	private executeCompiledBlock(frame: CallFrame, page: DecodedInstructionPage, word: number, targetDepth: number, rewritten: boolean): void {
		const cache = page.compiledBlocks!;
		if (page.dispatchOps[word] === DecodedDispatchOp.CompiledWarm) {
			if (cache.visits[word] < COMPILED_BLOCK_THRESHOLD) ++cache.visits[word];
			if (frame.compilationEntry && cache.visits[word] === COMPILED_BLOCK_THRESHOLD) {
				if (this.compiledCodeCache.atCapacity()) {
					this.compiledCodeCache.retireAll();
					cache.visits[word] = COMPILED_BLOCK_THRESHOLD;
				}
				this.prepareCompiledRegion(frame, page, word);
			}
		}
		const thread = this.activeThread;
		let block = cache.entries[word];
		if (block === null || thread.stackRequiresScalar()) {
			frame.compilationEntry = rewritten || compiledBlockEndsBlock(page.ops[word], page.b[word]);
			this.executeInstruction(frame, page, word, page.ops[word], targetDepth);
			return;
		}
		// The first instruction was admitted with positive budget and charged by
		// dispatch. Execute its bounded segment and return the complete charge.
		let remaining = this.instructionBudgetRemaining + page.dispatchCycles[word];
		if (remaining <= block.admissionCycles + block.admissionVarargs * frame.varargCount) {
			frame.compilationEntry = rewritten || compiledBlockEndsBlock(page.ops[word], page.b[word]);
			this.executeInstruction(frame, page, word, page.ops[word], targetDepth);
			return;
		}
		for (;;) {
			const registers = frame.registers;
			const image = frame.executionImage;
			let current = block;
			let registerTop = frame.top;
			let exit: CompiledBlockExitSite;
			const run = this.compiledRunState;
			run.stackOffset = thread.stackOffset();
			run.stackBytes = thread.backingByteLength();
			for (;;) {
				run.remainingCycles = remaining; run.registerTop = registerTop;
				exit = current.region.exits[current.region.execute(registers, image.constWords, page, frame, current.entry, run)];
				remaining = run.remainingCycles; registerTop = run.registerTop;
				if (exit.exit !== CompiledBlockExit.Continue) break;
				const target = exit.linkedBlock;
				if (target === null) break;
				if (remaining <= target.admissionCycles + target.admissionVarargs * frame.varargCount) break;
				current = target;
				page = target.page;
			}
			this.instructionBudgetRemaining = remaining;
			frame.pc = exit.nextPc;
			frame.compilationEntry = true;
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
					this.executeFunctionAddress(wordOperand(registers.get(exit.exitA))); redispatch = true; break;
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
					this.copyRegisterToUpvalue(frame.captureAddress(exit.exitB), registers, exit.exitA); break;
				case CompiledBlockExit.InvalidOperand:
				case CompiledBlockExit.InvalidConstant: throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				case CompiledBlockExit.InvalidLength: throw new LuaExecutionError(LUA_FAULT_REASON_UNKNOWN);
				case CompiledBlockExit.AllocateTable: {
					const table = this.createTable(exit.exitB, exit.exitC);
					this.setRegisterTableFast(frame, registers, exit.exitA, table);
					this.charge(2 * this.gc.tables.storedSlotCount(table.address) - exit.exitB);
					break;
				}
				case CompiledBlockExit.ReadMemory:
				case CompiledBlockExit.WriteMemory:
				case CompiledBlockExit.WriteWords: {
					const address = this.compiledRunState.memoryAddress;
					if (exit.exit === CompiledBlockExit.ReadMemory) this.executeMemoryLoad(frame, exit.exitA, exit.exitC, address);
					else if (exit.exit === CompiledBlockExit.WriteWords) this.executeWordStores(frame, address, exit.exitA, exit.exitC);
					else this.executeMemoryStore(frame, exit.exitA, exit.exitC, address);
					redispatch = true; break;
				}
				case CompiledBlockExit.ReadField:
				case CompiledBlockExit.ReadInteger:
				case CompiledBlockExit.ReadIndex: {
					const base = registers.get(exit.exitB);
					if (exit.exit === CompiledBlockExit.ReadField) {
						this.loadTableFieldIndexCached(base, page, exit.exitWord, image.constWords[exit.exitC], registers, exit.exitA);
					} else if (exit.exit === CompiledBlockExit.ReadInteger) {
						this.loadTableIntegerIndex(base, exit.exitC, registers, exit.exitA);
					} else {
						this.loadTableIndex(base, this.readRKValue(frame, exit.exitC), registers, exit.exitA);
					}
					this.bumpRegisterTop(frame, exit.exitA);
					break;
				}
				case CompiledBlockExit.WriteField:
				case CompiledBlockExit.WriteInteger:
				case CompiledBlockExit.WriteIndex: {
					const base = registers.get(exit.exitA), value = this.readRKValue(frame, exit.exitC);
					if (exit.exit === CompiledBlockExit.WriteField) {
						this.storeTableFieldIndexCached(base, page, exit.exitWord, image.constWords[exit.exitB], value);
					} else if (exit.exit === CompiledBlockExit.WriteInteger) {
						this.storeTableIntegerIndex(base, exit.exitB, value);
					} else {
						this.storeTableIndex(base, this.readRKValue(frame, exit.exitB), value);
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
			if (thread.frameDepth <= targetDepth || remaining <= 0 || thread.stackRequiresScalar()
				|| (this.haltedUntilIrqThread === this.activeThread && this.haltedUntilIrqFrameDepth === thread.frameDepth)) return;
			frame = thread.currentFrame!;
			if (exit.resumesFrame && exit.linkedBlock !== null) {
				// Pure same-frame helpers retain the image and socket selection.
				// Target retirement already withdraws this intrusive cache link.
				block = exit.linkedBlock;
				if (remaining <= block.admissionCycles + block.admissionVarargs * frame.varargCount) return;
				page = block.page;
				continue;
			}
			if (frame.executionImage !== image) return;
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
			if (next === null) return;
			if (remaining <= next.admissionCycles + next.admissionVarargs * frame.varargCount) return;
			// Only shared-memory system code entering the selectable cartridge
			// window needs a fresh chip-select lookup on each traversal.
			if ((exit.resumesFrame || exit.exit === CompiledBlockExit.Continue) && exit.linkedBlock === null
				&& (frame.executionImage.executionDomainId !== SYSTEM_EXECUTION_DOMAIN_ID
					|| pc < CART_ROM_BASE || exit.currentPc >= CART_ROM_BASE)) linkCompiledBlock(exit, next);
			block = next;
		}
	}

	private executeInstruction(
		frame: CallFrame,
		page: DecodedInstructionPage,
		pageOffset: number,
		op: number,
		targetDepth: number,
		rewritten = false,
	): void {
		const registers = frame.registers;
		const image = frame.executionImage;
		const a = page.a[pageOffset];
		switch (op) {
				case DecodedDispatchOp.CompiledWarm:
				case DecodedDispatchOp.Compiled:
					this.executeCompiledBlock(frame, page, pageOffset, targetDepth, rewritten);
					return;
				case DecodedDispatchOp.Observe:
					frame.compilationEntry = rewritten || compiledBlockEndsBlock(page.ops[pageOffset], page.b[pageOffset]);
					this.instructionObserver!.observe(image.executionDomainId, this.currentInstructionPc, registers);
					// Observe has zero base cost; execute and charge the original instruction once.
					this.instructionBudgetRemaining -= DECODED_DISPATCH_BASE_CYCLES[page.ops[pageOffset]];
					this.executeInstruction(frame, page, pageOffset, page.ops[pageOffset], targetDepth);
					return;
				case DecodedDispatchOp.FusedShlBxor:
				case DecodedDispatchOp.FusedShrBxor:
				case DecodedDispatchOp.FusedAddShl:
					if (frame.thread.stackRequiresScalar()) {
						this.executeInstruction(frame, page, pageOffset, page.ops[pageOffset], targetDepth);
						return;
					}
					this.executeFusedNumericPair(frame, page, pageOffset, op);
					return;
				case OpCode.WIDE:
					this.hardHalt();
					return;
				case DecodedDispatchOp.ReservedMemory:
					this.enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
					return;
				case OpCode.MOV: {
					const kind = page.c[pageOffset], b = page.b[pageOffset];
					if (kind === ValueMoveKind.Copy) this.copyRegisterFast(frame, registers, a, b);
					else if (kind === ValueMoveKind.FloatBits || kind === ValueMoveKind.FloatFromBits) {
						const sourceTag = kind === ValueMoveKind.FloatBits ? ValueTag.Float : ValueTag.Integer;
						if (registers.getTag(b) !== sourceTag) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
						this.setRegisterValueFast(frame, registers, a, valueFromTag(kind === ValueMoveKind.FloatBits ? ValueTag.Integer : ValueTag.Float, registers.getPayload(b)));
					} else this.enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
					return;
				}
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
					this.setRegisterIntegerFast(frame, registers, a, 0);
					return;
				case OpCode.K1:
					this.setRegisterIntegerFast(frame, registers, a, 1);
					return;
				case OpCode.KM1:
					this.setRegisterIntegerFast(frame, registers, a, -1);
					return;
				case OpCode.KSMI:
					this.setRegisterIntegerFast(frame, registers, a, page.sbx[pageOffset]);
					return;
				case OpCode.LOADNIL: {
					const b = page.b[pageOffset];
					registers.clear(b, a);
					this.charge(b);
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
					const base = registers.get(page.b[pageOffset]), index = page.c[pageOffset];
					if (valueTag(base) !== ValueTag.Table || !this.gc.tables.loadIntegerArrayKey(valuePayload(base), index, registers, a))
						this.loadTableIntegerIndex(base, index, registers, a);
					this.bumpRegisterTop(frame, a); return;
				}
				case OpCode.SETI: {
					const base = registers.get(a), index = page.b[pageOffset], value = this.readRKValue(frame, page.c[pageOffset]);
					if (valueTag(base) !== ValueTag.Table || !this.gc.tables.storeIntegerArrayKey(valuePayload(base), index, valueTag(value), valuePayload(value)))
						this.storeTableIntegerIndex(base, index, value);
					return;
				}
				case OpCode.GETFIELD:
					this.loadTableFieldIndexCached(registers.get(page.b[pageOffset]), page, pageOffset, image.constWords[page.c[pageOffset]], registers, a);
					this.bumpRegisterTop(frame, a); return;
				case OpCode.SETFIELD:
					this.storeTableFieldIndexCached(registers.get(a), page, pageOffset, image.constWords[page.b[pageOffset]], this.readRKValue(frame, page.c[pageOffset])); return;
				case OpCode.SELF: {
					const b = page.b[pageOffset], base = registers.get(b), key = image.constWords[page.c[pageOffset]];
					registers.copySlot(a + 1, b); this.bumpRegisterTop(frame, a + 1);
					this.loadTableFieldIndexCached(base, page, pageOffset, key, registers, a); this.bumpRegisterTop(frame, a); return;
				}
				case OpCode.HALT: this.haltUntilIrq(); return;
				case OpCode.GETT:
					this.loadTableIndex(registers.get(page.b[pageOffset]), this.readRKValue(frame, page.c[pageOffset]), registers, a);
					this.bumpRegisterTop(frame, a); return;
				case OpCode.SETT:
					this.storeTableIndex(registers.get(a), this.readRKValue(frame, page.b[pageOffset]), this.readRKValue(frame, page.c[pageOffset])); return;
				case OpCode.NEWT: {
					const arraySize = page.b[pageOffset];
					const table = this.createTable(arraySize, page.c[pageOffset]);
					this.setRegisterTableFast(frame, registers, a, table);
					this.charge(2 * this.gc.tables.storedSlotCount(table.address) - arraySize);
					return;
				}
				case OpCode.ADD:
					this.setRegisterValueFast(frame, registers, a, valueAdd(this.readRKValue(frame, page.b[pageOffset]), this.readRKValue(frame, page.c[pageOffset]))); return;
				case OpCode.SUB:
					this.setRegisterValueFast(frame, registers, a, valueSubtract(this.readRKValue(frame, page.b[pageOffset]), this.readRKValue(frame, page.c[pageOffset]))); return;
				case OpCode.MUL:
					this.setRegisterValueFast(frame, registers, a, valueMultiply(this.readRKValue(frame, page.b[pageOffset]), this.readRKValue(frame, page.c[pageOffset]))); return;
				case OpCode.DIV:
					this.setRegisterValueFast(frame, registers, a, valueDivide(this.readRKValue(frame, page.b[pageOffset]), this.readRKValue(frame, page.c[pageOffset]))); return;
				case OpCode.MOD:
					this.setRegisterValueFast(frame, registers, a, valueModulo(this.readRKValue(frame, page.b[pageOffset]), this.readRKValue(frame, page.c[pageOffset]))); return;
				case OpCode.FLOORDIV:
					this.setRegisterValueFast(frame, registers, a, valueFloorDivide(this.readRKValue(frame, page.b[pageOffset]), this.readRKValue(frame, page.c[pageOffset]))); return;
				case OpCode.POW:
					this.setRegisterValueFast(frame, registers, a, valuePower(this.readRKValue(frame, page.b[pageOffset]), this.readRKValue(frame, page.c[pageOffset]))); return;
				case OpCode.BAND: {
					const left = integerOperand(this.readRKValue(frame, page.b[pageOffset])), right = integerOperand(this.readRKValue(frame, page.c[pageOffset]));
					this.setRegisterIntegerFast(frame, registers, a, left & right); return;
				}
				case OpCode.BOR: {
					const left = integerOperand(this.readRKValue(frame, page.b[pageOffset])), right = integerOperand(this.readRKValue(frame, page.c[pageOffset]));
					this.setRegisterIntegerFast(frame, registers, a, left | right); return;
				}
				case OpCode.BXOR: {
					const left = integerOperand(this.readRKValue(frame, page.b[pageOffset])), right = integerOperand(this.readRKValue(frame, page.c[pageOffset]));
					this.setRegisterIntegerFast(frame, registers, a, left ^ right); return;
				}
				case OpCode.SHL: {
					const left = integerOperand(this.readRKValue(frame, page.b[pageOffset])), right = integerOperand(this.readRKValue(frame, page.c[pageOffset]));
					this.setRegisterIntegerFast(frame, registers, a, luaShiftLeft(left, right)); return;
				}
				case OpCode.SHR: {
					const left = integerOperand(this.readRKValue(frame, page.b[pageOffset])), right = integerOperand(this.readRKValue(frame, page.c[pageOffset]));
					this.setRegisterIntegerFast(frame, registers, a, luaShiftRight(left, right)); return;
				}
				case OpCode.CONCAT:
					this.executeConcat(frame, a, page.b[pageOffset], page.c[pageOffset]); return;
				case OpCode.CONCATN:
					this.executeConcatRange(frame, a, page.b[pageOffset], page.c[pageOffset]); return;
				case OpCode.UNM: {
					this.setRegisterValueFast(frame, registers, a, valueNegate(registers.get(page.b[pageOffset])));
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
							const cp = this.stringPool.byteLength(registers.getStringId(b));
							this.setRegisterIntegerFast(frame, registers, a, cp);
							return;
						}
						case ValueTag.Table: {
							const boundary = this.gc.tables.length(registers.getPayload(b), this.tableLengthWork);
							this.instructionBudgetRemaining -= this.tableLengthWork.probes * TABLE_LENGTH_PROBE_CYCLES;
							this.setRegisterIntegerFast(frame, registers, a, boundary);
							return;
						}
						default:
							throw new LuaExecutionError(LUA_FAULT_REASON_UNKNOWN);
					}
				}
				case OpCode.BNOT: {
					const value = integerOperand(registers.get(page.b[pageOffset]));
					this.setRegisterIntegerFast(frame, registers, a, ~value);
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
					const left = this.readRKValue(frame, page.b[pageOffset]), right = this.readRKValue(frame, page.c[pageOffset]);
					let ok = false;
					if (valueIsNumber(left) && valueIsNumber(right)) ok = compareNumbers(left, right) === NumericOrder.Less;
					else if (valueTag(left) === ValueTag.String && valueTag(right) === ValueTag.String) {
						const l = valuePayload(left), r = valuePayload(right);
						this.charge(Math.min(this.stringPool.byteLength(l), this.stringPool.byteLength(r)));
						ok = this.stringPool.compare(l, r) < 0;
					}
					if (ok !== (a !== 0)) this.skipNextInstruction(frame); return;
				}

				case OpCode.MFC0: {
					if (this.isUserMode()) {
						this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
						return;
					}
					const field = page.b[pageOffset];
					if (!cop0FieldImplemented(field)) { this.hardHalt(); return; }
					const value = field === COP0_EXEC ? 0 : this.cop0Words[field];
					this.setRegisterIntegerFast(frame, registers, a, value);
					return;
				}
				case OpCode.MTC0: {
					if (this.isUserMode()) {
						this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
						return;
					}
					const value = wordOperand(registers.get(a));
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
					const constantIndex = wordOperand(registers.get(page.b[pageOffset]));
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
					const left = this.readRKValue(frame, page.b[pageOffset]), right = this.readRKValue(frame, page.c[pageOffset]);
					let ok = false;
					if (valueIsNumber(left) && valueIsNumber(right)) ok = compareNumbers(left, right) <= NumericOrder.Equal;
					else if (valueTag(left) === ValueTag.String && valueTag(right) === ValueTag.String) {
						const l = valuePayload(left), r = valuePayload(right);
						this.charge(Math.min(this.stringPool.byteLength(l), this.stringPool.byteLength(r)));
						ok = this.stringPool.compare(l, r) <= 0;
					}
					if (ok !== (a !== 0)) this.skipNextInstruction(frame); return;
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
					const address = frame.captureAddress(page.b[pageOffset]);
					this.copyUpvalueToRegister(frame, registers, a, address);
					return;
				}
				case OpCode.SETUP: {
					const address = frame.captureAddress(page.b[pageOffset]);
					this.copyRegisterToUpvalue(address, registers, a);
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
					if (c === MemoryAccessKind.F64LE) this.instructionBudgetRemaining -= 2;
					const displaced = op === OpCode.LOAD_MEM_D || op === OpCode.STORE_MEM_D;
					const addr = displaced ? (wordOperand(registers.get(b)) + (page.disp[pageOffset] << 2)) >>> 0
						: wordOperand(this.readRKValue(frame, b));
					if (op === OpCode.LOAD_MEM_D || op === OpCode.LOAD_MEM) this.executeMemoryLoad(frame, a, c, addr);
					else this.executeMemoryStore(frame, a, c, addr);
					return;
				}
				case OpCode.STORE_MEM_WORDS_D:
				case OpCode.STORE_MEM_WORDS: {
					const b = page.b[pageOffset];
					const address = op === OpCode.STORE_MEM_WORDS_D
						? (wordOperand(registers.get(b)) + (page.disp[pageOffset] << 2)) >>> 0
						: wordOperand(this.readRKValue(frame, b));
					this.executeWordStores(frame, address, a, page.c[pageOffset]);
					return;
				}
		}
	}

	private pushFrame(
		closure: Closure,
		args: ReadonlyArray<Value>,
		returnBase: number,
		returnCount: number,
		returnToCompletionLatch: boolean,
		exception = false,
	): CallFrame {
		const functionRecord = closure.prototypeRecord;
		const frame = this.activeThread.acquireFrame();
		const argumentBase = this.activeThread.stackTop;
		const vararg = (functionRecord.flags & BLUA32_FUNCTION_VARARG) !== 0;
		const varargCount = vararg ? Math.max(args.length - functionRecord.numParams, 0) : 0;
		const stackBase = vararg ? argumentBase + args.length : argumentBase;
		const capacity = Math.max(functionRecord.maxStack, functionRecord.numParams, 1);
		this.ensureStackCapacity(stackBase + capacity, valueClosure(closure.address), true, exception);
		frame.executionImage = this.executionImageForDomain(closure.prototypeRecord.executionDomainId)!;
		frame.decodedPage = null;
		frame.decodedPageAddress = 0;
		frame.initializeControl(functionRecord.functionAddress, functionRecord.codeAddress, functionRecord.codeAddress, returnToCompletionLatch, functionRecord.executionDomainId,
			argumentBase + functionRecord.numParams, varargCount, returnBase, returnCount, functionRecord.numParams, closure.address, stackBase, capacity);
		const registers = frame.registers;
		this.activeThread.stackTop = stackBase + capacity;

		const copiedCount = Math.min(functionRecord.numParams, args.length);
		for (let index = 0; index < copiedCount; index += 1) {
			registers.set(index, args[index]);
		}
		for (let index = copiedCount; index < functionRecord.numParams; index += 1) {
			registers.setNil(index);
		}
		if ((functionRecord.flags & BLUA32_FUNCTION_VARARG) !== 0) {
			for (let index = 0; index < varargCount; index += 1) {
				this.activeThread.stackRegisters.set(argumentBase + functionRecord.numParams + index, args[functionRecord.numParams + index]);
			}
		}
		this.activeThread.enterFrame(frame);
		this.latchActiveExecutionImage(functionRecord.executionDomainId, frame.executionImage);
		return frame;
	}

	private pushFrameFromCaller(caller: CallFrame, closure: Closure, argBase: number, argCount: number, returnBase: number, returnCount: number, returnToCompletionLatch: boolean, callSitePc: number): CallFrame | null {
		const functionRecord = closure.prototypeRecord;
		const frame = this.activeThread.acquireFrame();
		const sharedStack = caller.thread === this.activeThread;
		const argumentBase = sharedStack ? caller.stackBase + argBase : this.activeThread.stackTop;
		const vararg = (functionRecord.flags & BLUA32_FUNCTION_VARARG) !== 0;
		const varargCount = vararg ? Math.max(argCount - functionRecord.numParams, 0) : 0;
		const stackBase = vararg ? argumentBase + argCount : argumentBase;
		const callerRegisters = caller.registers;
		const capacity = Math.max(functionRecord.maxStack, functionRecord.numParams, 1);
		this.ensureStackCapacity(stackBase + capacity, valueClosure(closure.address), true);
		frame.executionImage = this.executionImageForDomain(closure.prototypeRecord.executionDomainId)!;
		frame.decodedPage = null;
		frame.decodedPageAddress = 0;
		frame.initializeControl(functionRecord.functionAddress, functionRecord.codeAddress, callSitePc, returnToCompletionLatch, functionRecord.executionDomainId,
			argumentBase + functionRecord.numParams, varargCount, returnBase, returnCount, functionRecord.numParams, closure.address, stackBase, capacity);
		const registers = frame.registers;
		this.activeThread.stackTop = stackBase + capacity;
		const copiedCount = Math.min(functionRecord.numParams, argCount);
		if (vararg || !sharedStack) {
			registers.copyRangeFrom(callerRegisters, 0, argBase, copiedCount);
		}
		registers.clear(functionRecord.numParams - copiedCount, copiedCount);
		if (vararg) {
			if (sharedStack) {
				this.activeThread.stackRegisters.clear(copiedCount, argumentBase);
			} else {
				this.activeThread.stackRegisters.copyRangeFrom(callerRegisters,
					argumentBase + functionRecord.numParams, argBase + functionRecord.numParams, varargCount);
			}
		}
		this.charge((vararg || !sharedStack ? functionRecord.numParams : functionRecord.numParams - copiedCount)
			+ (sharedStack ? 0 : varargCount));
		this.activeThread.enterFrame(frame);
		this.latchActiveExecutionImage(functionRecord.executionDomainId, frame.executionImage);
		return frame;
	}

	private createClosure(frame: CallFrame): Closure | null {
		const functionRecord = this.functionRecordLatch;
		if ((functionRecord.flags & BLUA32_FUNCTION_STATIC) !== 0
			&& functionRecord.recordUpvalueCount === 0) {
			return this.staticClosureFromLatch();
		}
		const count = functionRecord.recordUpvalueCount;
		if (this.closureUpvalueWords.length < count) {
			this.closureUpvalueWords = new Uint32Array(count);
			this.closureCellAddresses = new Uint32Array(count);
		}
		const upvalueWords = this.closureUpvalueWords;
		const upvalues = this.closureCellAddresses;
		upvalues.fill(0, 0, count);
		const faultSequence = this.memory.readBusFaultSequence();
		let newUpvalueCount = 0;
		for (let index = 0; index < functionRecord.recordUpvalueCount; index += 1) {
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
					upvalues[index] = upvalue.address;
				} else {
					newUpvalueCount += 1;
				}
				continue;
			}
			upvalues[index] = frame.captureAddress(upvalueIndex);
		}
		if (this.captureAddresses.length < newUpvalueCount) this.captureAddresses = new Uint32Array(newUpvalueCount);
		const address = this.luaHeap.allocateClosureRecord(count, this.captureAddresses, newUpvalueCount);
		const closure = new Closure(this.memory, address, functionRecord, count, false);
		closure.initializeRecord();
		closure.hashId = this.allocateObjectHashId();
		this.gc.track(closure);
		let nextCell = 0;
		for (let index = 0; index < functionRecord.recordUpvalueCount; index += 1) {
			if (upvalues[index] !== 0 || (upvalueWords[index] & BLUA32_UPVALUE_IN_STACK_MASK) === 0) {
				closure.setCaptureAddress(index, upvalues[index]);
				continue;
			}
			const upvalue = new Upvalue(this.memory, this.captureAddresses[nextCell++]);
			upvalue.hashId = this.allocateObjectHashId();
			this.gc.track(upvalue);
			this.linkOpenUpvalue(frame, upvalue, (frame.stackBase + (upvalueWords[index] & BLUA32_UPVALUE_INDEX_MASK)) >>> 0);
			closure.setCaptureAddress(index, upvalue.address);
		}
		this.charge(count);
		return closure;
	}

	private closeUpvalues(frame: CallFrame): number {
		let closed = 0;
		let address = frame.openUpvalueHead;
		frame.openUpvalueHead = 0;
		while (address !== 0 && closed < UPVALUE_CHAIN_LIMIT) {
			const upvalue = this.gc.openCellAt(address);
			if (upvalue === null) break;
			address = upvalue.nextAddress;
			upvalue.close();
			++closed;
		}
		return closed;
	}

	private copyUpvalueToRegister(frame: CallFrame, registers: ValueSlots, registerIndex: number, address: number): void {
		registers.set(registerIndex, Upvalue.load(this.memory, address));
		this.bumpRegisterTop(frame, registerIndex);
	}

	private copyRegisterToUpvalue(address: number, registers: ValueSlots, registerIndex: number): void {
		if (!Upvalue.isOpen(this.memory, address)) this.gc.cellAt(address)?.writeBarrier();
		Upvalue.store(this.memory, address, registers.getTag(registerIndex), registers.getPayload(registerIndex));
	}

	private writeReturnValuesFromRegisters(frame: CallFrame, base: number, count: number, source: ValueSlots, sourceBase: number, sourceCount: number): void {
		const targetCount = decodeValueCount(count, sourceCount);
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
		this.charge(targetCount);
	}

	private writeReturnValuesFromBuiltinResults(
		frame: CallFrame,
		base: number,
		count: number,
		values: BuiltinResults,
	): void {
		const targetCount = decodeValueCount(count, values.length);
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
		this.charge(targetCount);
	}

	private ensureRegisterCapacity(frame: CallFrame, index: number): ValueSlots {
		const registers = frame.registers;
		if (index >= frame.stackCapacity) {
			const needed = index + 1;
			let capacity = 1 << (32 - Math.clz32(needed - 1));
			if (capacity < 8) capacity = 8;
			this.ensureStackCapacity(frame.stackBase + capacity, valueClosure(frame.closureAddress));
			frame.growRegisterWindow(capacity);
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
		registers.setBoolean(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterValueFast(frame: CallFrame, registers: ValueSlots, index: number, value: Value): void {
		registers.set(index, value); this.bumpRegisterTop(frame, index);
	}

	private setRegisterIntegerFast(frame: CallFrame, registers: ValueSlots, index: number, value: number): void {
		registers.setInteger(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterStringFast(frame: CallFrame, registers: ValueSlots, index: number, value: StringId): void {
		registers.setString(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterTableFast(frame: CallFrame, registers: ValueSlots, index: number, value: Table): void {
		registers.setTable(index, this.gc.reference(value));
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterClosureFast(frame: CallFrame, registers: ValueSlots, index: number, value: Closure): void {
		registers.setClosure(index, this.gc.reference(value));
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
			image.constWords[constantIndex],
		);
		this.bumpRegisterTop(frame, registerIndex);
	}


	private readRKEquals(frame: CallFrame, left: number, right: number): boolean {
		return valuesEqual(this.readRKValue(frame, left), this.readRKValue(frame, right));
	}
	private readRKValue(frame: CallFrame, rk: number): Value {
		return rk < 0 ? valueFromTag(frame.executionImage.constTags[-1 - rk], frame.executionImage.constWords[-1 - rk]) : frame.registers.get(rk);
	}

	private callBuiltinFunction(id: BuiltinFunctionId, args: BuiltinArgsView, out: BuiltinResults, resultLimit: number): void {
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
			case BuiltinFunctionId.NumberType: {
				const tag = args.length > 0 ? args.registers.getTag(args.base) : ValueTag.Nil;
				out.push(tag === ValueTag.Integer || tag === ValueTag.Float
					? valueString(this.stringPool.intern(tag === ValueTag.Integer ? 'integer' : 'float')) : valueNil());
				break;
			}
			case BuiltinFunctionId.ToInteger: {
				const integer = valueToInteger(args.length > 0 ? args.registers.get(args.base) : valueNil());
				out.push(integer === null ? valueNil() : valueInteger(integer));
				break;
			}
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
				const slot = this.globalSlotByKey.get(args.registers.getPayload(args.base));
				if (slot === undefined) out.push(valueNil());
				else out.push(this.globalSlots.get(slot));
				break;
			}
			case BuiltinFunctionId.SetGlobal: {
				if (args.length === 0 || args.registers.getTag(args.base) !== ValueTag.String) {
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				}
				const key = args.registers.getPayload(args.base);
				if (args.length < 2) this.setGlobalByKey(key, valueNil());
				else this.setGlobalByKey(key, args.registers.get(args.base + 1));
				break;
			}
			case BuiltinFunctionId.Select:
				this.runBuiltinSelect(args, out, resultLimit);
				break;
			case BuiltinFunctionId.FrameCount:
				out.push(valueInteger((args.registers.getThread(args.base, this.gc)).frameDepth));
				break;
			case BuiltinFunctionId.FrameHeader: {
				const thread = args.registers.getThread(args.base, this.gc);
				const frame = thread.frameAtDepth(integerOperand(args.registers.get(args.base + 1)));
				out.push(valueInteger(frame.functionAddress));
				out.push(valueInteger(frame.pc));
				out.push(valueInteger(frame.callSitePc));
				out.push(valueBool(frame.returnToCompletionLatch));
				out.push(valueInteger(frame.executionImage.executionDomainId >>> 0));
				out.push(valueBool(frame.isExceptionFrame));
				break;
			}
			case BuiltinFunctionId.GetFrameRegister:
			case BuiltinFunctionId.SetFrameRegister: {
				const thread = args.registers.getThread(args.base, this.gc);
				const registers = thread.frameAtDepth(integerOperand(args.registers.get(args.base + 1))).registers;
				const index = integerOperand(args.registers.get(args.base + 2));
				if (id === BuiltinFunctionId.GetFrameRegister) out.push(registers.get(index));
				else registers.copySlotFrom(args.registers, index, args.base + 3);
				break;
			}
			case BuiltinFunctionId.GetFrameUpvalue:
			case BuiltinFunctionId.SetFrameUpvalue: {
				const thread = args.registers.getThread(args.base, this.gc);
				const frame = thread.frameAtDepth(integerOperand(args.registers.get(args.base + 1)));
				const index = integerOperand(args.registers.get(args.base + 2));
				if (id === BuiltinFunctionId.SetFrameUpvalue) this.copyRegisterToUpvalue(frame.captureAddress(index), args.registers, args.base + 3);
				else out.push(Upvalue.load(this.memory, frame.captureAddress(index)));
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
				this.stringIndexTable = args.registers.get(args.base);
				break;
			case BuiltinFunctionId.CoroutineCreate: {
				const closure = args.length !== 0 && args.registers.getTag(args.base) === ValueTag.Closure
					? this.gc.closureAt(args.registers.getPayload(args.base)) : null;
				if (closure === null) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				out.push(valueThread(this.gc.reference(this.createThread(closure))));
				break;
			}
			case BuiltinFunctionId.CoroutineRunning:
				out.push(valueThread(this.gc.reference(this.activeThread)));
				out.push(valueBool(this.activeThread === this.rootThread));
				break;
			case BuiltinFunctionId.CoroutineStatus:
			case BuiltinFunctionId.CoroutineClose:
			case BuiltinFunctionId.CoroutineIsYieldable: {
				const thread = args.length === 0 && id === BuiltinFunctionId.CoroutineIsYieldable ? this.activeThread
					: args.length > 0 && args.registers.getTag(args.base) === ValueTag.Thread ? args.registers.getThread(args.base, this.gc) : null;
				if (thread === null) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				if (id === BuiltinFunctionId.CoroutineIsYieldable) out.push(valueBool(this.coroutineYieldable(thread)));
				else if (id === BuiltinFunctionId.CoroutineStatus) {
					out.push(valueInteger(thread.status));
				} else {
					const failed = thread.status === ThreadStatus.Failed;
					out.push(valueBool(!(failed)));
					if (failed) out.push(thread.error);
					this.closeThread(thread);
					thread.error = valueNil();
				}
				break;
			}
			case BuiltinFunctionId.CoroutineResume:
			case BuiltinFunctionId.CoroutineYield:
				throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			case BuiltinFunctionId.CollectGarbage: {
				const operation = args.length === 0 ? GarbageCollectionOperation.Collect : integerOperand(args.registers.get(args.base));
				switch (operation) {
					case GarbageCollectionOperation.Collect: this.luaHeap.collectRuntime(); break;
					case GarbageCollectionOperation.Count:
						out.push(valueInteger(this.luaHeap.usedBytes()));
						out.push(valueInteger(this.luaHeap.capacity()));
						break;
					case GarbageCollectionOperation.Step: out.push(valueBool(this.luaHeap.stepRuntime())); break;
					default: throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				}
				break;
			}
			case BuiltinFunctionId.Error:
				this.runBuiltinError(args);
				break;
			case BuiltinFunctionId.PCall:
			case BuiltinFunctionId.XPCall:
				throw new Error('Protected calls execute as Lua CPU microcode.');
		}
	}

	public createThread(entry: Closure | null): Thread {
		const address = this.luaHeap.allocateRecord(THREAD_HEAP_BYTES, true, THREAD_INITIAL_BACKING_BYTES, ThreadField.StackBlock,
			entry === null ? valueNil() : valueClosure(entry.address));
		const thread = new Thread(this.gc, address);
		thread.initializeRecord(entry);
		thread.hashId = this.allocateObjectHashId();
		this.gc.track(thread);
		if (this.localRootScopeDepth > 0) this.localRoots.push(valueThread(this.gc.reference(thread)));
		return thread;
	}

	private coroutineYieldable(thread: Thread): boolean {
		if (thread === this.rootThread) return false;
		for (let frame = thread.currentFrame; frame !== null; frame = frame.previous)
			if (frame.isExceptionFrame || frame.returnToCompletionLatch) return false;
		const depth = thread.protectedDepth;
		for (let index = 0; index < depth; ++index) {
			if ((thread.protectedWord(index, ProtectedField.Flags) & PROTECTED_CALL_KIND_MASK) === ProtectedCallKind.XPCallHandler)
				return false;
		}
		return true;
	}

	private returnToResumer(source: ValueSlots | null, sourceBase: number, sourceCount: number): void {
		const thread = this.activeThread;
		const resumer = thread.resumer!;
		this.activeThread = resumer;
		this.resumeFrameBank();
		resumer.status = ThreadStatus.Running;
		const caller = resumer.currentFrame!;
		const callBase = resumer.callBase;
		const count = decodeValueCount(resumer.returnCount, sourceCount + 1);
		if (count > 0) {
			const registers = this.ensureRegisterCapacity(caller, callBase + count - 1);
			registers.setBoolean(callBase, source !== null);
			const copied = Math.min(sourceCount, count - 1);
			if (source !== null) registers.copyRangeFrom(source, callBase + 1, sourceBase, copied);
			else if (copied !== 0) registers.set(callBase + 1, thread.error);
			for (let index = copied + 1; index < count; index += 1) registers.setNil(callBase + index);
		}
		caller.top = callBase + count;
		thread.resumer = null;
		this.threadSwitchRequested = true;
		this.yieldRequested = true;
		this.charge(count);
	}

	private runCoroutineTransfer(id: BuiltinFunctionId, caller: CallFrame, callBase: number, returnCount: number, argCount: number): void {
		const thread = this.activeThread;
		if (id === BuiltinFunctionId.CoroutineYield) {
			if (!this.coroutineYieldable(thread)) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			thread.setReturnWindow(callBase, returnCount);
			thread.status = ThreadStatus.Suspended;
			this.returnToResumer(caller.registers, callBase + 1, argCount);
			return;
		}
		if (argCount === 0 || caller.registers.getTag(callBase + 1) !== ValueTag.Thread) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		const target = caller.registers.getThread(callBase + 1, this.gc);
		const status = target.status;
		const exceptionActive = this.readExceptionReturnFrameDepth() !== -1;
		if (exceptionActive || (status !== ThreadStatus.New && status !== ThreadStatus.Suspended)) {
			const results = this.acquireBuiltinResults();
			try {
				results.push(valueBool(false));
				results.push(valueString(this.stringPool.intern(exceptionActive ? 'cannot resume coroutine across a hardware exception' : 'cannot resume non-suspended coroutine')));
				this.writeReturnValuesFromBuiltinResults(caller, callBase, returnCount, results);
			} finally { this.releaseBuiltinResults(results); }
			return;
		}
		const fresh = status === ThreadStatus.New;
		thread.setReturnWindow(callBase, returnCount);
		thread.status = ThreadStatus.Normal;
		target.resumer = thread;
		target.status = ThreadStatus.Running;
		this.activeThread = target;
		if (fresh) {
			this.pushFrameFromCaller(caller, target.entry!, callBase + 2, argCount - 1, 0, 0, false, 0);
			target.entry = null;
		} else {
			this.resumeFrameBank();
			const frame = target.currentFrame!;
			this.writeReturnValuesFromRegisters(frame, target.callBase, target.returnCount, caller.registers, callBase + 2, argCount - 1);
		}
		this.threadSwitchRequested = true;
		this.yieldRequested = true;
	}

	private handleThreadError(error: Value): boolean {
		if (this.handleProtectedCallError(error)) return true;
		const thread = this.activeThread;
		if (thread.resumer === null) return false;
		for (let frame = thread.currentFrame; frame !== null; frame = frame.previous)
			if (frame.isExceptionFrame || frame.returnToCompletionLatch) return false;
		thread.status = ThreadStatus.Failed;
		thread.error = error;
		this.returnToResumer(null, 0, 1);
		return true;
	}

	public closeThread(thread: Thread): void {
		const status = thread.status;
		if (status === ThreadStatus.Running || status === ThreadStatus.Normal) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		while (thread.currentFrame !== null) {
			this.charge(this.closeUpvalues(thread.currentFrame));
			thread.leaveFrame();
		}
		thread.protectedDepth = 0;
		thread.stackRegisters.clear(thread.stackRegisters.capacity());
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
			this.callBuiltinFunction(id, builtinArgs, results, returnCount === 0 ? -1 : returnCount - 1);
			if (this.activeThread.frameDepth > 0 && this.activeThread.currentFrame! === frame) {
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
		const kind = id === BuiltinFunctionId.PCall ? ProtectedCallKind.PCall : ProtectedCallKind.XPCallBody;
		const continuationIndex = this.activeThread.pushProtectedCall(kind, returnsToProtectedParent, callBase,
			returnCount, id === BuiltinFunctionId.XPCall ? argumentBase + 1 : -1);

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
		const caller = this.protectedCaller(continuationIndex);
		const targetTag = targetPresent
			? targetRegisters.getTag(targetRegister)
			: ValueTag.Nil;
		switch (targetTag) {
			case ValueTag.Closure: {
				const closure = this.gc.closureAt(targetRegisters.getPayload(targetRegister));
				if (closure === null) throw new LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
				const frame = this.pushFrameFromCaller(
					caller,
					closure,
					argumentBase,
					argumentCount,
					0,
					0,
					false,
					caller.pc - INSTRUCTION_BYTES,
				);
				if (frame !== null) frame.protectedContinuationIndex = continuationIndex;
				return;
			}
			case ValueTag.BuiltinFunction: {
				const builtinId = targetRegisters.getBuiltinFunctionId(targetRegister);
				this.charge(BUILTIN_FUNCTIONS[builtinId].cost.base);
				if (builtinId === BuiltinFunctionId.PCall || builtinId === BuiltinFunctionId.XPCall) {
					this.startProtectedCall(builtinId, caller, this.activeThread.protectedWord(continuationIndex, ProtectedField.Base) | 0,
						0, argumentBase, argumentCount, true);
					return;
				}
				const builtinArgs = this.acquireRegisterBuiltinArgs();
				const results = this.acquireBuiltinResults();
				try {
					builtinArgs.bind(caller.registers, argumentBase, argumentCount);
					this.callBuiltinFunction(builtinId, builtinArgs, results, -1);
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
		if ((this.activeThread.protectedWord(continuationIndex, ProtectedField.Flags) & PROTECTED_CALL_KIND_MASK) === ProtectedCallKind.XPCallHandler) {
			if (values.length > 0) {
				this.finishProtectedCallWithError(
					continuationIndex,
					values.get(0),
				);
			} else {
				this.finishProtectedCallWithError(
					continuationIndex,
					valueNil(),
				);
			}
			return;
		}
		const resultCount = this.writeProtectedResultsFromBuiltinResults(continuationIndex, true, values);
		this.charge(resultCount);
		this.finishProtectedContinuation(continuationIndex, resultCount);
	}

	private finishProtectedCallFromRegisters(continuationIndex: number, source: ValueSlots, sourceBase: number, sourceCount: number): void {
		if ((this.activeThread.protectedWord(continuationIndex, ProtectedField.Flags) & PROTECTED_CALL_KIND_MASK) === ProtectedCallKind.XPCallHandler) {
			if (sourceCount > 0) {
				this.finishProtectedCallWithError(
					continuationIndex,
					source.get(sourceBase),
				);
			} else {
				this.finishProtectedCallWithError(
					continuationIndex,
					valueNil(),
				);
			}
			return;
		}
		const resultCount = this.writeProtectedResultsFromRegisters(continuationIndex, true, source, sourceBase, sourceCount);
		this.charge(resultCount);
		this.finishProtectedContinuation(continuationIndex, resultCount);
	}

	private finishProtectedCallWithError(
		continuationIndex: number,
		error: Value,
	): void {
		const caller = this.protectedCaller(continuationIndex);
		const callBase = this.activeThread.protectedWord(continuationIndex, ProtectedField.Base) | 0;
		const returnCount = this.activeThread.protectedWord(continuationIndex, ProtectedField.Wanted) | 0;
		const resultCount = decodeValueCount(returnCount, 2);
		if (resultCount > 0) {
			const registers = this.ensureRegisterCapacity(caller, callBase + resultCount - 1);
			registers.setBoolean(callBase, false);
			if (resultCount > 1) {
				registers.set(callBase + 1, error);
				for (let index = 2; index < resultCount; index += 1) {
					registers.setNil(callBase + index);
				}
			}
		}
		caller.top = callBase + resultCount;
		this.charge(resultCount);
		this.finishProtectedContinuation(continuationIndex, resultCount);
	}

	private writeProtectedResultsFromBuiltinResults(
		continuationIndex: number,
		prefix: boolean,
		values: BuiltinResults,
	): number {
		const caller = this.protectedCaller(continuationIndex);
		const callBase = this.activeThread.protectedWord(continuationIndex, ProtectedField.Base) | 0;
		const returnCount = this.activeThread.protectedWord(continuationIndex, ProtectedField.Wanted) | 0;
		const resultCount = decodeValueCount(returnCount, values.length + 1);
		if (resultCount > 0) {
			const registers = this.ensureRegisterCapacity(caller, callBase + resultCount - 1);
			registers.setBoolean(callBase, prefix);
			const copiedCount = Math.min(values.length, resultCount - 1);
			if (copiedCount > 0) {
				values.copyTo(registers, callBase + 1, copiedCount);
			}
			for (let index = copiedCount + 1; index < resultCount; index += 1) {
				registers.setNil(callBase + index);
			}
		}
		caller.top = callBase + resultCount;
		return resultCount;
	}

	private writeProtectedResultsFromRegisters(
		continuationIndex: number,
		prefix: boolean,
		source: ValueSlots,
		sourceBase: number,
		sourceCount: number,
	): number {
		const caller = this.protectedCaller(continuationIndex);
		const callBase = this.activeThread.protectedWord(continuationIndex, ProtectedField.Base) | 0;
		const returnCount = this.activeThread.protectedWord(continuationIndex, ProtectedField.Wanted) | 0;
		const resultCount = decodeValueCount(returnCount, sourceCount + 1);
		if (resultCount > 0) {
			const registers = this.ensureRegisterCapacity(caller, callBase + resultCount - 1);
			const copiedCount = Math.min(sourceCount, resultCount - 1);
			if (copiedCount > 0) {
				if (registers === source) {
					registers.copyWithin(callBase + 1, sourceBase, copiedCount);
				} else {
					registers.copyRangeFrom(source, callBase + 1, sourceBase, copiedCount);
				}
			}
			registers.setBoolean(callBase, prefix);
			for (let index = copiedCount + 1; index < resultCount; index += 1) {
				registers.setNil(callBase + index);
			}
		}
		caller.top = callBase + resultCount;
		return resultCount;
	}

	private protectedCaller(continuationIndex: number): CallFrame {
		const caller = this.activeThread.protectedCaller(continuationIndex);
		if (caller === null) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		return caller;
	}

	private finishProtectedContinuation(continuationIndex: number, resultCount: number): void {
		const flags = this.activeThread.protectedWord(continuationIndex, ProtectedField.Flags);
		this.activeThread.protectedDepth = continuationIndex;
		if ((flags & PROTECTED_CALL_PARENT) !== 0) {
			const callBase = this.activeThread.protectedWord(continuationIndex, ProtectedField.Base) | 0;
			const caller = this.protectedCaller(continuationIndex);
			this.finishProtectedCallFromRegisters(continuationIndex - 1, caller.registers, callBase, resultCount);
		}
	}

	private handleProtectedCallError(
		error: Value,
	): boolean {
		for (;;) {
			const depth = this.activeThread.protectedDepth;
			if (depth === 0) return false;
			const continuationIndex = depth - 1;
			const callerIndex = this.activeThread.protectedWord(continuationIndex, ProtectedField.Caller);
			if (callerIndex >= this.activeThread.frameDepth) return false;
			let caller = this.activeThread.currentFrame!;
			for (let at = this.activeThread.frameDepth - 1; at > callerIndex; --at, caller = caller.previous!) {
				// Completion roots return to their latch, not the interrupted caller.
				if (caller.isExceptionFrame || caller.returnToCompletionLatch) return false;
			}
			this.unwindToDepth(callerIndex + 1, true);
			const kind = this.activeThread.protectedWord(continuationIndex, ProtectedField.Flags) & PROTECTED_CALL_KIND_MASK;
			if (kind !== ProtectedCallKind.XPCallBody) {
				this.finishProtectedCallWithError(continuationIndex, kind === ProtectedCallKind.XPCallHandler
					? valueString(this.errorInErrorHandlingStringId) : error);
				return true;
			}

			this.activeThread.setProtectedKind(continuationIndex, ProtectedCallKind.XPCallHandler);
			const handlerRegister = this.activeThread.protectedWord(continuationIndex, ProtectedField.Handler) | 0;
			const callBase = this.activeThread.protectedWord(continuationIndex, ProtectedField.Base) | 0;
			const registers = this.ensureRegisterCapacity(caller, callBase);
			registers.set(callBase, error);
			this.bumpRegisterTop(caller, callBase);
			this.charge(1);
			try {
				this.invokeProtectedTarget(
					continuationIndex,
					caller.registers,
					handlerRegister,
					true,
					callBase,
					1,
				);
				return true;
			} catch (handlerError) {
				if (handlerError instanceof LuaThrownValueError) {
					error = handlerError.value;
					continue;
				}
				if (handlerError instanceof LuaExecutionError) {
					error = valueString(this.luaFaultErrorStringIds[handlerError.reason]);
					continue;
				}
				throw handlerError;
			}
		}
	}

	private runBuiltinNextValue(args: BuiltinArgsView, out: BuiltinResults): void {
		const registers = args.registers, base = args.base;
		if (args.length === 0 || registers.getTag(base) !== ValueTag.Table) throw new LuaExecutionError(LUA_FAULT_REASON_ITERATE_NON_TABLE);
		const address = registers.getPayload(base);
		this.charge(this.gc.tables.next(address, args.length > 1 ? registers.get(base + 1) : valueNil(), out, 0));
	}

	private runBuiltinType(tag: ValueTag, out: BuiltinResults): void {
		out.push(valueString(this.stringPool.intern(valueTypeNameForLuaTag(tag))));
	}

	private runBuiltinSetMetatable(args: BuiltinArgsView, out: BuiltinResults): void {
		const registers = args.registers;
		if (args.length === 0 || registers.getTag(args.base) !== ValueTag.Table) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		const address = registers.getPayload(args.base);
		let metatable = 0;
		if (args.length > 1) {
			const metatableIndex = args.base + 1;
			const metatableTag = registers.getTag(metatableIndex);
			if (metatableTag === ValueTag.Table) {
				metatable = registers.getPayload(metatableIndex);
			} else if (metatableTag !== ValueTag.Nil) {
				throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			}
		}
		this.gc.tables.setMetatableAddress(address, metatable);
		out.push(valueTable(address));
	}

	private runBuiltinGetMetatable(args: BuiltinArgsView, out: BuiltinResults): void {
		if (args.length === 0 || args.registers.getTag(args.base) !== ValueTag.Table) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		const metatable = this.gc.tables.metatableAddress(args.registers.getPayload(args.base));
		if (metatable) {
			out.push(valueTable(metatable));
		} else {
			out.push(valueNil());
		}
	}

	private runBuiltinRawGet(args: BuiltinArgsView, out: BuiltinResults): void {
		const registers = args.registers, base = args.base;
		if (args.length === 0 || registers.getTag(base) !== ValueTag.Table) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		const address = registers.getPayload(base);
		if (args.length > 1) this.gc.tables.load(address, registers.getTag(base + 1), registers.getPayload(base + 1), out, 0);
		else this.gc.tables.load(address, ValueTag.Nil, 0, out, 0);
	}
	private runBuiltinRawSet(args: BuiltinArgsView, out: BuiltinResults): void {
		const registers = args.registers, base = args.base;
		if (args.length === 0 || registers.getTag(base) !== ValueTag.Table) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		this.gc.tables.set(registers.getPayload(base), args.length > 1 ? registers.get(base + 1) : valueNil(), args.length > 2 ? registers.get(base + 2) : valueNil());
		out.push(registers.get(base));
	}

	private runBuiltinSelect(args: BuiltinArgsView, out: BuiltinResults, resultLimit: number): void {
		const registers = args.registers;
		const base = args.base;
		const count = args.length - 1;
		const selector = args.length > 0 ? registers.get(base) : valueNil();
		if (valueTag(selector) === ValueTag.String && this.stringPool.byteLength(valuePayload(selector)) === 1
			&& this.stringPool.byteAt(valuePayload(selector), 0) === 35) {
			out.push(valueInteger(count)); return;
		}
		const startSelector = integerOperand(selector);
		const start = Math.max(startSelector >= 0 ? startSelector : count + startSelector + 1, 1);
		const available = Math.max(count - start + 1, 0);
		const produced = resultLimit < 0 ? available : Math.min(available, resultLimit);
		for (let index = 0; index < produced; index += 1) {
			const valueIndex = base + start + index;
			out.push(registers.get(valueIndex));
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
				position = wordOperand(registers.get(positionIndex)) | 0;
			}
		}
		if (position < 1 || position > this.stringPool.byteLength(sourceId)) {
			out.push(valueNil());
			return;
		}
		out.push(valueInteger(this.stringPool.byteAt(sourceId, position - 1)));
	}

	private runBuiltinStringChar(args: BuiltinArgsView, out: BuiltinResults): void {
		this.charge(args.length);
		const registers = args.registers;
		let result = '';
		for (let index = 0; index < args.length; index += 1) {
			const valueIndex = args.base + index;
			const byte = wordOperand(registers.get(valueIndex));
			if (byte > 0xff) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			result += String.fromCharCode(byte);
		}
		out.push(valueString(this.stringPool.intern(result)));
	}

	private runBuiltinError(args: BuiltinArgsView): never {
		if (args.length === 0) {
			throw new LuaThrownValueError(valueNil());
		}
		const registers = args.registers;
		const index = args.base;
		throw new LuaThrownValueError(
			registers.get(index)
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
		const writeValue: CpuSnapshotValueWriter = (offset, value): void => {
			writer.setWord(offset, valueTag(value)); writer.setWord(offset + 1, valuePayload(value));
		};
		const captureStoredValueState = (value: Value): number => {
			const offset = writer.reserveWords(CPU_SNAPSHOT_VALUE_WORDS); writeValue(offset, value); return offset;
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
					this.systemGlobalSlots.get(slot)
				),
			});
		}

		const globalSlots: CpuRootValueState[] = [];
		for (let slot = 0; slot < this.globalNames.length; slot += 1) {
			globalSlots.push({
				key: this.globalNames[slot],
				value: captureStoredValueState(
					this.globalSlots.get(slot)
				),
			});
		}


		const completionValues = new Array<number>(this.completionValueCount);
		for (let index = 0; index < this.completionValueCount; index += 1) {
			completionValues[index] = captureStoredValueState(
				this.completionValueSlots.get(index)
			);
		}

		const stringIndexTable = captureStoredValueState(
			this.stringIndexTable,
		);

		// Materialization order affects later object hashes even for an unrooted
		// static closure. Preserve the entire cache, in physical-address order.
		const canonicalClosures = Array.from(this.staticClosuresByAddress.values()).flat();
		canonicalClosures.sort((a, b) => a.prototypeRecord.functionAddress - b.prototypeRecord.functionAddress
			|| a.prototypeRecord.executionDomainId - b.prototypeRecord.executionDomainId || a.prototypeRecord.codeAddress - b.prototypeRecord.codeAddress
			|| a.prototypeRecord.numParams - b.prototypeRecord.numParams || a.prototypeRecord.maxStack - b.prototypeRecord.maxStack || a.prototypeRecord.flags - b.prototypeRecord.flags
			|| a.prototypeRecord.upvalueTableAddress - b.prototypeRecord.upvalueTableAddress || a.prototypeRecord.recordUpvalueCount - b.prototypeRecord.recordUpvalueCount
			|| a.upvalueCount - b.upvalueCount
			|| a.hashId - b.hashId);
		for (const closure of canonicalClosures) {
			captureObject(closure, CpuSnapshotObjectKind.Closure);
		}
		const gc = this.gc.captureState(object => captureObject(object as CpuSnapshotObject, object.gcKind as number));
		// Reserve ordinals at each edge, then drain in ordinal order. Guest graph
		// depth must not consume the host call stack.
		for (let id = 0; id < pendingObjects.length; id += 1) {
			const object = pendingObjects[id];
			const kind = pendingKinds[id];
			let offset: number;
			if (kind === CpuSnapshotObjectKind.Garbage) {
				offset = writer.reserveWords(3); writer.setWord(offset, CpuSnapshotObjectKind.Garbage);
				writer.setWord(offset + 1, object.hashId); writer.setWord(offset + 2, this.gc.allocationBytes(object));
				writer.setObjectWord(id, offset); continue;
			}
			switch (kind) {
				case CpuSnapshotObjectKind.Thread: {
					const thread = object as Thread;
					offset = writer.reserveWords(CpuSnapshotThread.Size);
					writer.setWord(offset + CpuSnapshotThread.Kind, kind);
					writer.setWord(offset + CpuSnapshotThread.HashId, thread.hashId);

					writer.setWord(offset + CpuSnapshotThread.Record, thread.address);
					break;
				}
				case CpuSnapshotObjectKind.Table:
					offset = (object as Table).captureSnapshot(writer);
					break;
				case CpuSnapshotObjectKind.Closure: {
					const closure = object as Closure;
					offset = writer.reserveWords(CpuSnapshotClosure.Size);
					writer.setWord(offset + CpuSnapshotClosure.Kind, kind);
					writer.setWord(offset + CpuSnapshotClosure.HashId, closure.hashId);
					writer.setWord(offset + CpuSnapshotClosure.FunctionAddress, closure.prototypeRecord.functionAddress);
					writer.setWord(offset + CpuSnapshotClosure.Canonical, closure.canonical ? 1 : 0);
					writer.setWord(offset + CpuSnapshotClosure.UpvalueCount, closure.upvalueCount);
					writer.setWord(offset + CpuSnapshotClosure.CodeAddress, closure.prototypeRecord.codeAddress);
					writer.setWord(offset + CpuSnapshotClosure.NumParams, closure.prototypeRecord.numParams);
					writer.setWord(offset + CpuSnapshotClosure.MaxStack, closure.prototypeRecord.maxStack);
					writer.setWord(offset + CpuSnapshotClosure.Flags, closure.prototypeRecord.flags);
					writer.setWord(offset + CpuSnapshotClosure.UpvalueTableAddress, closure.prototypeRecord.upvalueTableAddress);
					writer.setWord(offset + CpuSnapshotClosure.RecordUpvalueCount, closure.prototypeRecord.recordUpvalueCount);
					writer.setWord(offset + CpuSnapshotClosure.ExecutionDomainId, closure.prototypeRecord.executionDomainId);
					writer.setWord(offset + CpuSnapshotClosure.Record, closure.address);
					break;
				}
				case CpuSnapshotObjectKind.Upvalue: {
					const upvalue = object as Upvalue;
					offset = writer.reserveWords(CpuSnapshotUpvalue.Size);
					writer.setWord(offset + CpuSnapshotUpvalue.Kind, kind);
					writer.setWord(offset + CpuSnapshotUpvalue.HashId, upvalue.hashId);
					writer.setWord(offset + CpuSnapshotUpvalue.Address, upvalue.address);
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
			executionCartridgeSlot: this.activeExecutionDomainId,
			programExecutionDomainId: this.programExecutionDomainId,
			systemGlobals,
			globalSlots,
			executionResidencyMask,
			nextObjectHashId: this.nextObjectHashId,
			hardHalted: this.hardHalted,
			luaHeap: this.luaHeap.captureState(),
			gc,
			stringIndexTable,
			rootThreadRef, activeThreadRef, completionThreadRef,
			completionValues,
			snapshot,
			lastExecutionDomainId: this.lastExecutionDomainId,
			lastPc: this.lastPc,
			haltedUntilIrqFrameDepth: this.haltedUntilIrqFrameDepth,
			haltedUntilIrqThreadRef,
			interruptEventPending: this.interruptEventPending,
			memoryWriteBlocked: this.memoryWriteBlocked,
			memoryWriteBlockedAddress: this.memoryWriteBlockedAddress,
			pendingMemory: { ...this.pendingMemory },
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
		this.compiledCodeCache.retireAll();
		const snapshot = state.snapshot;
		this.gc.forgetPhysicalRecords();
		const restoredObjects = new Array<CpuSnapshotObject>(snapshot.objectCount);
		this.clearCompletionValues();
		// RAM has already been restored. Only detach the host activations
		// on the reused root; the restored Thread edges are not attached yet.
		this.rootThread.detachFrameViews();
		const previousCanonical = new Map(this.staticClosuresByAddress);
		this.staticClosuresByAddress.clear();
		// Allocate every identity before resolving edges, including cycles and weak references.
		for (let index = 0; index < snapshot.objectCount; index += 1) {
			const offset = snapshot.objectWord(index);
			switch (snapshot.word(offset)) {
				case CpuSnapshotObjectKind.Garbage: {
					const bytes = snapshot.word(offset + 2);
					this.luaHeap.restoreAllocate(bytes);
					const object = new GarbageAllocation(bytes); object.hashId = snapshot.word(offset + 1);
					this.gc.track(object); object.restored = true;
					restoredObjects[index] = object;
					break;
				}
				case CpuSnapshotObjectKind.Thread: {
					const thread = index === state.rootThreadRef ? this.rootThread : new Thread(this.gc, snapshot.word(offset + CpuSnapshotThread.Record));
					if (index !== state.rootThreadRef) this.gc.track(thread);
					thread.restored = true;
					thread.hashId = snapshot.word(offset + CpuSnapshotThread.HashId);
					thread.bindStack();
					if (index !== state.rootThreadRef) this.luaHeap.restoreAllocate(this.gc.allocationBytes(thread));
					restoredObjects[index] = thread;
					break;
				}
				case CpuSnapshotObjectKind.Table: {
					const table = new Table(this.gc, snapshot.word(offset + CpuSnapshotTable.Record));
					this.luaHeap.restoreAllocate(this.gc.tables.getTrackedHeapBytes(table.address));
					this.gc.track(table); table.restored = true;
					table.hashId = snapshot.word(offset + CpuSnapshotTable.HashId);
					restoredObjects[index] = table;
					break;
				}
				case CpuSnapshotObjectKind.Closure: {
					const functionAddress = snapshot.word(offset + CpuSnapshotClosure.FunctionAddress);
					const codeAddress = snapshot.word(offset + CpuSnapshotClosure.CodeAddress);
					const numParams = snapshot.word(offset + CpuSnapshotClosure.NumParams);
					const maxStack = snapshot.word(offset + CpuSnapshotClosure.MaxStack);
					const flags = snapshot.word(offset + CpuSnapshotClosure.Flags);
					const upvalueTableAddress = snapshot.word(offset + CpuSnapshotClosure.UpvalueTableAddress);
					const executionDomainId = snapshot.int(offset + CpuSnapshotClosure.ExecutionDomainId) as ExecutionDomainId;
					const recordUpvalueCount = snapshot.word(offset + CpuSnapshotClosure.RecordUpvalueCount);
					const count = snapshot.word(offset + CpuSnapshotClosure.UpvalueCount);
					const canonical = snapshot.word(offset + CpuSnapshotClosure.Canonical) !== 0;
					const address = snapshot.word(offset + CpuSnapshotClosure.Record);
					const record = { functionAddress, codeAddress, numParams, maxStack, flags, upvalueTableAddress, executionDomainId, recordUpvalueCount };
					const previous = canonical ? previousCanonical.get(functionAddress) : undefined;
					const existingIndex = previous === undefined ? -1 : previous.findIndex(item =>
						item.hashId === snapshot.word(offset + CpuSnapshotClosure.HashId) && item.address === address
						&& sameFunctionPrototype(item.prototypeRecord, record));
					const closure = existingIndex < 0 ? new Closure(this.memory, address, record, count, canonical) : previous!.splice(existingIndex, 1)[0];
					if (existingIndex < 0) { this.luaHeap.restoreAllocate(closure.heapBytes); this.gc.track(closure); }
					closure.restored = true;
					closure.hashId = snapshot.word(offset + CpuSnapshotClosure.HashId);
					if (canonical) {
						let versions = this.staticClosuresByAddress.get(functionAddress);
						if (versions === undefined) {
							versions = [];
							this.staticClosuresByAddress.set(functionAddress, versions);
						}
						versions.push(closure);
					}
					restoredObjects[index] = closure;
					break;
				}
				case CpuSnapshotObjectKind.Upvalue:
					this.luaHeap.restoreAllocate(UPVALUE_HEAP_BYTES);
					const upvalue = new Upvalue(this.memory, snapshot.word(offset + CpuSnapshotUpvalue.Address));
					this.gc.track(upvalue); upvalue.restored = true;
					upvalue.hashId = snapshot.word(offset + CpuSnapshotUpvalue.HashId);
					restoredObjects[index] = upvalue;
					break;
			}
		}
		this.gc.bindRestoredReferences(state.gc, restoredObjects);
		const reader = new CpuSnapshotReader(snapshot);
		// Constant/string and global-slot caches must not retain entries first
		// encountered in the discarded future. Rebuild from the same media.
		this.memory.clearMappedPageWriteWatches();
		this.gc.armThreadStackWatches();
		this.executionImagesByDomain.fill(null);
		this.clearGlobalSlots();
		this.systemGlobalSlots.reserveCapacity(state.systemGlobals.length);
		for (let slot = 0; slot < state.systemGlobals.length; slot += 1) {
			const entry = state.systemGlobals[slot];
			this.systemGlobalNames.push(entry.key);
			this.systemGlobalSlotByKey.set(entry.key, slot);
			reader.readValue(entry.value);
			this.systemGlobalSlots.setEncoded(slot, reader.tag, reader.payload);
		}
		this.globalSlots.reserveCapacity(state.globalSlots.length);
		for (let slot = 0; slot < state.globalSlots.length; slot += 1) {
			const entry = state.globalSlots[slot];
			this.globalNames.push(entry.key);
			this.globalSlotByKey.set(entry.key, slot);
			reader.readValue(entry.value);
			this.globalSlots.setEncoded(slot, reader.tag, reader.payload);
		}
		for (let index = 0; index < this.executionImagesByDomain.length; index += 1) {
			if ((state.executionResidencyMask & (1 << index)) !== 0) {
				const boot = this.executionAddressSpace.resolveDomain((index - 1) as ExecutionDomainId)!;
				this.executionImagesByDomain[index] = this.materializeExecutionImage(boot, this.readExecutionImageHeader(boot), true);
			}
		}
		this.systemImage = this.executionImagesByDomain[SYSTEM_EXECUTION_DOMAIN_ID + 1]!;
		const executionImage = this.executionImagesByDomain[state.executionCartridgeSlot + 1];
		this.latchActiveExecutionImage(state.executionCartridgeSlot, executionImage);

		this.gc.restoreState(state.gc, restoredObjects);
		this.gc.visitThreads(thread => { if (!this.gc.sweepGarbage(thread)) this.bindPhysicalFrames(thread); });
		this.activeThread = restoredObjects[state.activeThreadRef] as Thread;
		if (this.activeThread.currentFrame !== null) this.activeThread.currentFrame.executionImage = this.activeExecutionImage;
		this.completionThread = restoredObjects[state.completionThreadRef] as Thread;
		this.threadSwitchRequested = false;
		reader.readValue(state.stringIndexTable);
		this.stringIndexTable = reader.value();
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
				reader.tag, reader.payload,
			);
		}
		this.completionValueCount = state.completionValues.length;
		this.programExecutionDomainId = state.programExecutionDomainId;
		this.lastExecutionDomainId = state.lastExecutionDomainId;
		this.lastPc = state.lastPc;
		this.haltedUntilIrqFrameDepth = state.haltedUntilIrqFrameDepth;
		this.haltedUntilIrqThread = state.haltedUntilIrqThreadRef === -1 ? null : restoredObjects[state.haltedUntilIrqThreadRef] as Thread;
		this.interruptEventPending = state.interruptEventPending;
		this.memoryWriteBlocked = state.memoryWriteBlocked;
		this.memoryWriteBlockedAddress = state.memoryWriteBlockedAddress;
		Object.assign(this.pendingMemory, state.pendingMemory);
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

	public markHeapImage(image: Blua32ExecutionImage): void {
		if (this.heapSeenImages.get(image) === this.heapEpoch) {
			return;
		}
		this.heapSeenImages.set(image, this.heapEpoch);
		for (let index = 0; index < image.constTags.length; index += 1) {
			if (image.constTags[index] === ValueTag.String) {
				this.stringPool.markReachable(image.constWords[index] as StringId);
			}
		}
	}

	public visitReachableClosures(visitor: (closure: Closure) => void): void {
		const objects: (Table | Closure | Thread)[] = [];
		const upvalues: Upvalue[] = [];
		const seen = new Set<Table | Closure | Thread | Upvalue>();
		const add = (value: Value): void => {
			const tag = valueTag(value);
			if (tag === ValueTag.Table) {
				const table = this.gc.tableAt(valuePayload(value));
				if (table !== null) objects.push(table);
			} else if (tag === ValueTag.Closure) {
				const closure = this.gc.closureAt(valuePayload(value));
				if (closure !== null) objects.push(closure);
			} else if (tag === ValueTag.Thread) objects.push(asThread(value, this.gc));
		};
		const addSlots = (slots: ValueSlots, count: number): void => {
			for (let index = 0; index < count; index += 1) add(slots.get(index));
		};
		addSlots(this.systemGlobalSlots, this.systemGlobalNames.length);
		addSlots(this.globalSlots, this.globalNames.length);
		addSlots(this.completionValueSlots, this.completionValueCount);
		add(this.stringIndexTable);
		objects.push(this.rootThread, this.activeThread, this.completionThread);
		if (this.haltedUntilIrqThread !== null) objects.push(this.haltedUntilIrqThread);
		for (const versions of this.staticClosuresByAddress.values()) objects.push(...versions);
		for (const value of this.localRoots) add(value);
		for (let index = 0; index < this.builtinResultsScratchIndex; index += 1) {
			const slots = this.builtinResultsScratch.peek(index);
			for (let valueIndex = 0; valueIndex < slots.length; valueIndex += 1) add(slots.get(valueIndex));
		}
		while (objects.length > 0 || upvalues.length > 0) {
			if (upvalues.length > 0) {
				const upvalue = upvalues.pop()!;
				if (seen.has(upvalue)) continue;
				seen.add(upvalue);
				if (upvalue.open) {
					const thread = this.gc.threadAt(upvalue.ownerAddress);
					if (thread !== null) objects.push(thread);
				}
				add(upvalue.value);
				continue;
			}
			const object = objects.pop()!;
			if (seen.has(object)) continue;
			seen.add(object);
			switch (object.gcKind) {
				case GcKind.Closure: {
					const closure = object as Closure;
					visitor(closure);
					for (let index = 0; index < closure.upvalueCount; ++index) {
						const cell = this.gc.cellAt(closure.captureAddress(index));
						if (cell !== null) upvalues.push(cell);
					}
					break;
				}
				case GcKind.Table: {
					const table = object as Table;
					if (table.metatable !== null) objects.push(table.metatable);
					this.gc.tables.forEachStoredEntry(table.address, (key, value) => { add(key); add(value); });
					break;
				}
				case GcKind.Thread: {
					const thread = object as Thread;
					if (thread.entry !== null) objects.push(thread.entry);
					if (thread.resumer !== null) objects.push(thread.resumer);
					add(thread.error);
					addSlots(thread.stackRegisters, thread.stackTop);
					for (let frame = thread.currentFrame; frame !== null; frame = frame.previous) {
						add(valueClosure(frame.closureAddress));
						let address = frame.openUpvalueHead;
						for (let remaining = UPVALUE_CHAIN_LIMIT; address !== 0 && remaining !== 0; --remaining) {
							const upvalue = this.gc.openCellAt(address);
							if (upvalue === null) break;
							upvalues.push(upvalue);
							address = upvalue.nextAddress;
						}
					}
					break;
				}
			}
		}
	}

	public collectionRootWordCount(): number {
		let words = 3 * (this.systemGlobalNames.length + this.globalNames.length);
		for (const image of this.executionImagesByDomain) {
			if (image !== null) words += 2 * image.constTags.length;
		}
		return words;
	}

	public collectTrackedHeapBytes(root0: Value = valueNil(), root1: Value = valueNil(), root2: Value = valueNil()): number {
		this.gc.collect(root0, root1, root2);
		return this.luaHeap.usedBytes();
	}

	public markHeapRoots(heap: GcHeap): void {
		++this.heapEpoch;
		this.stringPool.markReachable(this.modeKey);
		this.stringPool.markReachable(this.indexKey);
		this.stringPool.markReachable(this.errorInErrorHandlingStringId);
		for (let i = 0; i < this.luaFaultErrorStringIds.length; ++i)
			if (i !== LUA_FAULT_REASON_EXPLICIT_ERROR) this.stringPool.markReachable(this.luaFaultErrorStringIds[i]);
		heap.markValue(this.stringIndexTable);
		for (let i = 0; i < this.completionValueCount; ++i) heap.markSlot(this.completionValueSlots, i);
		for (let i = 0; i < this.builtinResultsScratchIndex; ++i) {
			const slots = this.builtinResultsScratch.peek(i);
			for (let j = 0; j < slots.length; ++j) heap.markValue(slots.get(j));
		}
		for (const value of this.localRoots) heap.markValue(value);
		for (let i = 0; i < this.systemGlobalNames.length; ++i) {
			this.stringPool.markReachable(this.systemGlobalNames[i]); heap.markSlot(this.systemGlobalSlots, i);
		}
		for (let i = 0; i < this.globalNames.length; ++i) {
			this.stringPool.markReachable(this.globalNames[i]); heap.markSlot(this.globalSlots, i);
		}
		for (const image of this.executionImagesByDomain) if (image !== null) this.markHeapImage(image);
		heap.markObject(this.rootThread); heap.markObject(this.activeThread); heap.markObject(this.completionThread);
		heap.markObject(this.haltedUntilIrqThread);
	}
	public pruneStaticClosures(): void {
		for (const [address, closures] of this.staticClosuresByAddress) {
			let write = 0;
			for (const closure of closures) if (this.gc.isAlive(closure)) closures[write++] = closure;
			closures.length = write;
			if (write === 0) this.staticClosuresByAddress.delete(address);
		}
	}
}

// end normalized-body-acceptable
// end repeated-sequence-acceptable
