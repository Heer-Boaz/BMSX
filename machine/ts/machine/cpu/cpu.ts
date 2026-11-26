import { ValueMoveKind } from '../../spec/blua32/instruction_format';
import { GcHeap, GcRootBank, GC_WORK_WORD_CYCLES } from './gc_heap';
import { ConcatAssembly, type ConcatAssemblyState } from './concat_assembly';
import { PendingMemoryKind, type PendingMemoryOperation } from './memory_operation';
import { valueAdd, valueSubtract, valueMultiply, valueDivide, valueFloorDivide, valueModulo, valuePower, valueNegate, integerOperand, wordOperand, } from './value_arithmetic';
import { numberToF32Bits } from '../../common/float32';
import { CART_ROM_BASE, CART_ROM_END, CART_ROM_SIZE, MAIN_RAM_SIZE, RAM_BASE, RAM_RECORD_WORD_MASK, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE } from '../../spec/bmsx/memory_map';
import { isRamStringId, StringPool, type StringId } from './string_pool';
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
import { BASE_CYCLES, INLINE_CONCAT_BYTES, INLINE_CONCAT_OPERANDS, INLINE_STRING_COMPARE_BYTES, TABLE_INDEX_VISIT_CYCLES, OPCODE_COUNT, OPCODE_USES_BX, OPCODE_USES_DISP, OPCODE_RK_OPERANDS, RK_OPERAND_B, RK_OPERAND_C, OpCode, decodeValueCount } from '../../spec/blua32/opcode';
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
	LUA_FAULT_REASON_INDEX_NAN,
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
import {
	BASE_OPERAND_A_BITS, BASE_OPERAND_BC_BITS, CLOSURE_ADDRESS_REGISTER_FLAG, INSTRUCTION_BYTES, MAX_OPERAND_BITS,
	instructionBranchTarget, instructionBx, instructionFieldExtraHashSlots, instructionLowB, instructionOpcode, instructionSignedBx, signExtend,
} from '../../spec/blua32/instruction_format';
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
	BLUA32_IMAGE_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_CONSTANT_COUNT_OFFSET,
	BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_FLAGS_OFFSET,
	BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET,
	BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_HEADER_SIZE,
	BLUA32_IMAGE_MAGIC,
	BLUA32_IMAGE_MAGIC_OFFSET,
	BLUA32_IMAGE_RODATA_ADDRESS_OFFSET,
	BLUA32_IMAGE_RODATA_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET,
	BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET,
	BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET,
	BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
	BLUA32_STRING_ROM_ADDRESS_MASK,
	BLUA32_STRING_ROM_SOCKET_SHIFT,
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
	mappedPageDomainIndex, mappedPageAddressKey,
} from '../memory/mapped_page';
import { BuiltinFunctionId, GarbageCollectionOperation, LUA_BOOT_PRIMITIVES } from '../../spec/blua32/builtin';
import {
	EMPTY_CALL_ARGS,
	ValueTag,
	valueTable, valueClosure, valueNil, valueInteger, valueFloat, valueFloatBits, valuePayload, valueFromTag, valueToByteString, MAX_NON_STRING_TEXT_BYTES,
	canonicalTableKey, valueIsInteger, valueIsFloat, valueIsNumber, asInteger, asFloat, compareNumbers, valuesEqual, valueBuiltinFunction, valueString, valueBool, valueThread, asThread,
	isNil, valueTag, valueToInteger,
	valueTypeNameForLuaTag,
	type Value,
} from './value';
import { LUA_OUT_OF_MEMORY_SIGNAL, LuaExecutionError, LuaThrownValueError } from './errors';
import { TableRecords, TableRebuild, TableCensus, TableStoreReturn, TableHeader, TABLE_INDEX_CHAIN_LIMIT, HASH_STORE_DECLINED, TableLookupStatus, type TableLookupResult } from './table';
import * as Closure from './closure';
import { CLOSURE_BINDING_FLAGS, CLOSURE_CANONICAL, CLOSURE_PROTOTYPE_ADDRESS, sameFunctionPrototype, type FunctionPrototype } from './closure';
import { StaticClosureIndex } from './static_closure_index';
import { UPVALUE_NEXT, UPVALUE_CHAIN_LIMIT, UPVALUE_VALUE_WORD, UPVALUE_OWNER } from './upvalue';
import * as Upvalue from './upvalue';
import { ValueSlots } from './value_slots';
import { GlobalBank, type GlobalBankState } from './global_bank';
import { BuiltinArgsView, BuiltinResults, BUILTIN_FUNCTIONS } from './builtin_values';
import {
	COMPILED_VERSION_MAX_PAGES,
	DECODED_PAGE_SHIFT,
	DECODED_PAGE_WORDS,
	DECODED_DEPENDENCY_PREDECESSOR_WORDS,
	DECODED_REFRESH_DECODE,
	DECODED_REFRESH_FUSION,
	createDecodedInstructionPage,
	decodedDispatchCanFuse,
	decodedDispatchOp,
	decodedInstructionBaseCycles,
	admitsFunctionPc,
	isRomInstructionHead,
	readPublishedPrototype,
	romFunctionVersionLane,
	RomCallBindings,
	RomFunctionLane,
	SCALAR_LOCAL_PC,
	readRomFunctionDirectory,
	fixedRegisterExtent,
	DecodedDispatchOp,
	type Blua32ExecutionImage,
	type ExecutionImageRelocation,
	type Blua32FunctionRecordLatch,
	type DecodedInstructionPage,
} from './execution_image';
import { FRAME_CONTROL_BYTES, PROTECTED_CALL_BYTES, FRAME_WINDOW_MASK, FRAME_COMPLETION, FRAME_EXCEPTION, FrameField, frameExecutionBank, ProtectedCallKind, ProtectedField, PROTECTED_CALL_KIND_MASK, PROTECTED_CALL_HANDLER_BUILTIN, PROTECTED_CALL_PARENT, CALL_RESULT_EXTEND_TOP, SINGLE_CALL_RESULT, DISCARD_CALL_RESULT, selectedCallResultCount, CallFrame } from './call_state';
import { CompiledCodeLookup } from './compiled_code_lookup';
import { Thread, ThreadStatus, THREAD_RECORD_KIND } from './thread';
import { ThreadField, ThreadLayout, THREAD_CONTROL_COUNT_MASK, MAX_THREAD_VALUE_SLOTS } from './thread_record';
import { GC_STEP_WORDS, LuaAllocationMode, LuaAllocationRecovery, LuaHeap } from './lua_heap';
import { GC_OBJECT_PREFIX } from './gc_object';
import { HEAP_GC_CONTROL_OFFSET, HeapAllocator } from './heap_allocator';
import { HeapService } from './heap_service';
import {
	HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET, HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET, HEAP_SERVICE_DESCRIPTOR_SIZE,
	HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET,
	HEAP_SERVICE_EXEC_BUS_OFFSET, HEAP_SERVICE_EXEC_FLOOR_OFFSET, HEAP_SERVICE_EXEC_PC_OFFSET,
	HEAP_SERVICE_EXEC_STAGE_OFFSET, HEAP_SERVICE_EXEC_TARGET_OFFSET,
	HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_IMAGE_ADDRESS_OFFSET, HEAP_SERVICE_IMAGE_FLAG, HEAP_SERVICE_IMAGE_HEADER_SIZE,
	HEAP_SERVICE_VALUE_COUNT, HeapServiceExecStage, HeapServiceGcStage, HeapServiceNewtField, HeapServiceNewtStage, HeapServiceOperation,
	HEAP_SERVICE_REMARK_FAULTS_OFFSET, HEAP_SERVICE_REMARK_HEAD_OFFSET, HeapServiceRemarkHeadField,
	HEAP_SERVICE_ROOT_BANK_SIZE, HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE, HEAP_SERVICE_ROOT_BANKS_OFFSET, HEAP_SERVICE_ROOT_PORT_BASE,
	HEAP_SERVICE_ROOT_PORT_BYTES, HEAP_SERVICE_ROOT_PORT_SHIFT, HEAP_SERVICE_ROOT_PORT_STRIDE, HeapServiceRootBankField, HeapServiceRootPlane,
} from '../../spec/bmsx/heap_service';
import {
	CpuExecutionBackend, CompiledBlockExit, COMPILED_BLOCK_THRESHOLD,
	compiledBlockSupports, compiledBlockEndsBlock, compiledBlockComparison, compiledBlockHasContinuation, compiledBlockAdmits,
	type CompiledBlockExitSite,
} from './compiled_block';
import { CompiledBlockPage, CompiledCodeCache, linkCompiledBlock } from './compiled_code_cache';
import { CompiledSourceGraph, SourceWord } from './compiled_source_graph';
import { compileJavaScriptRegion, type CompiledRegion, type CompiledRegionRunState } from './compiled_region';

// start repeated-sequence-acceptable -- Lua VM/table/register hot paths deliberately keep short copy/update sequences inline.
// start normalized-body-acceptable -- Specialized Lua VM accessors stay split so the fast paths avoid dispatch helpers.



// Main RAM owns language heap and stack records; this state is CPU latches only.
export type CpuRuntimeState = {
	executionCartridgeSlot: ExecutionDomainId;
	programExecutionDomainId: ExecutionDomainId;
	systemGlobals: GlobalBankState;
	globals: GlobalBankState;
	executionResidencyMask: ExecutionDomainMask;
	constantPoolBases: number[];
	globalMapBases: number[];
	hardHalted: boolean;
	stringIndexTable: Value;
	rootThreadAddress: number;
	activeThreadAddress: number;
	completionThreadAddress: number;
	completionValues: Value[];
	lastExecutionDomainId: ExecutionDomainId;
	lastPc: number;
	haltedUntilIrqFrameDepth: number;
	haltedUntilIrqThreadAddress: number;
	interruptEventPending: boolean;
	memoryWriteBlocked: boolean;
	memoryWriteBlockedAddress: number;
	stringComparison: StringComparisonLatch;
	rebuild: TableRebuild | null;
	concat: ConcatAssemblyState | null;
	pendingMemory: PendingMemoryOperation;
	pendingAllocation: PendingAllocation | null;
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
	ParkedAllocation,
	CollectionProgress,
}

export const enum CpuRunKind { Idle, Direct, Scheduled }

class StringComparisonLatch {
	left = 0; right = 0; offset = 0; remaining = 0;
	order = 0; skipLess = false; skipTie = false;
}

export const enum AllocationRecovery { None, Current, RetryCurrent, Fresh, RetryFresh }
export const enum PendingAllocationKind { TableAssignment, TableCreation }
type PendingAllocationOperands =
	| { kind: PendingAllocationKind.TableAssignment; receiver: number; key: Value; value: Value; extraHashSlots: number }
	| { kind: PendingAllocationKind.TableCreation; destination: number; arraySize: number; hashSize: number };

export type PendingAllocation = PendingAllocationOperands & {
	recovery: AllocationRecovery;
	instructionPc: number;
	lastPc: number;
	nextPc: number;
};
const ALLOCATION_PARKED = Symbol('AllocationParked');

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
	private unpublishedRomMask: ExecutionDomainMask = 0;
	private readonly threadBanks: readonly Thread[];
	private completionThread = 0;
	private readonly inspectionThreadLayout = new ThreadLayout();
	private readonly inspectionThreadValues = new ValueSlots(0);
	public readonly memory: Memory;

	public readonly luaHeap: LuaHeap;
	public readonly heapAllocator: HeapAllocator;
	public readonly gc: GcHeap;
	private readonly heapService: HeapService;
	private readonly execFloorArgs = [0, 0];
	private readonly newTableArgs: number[];
	public readonly stringPool: StringPool;
	private indexKey!: StringId;
	private lengthKey!: StringId;
	private modeKey!: StringId;
	private haltedUntilIrqFrameDepth = -1;
	private haltedUntilIrqThread = 0;
	private interruptEventPending = false;
	private memoryWriteBlocked = false;
	private memoryWriteBlockedAddress = 0;
	private pendingAllocation: PendingAllocation | null = null;
	private runKind = CpuRunKind.Idle;
	private readonly concat = new ConcatAssembly();
	public readonly tableRebuild = new TableRebuild();
	private stringComparison = new StringComparisonLatch();
	private readonly pendingMemory: PendingMemoryOperation = { kind: PendingMemoryKind.None, instructionPc: 0, nextPc: 0, address: 0, accessKind: MemoryAccessKind.Word, registerIndex: 0, wordCount: 0 };
	private currentInstructionPc = 0;
	private scalarRegisterTop = -1;
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
	private compiledSourceGraph: CompiledSourceGraph | null = null;
	private readonly compiledCodeCache = new CompiledCodeCache();
	private readonly compiledRunState: CompiledRegionRunState = {
		remainingCycles: 0, registerTop: 0, memoryAddress: 0,
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
	private readonly tableLookupResult: TableLookupResult = {
		value: valueNil(), slot: -1, extraVisits: 0, status: TableLookupStatus.Resolved, receiver: 0,
	};

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
		romBacked: false,
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
	private readonly latchedCallEntry: Closure.FunctionEntry = { codeAddress: 0, numParams: 0, maxStack: 0, flags: 0 };
	private readonly canonicalBinding: FunctionPrototype = { functionAddress: 0, codeAddress: 0, numParams: 0, maxStack: 0, flags: 0, upvalueTableAddress: 0, recordUpvalueCount: 0, executionDomainId: SYSTEM_EXECUTION_DOMAIN_ID };
	private readonly staticClosures = new StaticClosureIndex();
	private stringIndexTable: Value = valueNil();
	private readonly systemGlobalBank: GlobalBank;
	private readonly globalBank: GlobalBank;
	private completionValueSlots = new ValueSlots(8);
	private completionValueCount = 0;
	private readonly luaFaultErrorStringIds: StringId[] = [];
	private readonly errorInErrorHandlingStringId: StringId;

	constructor(
		memory: Memory,
		private readonly irqController: IrqController,
		private readonly executionAddressSpace: ExecutionAddressSpace,
		// The interpreter is the default: on BMSX's high-level opcodes the
		// generated JavaScript costs more time, memory and warm-up than it saves.
		private readonly executionBackend = CpuExecutionBackend.Interpreter,
	) {
		this.memory = memory;
		this.cop0Words[COP0_STATUS] = CPU_STATUS_CART_ENTRY;
		this.heapAllocator = new HeapAllocator(memory);
		this.luaHeap = new LuaHeap(this);
		this.newTableArgs = [this.heapAllocator.allocatorStateOffset(), this.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET,
			this.luaHeap.occupiedOffset, 0, 0, 0, 0, 0];
		this.stringPool = new StringPool(this.luaHeap, this.memory, this.heapAllocator);
		this.indexKey = this.stringPool.intern('__index');
		const newIndexKey = this.stringPool.intern('__newindex');
		this.lengthKey = this.stringPool.intern('__len');
		this.modeKey = this.stringPool.intern('__mode');
		this.gc = new GcHeap(this, this.luaHeap, memory, this.heapAllocator, this.modeKey, newIndexKey);
		this.heapService = new HeapService(this.gc);
		this.systemGlobalBank = new GlobalBank(memory, this.gc);
		this.globalBank = new GlobalBank(memory, this.gc);
		this.errorInErrorHandlingStringId = this.stringPool.intern('error in error handling');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_UNKNOWN] = this.stringPool.intern('Attempted to get length of an unsupported value.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_CALL_NON_FUNCTION] = this.stringPool.intern('Attempted to call a non-function value.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_INDEX_NON_TABLE] = this.stringPool.intern('Attempted to index field on a non-table value.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_ASSIGN_NON_TABLE] = this.stringPool.intern('Attempted to assign to a non-table value.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_INDEX_NIL] = this.stringPool.intern('Table index is nil.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_METATABLE_LOOP] = this.stringPool.intern('Metatable index chain too long.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_ITERATE_NON_TABLE] = this.stringPool.intern('Attempted to iterate a non-table value.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION] = this.stringPool.intern('xpcall error handler must be a function.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_OUT_OF_MEMORY] = this.stringPool.intern('Out of memory.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_INVALID_ARGUMENT] = this.stringPool.intern('Invalid argument.');
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_INVALID_NEXT_KEY] = this.stringPool.intern("invalid key to 'next'");
		this.luaFaultErrorStringIds[LUA_FAULT_REASON_INDEX_NAN] = this.stringPool.intern('Table index is NaN.');
		// CPU reset keeps the boot-interned records; checkpoints restore these lanes with RAM.
		const management = this.heapAllocator.managementOffset();
		const remark = management + HEAP_SERVICE_REMARK_HEAD_OFFSET, faults = management + HEAP_SERVICE_REMARK_FAULTS_OFFSET;
		memory.writeRamRecordWord(remark + HeapServiceRemarkHeadField.Mode, this.modeKey);
		memory.writeRamRecordPair(remark + HeapServiceRemarkHeadField.Index, this.indexKey, newIndexKey);
		memory.writeRamRecordPair(remark + HeapServiceRemarkHeadField.Length, this.lengthKey, this.errorInErrorHandlingStringId);
		memory.writeRamRecordWord(remark + HeapServiceRemarkHeadField.FaultIds, RAM_BASE + faults);
		for (let reason = 0; reason < this.luaFaultErrorStringIds.length; ++reason) {
			const id = reason === LUA_FAULT_REASON_EXPLICIT_ERROR ? 0 : this.luaFaultErrorStringIds[reason];
			memory.writeRamRecordWord(faults + reason * 4, id);
		}
		this.rootThread = new Thread(this.gc);
		this.threadBanks = [this.rootThread, new Thread(this.gc), new Thread(this.gc)];
		this.rootThread.bindAddress(this.createThread(0));
		this.rootThread.bindStack();
		this.rootThread.status = ThreadStatus.Running;
		this.activeThread = this.rootThread;
		this.completionThread = this.rootThread.address;
		this.memory.attachMappedPageInvalidator(this);
	}

	public createTable(arraySize: number = 0, hashSize: number = 0): number {
		return this.allocateTable(arraySize, hashSize, LuaAllocationMode.Direct);
	}

	private allocateTable(arraySize: number, hashSize: number, mode: LuaAllocationMode): number {
		const hashCapacity = TableRecords.hashCapacity(hashSize);
		const address = this.luaHeap.allocateRecord(TableRecords.HEADER_BYTES, true, 5 * arraySize,
			TableHeader.ArrayStorage, valueNil(), valueNil(), valueNil(), TableRecords.HEADER_CHARGE + TableRecords.allocationCharge(arraySize, hashCapacity), mode, TableRecords.hashStorageBytes(hashCapacity), TableHeader.HashStorage);
		if (address === 0) return 0;
		this.gc.tables.initialize(address, arraySize, hashCapacity);
		this.gc.publishObject(address);
		if (this.localRootScopeDepth > 0) this.localRoots.push(valueTable(address));
		return address;
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

	private findOpenUpvalue(frame: CallFrame, index: number): number {
		const slot = (frame.stackBase + index) >>> 0;
		let address = frame.openUpvalueHead;
		for (let remaining = UPVALUE_CHAIN_LIMIT; address !== 0 && remaining !== 0; --remaining) {
			const cell = this.gc.openCellAddress(address);
			if (cell === 0) break;
			const current = this.memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD);
			if (current <= slot) return current === slot ? cell : 0;
			address = this.memory.readRamRecordWord(cell + UPVALUE_NEXT);
		}
		return 0;
	}

	private linkOpenUpvalue(frame: CallFrame, cell: number, slot: number): void {
		let previous = 0;
		let next = frame.openUpvalueHead;
		for (let remaining = UPVALUE_CHAIN_LIMIT; next !== 0 && remaining !== 0; --remaining) {
			const current = this.gc.openCellAddress(next);
			if (current === 0 || this.memory.readRamRecordWord(current + UPVALUE_VALUE_WORD) <= slot) break;
			previous = current;
			next = this.memory.readRamRecordWord(current + UPVALUE_NEXT);
		}
		Upvalue.bindOpen(this.memory, cell, frame.thread.address, slot, next);
		if (previous === 0) frame.openUpvalueHead = cell;
		else this.memory.writeRamRecordWord(previous + UPVALUE_NEXT, cell);
	}

	private tableIndexAddress(base: Value): number {
		switch (valueTag(base)) {
			case ValueTag.Table: return valuePayload(base);
			case ValueTag.String:
				if (!isNil(this.stringIndexTable)) return valuePayload(this.stringIndexTable);
				break;
		}
		throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
	}
	private finishTableRead(frame: CallFrame, destination: number, base: Value, key: Value, result: TableLookupResult): boolean {
		let remaining = TABLE_INDEX_CHAIN_LIMIT;
		while (result.status === TableLookupStatus.Forward) {
			this.charge(result.extraVisits * TABLE_INDEX_VISIT_CYCLES);
			remaining -= result.extraVisits + 1;
			base = result.value;
			const record = this.tableIndexAddress(base);
			if (remaining === 0) throw new LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
			this.charge(TABLE_INDEX_VISIT_CYCLES);
			this.instructionBudgetRemaining -= this.gc.tables.resolveIndex(record, this.indexKey, key, result, remaining);
		}
		this.instructionBudgetRemaining -= result.extraVisits * TABLE_INDEX_VISIT_CYCLES;
		if (result.status === TableLookupStatus.ChainExhausted) throw new LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
		if (result.status === TableLookupStatus.Resolved) {
			frame.registers.set(destination, result.value);
			this.bumpRegisterTop(frame, destination);
			return false;
		}
		// A forwarded lookup passes the reached table. The String-index table
		// is an implementation of the initial String receiver, not its value.
		const receiver = result.extraVisits === 0 ? base : valueTable(result.receiver);
		this.invokeTableMetamethod(frame, result.value, destination, SINGLE_CALL_RESULT, receiver, key);
		return true;
	}
	private invokeTableMetamethod(frame: CallFrame, method: Value, destination: number, result: number,
		receiver: Value, operand: Value, assignment?: Value): void {
		const args = this.acquireRegisterBuiltinArgs();
		const rootBase = this.localRoots.length;
		this.localRoots.push(method, receiver, operand);
		if (assignment !== undefined) this.localRoots.push(assignment);
		args.bindDetached(receiver, operand, assignment);
		try {
			switch (valueTag(method)) {
				case ValueTag.Closure: {
					const closure = this.gc.closureRecordAddress(valuePayload(method));
					if (closure === 0) throw new LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
					this.pushFrame(closure, args.registers, destination, result, false, false, this.currentInstructionPc, 0, args.length);
					break;
				}
				case ValueTag.BuiltinFunction:
					this.runBuiltinFunction(valuePayload(method), frame, destination, result, args.length, args.registers, 0);
					break;
				default: throw new LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
			}
		} finally {
			this.localRoots.length = rootBase;
			this.releaseRegisterBuiltinArgs(args);
		}
	}
	private loadTableIndex(base: Value, key: Value, frame: CallFrame, targetIndex: number): boolean {
		const result = this.tableLookupResult;
		this.instructionBudgetRemaining -= this.gc.tables.resolveIndex(this.tableIndexAddress(base), this.indexKey, key, result);
		return this.finishTableRead(frame, targetIndex, base, key, result);
	}
	private resolveTableFieldIndexCached(base: Value, page: DecodedInstructionPage, pageOffset: number, key: StringId): TableLookupResult {
		const result = this.tableLookupResult;
		this.instructionBudgetRemaining -= this.gc.tables.resolveStringIndexCached(this.tableIndexAddress(base), this.indexKey, key, page.tableCacheSlots[pageOffset], result);
		if (result.extraVisits === 0 && result.slot >= 0) page.tableCacheSlots[pageOffset] = result.slot;
		return result;
	}
	private storeTableIndex(frame: CallFrame, base: Value, key: Value, value: Value): boolean {
		if (valueTag(base) !== ValueTag.Table) throw new LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
		const tables = this.gc.tables;
		let receiver = valuePayload(base);
		if (tables.metatableAddress(receiver) !== 0) {
			const assignment = this.tableLookupResult;
			tables.resolveAssignment(receiver, key, assignment);
			if (this.finishTableAssignment(frame, key, value, assignment)) return true;
			receiver = assignment.receiver;
		}
		if (this.runKind === CpuRunKind.Scheduled) {
			if (tables.assignScheduled(receiver, key, value, this) === HASH_STORE_DECLINED)
				return this.parkTableWrite(frame, receiver, key, value, 0);
		} else tables.set(receiver, key, value, this);
		return false;
	}
	public allocationParked(): boolean { return this.pendingAllocation !== null; }

	private retireNewTable(frame: CallFrame, destination: number, address: number): void {
		frame.registers.setTable(destination, address);
		this.bumpRegisterTop(frame, destination);
	}

	private executeNewTable(frame: CallFrame, destination: number, arraySize: number, hashSize: number): boolean {
		const scheduled = this.runKind === CpuRunKind.Scheduled;
		if (this.systemImage.heapServiceFunctions !== null) {
			const stage = scheduled ? HeapServiceNewtStage.Scheduled : HeapServiceNewtStage.Direct;
			if (this.beginNewTableReservation(frame, destination, arraySize, hashSize, stage, frame.pc)) {
				this.requestYield();
				return true;
			}
		} else {
			const address = this.allocateTable(arraySize, hashSize, scheduled ? LuaAllocationMode.Scheduled : LuaAllocationMode.Direct);
			if (address !== 0) {
				this.retireNewTable(frame, destination, address);
				return true;
			}
		}
		this.parkAllocation(frame, { kind: PendingAllocationKind.TableCreation, destination, arraySize, hashSize });
		return false;
	}

	private beginNewTableReservation(frame: CallFrame, destination: number, arraySize: number, hashSize: number,
		stage: HeapServiceNewtStage, nextPc: number): boolean {
		const mode = stage === HeapServiceNewtStage.Direct ? LuaAllocationMode.Direct
			: stage === HeapServiceNewtStage.Scheduled ? LuaAllocationMode.Scheduled : LuaAllocationMode.Retry;
		const hashCapacity = TableRecords.hashCapacity(hashSize);
		const arrayBytes = 5 * arraySize, hashBytes = TableRecords.hashStorageBytes(hashCapacity);
		const charged = TableRecords.HEADER_CHARGE + TableRecords.allocationCharge(arraySize, hashCapacity);
		const recovery = this.luaHeap.admitRecordAllocation(charged, TableRecords.HEADER_BYTES + GC_OBJECT_PREFIX + arrayBytes + hashBytes, mode);
		if (recovery === null) return false;
		const base = this.heapService.newTableAddress, memory = this.memory;
		memory.writeRamRecordWord(base + HeapServiceNewtField.Destination, destination);
		memory.writeRamRecordWord(base + HeapServiceNewtField.ArraySize, arraySize);
		memory.writeRamRecordWord(base + HeapServiceNewtField.HashSize, hashSize);
		memory.writeRamRecordWord(base + HeapServiceNewtField.InstructionPc, this.currentInstructionPc);
		memory.writeRamRecordWord(base + HeapServiceNewtField.LastPc, this.lastPc);
		memory.writeRamRecordWord(base + HeapServiceNewtField.NextPc, nextPc);
		memory.writeRamRecordWord(base + HeapServiceNewtField.DirectRecovery, recovery);
		memory.writeRamRecordWord(base + HeapServiceNewtField.Stage, stage);
		frame.pc = this.currentInstructionPc;
		this.startNewTableReservation(arraySize, hashCapacity, arrayBytes, hashBytes, charged);
		return true;
	}

	private startNewTableReservation(array: number, hash: number, arrayBytes: number, hashBytes: number, charged: number): void {
		const args = this.newTableArgs;
		args[3] = array;
		args[4] = hash;
		args[5] = arrayBytes;
		args[6] = hashBytes;
		args[7] = charged;
		this.beginHeapService(this.systemImage.heapServiceFunctions![HeapServiceOperation.CreateTable], args);
	}

	private finishNewTableReservation(): void {
		const base = this.heapService.newTableAddress, memory = this.memory;
		const stage = memory.readRamRecordWord(base + HeapServiceNewtField.Stage);
		if (stage === HeapServiceNewtStage.Idle) return;
		const destination = memory.readRamRecordWord(base + HeapServiceNewtField.Destination);
		const nextPc = memory.readRamRecordWord(base + HeapServiceNewtField.NextPc);
		this.currentInstructionPc = memory.readRamRecordWord(base + HeapServiceNewtField.InstructionPc);
		this.lastPc = memory.readRamRecordWord(base + HeapServiceNewtField.LastPc);
		this.lastExecutionDomainId = this.activeExecutionDomainId;
		const frame = this.activeThread.currentFrame!;
		memory.writeRamRecordWord(base + HeapServiceNewtField.Stage, HeapServiceNewtStage.Idle);
		const offset = this.heapServiceResult();
		if (offset !== 0) {
			const address = RAM_BASE + offset;
			if (this.localRootScopeDepth > 0) this.localRoots.push(valueTable(address));
			this.retireNewTable(frame, destination, address);
			frame.pc = nextPc;
			return;
		}
		const arraySize = memory.readRamRecordWord(base + HeapServiceNewtField.ArraySize);
		const hashSize = memory.readRamRecordWord(base + HeapServiceNewtField.HashSize);
		if (stage === HeapServiceNewtStage.Direct) {
			// The BIOS has released every partial reservation, so the
			// existing direct collector retry can now inspect the arena.
			const recoveryAddress = base + HeapServiceNewtField.DirectRecovery;
			const recovery = this.gc.recoverAllocation(memory.readRamRecordWord(recoveryAddress) as LuaAllocationRecovery);
			memory.writeRamRecordWord(recoveryAddress, recovery);
			memory.writeRamRecordWord(base + HeapServiceNewtField.Stage, stage);
			const hashCapacity = TableRecords.hashCapacity(hashSize);
			this.startNewTableReservation(arraySize, hashCapacity, 5 * arraySize, TableRecords.hashStorageBytes(hashCapacity),
				TableRecords.HEADER_CHARGE + TableRecords.allocationCharge(arraySize, hashCapacity));
			return;
		}
		if (stage === HeapServiceNewtStage.RetryFresh) throw LUA_OUT_OF_MEMORY_SIGNAL;
		if (stage === HeapServiceNewtStage.RetryCurrent) {
			this.pendingAllocation = {
				recovery: AllocationRecovery.Fresh, instructionPc: this.currentInstructionPc, lastPc: this.lastPc, nextPc,
				kind: PendingAllocationKind.TableCreation, destination, arraySize, hashSize,
			};
			return;
		}
		frame.pc = nextPc;
		this.parkAllocation(frame, { kind: PendingAllocationKind.TableCreation, destination, arraySize, hashSize });
	}

	private markPendingAllocationRoots(heap: GcHeap, pending: PendingAllocation): void {
		if (pending.kind !== PendingAllocationKind.TableAssignment) return;
		heap.markValue(valueTable(pending.receiver));
		heap.markValue(pending.key);
		heap.markValue(pending.value);
	}

	private parkTableWrite(frame: CallFrame, receiver: number, key: Value, value: Value, extraHashSlots: number): boolean {
		this.parkAllocation(frame, { kind: PendingAllocationKind.TableAssignment, receiver, key: canonicalTableKey(key), value, extraHashSlots });
		return true;
	}

	private parkAllocation(frame: CallFrame, operands: PendingAllocationOperands): void {
		this.pendingAllocation = {
			recovery: this.gc.active() ? AllocationRecovery.Current : AllocationRecovery.Fresh,
			instructionPc: this.currentInstructionPc, lastPc: this.lastPc, nextPc: frame.pc,
			...operands,
		};
		frame.pc = this.currentInstructionPc;
		// The final root head visits parked operands after detaching the
		// changed queue and before clearing weak references.
	}

	public allocationReady(): boolean {
		const recovery = this.pendingAllocation?.recovery;
		return recovery === AllocationRecovery.RetryCurrent || recovery === AllocationRecovery.RetryFresh;
	}

	public advanceAllocationRecovery(): boolean {
		const recovery = this.pendingAllocation!.recovery;
		if (recovery === AllocationRecovery.RetryCurrent || recovery === AllocationRecovery.RetryFresh) return false;
		if (this.gc.finalMarkPending()) this.advanceFinalMark();
		else {
			this.gc.step(valueNil(), valueNil(), valueNil(), 0, false, GC_STEP_WORDS,
				HeapServiceGcStage.AllocationRecoveryStringSweep, this.systemImage.heapServiceFunctions);
		}
		this.finishAllocationRecovery();
		return true;
	}

	public advanceFinalMark(): void {
		this.gc.stepFinalMark(GC_STEP_WORDS, HeapServiceGcStage.MaintenanceTrace, this.systemImage.heapServiceFunctions);
	}

	public admitPhysicalPressureAtTick(): void {
		this.gc.assistPhysicalPressureAtTick(this.systemImage.heapServiceFunctions);
	}

	private finishAllocationRecovery(): void {
		if (this.gc.active()) return;
		const write = this.pendingAllocation!;
		write.recovery = write.recovery === AllocationRecovery.Current
			? AllocationRecovery.RetryCurrent : AllocationRecovery.RetryFresh;
	}

	public resumeAllocation(): void {
		const pending = this.pendingAllocation!;
		const frame = this.activeThread.currentFrame!;
		this.currentInstructionPc = pending.instructionPc;
		this.lastPc = pending.lastPc;
		this.lastExecutionDomainId = this.activeExecutionDomainId;
		let retired: boolean;
		if (pending.kind === PendingAllocationKind.TableAssignment) {
			retired = this.gc.tables.resumeAssignment(pending.receiver, pending.key, pending.value, pending.extraHashSlots, this);
			if (this.tableRebuild.census === TableCensus.RetryCurrent && pending.recovery === AllocationRecovery.RetryFresh)
				this.tableRebuild.census = TableCensus.RetryFresh;
		} else {
			if (this.systemImage.heapServiceFunctions !== null) {
				const stage = pending.recovery === AllocationRecovery.RetryCurrent ? HeapServiceNewtStage.RetryCurrent : HeapServiceNewtStage.RetryFresh;
				if (this.beginNewTableReservation(frame, pending.destination, pending.arraySize, pending.hashSize, stage, pending.nextPc)) {
					this.pendingAllocation = null;
					return;
				}
				retired = false;
			} else {
				const address = this.allocateTable(pending.arraySize, pending.hashSize, LuaAllocationMode.Retry);
				retired = address !== 0;
				if (retired) this.retireNewTable(frame, pending.destination, address);
			}
		}
		if (retired) {
			frame.pc = pending.nextPc;
			this.pendingAllocation = null;
			return;
		}
		if (pending.recovery === AllocationRecovery.RetryCurrent) {
			pending.recovery = AllocationRecovery.Fresh;
			return;
		}
		this.pendingAllocation = null;
		const value = valueString(this.luaFaultErrorStringIds[LUA_FAULT_REASON_OUT_OF_MEMORY]);
		if (!this.handleThreadError(value)) this.enterLuaFaultException(LUA_FAULT_REASON_OUT_OF_MEMORY, value);
	}

	private finishTableAssignment(frame: CallFrame, key: Value, value: Value, assignment: TableLookupResult): boolean {
		this.charge(assignment.extraVisits * TABLE_INDEX_VISIT_CYCLES);
		if (assignment.status === TableLookupStatus.Store) return false;
		if (assignment.status === TableLookupStatus.ChainExhausted) throw new LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
		if (assignment.status === TableLookupStatus.Forward) throw new LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
		this.invokeTableMetamethod(frame, assignment.value, 0, DISCARD_CALL_RESULT, valueTable(assignment.receiver), key, value);
		return true;
	}
	private storeTableFieldIndexCached(frame: CallFrame, base: Value, page: DecodedInstructionPage, pageOffset: number, key: StringId, value: Value): boolean {
		if (valueTag(base) !== ValueTag.Table) throw new LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
		const tables = this.gc.tables, record = valuePayload(base);
		const tag = valueTag(value), word = valuePayload(value);
		if (tables.storePredictedStringKey(record, key, page.tableCacheSlots[pageOffset], tag, word)) return false;
		const assignment = this.tableLookupResult, field = valueString(key);
		tables.resolveAssignment(record, field, assignment, true);
		if (this.finishTableAssignment(frame, field, value, assignment)) return true;
		const extraHashSlots = assignment.extraVisits === 0 ? page.operandByte[pageOffset] : 0;
		const slot = this.runKind === CpuRunKind.Scheduled
			? tables.assignScheduled(assignment.receiver, field, value, this, assignment.slot, extraHashSlots)
			: tables.storeStringKey(assignment.receiver, key, tag, word, assignment.slot, extraHashSlots, this);
		if (slot === HASH_STORE_DECLINED) return this.parkTableWrite(frame, assignment.receiver, field, value, extraHashSlots);
		if (assignment.extraVisits === 0) page.tableCacheSlots[pageOffset] = slot;
		return false;
	}
	private executeLength(frame: CallFrame, destination: number, source: number): boolean {
		const registers = frame.registers;
		switch (registers.getTag(source)) {
			case ValueTag.String:
				this.setRegisterIntegerFast(frame, registers, destination, this.stringPool.byteLength(registers.getStringId(source)));
				return false;
			case ValueTag.Table: {
				const record = registers.getPayload(source);
				const method = this.gc.tables.metafield(record, this.lengthKey);
				if (!isNil(method)) {
					const operand = valueTable(record);
					this.invokeTableMetamethod(frame, method, destination, SINGLE_CALL_RESULT, operand, operand);
					return true;
				}
				const boundary = this.gc.tables.length(record);
				this.setRegisterIntegerFast(frame, registers, destination, boundary);
				return false;
			}
			default: throw new LuaExecutionError(LUA_FAULT_REASON_UNKNOWN);
		}
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
			thread.entry = 0;
			thread.error = valueNil();
			if (thread === this.rootThread) break;
			const resumer = thread.resumer;
			thread.resumer = 0;
			this.activeThread = resumer === 0 ? this.rootThread : this.bindThread(resumer);
		}
		this.rootThread.status = ThreadStatus.Running;
		this.completionThread = this.rootThread.address;
		this.threadSwitchRequested = false;
	}

	public reset(): void {
		if (this.heapServiceActive()) throw new Error('Heap service must retire before CPU reset.');
		this.compiledCodeCache.retireAll();
		const systemBoot = this.executionAddressSpace.resolveSystemDomain();
		const systemResetFunctionAddress = systemBoot.startupFunctionAddress;
		const job = this.tableRebuild;
		if (job.record && job.arrayStorage && job.arrayStorage === this.gc.tables.arrayAddress(job.record)) {
			if (job.arraySlots < this.gc.tables.arrayCapacity(job.record) && !job.arrayCleared) job.arrayStorage = 0;
			else this.gc.tables.advanceRebuild(job, 0x7fffffff);
		}
		this.clearCompletionValues();
		this.clearCallStack();
		for (let index = 1; index < this.threadBanks.length; ++index) this.threadBanks[index].bindAddress(0);
		this.stringIndexTable = valueNil();
		this.haltedUntilIrqFrameDepth = -1;
		this.haltedUntilIrqThread = 0;
		this.interruptEventPending = false;
		this.memoryWriteBlocked = false;
		this.memoryWriteBlockedAddress = 0;
		this.pendingMemory.kind = PendingMemoryKind.None;
		this.stringComparison = new StringComparisonLatch();
		if (this.tableRebuild.record) {
			if (this.tableRebuild.storage) this.heapAllocator.free(this.tableRebuild.storage);
			if (this.tableRebuild.arrayStorage) this.heapAllocator.free(this.tableRebuild.arrayStorage);
		}
		this.tableRebuild.record = 0;
		this.concat.registersLeft = this.concat.length = 0;
		this.pendingAllocation = null;
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
		this.staticClosures.clear();
		this.memory.clearMappedPageWriteWatches();
		if (!this.setProgramHeapFloor(systemBoot.staticEnd)) { this.hardHalt(); return; }
		for (const image of this.executionImagesByDomain) if (image !== null) this.releaseImageData(image);
		this.executionImagesByDomain.fill(null);
		this.unpublishedRomMask = 0;
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
		this.systemGlobalBank.clear();
		this.globalBank.clear();
	}


	private decodeConstantPool(
		executionDomainId: ExecutionDomainId,
		tableAddress: number,
		constTags: Uint8Array,
		constWords: Uint32Array,
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
					constWords[index] = 0;
					break;
				case Blua32ConstantTag.False:
					constTags[index] = ValueTag.False;
					constWords[index] = 0;
					break;
				case Blua32ConstantTag.True:
					constTags[index] = ValueTag.True;
					constWords[index] = 0;
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
					);
					break;
				default:
					throw new Error('BLua32 constant tag is invalid.');
			}
		}
	}

	private releaseImageData(image: Blua32ExecutionImage): void {
		for (const bank of this.threadBanks) bank.dropParkedFrameViews();
		const names = image.globalMapBase, constants = image.constantBase;
		if (names !== 0) {
			image.globalMapBase = 0;
			this.luaHeap.releaseRecord(names, 4 * (image.globalNameCount + image.systemNameCount));
		}
		if (constants !== 0) {
			image.constantBase = 0;
			this.luaHeap.releaseRecord(constants, 5 * image.constTags.length);
		}
	}

	private registerGlobalNames(domain: ExecutionDomainId, tableAddress: number, nameCount: number, bank: GlobalBank, destination: number): void {
		if (nameCount === 0) return;
		this.executionAddressSpace.bindReadOnlyView(domain, tableAddress,
			nameCount * BLUA32_GLOBAL_NAME_RECORD_SIZE, this.executionTableView);
		const { bytes, byteOffset } = this.executionTableView;
		for (let index = 0; index < nameCount; ++index) {
			const record = byteOffset + index * BLUA32_GLOBAL_NAME_RECORD_SIZE;
			const key = this.stringPool.resolveImageRecord(domain, readLE32(bytes, record + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET));
			this.memory.writeRamRecordWord(destination + 4 * index, bank.registerName(key));
		}
	}

	private readExecutionImageHeader(executionBoot: Blua32ExecutionBoot) {
		this.executionAddressSpace.bindReadOnlyView(
			executionBoot.executionDomainId,
			executionBoot.imageAddress,
			BLUA32_IMAGE_HEADER_SIZE,
			this.executionReadView,
		);
		const { bytes, byteOffset } = this.executionReadView;
		if (readLE32(bytes, byteOffset + BLUA32_IMAGE_MAGIC_OFFSET) !== BLUA32_IMAGE_MAGIC) {
			throw new Error('BLua32 image magic is invalid.');
		}
		const constantCount = readLE32(bytes, byteOffset + BLUA32_IMAGE_CONSTANT_COUNT_OFFSET);
		const globalNameCount = readLE32(bytes, byteOffset + BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET);
		const systemGlobalNameCount = readLE32(bytes, byteOffset + BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET);
		if (constantCount > MAIN_RAM_SIZE / 5 || globalNameCount + systemGlobalNameCount > MAIN_RAM_SIZE / 4) {
			throw new Error('BLua32 image bank extents exceed main RAM.');
		}
		const romFunctions = readRomFunctionDirectory(this.memory, executionBoot.executionDomainId, this.executionReadView);
		let heapServiceFunctions: Uint32Array | null = null;
		if ((readLE32(bytes, byteOffset + BLUA32_IMAGE_FLAGS_OFFSET) & HEAP_SERVICE_IMAGE_FLAG) !== 0) {
			if (executionBoot.executionDomainId !== SYSTEM_EXECUTION_DOMAIN_ID || romFunctions.mappedCode
				|| readLE32(bytes, byteOffset + BLUA32_IMAGE_BYTE_COUNT_OFFSET) < HEAP_SERVICE_IMAGE_HEADER_SIZE)
				throw new Error('Heap service requires an extended linked System ROM image.');
			this.executionAddressSpace.bindReadOnlyView(SYSTEM_EXECUTION_DOMAIN_ID, executionBoot.imageAddress,
				HEAP_SERVICE_IMAGE_HEADER_SIZE, this.executionTableView);
			const extended = this.executionTableView;
			const address = readLE32(extended.bytes, extended.byteOffset + HEAP_SERVICE_IMAGE_ADDRESS_OFFSET);
			const rodata = readLE32(bytes, byteOffset + BLUA32_IMAGE_RODATA_ADDRESS_OFFSET);
			const rodataEnd = rodata + readLE32(bytes, byteOffset + BLUA32_IMAGE_RODATA_BYTE_COUNT_OFFSET);
			if ((address & 3) !== 0 || address < rodata || address + HEAP_SERVICE_DESCRIPTOR_SIZE > rodataEnd
				|| address + HEAP_SERVICE_DESCRIPTOR_SIZE > SYSTEM_ROM_SIZE)
				throw new Error('Heap service descriptor is outside immutable system RODATA.');
			this.executionAddressSpace.bindReadOnlyView(SYSTEM_EXECUTION_DOMAIN_ID, address,
				HEAP_SERVICE_DESCRIPTOR_SIZE, this.executionTableView);
			const descriptor = this.executionTableView.bytes, offset = this.executionTableView.byteOffset;
			const values = readLE32(descriptor, offset + HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET);
			const frames = readLE32(descriptor, offset + HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET);
			if (values === 0 || values > HEAP_SERVICE_VALUE_COUNT || frames === 0 || frames > HEAP_SERVICE_FRAME_COUNT)
				throw new Error('Heap service descriptor does not fit the private CPU stack.');
			const functions = offset + HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET;
			const versions = romFunctions.versions;
			heapServiceFunctions = new Uint32Array(HeapServiceOperation.Count);
			for (let index = 0; index < HeapServiceOperation.Count; ++index) {
				const record = readLE32(descriptor, functions + 4 * index);
				const lane = romFunctionVersionLane(romFunctions, record);
				if (lane < 0 || versions[lane + RomFunctionLane.UpvalueCount] !== 0
					|| Math.max(1, versions[lane + RomFunctionLane.NumParams], versions[lane + RomFunctionLane.MaxStack]) > values
					|| (versions[lane + RomFunctionLane.Flags] & (BLUA32_FUNCTION_STATIC | BLUA32_FUNCTION_VARARG)) !== BLUA32_FUNCTION_STATIC)
					throw new Error('Heap service descriptor does not name a fixed System ROM activation.');
				heapServiceFunctions[index] = record;
			}
		}
		return {
			constantTableAddress: readLE32(bytes, byteOffset + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET),
			constantCount,
			globalNameTableAddress: readLE32(bytes, byteOffset + BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET),
			globalNameCount,
			systemGlobalNameTableAddress: readLE32(bytes, byteOffset + BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET),
			systemGlobalNameCount,
			stringBucketAddress: readLE32(bytes, byteOffset + BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET),
			stringBucketCount: readLE32(bytes, byteOffset + BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET),
			romFunctions, heapServiceFunctions,
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
		restoredConstantBase: number | null = null,
		restoredMapBase = 0,
	): Blua32ExecutionImage {
		const executionDomainId = executionBoot.executionDomainId;
		const { constantTableAddress, constantCount, globalNameTableAddress, globalNameCount,
			systemGlobalNameTableAddress, systemGlobalNameCount } = header;
		const restoring = restoredConstantBase !== null;
		const mapBytes = 4 * (globalNameCount + systemGlobalNameCount);
		const globalMapBase = restoring ? restoredMapBase : mapBytes === 0 ? 0
			: this.luaHeap.allocateRecord(mapBytes, false, 0, 0);
		if (mapBytes !== 0) {
			if (!restoring) {
				this.registerGlobalNames(executionDomainId, globalNameTableAddress, globalNameCount, this.globalBank, globalMapBase);
				this.registerGlobalNames(executionDomainId, systemGlobalNameTableAddress, systemGlobalNameCount,
					this.systemGlobalBank, globalMapBase + 4 * globalNameCount);
			}
		}
		const constantBase = restoring ? restoredConstantBase : constantCount === 0 ? 0
			: this.luaHeap.allocateRecord(constantCount * 5, false, 0, 0);
		const offset = constantBase & RAM_RECORD_WORD_MASK;
		const buffer = this.memory.ramData().buffer;
		const constWords = new Uint32Array(buffer, offset, constantCount);
		const constTags = new Uint8Array(buffer, offset + constantCount * 4, constantCount);
		if (!restoring) {
			this.decodeConstantPool(executionDomainId, constantTableAddress, constTags, constWords);
			this.memory.invalidateRamWrite(offset, constantCount * 5);
		}
		const constantStringRoots: StringId[] = [];
		for (let slot = 0; slot < constantCount; ++slot) {
			if (constTags[slot] === ValueTag.String && isRamStringId(constWords[slot])) {
				constantStringRoots.push(constWords[slot]);
			}
		}
		const image: Blua32ExecutionImage = {
			executionDomainId,
			irqFunctionAddress: executionBoot.irqFunctionAddress,
			staticEnd: executionBoot.staticEnd,
			heapServiceFunctions: header.heapServiceFunctions,
			constantBase,
			constTags,
			constWords,
			constantStringRoots,
			globalMapBase, globalNameCount, systemNameCount: systemGlobalNameCount,
			romFunctions: header.romFunctions,
			romCallBindings: new RomCallBindings(),
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
			frame.compilationEntry = true;
		}
		this.latchActiveExecutionImage(domain, image);
	}

	private staticClosureFromLatch(): number {
		const record = this.functionRecordLatch;
		const closures = this.staticClosures.find(record.functionAddress);
		if (closures !== undefined) {
			let match = 0;
			for (const address of closures) {
				if ((match !== 0 && address >= match) || this.gc.sweepGarbage(address)) continue;
				this.readClosureBinding(address, this.memory.readRamRecordByte(address + CLOSURE_BINDING_FLAGS), this.canonicalBinding);
				if (sameFunctionPrototype(this.canonicalBinding, record)) match = address;
			}
			if (match !== 0) return match;
		}
		const latched = !record.romBacked;
		const address = this.luaHeap.allocateClosureRecord(0, latched);
		Closure.initializeRecord(this.memory, address, record, true, this.gc.white(), 0, latched);
		this.gc.publishObject(address);
		this.staticClosures.insert(record.functionAddress, address);
		return address;
	}

	/** Cold inspector/hot-resume snapshot. Execution uses the caller-owned latch. */
	public captureClosureBinding(address: number, record: FunctionPrototype = { functionAddress: 0, codeAddress: 0, numParams: 0, maxStack: 0, flags: 0, upvalueTableAddress: 0, recordUpvalueCount: 0, executionDomainId: SYSTEM_EXECUTION_DOMAIN_ID }): FunctionPrototype {
		this.readClosureBinding(address, this.memory.readRamRecordByte(address + CLOSURE_BINDING_FLAGS), record);
		return record;
	}
	private readClosureBinding(address: number, flags: number, target: FunctionPrototype): void {
		const image = this.executionImageForDomain(Closure.executionDomain(flags))!;
		Closure.readBinding(this.memory, address, flags, image.romFunctions, this.executionReadView, target);
	}
	public reindexCanonicalClosures(): void {
		this.staticClosures.clear();
		// Inventory does not advance a saved in-flight sweep.
		this.gc.visitObjectRecords(this, (cpu, address) => {
			const header = cpu.memory.readRamRecordWord(address);
			if ((header & 0xff) === ValueTag.Closure
				&& (header & (CLOSURE_CANONICAL << (8 * CLOSURE_BINDING_FLAGS))) !== 0
				&& !cpu.gc.sweepGarbage(address)) {
				const functionAddress = cpu.memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS);
				cpu.staticClosures.insert(functionAddress, address);
			}
		});
	}

	public replaceExecutionImages(executionBoots: readonly Blua32ExecutionBoot[], relocation?: ExecutionImageRelocation): void {
		if (executionBoots.length === 0) return;
		if (this.heapServiceActive()) throw new Error('Heap service must retire before replacing code execution.');
		const headers = executionBoots.map(boot => this.readExecutionImageHeader(boot));
		const replacements = new Array<Blua32ExecutionImage['romFunctions'] | null>(EXECUTION_DOMAIN_COUNT).fill(null);
		for (let i = 0; i < executionBoots.length; ++i)
			replacements[executionBoots[i].executionDomainId + 1] = headers[i].romFunctions;
		// The guest can retain a closure or activation without any host
		// frame view. Admit these against the new catalogs before bank writes.
		this.visitReachableExecutionRecords(address => {
			const flags = this.memory.readRamRecordByte(address + CLOSURE_BINDING_FLAGS);
			if ((flags & Closure.CLOSURE_LATCHED_PROTOTYPE) !== 0) return;
			const bank = Closure.executionDomain(flags) + 1;
			const next = replacements[bank];
			const previous = this.executionImagesByDomain[bank]?.romFunctions;
			if (next === null || (next.mappedCode && previous?.mappedCode !== false)) return;
			if (next.mappedCode || previous?.mappedCode === true)
				throw new Error('Replacement image changes the addressing mode of a retained closure.');
			const record = this.memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS);
			const lane = romFunctionVersionLane(next, relocation?.closures.get(address) ?? record);
			const old = previous === undefined ? -1 : romFunctionVersionLane(previous, record);
			if (lane < 0 || (previous !== undefined && old >= 0
				&& previous.versions[old + RomFunctionLane.UpvalueCount] !== next.versions[lane + RomFunctionLane.UpvalueCount]))
				throw new Error('Replacement image does not preserve a retained closure binding.');
		}, (address, depth) => {
			for (let i = 0; i < depth; ++i) {
				const domain = this.readThreadFrameExecutionDomain(address, i);
				const next = replacements[domain + 1];
				const previous = this.executionImagesByDomain[domain + 1]?.romFunctions;
				if (next === null || (next.mappedCode && previous?.mappedCode !== false)) continue;
				if (next.mappedCode || previous?.mappedCode === true)
					throw new Error('Replacement image changes the addressing mode of a retained frame.');
				const target = address === this.activeThread.address ? relocation?.frames[i] : undefined;
				const record = this.readThreadFrameWord(address, i, FrameField.Function);
				const old = previous === undefined ? -1 : romFunctionVersionLane(previous, record);
				const pc = this.readThreadFrameWord(address, i, FrameField.Pc);
				const nextRecord = target?.functionAddress ?? record, nextPc = target?.pc ?? pc;
				const lane = romFunctionVersionLane(next, nextRecord);
				if ((old >= 0 && lane < 0) || !admitsFunctionPc(next, nextRecord, nextPc))
					throw new Error('Replacement image does not admit a retained frame continuation.');
				if (target == null && previous !== undefined && old >= 0) {
					for (const field of [RomFunctionLane.NumParams, RomFunctionLane.MaxStack, RomFunctionLane.Flags, RomFunctionLane.UpvalueCount]) {
						if (previous.versions[old + field] !== next.versions[lane + field])
							throw new Error('Replacement image does not preserve a retained frame layout.');
					}
				}
			}
		});
		const roots = this.acquireLocalRoots();
		if (relocation !== undefined)
			for (const closure of relocation.closures.keys()) this.localRoots.push(valueClosure(closure));
		try {
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
				this.unpublishedRomMask &= ~executionDomainBit(domain);
				if (domain === SYSTEM_EXECUTION_DOMAIN_ID) {
					this.systemImage = image;
					this.systemExceptionFunctionAddress = boot.exceptionFunctionAddress;
				}
				if (previous !== null) {
					for (const thread of this.threadBanks) {
						if (thread.address === 0) continue;
						for (let frame = thread.firstFrame; frame !== null; frame = frame.next) {
							if (frame.executionImage !== previous) continue;
							frame.executionImage = image;
							frame.decodedPage = null;
							frame.compilationEntry = true;
						}
					}
				}
				if (previous !== null) this.releaseImageData(previous);
				if (this.activeExecutionDomainId === domain) {
					this.latchActiveExecutionImage(domain, image);
					const frame = this.activeThread.currentFrame;
					if (frame !== null && frame.executionImage === null) frame.executionImage = image;
				}
			}
			if (relocation !== undefined) {
				for (const [closure, record] of relocation.closures)
					this.memory.writeRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS, record);
				if (relocation.closures.size !== 0) this.reindexCanonicalClosures();
				for (let i = 0; i < relocation.frames.length; ++i) {
					const target = relocation.frames[i];
					if (target !== null) this.writeFrameExecution(i, target.domain, target.functionAddress, target.pc);
				}
			}
		} finally {
			this.releaseLocalRoots(roots);
		}
	}

	public isExecutionDomainResident(executionDomainId: ExecutionDomainId): boolean {
		return this.executionImagesByDomain[executionDomainId + 1] !== null;
	}

	private decodedPageForAddress(
		image: Blua32ExecutionImage,
		address: number, key: number, slot: number,
	): DecodedInstructionPage {
		const existing = image.decodedPages.get(key);
		if (existing !== undefined) {
			return existing;
		}
		const binding = this.mappedPageBinding;
		this.memory.bindMappedPage(address, mappedBusSignalsForCartridgeSlot(slot) | MAPPED_BUS_INSTRUCTION_FETCH, binding);
		const page = createDecodedInstructionPage(binding);
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

	/** A borrowed execution/inspection bank; never retain it across a thread switch. */
	public bindThread(address: number): Thread {
		for (const bank of this.threadBanks) if (bank.address === address) return bank;
		const bank = this.threadBanks[1] !== this.activeThread ? this.threadBanks[1] : this.threadBanks[2];
		bank.bindAddress(address);
		this.bindPhysicalFrames(bank);
		return bank;
	}
	public rebindRelocatedThread(address: number): void {
		for (const bank of this.threadBanks) if (bank.address === address) bank.bindStack();
	}
	public retireThreadView(address: number): void {
		for (const bank of this.threadBanks) if (bank.address === address) bank.bindAddress(0);
	}
	public readThreadStatus(address: number): ThreadStatus { return this.memory.readRamRecordWord(address + ThreadField.Status); }
	public readThreadResumer(address: number): number {
		const resumer = this.memory.readRamRecordWord(address + ThreadField.Resumer);
		return resumer === 0 ? 0 : this.gc.threadRecordAddress(resumer);
	}
	public readThreadError(address: number): Value {
		return valueFromTag(this.memory.readRamRecordByte(address + ThreadField.ErrorKind), this.memory.readRamRecordWord(address + ThreadField.ErrorWord));
	}
	public readThreadFrameDepth(address: number): number { return this.memory.readRamRecordWord(address + ThreadField.FrameDepth) & THREAD_CONTROL_COUNT_MASK; }
	public readThreadFrameAddress(address: number, index: number): number {
		return (this.memory.readRamRecordWord(address + ThreadField.FrameBlock) & RAM_RECORD_WORD_MASK) + index * FRAME_CONTROL_BYTES;
	}
	public readThreadFrameWord(address: number, index: number, field: FrameField): number {
		return this.memory.readRamRecordWord(this.readThreadFrameAddress(address, index) + field);
	}
	public readThreadRegister(address: number, frameIndex: number, registerIndex: number): Value {
		const slot = (this.readThreadFrameWord(address, frameIndex, FrameField.StackBase) & FRAME_WINDOW_MASK) + registerIndex;
		const block = this.memory.readRamRecordWord(address + ThreadField.StackBlock) & RAM_RECORD_WORD_MASK;
		const capacity = this.memory.readRamRecordWord(address + ThreadField.StackCapacity);
		return valueFromTag(this.memory.readRamRecordByte(block + capacity * 4 + slot), this.memory.readRamRecordWord(block + slot * 4));
	}
	public readThreadFrameExecutionDomain(address: number, index: number): ExecutionDomainId {
		return frameExecutionBank(this.readThreadFrameWord(address, index, FrameField.Flags));
	}
	public bindPhysicalFrames(thread: Thread): void {
		thread.bindFrameViews();
		for (let frame = thread.currentFrame; frame !== null; frame = frame.previous)
			frame.executionImage = this.executionImagesByDomain[frame.savedExecutionBank + 1]!;
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
		const address = firstKey >>> 0, end = endKey >>> 0;
		if ((address === SYSTEM_ROM_BASE && end === SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE)
			|| (address === CART_ROM_BASE && end === CART_ROM_END)) {
			const resident = this.executionImagesByDomain[mappedPageDomainIndex(firstKey)];
			if (resident !== null && !resident.romFunctions.mappedCode)
				this.unpublishedRomMask |= executionDomainBit(resident.executionDomainId);
		}
		const invalidationStart = firstKey >= MAPPED_PAGE_BYTE_SIZE
			? firstKey - MAPPED_PAGE_BYTE_SIZE
			: 0;
		for (let imageIndex = 0; imageIndex < this.executionImagesByDomain.length; imageIndex += 1) {
			const image = this.executionImagesByDomain[imageIndex];
			if (image === null) {
				continue;
			}
			if (address < SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE || (address >= CART_ROM_BASE && address < CART_ROM_END))
				image.romCallBindings.invalidate();
			for (const [key, page] of image.decodedPages) {
				if (key >= invalidationStart && key < endKey) {
					this.compiledCodeCache.retirePage(page);
					this.memory.bindMappedPage(key >>> 0, mappedBusSignalsForCartridgeSlot(mappedPageDomainIndex(key) === 2 ? 1 : 0) | MAPPED_BUS_INSTRUCTION_FETCH, page);
					page.refreshState.fill(DECODED_REFRESH_DECODE);
				}
			}
		}
	}

	private decodedPageForFrame(frame: CallFrame, pc: number): DecodedInstructionPage {
		const pageAddress = (pc & ~MAPPED_PAGE_BYTE_MASK) >>> 0;
		const slot = this.memory.cartridgeController.selectedSlot(this.executionBusSignals);
		const key = mappedPageAddressKey(pageAddress, slot);
		const cached = frame.decodedPage;
		if (cached !== null && cached.key === key) {
			return cached;
		}
		const page = this.decodedPageForAddress(frame.executionImage, pageAddress, key, slot);
		frame.decodedPage = page;
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
		const image = frame.executionImage;
		let instructionCacheable = page.cacheable;
		let bodyPage: DecodedInstructionPage | null = null;
		let width = 1;
		let op: number;
		const faultSequence = this.memory.readBusFaultSequence();
		let wideA = 0;
		let wideB = 0;
		let wideC = 0;
		const sourceWord = page.readBytes !== null
			? readLE32(page.readBytes, page.readByteOffset + pageOffset * INSTRUCTION_BYTES)
			: this.memory.readMappedBusU32LE(pc, this.executionBusSignals | MAPPED_BUS_INSTRUCTION_FETCH);
		if (this.memory.readBusFaultSequence() !== faultSequence) {
			this.enterInstructionFetchException(frame, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, pc);
			return false;
		}
		let bodyWord = sourceWord;
		op = instructionOpcode(sourceWord);
		let ext = sourceWord >>> 24;
		if (op === OpCode.WIDE) {
			width = 2;
			if (pageOffset === DECODED_PAGE_WORDS - 1) {
				bodyPage = this.decodedPageForFrame(frame, (pc + INSTRUCTION_BYTES) >>> 0);
				instructionCacheable = instructionCacheable && bodyPage.cacheable;
			}
			wideA = (sourceWord >>> 12) & 0x3f;
			wideB = instructionLowB(sourceWord);
			wideC = sourceWord & 0x3f;
			const bodySource = bodyPage ?? page;
			const bodyPc = (pc + INSTRUCTION_BYTES) >>> 0;
			bodyWord = bodySource.readBytes !== null
				? readLE32(bodySource.readBytes, bodySource.readByteOffset + (bodyPc & MAPPED_PAGE_BYTE_MASK))
				: this.memory.readMappedBusU32LE(bodyPc, this.executionBusSignals | MAPPED_BUS_INSTRUCTION_FETCH);
			if (this.memory.readBusFaultSequence() !== faultSequence) {
				this.enterInstructionFetchException(frame, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, pc);
				return false;
			}
			op = instructionOpcode(bodyWord);
			ext = bodyWord >>> 24;
		}
		const unchanged = page.widths[pageOffset] !== 0
			&& page.sourceWords[pageOffset] === sourceWord
			&& page.bodyWords[pageOffset] === bodyWord
			&& page.widths[pageOffset] === width;
		if (!unchanged) {
			const aLow = (bodyWord >>> 12) & 0x3f;
			const bLow = instructionLowB(bodyWord);
			const cLow = bodyWord & 0x3f;
			page.widths[pageOffset] = width;
			page.sourceWords[pageOffset] = sourceWord;
			page.bodyWords[pageOffset] = bodyWord;
			page.ops[pageOffset] = op;
			if (OPCODE_USES_DISP[op] !== 0) {
				page.a[pageOffset] = (wideA << MAX_OPERAND_BITS) | aLow;
				page.b[pageOffset] = (wideB << MAX_OPERAND_BITS) | bLow;
				page.c[pageOffset] = (wideC << MAX_OPERAND_BITS) | cLow;
				page.operandByte[pageOffset] = ext;
				if (page.c[pageOffset] > MemoryAccessKind.F64LE
					&& (op === OpCode.LOAD_MEM_D || op === OpCode.STORE_MEM_D)) {
					page.ops[pageOffset] = DecodedDispatchOp.ReservedMemory;
				}
			} else if (OPCODE_USES_BX[op] !== 0) {
				page.a[pageOffset] = (wideA << MAX_OPERAND_BITS) | aLow;
				const bx = instructionBx(bodyWord, wideB);
				switch (op) {
					case OpCode.KSMI:
						page.sbx[pageOffset] = instructionSignedBx(bx, width);
						break;
					case OpCode.JMP:
					case OpCode.JMPIF:
					case OpCode.JMPIFNOT:
						page.bx[pageOffset] = instructionBranchTarget(pc, width, bx);
						break;
					case OpCode.CLOSURE:
						page.c[pageOffset] = (wideC << BASE_OPERAND_BC_BITS) | cLow;
					default:
						page.bx[pageOffset] = bx;
						break;
				}
				if (op === OpCode.LOADK && bx >= image.constWords.length) {
					page.ops[pageOffset] = DecodedDispatchOp.InvalidImageOperand;
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
					page.operandByte[pageOffset] = op === OpCode.SETFIELD ? instructionFieldExtraHashSlots(sourceWord, width) : 0;
				}
				if (rawC > MemoryAccessKind.F64LE && (op === OpCode.LOAD_MEM || op === OpCode.STORE_MEM)) {
					page.ops[pageOffset] = DecodedDispatchOp.ReservedMemory;
				} else {
					const constantCount = image.constWords.length;
					if ((op === OpCode.ITERN && rawC === 0)
						|| -page.b[pageOffset] > constantCount || -page.c[pageOffset] > constantCount
						|| ((op === OpCode.GETFIELD || op === OpCode.SELF)
							&& (rawC >= constantCount || image.constTags[rawC] !== ValueTag.String))
						|| (op === OpCode.SETFIELD && (rawB >= constantCount || image.constTags[rawB] !== ValueTag.String))) {
						page.ops[pageOffset] = DecodedDispatchOp.InvalidImageOperand;
					}
				}
			}
			page.requiredSlots[pageOffset] = fixedRegisterExtent(op, page.a[pageOffset], page.b[pageOffset], page.c[pageOffset]);
		}
		if (op >= OpCode.GETSYS && op <= OpCode.SETGL) {
			const system = op <= OpCode.SETSYS;
			const index = instructionBx(bodyWord, wideB);
			if (index >= (system ? image.systemNameCount : image.globalNameCount)) {
				page.ops[pageOffset] = DecodedDispatchOp.InvalidImageOperand;
			} else {
				const base = image.globalMapBase + (system ? 4 * image.globalNameCount : 0);
				page.bx[pageOffset] = this.memory.readRamRecordWord(base + 4 * index);
			}
		}
		page.dispatchOps[pageOffset] = page.ops[pageOffset];
		page.dispatchCycles[pageOffset] = decodedInstructionBaseCycles(page, pageOffset);
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
			&& compiledBlockSupports(page.ops[pageOffset], page.a[pageOffset], page.c[pageOffset])) {
			if (page.compiledBlocks === null) page.compiledBlocks = new CompiledBlockPage();
			page.compiledBlocks.visits[pageOffset] = 0;
			page.dispatchOps[pageOffset] = DecodedDispatchOp.CompiledWarm;
			return true;
		}
		const fusionCandidate = decodedDispatchCanFuse(page.ops[pageOffset]);
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
			if (nextPage.readBytes === null) {
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
			page.ops[pageOffset],
			nextPage.ops[nextPageOffset],
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
		latch.romBacked = false;
		const directory = image.romFunctions;
		if (!directory.mappedCode) {
			if ((this.unpublishedRomMask & executionDomainBit(image.executionDomainId)) !== 0) return false;
			const lane = romFunctionVersionLane(directory, address);
			if (lane >= 0) {
				latch.romBacked = true;
				readPublishedPrototype(directory.versions, lane, latch);
				return true;
			}
			if (((address - SYSTEM_ROM_BASE) >>> 0) < SYSTEM_ROM_SIZE || ((address - CART_ROM_BASE) >>> 0) < CART_ROM_SIZE) return false;
		}
		const view = this.executionReadView;
		if (this.memory.bindMappedReadView(address, BLUA32_FUNCTION_RECORD_SIZE, busSignals, view)) {
			latch.romBacked = address < RAM_BASE || (address >= CART_ROM_BASE && address < CART_ROM_END);
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
			return admitsFunctionPc(image.romFunctions, address, latch.codeAddress);
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
		return this.memory.readBusFaultSequence() === faultSequence && admitsFunctionPc(image.romFunctions, address, latch.codeAddress);
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
		if (staticEnd !== undefined) {
			if (this.systemImage.heapServiceFunctions !== null) {
				const management = this.heapAllocator.managementOffset();
				const floor = this.heapAllocator.floorOffset(staticEnd);
				this.memory.writeRamRecordWord(management + HEAP_SERVICE_EXEC_TARGET_OFFSET, functionAddress);
				this.memory.writeRamRecordWord(management + HEAP_SERVICE_EXEC_FLOOR_OFFSET, floor);
				this.memory.writeRamRecordWord(management + HEAP_SERVICE_EXEC_PC_OFFSET, this.currentInstructionPc);
				this.memory.writeRamRecordWord(management + HEAP_SERVICE_EXEC_BUS_OFFSET, targetDomainId === null
					? MAPPED_BUS_MASTER_CPU : CPU.executionBusSignalsForDomain(targetDomainId));
				this.memory.writeRamRecordWord(management + HEAP_SERVICE_EXEC_STAGE_OFFSET, HeapServiceExecStage.First);
				this.startExecFloorService(floor);
				this.requestYield();
				return;
			}
			if (!this.setProgramHeapFloor(staticEnd)) {
				this.hardHalt();
				return;
			}
		}
		this.commitExecutionTransfer(functionAddress);
	}

	private startExecFloorService(floor: number): void {
		this.execFloorArgs[0] = this.heapAllocator.allocatorStateOffset();
		this.execFloorArgs[1] = floor;
		this.beginHeapService(this.systemImage.heapServiceFunctions![HeapServiceOperation.SetFloor], this.execFloorArgs);
	}

	private finishExecFloorService(): void {
		const management = this.heapAllocator.managementOffset();
		const stage = this.memory.readRamRecordWord(management + HEAP_SERVICE_EXEC_STAGE_OFFSET);
		if (stage === HeapServiceExecStage.Idle) return;
		this.currentInstructionPc = this.memory.readRamRecordWord(management + HEAP_SERVICE_EXEC_PC_OFFSET);
		this.lastPc = this.activeThread.currentFrame!.pc - INSTRUCTION_BYTES;
		this.lastExecutionDomainId = this.activeExecutionDomainId;
		const floor = this.memory.readRamRecordWord(management + HEAP_SERVICE_EXEC_FLOOR_OFFSET);
		if (this.heapServiceResult() !== 0) {
			this.heapAllocator.publishFloor(floor);
			this.memory.writeRamRecordWord(management + HEAP_SERVICE_EXEC_STAGE_OFFSET, HeapServiceExecStage.Idle);
			this.commitExecutionTransfer(
				this.memory.readRamRecordWord(management + HEAP_SERVICE_EXEC_TARGET_OFFSET),
				this.memory.readRamRecordWord(management + HEAP_SERVICE_EXEC_BUS_OFFSET),
			);
		} else if (stage === HeapServiceExecStage.First) {
			// A refused floor has not changed the arena. Keep the original
			// collector retry at this safe boundary until it too is ported.
			this.luaHeap.collectRuntime();
			this.memory.writeRamRecordWord(management + HEAP_SERVICE_EXEC_STAGE_OFFSET, HeapServiceExecStage.Retry);
			this.startExecFloorService(floor);
		} else {
			this.memory.writeRamRecordWord(management + HEAP_SERVICE_EXEC_STAGE_OFFSET, HeapServiceExecStage.Idle);
			this.hardHalt();
		}
	}

	private commitExecutionTransfer(functionAddress: number, busSignals = MAPPED_BUS_MASTER_CPU): void {
		if (!this.readFunctionRecordOnBus(
			this.activeExecutionImage,
			functionAddress,
			busSignals,
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
		this.haltedUntilIrqThread = 0;
		this.interruptEventPending = false;
		this.memoryWriteBlocked = false;
		this.memoryWriteBlockedAddress = 0;
		this.pendingMemory.kind = PendingMemoryKind.None;
		this.stringComparison = new StringComparisonLatch();
		this.concat.registersLeft = this.concat.length = 0;
		this.pendingAllocation = null;
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

	public beginCompletionCall(closure: number, args: ReadonlyArray<Value> = EMPTY_CALL_ARGS): void {
		if (this.heapServiceActive()) throw new Error('Heap service must retire before replacing code execution.');
		if (this.pendingAllocation !== null || this.stringComparison.remaining !== 0 || this.concat.active || this.tableRebuild.record || this.gc.fullEpochs() !== 0) throw new Error('Pending CPU work must retire before replacing code execution.');
		if (this.unpublishedRomMask !== 0) throw new Error('Installed ROM must be published before CPU execution.');
		const roots = this.acquireLocalRoots();
		this.localRoots.push(valueClosure(closure));
		for (const arg of args) this.localRoots.push(arg);
		try {
			this.gc.finishFinalMark();
			// Call injection takes over the physical instruction stream. The suspended
			// frame retains its PC; an unaccepted endpoint access must not follow it.
			this.abortStalledMemoryWrite();
			this.clearCompletionValues();
			this.completionThread = this.activeThread.address;
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
		if (this.heapServiceActive()) throw new Error('Heap service must retire before replacing code execution.');
		if (this.pendingAllocation !== null || this.stringComparison.remaining !== 0 || this.concat.active || this.tableRebuild.record || this.gc.fullEpochs() !== 0) throw new Error('Pending CPU work must retire before replacing code execution.');
		this.gc.finishFinalMark();
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
		this.haltedUntilIrqThread = this.activeThread.address;
		this.yieldRequested = false;
	}

	private hardHalt(): void {
		this.hardHalted = true;
		this.haltedUntilIrqFrameDepth = -1;
		this.haltedUntilIrqThread = 0;
		this.yieldRequested = false;
	}


	public clearHaltUntilIrq(): void {
		this.haltedUntilIrqFrameDepth = -1;
		this.haltedUntilIrqThread = 0;
		this.yieldRequested = false;
	}

	public isHaltedUntilIrq(): boolean {
		return this.haltedUntilIrqThread === this.activeThread.address && this.haltedUntilIrqFrameDepth === this.activeThread.frameDepth;
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
		if (this.pendingMemory.kind !== PendingMemoryKind.None || this.pendingAllocation !== null || this.stringComparison.remaining !== 0 || this.concat.active || this.tableRebuild.record || this.gc.fullEpochs() || this.heapServiceActive()) return false;
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
		if (caller && caller.executionImage && !admitsFunctionPc(caller.executionImage.romFunctions, caller.functionAddress, returnPc)) {
			this.cop0Words[COP0_BAD_ADDRESS] = returnPc;
			const cause = (returnPc & (INSTRUCTION_BYTES - 1)) !== 0
				? CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD : CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR;
			this.enterInstructionFetchException(caller, cause, returnPc);
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
		this.haltedUntilIrqThread = 0;
		this.yieldRequested = false;
	}

	public getFrameDepth(): number {
		return this.activeThread.frameDepth;
	}

	public heapServiceActive(): boolean {
		return this.heapService.thread.frameDepth !== 0;
	}

	public heapServiceResult(): number {
		return this.memory.readRamRecordWord(this.heapService.resultAddress);
	}

	/** Internal CPU entry. The host supplies a linked, fixed-stack firmware function. */
	public beginHeapService(functionAddress: number, args: readonly number[]): boolean {
		if (this.heapServiceActive()) return false;
		const frame = this.prepareHeapServiceFrame(functionAddress, 0, 0, 0);
		const copied = Math.min(frame.top, args.length);
		for (let index = 0; index < copied; ++index) frame.registers.setInteger(index, args[index]);
		frame.registers.clear(frame.top - copied, copied);
		this.memory.writeRamRecordWord(this.heapService.resultAddress, 0);
		frame.thread.enterFrame(frame);
		return true;
	}

	public runUntilDepth(targetDepth: number, instructionBudget: number, target: number = this.rootThread.address, kind = CpuRunKind.Direct): RunResult {
		if (this.heapServiceActive()) {
			const gcStage = this.gc.serviceStage();
			this.runKind = kind;
			try {
				this.runUntilDepthInstrumented(0, instructionBudget, true);
				if (!this.heapServiceActive()) {
					try {
						switch (gcStage) {
							case HeapServiceGcStage.FullTrace:
							case HeapServiceGcStage.MaintenanceTrace: {
								const work = this.gc.finishTraceQuantum(this.systemImage.heapServiceFunctions!, gcStage);
								if (gcStage === HeapServiceGcStage.FullTrace) this.chargeCollectionWork(work);
								break;
							}
							case HeapServiceGcStage.FullRemark:
							case HeapServiceGcStage.MaintenanceRemark: {
								const work = this.gc.finishRemarkQuantum(this.systemImage.heapServiceFunctions!, gcStage);
								if (gcStage === HeapServiceGcStage.FullRemark) this.chargeCollectionWork(work);
								break;
							}
							case HeapServiceGcStage.FullRootHead:
							case HeapServiceGcStage.MaintenanceRootHead: {
								const work = this.gc.finishRootHead(this.systemImage.heapServiceFunctions!, gcStage);
								if (gcStage === HeapServiceGcStage.FullRootHead) this.chargeCollectionWork(work);
								break;
							}
							case HeapServiceGcStage.FullRootBanks:
							case HeapServiceGcStage.MaintenanceRootBanks:
								this.gc.finishRootBanks(this.systemImage.heapServiceFunctions!, gcStage);
								break;
							case HeapServiceGcStage.FullWeakClear:
							case HeapServiceGcStage.MaintenanceWeakClear:
								this.gc.finishWeakQuantum();
								break;
							case HeapServiceGcStage.FullObjectSweep:
							case HeapServiceGcStage.PressureObjectSweep:
							case HeapServiceGcStage.AllocationRecoveryObjectSweep: {
								const services = this.systemImage.heapServiceFunctions!;
								this.gc.finishObjectSweep(gcStage, services[HeapServiceOperation.ObjectSweep], services[HeapServiceOperation.StringSweep]);
								break;
							}
							case HeapServiceGcStage.FullStringSweep:
							case HeapServiceGcStage.PressureStringSweep:
							case HeapServiceGcStage.AllocationRecoveryStringSweep:
								this.gc.finishStringSweep(gcStage);
								if (gcStage === HeapServiceGcStage.AllocationRecoveryStringSweep) this.finishAllocationRecovery();
								break;
							case HeapServiceGcStage.Idle:
								this.finishExecFloorService();
								this.finishNewTableReservation();
								break;
						}
					} catch (error) {
						this.handleRunLoopError(error);
					}
				}
				if (this.hardHalted) return RunResult.Halted;
				return gcStage !== HeapServiceGcStage.Idle && kind === CpuRunKind.Scheduled ? RunResult.CollectionProgress : RunResult.Yielded;
			} finally {
				this.runKind = CpuRunKind.Idle;
			}
		}
		if (this.pendingAllocation !== null) {
			this.instructionBudgetRemaining = instructionBudget;
			return RunResult.ParkedAllocation;
		}
		if (this.unpublishedRomMask !== 0) throw new Error('Installed ROM must be published before CPU execution.');
		this.runKind = kind;
		try {
			for (;;) {
				const epochs = this.gc.fullEpochs();
				if (epochs !== 0) {
					this.instructionBudgetRemaining = instructionBudget;
					if (instructionBudget <= 0) return RunResult.Yielded;
					const words = Math.min(GC_STEP_WORDS, Math.max(1, Math.trunc(instructionBudget / GC_WORK_WORD_CYCLES)));
					this.chargeCollectionWork(this.gc.stepFullCollection(epochs, words, this.systemImage.heapServiceFunctions));
					if (kind === CpuRunKind.Scheduled) return RunResult.CollectionProgress;
					instructionBudget = this.instructionBudgetRemaining;
					if (instructionBudget <= 0 || this.heapServiceActive()) return RunResult.Yielded;
					continue;
				}
				const result = this.runUntilDepthEntry(this.activeThread.address === target ? targetDepth : 0, instructionBudget);
				if (!this.threadSwitchRequested) {
					if (kind !== CpuRunKind.Direct || result !== RunResult.Yielded || this.instructionBudgetRemaining <= 0 || !this.gc.fullEpochs()) return result;
					instructionBudget = this.instructionBudgetRemaining;
					continue;
				}
				this.threadSwitchRequested = false;
				this.yieldRequested = false;
				instructionBudget = this.instructionBudgetRemaining;
				if (instructionBudget <= 0) return RunResult.Yielded;
			}
		} finally {
			this.runKind = CpuRunKind.Idle;
		}
	}

	private runUntilDepthNormal(targetDepth: number, instructionBudget: number): RunResult {
		this.instructionBudgetRemaining = instructionBudget;
		const thread = this.activeThread;
		let scalarFrame: CallFrame | null = null, nextPc = 0;
		try {
			while (thread.frameDepth > targetDepth) {
				try {
					if (this.instructionBudgetRemaining > 0 && !this.memoryWriteBlocked && !this.hardHalted
						&& !this.yieldRequested && !this.isHaltedUntilIrq()) {
						this.resumePendingMemoryOperation();
						if (this.stringComparison.remaining !== 0) this.advanceStringComparison(thread.currentFrame!);
						if (this.concat.active) this.advanceConcat(thread.currentFrame!);
						if (this.tableRebuild.record && !this.advanceTableStore(thread.currentFrame!)) return RunResult.ParkedAllocation;
					}
					while (scalarFrame !== null || thread.frameDepth > targetDepth) {
						if (this.hardHalted
							|| (this.haltedUntilIrqThread === this.activeThread.address && this.haltedUntilIrqFrameDepth === thread.frameDepth)
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
						const frame = scalarFrame ?? thread.currentFrame!;
						const image = frame.executionImage;
						if (image !== null && this.activeExecutionImage !== image) this.latchActiveExecutionImage(image.executionDomainId, image);
						if (this.nonMaskableInterruptPending
							|| ((this.cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) !== 0
								&& this.irqController.hasAssertedMaskableInterruptLine())
						) {
								if (scalarFrame !== null) { this.publishScalarFrontier(scalarFrame, nextPc); scalarFrame = null; }
							this.enterPendingInterrupt();
							continue;
						}
						let pc = scalarFrame === null ? frame.pc : nextPc;
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
						for (;;) {
							const pageOffset = (pc & MAPPED_PAGE_BYTE_MASK) >>> 2;
							const refreshState = page.refreshState[pageOffset];
							let rewritten = false, cacheableFetch = true;
							if (refreshState !== 0) {
								rewritten = (refreshState & DECODED_REFRESH_DECODE) !== 0 && page.widths[pageOffset] !== 0;
								if (scalarFrame !== null) { this.publishScalarFrontier(scalarFrame, nextPc); scalarFrame = null; }
								if (!this.decodeInstruction(frame, page, pageOffset, pc, true)) break;
								cacheableFetch = (page.refreshState[pageOffset] & DECODED_REFRESH_DECODE) === 0;
							}
							const width = page.widths[pageOffset];
							const dispatchOp = page.dispatchOps[pageOffset];
							this.currentInstructionPc = pc;
							nextPc = (pc + width * INSTRUCTION_BYTES) >>> 0;
							if (SCALAR_LOCAL_PC[dispatchOp] || (dispatchOp === OpCode.MOV && page.c[pageOffset] <= ValueMoveKind.FloatFromBits)) {
								if (scalarFrame === null) this.scalarRegisterTop = frame.top;
								scalarFrame = frame;
							} else {
								if (scalarFrame === null) frame.pc = nextPc;
								else this.publishScalarFrontier(frame, nextPc);
								scalarFrame = null;
							}
							this.lastExecutionDomainId = image.executionDomainId;
							this.lastPc = (nextPc - INSTRUCTION_BYTES) >>> 0;
							this.instructionBudgetRemaining -= page.dispatchCycles[pageOffset];
							const tableReceiver = this.executeInstruction(
								frame,
								page,
								pageOffset,
								dispatchOp,
								targetDepth,
								rewritten,
							);
							if (tableReceiver !== undefined) {
								if (tableReceiver === ALLOCATION_PARKED) return RunResult.ParkedAllocation;
								this.publishScalarFrontier(frame, nextPc);
								scalarFrame = null;
								this.finishTableRead(frame, page.a[pageOffset], tableReceiver, valueString(image.constWords[page.c[pageOffset]]), this.tableLookupResult);
							}
							// Only straight-line scalar operations retain the local frontier.
							// An uncached bus fetch can itself raise a device edge.
							if (scalarFrame === null || !cacheableFetch || this.instructionBudgetRemaining <= 0
								|| ((pc ^ nextPc) & ~MAPPED_PAGE_BYTE_MASK) !== 0) break;
							pc = nextPc;
						}
					}
				} catch (error) {
					if (scalarFrame !== null) { this.publishScalarFrontier(scalarFrame, nextPc); scalarFrame = null; }
					this.handleRunLoopError(error);
				}
			}
			return RunResult.Halted;
		} finally {
			if (scalarFrame !== null) this.publishScalarFrontier(scalarFrame, nextPc);
		}
	}

	private publishScalarFrontier(frame: CallFrame, pc: number): void {
		frame.pc = pc;
		if (this.scalarRegisterTop !== frame.top) frame.top = this.scalarRegisterTop;
		this.scalarRegisterTop = -1;
	}

	private runUntilDepthInstrumented(targetDepth: number, instructionBudget: number, service = false): RunResult {
		this.instructionBudgetRemaining = instructionBudget;
		const thread = service ? this.heapService.thread : this.activeThread;
		const executionHook = this.executionHook!;
		const executionDomainMask = this.executionHookDomainMask;
		const preMaskableInterruptExecutionDomainMask =
			this.preMaskableInterruptExecutionHookDomainMask;
		while (thread.frameDepth > targetDepth) {
			try {
				if (!service && this.instructionBudgetRemaining > 0 && !this.memoryWriteBlocked && !this.hardHalted
					&& !this.yieldRequested && !this.isHaltedUntilIrq()) {
					this.resumePendingMemoryOperation();
					if (this.stringComparison.remaining !== 0) this.advanceStringComparison(thread.currentFrame!);
					if (this.concat.active) this.advanceConcat(thread.currentFrame!);
					if (this.tableRebuild.record && !this.advanceTableStore(thread.currentFrame!)) return RunResult.ParkedAllocation;
				}
				while (thread.frameDepth > targetDepth) {
					if (this.hardHalted
						|| (!service && (this.isHaltedUntilIrq() || this.memoryWriteBlocked))) {
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
					if (!service && image !== null && this.activeExecutionImage !== image) this.latchActiveExecutionImage(image.executionDomainId, image);
					if (!service && this.nonMaskableInterruptPending) {
						this.enterPendingInterrupt();
						continue;
					}
					if (!service && (this.cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) !== 0
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
					if (!service && (executionDomainMask & executionDomainBit(this.activeExecutionDomainId)) !== 0
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
					const op = !service && page.dispatchOps[pageOffset] === DecodedDispatchOp.Observe
						? DecodedDispatchOp.Observe : page.ops[pageOffset];
					this.currentInstructionPc = pc;
					frame.pc = (pc + (width * INSTRUCTION_BYTES)) >>> 0;
					this.lastExecutionDomainId = image.executionDomainId;
					this.lastPc = (pc + ((width - 1) * INSTRUCTION_BYTES)) >>> 0;
					this.instructionBudgetRemaining -= service ? decodedInstructionBaseCycles(page, pageOffset) : page.dispatchCycles[pageOffset];
					if (this.executeInstruction(
						frame,
						page,
						pageOffset,
						op,
						targetDepth,
						false,
						service,
					) === ALLOCATION_PARKED) return RunResult.ParkedAllocation;
				}
			} catch (error) {
				if (service) throw error;
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
		for (let index = 0, depth = this.readThreadFrameDepth(this.completionThread); index < depth; ++index) {
			if ((this.readThreadFrameWord(this.completionThread, index, FrameField.Flags) & FRAME_COMPLETION) !== 0) return true;
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
	public readClosureUpvalue(closure: number, index: number): Value {
		return Upvalue.load(this.memory, Closure.captureAddress(this.memory, closure, index));
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
		if (this.pendingAllocation !== null || this.stringComparison.remaining !== 0 || this.concat.active || this.tableRebuild.record || this.gc.fullEpochs() !== 0) throw new Error('Pending CPU work must retire before replacing code execution.');
		const image = this.executionImageForDomain(executionDomainId)!;
		if (!admitsFunctionPc(image.romFunctions, functionAddress, pc)
			|| !this.readFunctionRecord(image, functionAddress, CPU.executionBusSignalsForDomain(executionDomainId)))
			throw new Error('Frame execution must enter an instruction of its published function.');
		const frame = this.activeThread.frameAtDepth(frameIndex);
		if (frame === this.activeThread.currentFrame) this.abortStalledMemoryWrite();
		const registerCount = Math.max(this.functionRecordLatch.maxStack, this.functionRecordLatch.numParams);
		if (registerCount > MAX_THREAD_VALUE_SLOTS) throw LUA_OUT_OF_MEMORY_SIGNAL;
		if (registerCount > frame.stackCapacity) {
			this.ensureRegisterCapacity(frame, registerCount - 1);
		}
		frame.functionAddress = functionAddress;
		frame.executionImage = image;
		frame.savedExecutionBank = executionDomainId;
		if (frame === this.activeThread.currentFrame) this.latchActiveExecutionImage(executionDomainId, image);
		frame.decodedPage = null;
		frame.compilationEntry = true;
		frame.pc = pc;
	}

	public writeFrameCallSitePc(childFrameIndex: number, pc: number): void {
		this.activeThread.frameAtDepth(childFrameIndex).callSitePc = pc;
	}

	public setGlobalByKey(
		key: StringId, value: Value,
	): void {
		const slot = this.globalBank.registerName(key, value);
		this.globalBank.writeSlot(slot, value);
	}

	public setSystemGlobalByKey(
		key: StringId, value: Value,
	): void {
		const slot = this.systemGlobalBank.find(key);
		if (slot === undefined) {
			throw new Error(`System global '${this.stringPool.toString(key)}' has no register slot.`);
		}
		this.systemGlobalBank.writeSlot(slot, value);
	}

	public getSystemGlobalByKey(key: StringId): Value {
		return this.systemGlobalBank.slots.get(this.systemGlobalBank.find(key)!);
	}

	public get globalSlotCount(): number {
		return this.globalBank.count;
	}

	public getGlobalByKey(key: StringId): Value {
		const slot = this.globalBank.find(key);
		return slot === undefined ? valueNil() : this.globalBank.slots.get(slot);
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
		if (page.requiredSlots[pageOffset] > registers.capacity()) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
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
		if (secondPage.requiredSlots[secondPageOffset] > registers.capacity()) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		const secondRkB = secondPage.b[secondPageOffset];
		const secondRkC = secondPage.c[secondPageOffset];
		const secondLeft = integerOperand(this.readRKValue(frame, secondRkB));
		const secondRight = integerOperand(this.readRKValue(frame, secondRkC));
		const secondResult = isAddShl ? luaShiftLeft(secondLeft, secondRight) : secondLeft ^ secondRight;
		this.setRegisterIntegerFast(frame, registers, secondPage.a[secondPageOffset], secondResult);
	}

	private advanceConcat(frame: CallFrame): void {
		const job = this.concat;
		if (job.registersLeft) {
			const count = Math.min(job.registersLeft, this.instructionBudgetRemaining);
			this.charge(count); job.registersLeft -= count;
			for (const stop = job.nextRegister + count; job.nextRegister < stop; ++job.nextRegister) {
				const v = frame.registers.get(job.nextRegister);
				const n = valueTag(v) === ValueTag.String ? this.stringPool.byteLength(valuePayload(v)) >>> 0
					: valueToByteString(v, this.stringPool).length;
				if (n >= MAIN_RAM_SIZE - job.length) {
					this.charge(MAIN_RAM_SIZE + job.registersLeft);
					this.currentInstructionPc = job.instructionPc;
					job.length = job.registersLeft = 0;
					throw LUA_OUT_OF_MEMORY_SIGNAL;
				}
				job.length += n;
				if (n) { job.values.push(v); job.lengths.push(n); }
			}
			if (job.registersLeft) return;
			if (job.length > job.bytes.length) job.bytes = new Uint8Array(job.length);
		}
		const amount = Math.min(this.instructionBudgetRemaining, job.length - job.cursor);
		this.charge(amount);
		job.append(this.stringPool, amount);
		if (job.cursor !== job.length) return;
		const length = job.length;
		job.length = 0;
		this.currentInstructionPc = job.instructionPc;
		this.setRegisterStringFast(frame, frame.registers, job.destination, this.stringPool.internHashedBytes(job.bytes, length, job.hash));
	}

	private executeConcat(frame: CallFrame, a: number, b: number, c: number, range = false): void {
		const count = range ? c : 2;
		if (range && count > INLINE_CONCAT_OPERANDS) {
			const job = this.concat;
			job.values.length = job.lengths.length = 0;
			job.start(0, this.currentInstructionPc, a);
			job.nextRegister = b; job.registersLeft = count;
			if (this.instructionBudgetRemaining > 0) this.advanceConcat(frame);
			return;
		}
		if (range) this.charge(count);
		const strings = this.stringPool;
		let length = 0, conversions = 0;
		for (let i = 0; i < count; ++i) {
			const v = range ? frame.registers.get(b + i) : this.readRKValue(frame, i ? c : b);
			if (valueTag(v) === ValueTag.String) {
				length += strings.byteLength(valuePayload(v)) >>> 0;
				if (length >= MAIN_RAM_SIZE) { this.charge(MAIN_RAM_SIZE); throw LUA_OUT_OF_MEMORY_SIGNAL; }
			} else ++conversions;
		}
		const directBytes = Math.min(MAIN_RAM_SIZE - 1, Math.max(INLINE_CONCAT_BYTES, this.instructionBudgetRemaining));
		if (length + conversions * MAX_NON_STRING_TEXT_BYTES > directBytes) {
			const job = this.concat;
			job.values.length = job.lengths.length = 0;
			for (let i = 0; i < count; ++i) {
				const v = range ? frame.registers.get(b + i) : this.readRKValue(frame, i ? c : b);
				let n: number;
				if (valueTag(v) === ValueTag.String) n = strings.byteLength(valuePayload(v)) >>> 0;
				else {
					n = valueToByteString(v, strings).length; length += n;
					if (length >= MAIN_RAM_SIZE) { this.charge(MAIN_RAM_SIZE); throw LUA_OUT_OF_MEMORY_SIGNAL; }
				}
				if (n) { job.values.push(v); job.lengths.push(n); }
			}
			if (length > directBytes) {
				job.start(length, this.currentInstructionPc, a);
				if (this.instructionBudgetRemaining > 0) this.advanceConcat(frame);
				return;
			}
		}
		let text = '';
		for (let i = 0; i < count; ++i) {
			const v = range ? frame.registers.get(b + i) : this.readRKValue(frame, i ? c : b);
			text += valueToByteString(v, strings);
		}
		this.charge(text.length);
		this.setRegisterStringFast(frame, frame.registers, a, strings.intern(text));
	}

	private executeClosure(frame: CallFrame, a: number, bx: number, c: number): void {
		const registers = frame.registers;
		const registerAddress = (c & CLOSURE_ADDRESS_REGISTER_FLAG) !== 0;
		const capacity = registers.capacity();
		if (a >= capacity || (registerAddress && bx >= capacity)) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		const functionAddress = registerAddress ? wordOperand(registers.get(bx)) : bx * BLUA32_FUNCTION_ALIGNMENT;
		if (!this.readFunctionRecordOnBus(
			this.activeExecutionImage,
			functionAddress,
			this.executionBusSignals,
		)) {
			this.hardHalt();
			return;
		}
		const closure = this.createClosure(frame);
		if (closure === 0) {
			return;
		}
		this.setRegisterClosureFast(frame, registers, a, closure);
		return;
	}

	private executeCall(frame: CallFrame, a: number, b: number, c: number): boolean {
		const registers = frame.registers;
		const argCount = decodeValueCount(b, Math.max(frame.top - a - 1, 0));
		const capacity = registers.capacity();
		if (a >= capacity) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		switch (registers.getTag(a)) {
			case ValueTag.BuiltinFunction: {
				// Unlike closure placement, a primitive does not reserve a new
				// argument window. Its shared source must already be backed.
				const last = a + argCount;
				if (last >= capacity && frame.stackBase + last >= frame.thread.stackRegisters.capacity()) {
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				}
				this.runBuiltinFunction(registers.getBuiltinFunctionId(a), frame, a, c, argCount);
				return false;
			}
			case ValueTag.Closure: {
				const closure = this.gc.closureRecordAddress(registers.getPayload(a));
				if (closure === 0) throw new LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
				this.pushFrame(closure, frame, a, c, false, false, frame.pc - INSTRUCTION_BYTES, a + 1, argCount);
				return true;
			}
			default:
				throw new LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
		}
	}

	private executeReturn(frame: CallFrame, a: number, b: number): boolean {
		const registers = frame.registers;
		const total = decodeValueCount(b, Math.max(frame.top - a, 0));
		if (total !== 0 && a + total > registers.capacity()) {
			const copied = this.returnSourceCount(frame, total);
			if (copied !== 0 && a + copied > registers.capacity()) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		this.charge(this.closeUpvalues(frame));
		const frameIndex = this.activeThread.frameDepth - 1;
		if (frame.protectedContinuationIndex >= 0) {
			this.finishProtectedCall(frame.protectedContinuationIndex, registers, a, total);
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
		if (frameIndex === 0 && this.activeThread.resumer !== 0) {
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

	/** A receiver may discard part or all of the produced range without reading it. */
	private returnSourceCount(frame: CallFrame, produced: number): number {
		const thread = frame.thread;
		const continuation = frame.protectedContinuationIndex;
		if (continuation >= 0) {
			const flags = thread.protectedWord(continuation, ProtectedField.Flags);
			if ((flags & PROTECTED_CALL_KIND_MASK) === ProtectedCallKind.XPCallHandler) return 1;
			const wanted = thread.protectedWord(continuation, ProtectedField.Wanted);
			if ((flags & PROTECTED_CALL_PARENT) !== 0 && (wanted & CALL_RESULT_EXTEND_TOP) !== 0) return 0;
			return Math.max(0, Math.min(produced, selectedCallResultCount(wanted, produced + 1) - 1));
		}
		if (frame.returnToCompletionLatch) return produced;
		if (frame.previous !== null) return Math.min(produced, selectedCallResultCount(frame.returnCount, produced));
		const resumer = thread.resumer;
		if (resumer === 0) return produced;
		const wanted = this.memory.readRamRecordWord(resumer + ThreadField.ReturnCount);
		return Math.max(0, Math.min(produced, selectedCallResultCount(wanted, produced + 1) - 1));
	}

	private executeVararg(frame: CallFrame, a: number, b: number): void {
		const count = decodeValueCount(b, frame.varargCount);
		if (count !== 0) {
			this.ensureRegisterCapacity(frame, a + count - 1);
			const copied = Math.min(count, frame.varargCount);
			frame.registers.copyRangeFrom(frame.thread.stackRegisters, a, frame.varargBase, copied, count - copied);
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
		if (source >= frame.registers.capacity()) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
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
		const available = Math.max(0, Math.min(valueCount, frame.registers.capacity() - valueBase));
		let writeAddr = addr;
		for (let offset = 0; offset < available; offset += 1) {
			this.memory.writeMappedWord(writeAddr, wordOperand(frame.registers.get(valueBase + offset)));
			if (this.memory.readBusFaultSequence() !== faultSequence) {
				this.enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
				return;
			}
			writeAddr = (writeAddr + 4) >>> 0;
		}
		if (available !== valueCount) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}

	private beginStringComparison(frame: CallFrame, left: number, right: number, ln: number, rn: number, inclusive: boolean, expected: boolean): void {
		const s = this.stringComparison;
		s.left = left; s.right = right; s.offset = 0; s.remaining = Math.min(ln, rn); s.order = 0;
		s.skipLess = !expected; s.skipTie = (inclusive ? ln <= rn : ln < rn) !== expected;
		if (this.instructionBudgetRemaining > 0) this.advanceStringComparison(frame);
	}

	private advanceStringComparison(frame: CallFrame): void {
		const s = this.stringComparison, n = Math.min(s.remaining, this.instructionBudgetRemaining);
		if (s.order === 0) s.order = Math.sign(this.stringPool.compareBytes(s.left, s.right, s.offset, n));
		s.offset += n; s.remaining -= n; this.charge(n);
		if (s.remaining !== 0) return;
		const skip = s.order === 0 ? s.skipTie : (s.order < 0) === s.skipLess;
		s.left = s.right = s.offset = s.order = 0;
		s.skipLess = s.skipTie = false;
		if (skip) this.skipNextInstruction(frame);
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
		const pc = this.currentInstructionPc, image = frame.executionImage;
		const pagePc = (pc & ~MAPPED_PAGE_BYTE_MASK) >>> 0;
		const slot = this.memory.cartridgeController.selectedSlot(this.executionBusSignals);
		const romView = this.executionReadView, domain = image.executionDomainId;
		const directory = image.romFunctions;
		const version = romFunctionVersionLane(directory, frame.functionAddress);
		const selectedImage = domain === SYSTEM_EXECUTION_DOMAIN_ID || domain === slot;
		const verified = version >= 0 && !directory.mappedCode;
		const pages = [page];
		let basePc = pagePc, firstWord = 0, endWord = DECODED_PAGE_WORDS;
		let bounded = false, finalWordStartsInstruction = false;
		if (version >= 0 && selectedImage) {
			const start = directory.versions[version + RomFunctionLane.FirstPc];
			const end = directory.versions[version + RomFunctionLane.EndPc];
			const firstPage = (start & ~MAPPED_PAGE_BYTE_MASK) >>> 0;
			const bodyPages = ((((end - 1) & ~MAPPED_PAGE_BYTE_MASK) >>> 0) - firstPage) / MAPPED_PAGE_BYTE_SIZE + 1;
			if (verified && (pc < start || pc >= end || !isRomInstructionHead(directory, pc))) return;
			if (verified || (pc >= start && pc < end && bodyPages > 1 && bodyPages <= COMPILED_VERSION_MAX_PAGES
				&& this.memory.bindRomByteView(end - INSTRUCTION_BYTES, INSTRUCTION_BYTES, slot, romView))) {
				bounded = true;
				basePc = bodyPages <= COMPILED_VERSION_MAX_PAGES ? firstPage : pagePc;
				let endPc = Math.min(end, basePc + COMPILED_VERSION_MAX_PAGES * MAPPED_PAGE_BYTE_SIZE);
				// Cut before the prefix when a bounded window would cut a WIDE in half.
				if (endPc < end && !isRomInstructionHead(directory, endPc)) endPc -= INSTRUCTION_BYTES;
				finalWordStartsInstruction = verified ? isRomInstructionHead(directory, endPc - INSTRUCTION_BYTES)
					: instructionOpcode(readLE32(romView.bytes, romView.byteOffset)) !== OpCode.WIDE;
				firstWord = (Math.max(start, basePc) - basePc) / INSTRUCTION_BYTES;
				endWord = (endPc - basePc) / INSTRUCTION_BYTES;
				for (let address = basePc, index = 0; address < endPc; address += MAPPED_PAGE_BYTE_SIZE, ++index) {
					if (address === pagePc) pages[index] = page;
					else pages[index] = this.decodedPageForAddress(image, address, mappedPageAddressKey(address, slot), slot);
				}
			}
		}
		if (verified && !bounded) return;
		const mayLookAhead = bounded || page.readBytes !== null;
		const watchesWrites = page.writeWatches !== null;
		const pcAt = (index: number) => (basePc + index * INSTRUCTION_BYTES) >>> 0;
		const pageAt = (index: number) => pages[index >>> DECODED_PAGE_SHIFT];
		const wordAt = (index: number) => index & (DECODED_PAGE_WORDS - 1);
		const contains = (index: number) => index >= firstWord && index < endWord;
		const canDecode = (index: number) => mayLookAhead && (index + 1 < endWord || finalWordStartsInstruction);
		const graph = this.compiledSourceGraph ??= new CompiledSourceGraph();
		graph.begin(basePc, firstWord, endWord);
		if (!verified) graph.indexOwners(pages);
		const merged = new Set<CompiledRegion>();
		const entryIndex = (pc - basePc) / INSTRUCTION_BYTES;
		graph.enqueue(pc, true, true);
		for (let next = 0; next < graph.pendingCount; ++next) {
			const cursor = graph.pending[next], start = pcAt(cursor), sourcePage = pageAt(cursor), sourceWord = wordAt(cursor);
			// Immutable windows may link to another published entry without
			// replacing the other window and its continuation roots.
			if (verified && sourcePage.compiledBlocks?.entries[sourceWord]) continue;
			const ownerWord = verified ? 0 : graph.owners[cursor];
			const owner = ownerWord === 0 ? null : sourcePage.compiledBlocks!.entries[ownerWord - 1]!.region;
			if (owner !== null && !merged.has(owner)) {
				merged.add(owner); graph.enqueue(start, true);
				for (const block of owner.entries) {
					const index = pages.indexOf(block.page);
					if (index < 0) continue;
					const entry = index * DECODED_PAGE_WORDS + block.firstWord;
					if (!contains(entry)) continue;
					graph.enqueue(pcAt(entry), true, true);
				}
			}
			if ((sourcePage.refreshState[sourceWord] & DECODED_REFRESH_DECODE) !== 0) {
				if (!canDecode(cursor)) continue;
				if (!this.decodeInstruction(frame, sourcePage, sourceWord, start, false)) return;
			}
			const op = sourcePage.ops[sourceWord];
			if ((sourcePage.refreshState[sourceWord] & DECODED_REFRESH_DECODE) !== 0
				|| sourcePage.dispatchOps[sourceWord] === DecodedDispatchOp.Observe
				|| !compiledBlockSupports(op, sourcePage.a[sourceWord], sourcePage.c[sourceWord])) continue;
			if (op >= OpCode.GETSYS && op <= OpCode.SETGL) {
				const bank = op <= OpCode.SETSYS ? this.systemGlobalBank : this.globalBank;
				if (sourcePage.bx[sourceWord] >= bank.slots.capacity()) continue;
			}
			if (!(graph.flags[cursor] & SourceWord.Root) && watchesWrites && sourcePage.compiledBlocks!.visits[sourceWord] + 1 < COMPILED_BLOCK_THRESHOLD) continue;
			const width = sourcePage.widths[sourceWord], successor = cursor + width, successorPc = pcAt(successor);
			if (bounded && successor > endWord) continue;
			graph.flags[cursor] |= SourceWord.Available;
			if (op === OpCode.ITERN || compiledBlockComparison(op)) {
				if (mayLookAhead && contains(successor)) {
					const nextPage = pageAt(successor), nextWord = wordAt(successor);
					if ((nextPage.refreshState[nextWord] & DECODED_REFRESH_DECODE) !== 0 && canDecode(successor)
						&& !this.decodeInstruction(frame, nextPage, nextWord, successorPc, false)) return;
					const skipWidth = nextPage.widths[nextWord];
					if ((nextPage.refreshState[nextWord] & DECODED_REFRESH_DECODE) === 0 && successor + skipWidth <= endWord) {
						graph.skipWidths[cursor] = skipWidth;
						graph.enqueue(pcAt(successor + skipWidth), true);
						if (op !== OpCode.ITERN && nextPage === sourcePage && nextPage.ops[nextWord] === OpCode.JMP && nextPage.a[nextWord] === 0
							&& nextPage.dispatchOps[nextWord] !== DecodedDispatchOp.Observe) {
							// The fused edge does not need an independent JMP entry.
							graph.enqueue(nextPage.bx[nextWord], true);
							continue;
						}
					}
				}
				graph.enqueue(successorPc, true);
			} else if (op === OpCode.JMP || op === OpCode.JMPIF || op === OpCode.JMPIFNOT) {
				graph.enqueue(sourcePage.bx[sourceWord], true);
				if (op !== OpCode.JMP) graph.enqueue(successorPc, true);
			} else if (!compiledBlockEndsBlock(op, sourcePage.b[sourceWord])) {
				graph.enqueue(successorPc, sourceWord + width >= DECODED_PAGE_WORDS);
			} else if (compiledBlockHasContinuation(op, sourcePage.b[sourceWord])) graph.enqueue(successorPc, true);
		}
		if (!(graph.flags[entryIndex] & SourceWord.Available)) { page.dispatchOps[word] = page.ops[word]; return; }
		const plans = graph.plan(pages);
		const region = compileJavaScriptRegion(plans, image, this.memory, this.stringPool,
			this.globalBank.slots, this.systemGlobalBank.slots, this.cop0Words, this.gc);
		if (!this.compiledCodeCache.install(region, merged)) {
			page.dispatchOps[word] = page.ops[word];
			return;
		}
		if (image.compiledCodeLookup === null) image.compiledCodeLookup = new CompiledCodeLookup();
		for (let entry = 0; entry < region.entries.length; ++entry) {
			const block = region.entries[entry], sourcePage = block.page;
			sourcePage.dispatchCycles[block.firstWord] = BASE_CYCLES[sourcePage.ops[block.firstWord]];
			sourcePage.refreshState[block.firstWord] &= ~DECODED_REFRESH_FUSION;
			if (entry === 0 || region.entries[entry - 1].page !== sourcePage) {
				const sourcePc = (plans[entry].pc & ~MAPPED_PAGE_BYTE_MASK) >>> 0;
				image.compiledCodeLookup.install(sourcePc, slot, sourcePage);
			}
		}
	}

	private executeCompiledBlock(frame: CallFrame, page: DecodedInstructionPage, word: number, targetDepth: number, rewritten: boolean): Value | typeof ALLOCATION_PARKED | undefined {
		const cache = page.compiledBlocks!;
		if (page.dispatchOps[word] === DecodedDispatchOp.CompiledWarm) {
			if (cache.visits[word] < COMPILED_BLOCK_THRESHOLD) ++cache.visits[word];
			if (frame.compilationEntry && cache.visits[word] === COMPILED_BLOCK_THRESHOLD) {
				this.prepareCompiledRegion(frame, page, word);
			}
		}
		const thread = this.activeThread;
		let block = cache.entries[word];
		if (block === null || thread.stackRequiresScalar()) {
			frame.compilationEntry = rewritten || compiledBlockEndsBlock(page.ops[word], page.b[word]);
			return this.executeInstruction(frame, page, word, page.ops[word], targetDepth);
		}
		// The first instruction was admitted with positive budget and charged by
		// dispatch. Execute its bounded segment and return the complete charge.
		let remaining = this.instructionBudgetRemaining + page.dispatchCycles[word];
		if (!compiledBlockAdmits(block, frame, remaining)) {
			frame.compilationEntry = rewritten || compiledBlockEndsBlock(page.ops[word], page.b[word]);
			return this.executeInstruction(frame, page, word, page.ops[word], targetDepth);
		}
		for (;;) {
			const registers = frame.registers;
			const image = frame.executionImage;
			let current = block;
			let registerTop = frame.top;
			let exit: CompiledBlockExitSite;
			const run = this.compiledRunState;
			for (;;) {
				run.remainingCycles = remaining; run.registerTop = registerTop;
				exit = current.region.exits[current.region.execute(registers, image.constWords, current.page, frame, current.entry, run)];
				remaining = run.remainingCycles; registerTop = run.registerTop;
				if (exit.exit !== CompiledBlockExit.Continue) break;
				const target = exit.linkedBlock;
				if (target === null) break;
				if (!compiledBlockAdmits(target, frame, remaining)) break;
				current = target;
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
					this.executeConcat(frame, exit.exitA, exit.exitB, exit.exitC, true); break;
				case CompiledBlockExit.Call:
					redispatch = !this.executeCall(frame, exit.exitA, exit.exitB, exit.exitC);
					break;
				case CompiledBlockExit.Return:
					redispatch = !this.executeReturn(frame, exit.exitA, exit.exitB);
					break;
				case CompiledBlockExit.StringOrder: {
					const left = valuePayload(this.readRKValue(frame, exit.exitB)), right = valuePayload(this.readRKValue(frame, exit.exitC));
					this.beginStringComparison(frame, left, right, this.stringPool.byteLength(left), this.stringPool.byteLength(right),
						exit.page.ops[exit.exitWord] === OpCode.LE, exit.exitA !== 0);
					redispatch = true; break;
				}
				case CompiledBlockExit.SkipInstruction: this.skipNextInstruction(frame); redispatch = true; break;
				case CompiledBlockExit.IterateTable:
					if (this.stepTableIterator(frame, exit.exitA, exit.exitB, exit.exitC)) {
						if (exit.skippedInstructionWidth === 0) { this.skipNextInstruction(frame); redispatch = true; }
						else frame.pc = (exit.nextPc + exit.skippedInstructionWidth * INSTRUCTION_BYTES) >>> 0;
					}
					break;
				case CompiledBlockExit.Vararg: this.executeVararg(frame, exit.exitA, exit.exitB); break;
				case CompiledBlockExit.WriteGlobal:
				case CompiledBlockExit.WriteSystemGlobal: {
					const bank = exit.exit === CompiledBlockExit.WriteGlobal ? this.globalBank : this.systemGlobalBank;
					bank.writeSlot(exit.exitBx, registers.get(exit.exitA));
					redispatch = true;
					break;
				}
				case CompiledBlockExit.ReadUpvalue:
					this.copyUpvalueToRegister(frame, registers, exit.exitA, frame.captureAddress(exit.exitB)); break;
				case CompiledBlockExit.WriteUpvalue:
					this.copyRegisterToUpvalue(frame.captureAddress(exit.exitB), registers, exit.exitA); break;
				case CompiledBlockExit.InvalidOperand:
				case CompiledBlockExit.InvalidConstant: throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				case CompiledBlockExit.Length:
					if (this.executeLength(frame, exit.exitA, exit.exitB)) return;
					break;
				case CompiledBlockExit.AllocateTable:
					if (!this.executeNewTable(frame, exit.exitA, exit.exitB, exit.exitC)) return ALLOCATION_PARKED;
					if (this.yieldRequested) return;
					break;
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
						const key = image.constWords[exit.exitC];
						const result = this.resolveTableFieldIndexCached(base, exit.page, exit.exitWord, key);
						if (this.finishTableRead(frame, exit.exitA, base, valueString(key), result)) return;
					} else if (this.loadTableIndex(base, exit.exit === CompiledBlockExit.ReadInteger
						? valueInteger(exit.exitC) : this.readRKValue(frame, exit.exitC), frame, exit.exitA)) return;
					break;
				}
				case CompiledBlockExit.WriteField:
				case CompiledBlockExit.WriteInteger:
				case CompiledBlockExit.WriteIndex: {
					const base = registers.get(exit.exitA), value = this.readRKValue(frame, exit.exitC);
					const key = exit.exit === CompiledBlockExit.WriteField ? valueString(image.constWords[exit.exitB])
						: exit.exit === CompiledBlockExit.WriteInteger ? valueInteger(exit.exitB) : this.readRKValue(frame, exit.exitB);
					const invoked = valueTag(key) === ValueTag.String
						? this.storeTableFieldIndexCached(frame, base, exit.page, exit.exitWord, valuePayload(key), value)
						: this.storeTableIndex(frame, base, key, value);
					if (invoked) return this.pendingAllocation !== null ? ALLOCATION_PARKED : undefined;
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
				|| (this.haltedUntilIrqThread === this.activeThread.address && this.haltedUntilIrqFrameDepth === thread.frameDepth)) return;
			frame = thread.currentFrame!;
			const pc = frame.pc;
			if (exit.resumesFrame && pc === exit.nextPc && exit.linkedBlock !== null) {
				// Pure same-frame helpers retain the image and socket selection.
				// Target retirement already withdraws this intrusive cache link.
				block = exit.linkedBlock;
				if (!compiledBlockAdmits(block, frame, remaining)) return;
				continue;
			}
			if (frame.executionImage !== image) return;
			if ((pc & (INSTRUCTION_BYTES - 1)) !== 0) return;
			const lookup = frame.executionImage.compiledCodeLookup;
			if (lookup === null) return;
			const nextPage = lookup.find(pc, this.memory.cartridgeController.selectedSlot(this.executionBusSignals));
			if (nextPage === null) return;
			const nextCache = nextPage.compiledBlocks;
			if (nextCache === null) return;
			const next = nextCache.entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
			if (next === null) return;
			if (!compiledBlockAdmits(next, frame, remaining)) return;
			// Only shared-memory system code entering the selectable cartridge
			// window needs a fresh chip-select lookup on each traversal.
			if (pc === exit.nextPc && (exit.resumesFrame || exit.exit === CompiledBlockExit.Continue) && exit.linkedBlock === null
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
		service = false,
	): Value | typeof ALLOCATION_PARKED | undefined {
		const registers = frame.registers;
		const image = frame.executionImage;
		const a = page.a[pageOffset];
		if (op < OPCODE_COUNT && page.requiredSlots[pageOffset] > registers.capacity()) {
			switch (op) {
				// Mode and selector faults precede these register operands.
				case OpCode.MFC0: case OpCode.MTC0: break;
				// F64LE bills its format before it reads a register.
				case OpCode.LOAD_MEM: case OpCode.STORE_MEM: case OpCode.LOAD_MEM_D: case OpCode.STORE_MEM_D:
					if (page.c[pageOffset] === MemoryAccessKind.F64LE) this.instructionBudgetRemaining -= 2;
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				default: throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			}
		}
		switch (op) {
				case DecodedDispatchOp.CompiledWarm:
				case DecodedDispatchOp.Compiled:
					return this.executeCompiledBlock(frame, page, pageOffset, targetDepth, rewritten);
				case DecodedDispatchOp.Observe:
					frame.compilationEntry = rewritten || compiledBlockEndsBlock(page.ops[pageOffset], page.b[pageOffset]);
					this.instructionObserver!.observe(image.executionDomainId, this.currentInstructionPc, registers);
					// Observe has zero base cost; execute and charge the original instruction once.
					this.instructionBudgetRemaining -= decodedInstructionBaseCycles(page, pageOffset);
					return this.executeInstruction(frame, page, pageOffset, page.ops[pageOffset], targetDepth);
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
				case DecodedDispatchOp.InvalidImageOperand:
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
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
				case OpCode.ITERN:
					if (this.stepTableIterator(frame, a, page.b[pageOffset], page.c[pageOffset])) this.skipNextInstruction(frame);
					return;
				case OpCode.KSMI:
					this.setRegisterIntegerFast(frame, registers, a, page.sbx[pageOffset]);
					return;
				case OpCode.LOADNIL: {
					const b = page.b[pageOffset];
					registers.clear(b, a);
					this.charge(b);
					if (b !== 0) this.bumpRegisterTop(frame, a + b - 1);
					return;
				}
				case OpCode.GETSYS:
					registers.set(a, this.systemGlobalBank.readSlot(page.bx[pageOffset]));
					this.bumpRegisterTop(frame, a);
					return;
				case OpCode.SETSYS:
					this.systemGlobalBank.writeSlot(page.bx[pageOffset], registers.get(a));
					return;
				case OpCode.GETGL:
					registers.set(a, this.globalBank.readSlot(page.bx[pageOffset]));
					this.bumpRegisterTop(frame, a);
					return;
				case OpCode.SETGL:
					this.globalBank.writeSlot(page.bx[pageOffset], registers.get(a));
					return;
				case OpCode.GETI: {
					const base = registers.get(page.b[pageOffset]), index = page.c[pageOffset];
					if (valueTag(base) !== ValueTag.Table || !this.gc.tables.loadIntegerArrayKey(valuePayload(base), index, registers, a))
						this.loadTableIndex(base, valueInteger(index), frame, a);
					else this.bumpRegisterTop(frame, a);
					return;
				}
				case OpCode.SETI: {
					const base = registers.get(a), index = page.b[pageOffset], value = this.readRKValue(frame, page.c[pageOffset]);
					if (valueTag(base) !== ValueTag.Table || !this.gc.tables.storeIntegerArrayKey(valuePayload(base), index, valueTag(value), valuePayload(value))) {
						if (this.storeTableIndex(frame, base, valueInteger(index), value) && this.pendingAllocation !== null)
							return ALLOCATION_PARKED;
					}
					return;
				}
				case OpCode.GETFIELD:
				case OpCode.SELF: {
					const b = page.b[pageOffset], base = registers.get(b), key = image.constWords[page.c[pageOffset]];
					if (op === OpCode.SELF) {
						registers.copySlot(a + 1, b);
						this.bumpRegisterTop(frame, a + 1);
					}
					const result = this.resolveTableFieldIndexCached(base, page, pageOffset, key);
					if (result.status !== TableLookupStatus.Resolved && this.scalarRegisterTop >= 0) {
						// The normal loop owns the PC and must publish before a
						// metamethod or fault. Return the original SELF receiver.
						return base;
					}
					this.finishTableRead(frame, a, base, valueString(key), result);
					return;
				}
				case OpCode.SETFIELD:
					if (this.storeTableFieldIndexCached(frame, registers.get(a), page, pageOffset, image.constWords[page.b[pageOffset]], this.readRKValue(frame, page.c[pageOffset]))
						&& this.pendingAllocation !== null) return ALLOCATION_PARKED;
					return;
				case OpCode.HALT: this.haltUntilIrq(); return;
				case OpCode.GETT:
					this.loadTableIndex(registers.get(page.b[pageOffset]), this.readRKValue(frame, page.c[pageOffset]), frame, a); return;
				case OpCode.SETT:
					if (this.storeTableIndex(frame, registers.get(a), this.readRKValue(frame, page.b[pageOffset]), this.readRKValue(frame, page.c[pageOffset]))
						&& this.pendingAllocation !== null) return ALLOCATION_PARKED;
					return;
				case OpCode.NEWT:
					if (!this.executeNewTable(frame, a, page.b[pageOffset], page.c[pageOffset])) return ALLOCATION_PARKED;
					return;
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
					this.executeConcat(frame, a, page.b[pageOffset], page.c[pageOffset], true); return;
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
				case OpCode.LEN:
					this.executeLength(frame, a, page.b[pageOffset]); return;
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
						const ln = this.stringPool.byteLength(l), rn = this.stringPool.byteLength(r), shared = Math.min(ln, rn);
						if (shared > INLINE_STRING_COMPARE_BYTES) {
							this.beginStringComparison(frame, l, r, ln, rn, false, a !== 0);
							return;
						}
						this.charge(shared);
						ok = (this.stringPool.compareBytes(l, r, 0, shared) || ln - rn) < 0;
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
					if (a >= registers.capacity()) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
					const value = field === COP0_EXEC ? 0 : this.cop0Words[field];
					this.setRegisterIntegerFast(frame, registers, a, value);
					return;
				}
				case OpCode.MTC0: {
					if (this.isUserMode()) {
						this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
						return;
					}
					if (a >= registers.capacity()) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
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
						const ln = this.stringPool.byteLength(l), rn = this.stringPool.byteLength(r), shared = Math.min(ln, rn);
						if (shared > INLINE_STRING_COMPARE_BYTES) {
							this.beginStringComparison(frame, l, r, ln, rn, true, a !== 0);
							return;
						}
						this.charge(shared);
						ok = (this.stringPool.compareBytes(l, r, 0, shared) || ln - rn) <= 0;
					}
					if (ok !== (a !== 0)) this.skipNextInstruction(frame); return;
				}

				case OpCode.JMP: {
					if (a !== 0) this.charge(this.closeUpvalues(frame, frame.stackBase + a - 1));
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
					if (service) this.setRegisterIntegerFast(frame, registers, a, page.bx[pageOffset] * BLUA32_FUNCTION_ALIGNMENT);
					else this.executeClosure(frame, a, page.bx[pageOffset], page.c[pageOffset]);
					return;
				case OpCode.GETUP: {
					const index = page.b[pageOffset];
					if (index >= frame.captureCount) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
					const address = frame.captureAddress(index);
					this.copyUpvalueToRegister(frame, registers, a, address);
					return;
				}
				case OpCode.SETUP: {
					const index = page.b[pageOffset];
					if (index >= frame.captureCount) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
					const address = frame.captureAddress(index);
					this.copyRegisterToUpvalue(address, registers, a);
					return;
				}
				case OpCode.VARARG: {
					this.executeVararg(frame, a, page.b[pageOffset]);
					return;
				}
				case OpCode.CALL:
					if (service) {
						const supplied = page.b[pageOffset] - 1;
						const callee = this.prepareHeapServiceFrame(registers.getPayload(a), frame.stackBase + a + 1,
							a, page.c[pageOffset], frame.pc - INSTRUCTION_BYTES);
						const padding = Math.max(0, callee.top - supplied);
						callee.registers.clear(padding, callee.top - padding);
						this.charge(padding);
						callee.thread.enterFrame(callee);
					} else this.executeCall(frame, a, page.b[pageOffset], page.c[pageOffset]);
					return;
				case OpCode.RET:
					if (service) {
						const count = page.b[pageOffset] - 1;
						const caller = frame.previous;
						if (caller !== null) this.writeReturnValuesFromRegisters(caller, frame.returnBase, frame.returnCount, registers, a, count, true);
						else {
							this.memory.writeRamRecordWord(this.heapService.resultAddress, count === 0 ? 0 : registers.getPayload(a));
							this.charge(count);
						}
						frame.thread.leaveFrame();
					} else this.executeReturn(frame, a, page.b[pageOffset]);
					return;
				case OpCode.LOAD_MEM_D:
				case OpCode.STORE_MEM_D:
				case OpCode.LOAD_MEM:
				case OpCode.STORE_MEM: {
					const b = page.b[pageOffset];
					const c = page.c[pageOffset] as MemoryAccessKind;
					if (c === MemoryAccessKind.F64LE) this.instructionBudgetRemaining -= 2;
					const displaced = op === OpCode.LOAD_MEM_D || op === OpCode.STORE_MEM_D;
					const addr = displaced ? (wordOperand(registers.get(b)) + (page.operandByte[pageOffset] << 2)) >>> 0
						: wordOperand(this.readRKValue(frame, b));
					const load = op === OpCode.LOAD_MEM_D || op === OpCode.LOAD_MEM;
					if (service) this.executeHeapServiceAccess(frame, a, c, addr, load);
					else if (load) this.executeMemoryLoad(frame, a, c, addr);
					else this.executeMemoryStore(frame, a, c, addr);
					return;
				}
				case OpCode.STORE_MEM_WORDS_D:
				case OpCode.STORE_MEM_WORDS: {
					const b = page.b[pageOffset];
					const address = op === OpCode.STORE_MEM_WORDS_D
						? (wordOperand(registers.get(b)) + (page.operandByte[pageOffset] << 2)) >>> 0
						: wordOperand(this.readRKValue(frame, b));
					this.executeWordStores(frame, address, a, page.c[pageOffset]);
					return;
				}
		}
	}

	private prepareHeapServiceFrame(functionAddress: number, stackBase: number, returnBase: number, returnCount: number, callSite?: number): CallFrame {
		const thread = this.heapService.thread;
		const image = this.systemImage;
		if ((functionAddress >>> 0) >= SYSTEM_ROM_SIZE || romFunctionVersionLane(image.romFunctions, functionAddress) < 0
			|| !this.readFunctionRecord(image, functionAddress, MAPPED_BUS_MASTER_CPU)) {
			throw new Error('Heap service entry must identify a linked System ROM function.');
		}
		const { codeAddress, flags, maxStack, numParams, recordUpvalueCount } = this.functionRecordLatch;
		const capacity = Math.max(1, numParams, maxStack);
		if (codeAddress >= SYSTEM_ROM_SIZE || recordUpvalueCount !== 0 || (flags & (BLUA32_FUNCTION_STATIC | BLUA32_FUNCTION_VARARG)) !== BLUA32_FUNCTION_STATIC
			|| thread.frameDepth >= HEAP_SERVICE_FRAME_COUNT || stackBase + capacity > HEAP_SERVICE_VALUE_COUNT) {
			throw new Error('Function does not fit its fixed heap service activation.');
		}
		const frame = thread.acquireFrame();
		frame.executionImage = image;
		frame.decodedPage = null;
		frame.initializeControl(functionAddress, codeAddress, callSite ?? codeAddress, false, SYSTEM_EXECUTION_DOMAIN_ID,
			stackBase + numParams, 0, returnBase, returnCount, numParams, 0, stackBase, capacity);
		thread.stackTop = stackBase + capacity;
		return frame;
	}

	private executeHeapServiceAccess(frame: CallFrame, register: number, kind: MemoryAccessKind, address: number, load: boolean): void {
		const memory = this.memory;
		if ((kind !== MemoryAccessKind.Word && kind !== MemoryAccessKind.U32LE && kind !== MemoryAccessKind.U8)
			|| (address & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[kind]) !== 0) {
			throw new Error('Heap service access requires an aligned byte or word.');
		}
		if (load) {
			let word: number;
			if (((address - RAM_BASE) >>> 0) < memory.ramByteCount()) {
				// Raw records may project into the bus-visible part or beneath MMIO.
				word = kind === MemoryAccessKind.U8 ? memory.readRamRecordByte(address) : memory.readRamRecordWord(address);
			} else if (((address - HEAP_SERVICE_ROOT_PORT_BASE) >>> 0) < HEAP_SERVICE_ROOT_PORT_BYTES) {
				word = this.readHeapServiceRoot(address - HEAP_SERVICE_ROOT_PORT_BASE, kind);
			} else {
				const slot = address >>> BLUA32_STRING_ROM_SOCKET_SHIFT;
				const busAddress = address & BLUA32_STRING_ROM_ADDRESS_MASK;
				const view = this.executionReadView;
				if ((slot !== 0 && busAddress < CART_ROM_BASE)
					|| !memory.bindRomByteView(busAddress, kind === MemoryAccessKind.U8 ? 1 : 4, slot, view)) {
					throw new Error('Heap service read is outside installed RAM and ROM.');
				}
				word = kind === MemoryAccessKind.U8 ? view.bytes[view.byteOffset] : readLE32(view.bytes, view.byteOffset);
			}
			this.setRegisterIntegerFast(frame, frame.registers, register, word);
		} else {
			if (address < memory.ramBusEnd() || address >= this.heapService.thread.address)
				throw new Error('Heap service write is outside its private RAM port.');
			const word = wordOperand(frame.registers.get(register));
			if (kind === MemoryAccessKind.U8) memory.writeRamRecordByte(address, word);
			else memory.writeRamRecordWord(address, word);
		}
	}

	private pushFrame(
		closure: number, args: CallFrame | ValueSlots | ReadonlyArray<Value>,
		returnBase: number, returnCount: number, returnToCompletionLatch: boolean,
		exception = false, callSitePc?: number, argBase = 0, supplied = 0,
	): CallFrame {
		const flags = this.memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS);
		const domain = Closure.executionDomain(flags);
		const image = this.executionImageForDomain(domain)!;
		const prototype = this.memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS);
		let entry: Readonly<Closure.FunctionEntry>;
		if ((flags & Closure.CLOSURE_LATCHED_PROTOTYPE) !== 0) {
			Closure.readLatchedEntry(this.memory, closure, this.latchedCallEntry);
			entry = this.latchedCallEntry;
		} else entry = image.romCallBindings.bind(this.memory, image, prototype, this.executionReadView);
		const { codeAddress, numParams, maxStack, flags: functionFlags } = entry;
		const thread = this.activeThread;
		const fromFrame = args instanceof CallFrame;
		const fromSlots = fromFrame || args instanceof ValueSlots;
		const shared = fromFrame && args.thread === thread;
		const first = fromFrame ? args.stackBase + argBase : argBase;
		const count = fromSlots ? supplied : args.length;
		const argumentBase = shared ? first : thread.stackTop;
		const vararg = (functionFlags & BLUA32_FUNCTION_VARARG) !== 0;
		const extras = vararg ? Math.max(count - numParams, 0) : 0;
		const stackBase = vararg ? argumentBase + count : argumentBase;
		const capacity = Math.max(1, numParams, maxStack);
		const frame = thread.acquireFrame();
		if (stackBase + capacity > MAX_THREAD_VALUE_SLOTS) throw LUA_OUT_OF_MEMORY_SIGNAL;
		this.ensureStackCapacity(stackBase + capacity, valueClosure(closure), true, exception);
		frame.executionImage = image;
		frame.decodedPage = null;
		const varargBase = argumentBase + numParams;
		frame.initializeControl(prototype, codeAddress, callSitePc ?? codeAddress, returnToCompletionLatch,
			domain, varargBase, extras, returnBase, returnCount, numParams, closure, stackBase, capacity);
		const copied = Math.min(numParams, count);
		if (fromSlots) {
			const slots = fromFrame ? args.thread.stackRegisters : args;
			if (!shared || vararg) frame.registers.copyRangeFrom(slots, 0, first, copied, numParams - copied);
			else frame.registers.clear(numParams - copied, copied);
			if (shared && vararg) thread.stackRegisters.clear(copied, argumentBase);
			else if (extras !== 0) thread.stackRegisters.copyRangeFrom(slots, varargBase, first + numParams, extras);
			this.charge(shared ? (vararg ? numParams : numParams - copied) : numParams + extras);
		} else {
			for (let i = 0; i < copied; ++i) frame.registers.set(i, args[i]);
			frame.registers.clear(numParams - copied, copied);
			for (let i = 0; i < extras; ++i) thread.stackRegisters.set(varargBase + i, args[numParams + i]);
		}
		thread.stackTop = stackBase + capacity;
		thread.enterFrame(frame);
		this.latchActiveExecutionImage(domain, image);
		return frame;
	}

	private createClosure(frame: CallFrame): number {
		const functionRecord = this.functionRecordLatch;
		if ((functionRecord.flags & BLUA32_FUNCTION_STATIC) !== 0
			&& functionRecord.recordUpvalueCount === 0) {
			return this.staticClosureFromLatch();
		}
		const count = functionRecord.recordUpvalueCount;
		const latched = !functionRecord.romBacked;
		if (Closure.closureRecordBytes(count, latched) > MAIN_RAM_SIZE) throw LUA_OUT_OF_MEMORY_SIGNAL;
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
				return 0;
			}
			upvalueWords[index] = word;
			const upvalueIndex = word & BLUA32_UPVALUE_INDEX_MASK;
			if ((word & BLUA32_UPVALUE_IN_STACK_MASK) !== 0) {
				if (upvalueIndex >= frame.registers.capacity()) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				const cell = this.findOpenUpvalue(frame, upvalueIndex);
				upvalues[index] = cell;
				if (cell === 0) newUpvalueCount += 1;
				continue;
			}
			if (upvalueIndex >= frame.captureCount) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			upvalues[index] = frame.captureAddress(upvalueIndex);
		}
		if (this.captureAddresses.length < newUpvalueCount) this.captureAddresses = new Uint32Array(newUpvalueCount);
		const address = this.luaHeap.allocateClosureRecord(count, latched, this.captureAddresses, newUpvalueCount);
		const closure = address;
		Closure.initializeRecord(this.memory, address, functionRecord, false, this.gc.white(), count, latched);
		let nextCell = 0;
		for (let index = 0; index < functionRecord.recordUpvalueCount; index += 1) {
			if (upvalues[index] !== 0 || (upvalueWords[index] & BLUA32_UPVALUE_IN_STACK_MASK) === 0) {
				Closure.setCaptureAddress(this.memory, closure, index, upvalues[index]);
				continue;
			}
			const cell = this.captureAddresses[nextCell++];
			this.linkOpenUpvalue(frame, cell, (frame.stackBase + (upvalueWords[index] & BLUA32_UPVALUE_INDEX_MASK)) >>> 0);
			Closure.setCaptureAddress(this.memory, closure, index, cell);
		}
		this.gc.publishObject(closure);
		this.charge(count);
		return closure;
	}

	private closeUpvalues(frame: CallFrame, firstSlot = 0): number {
		const head = frame.openUpvalueHead;
		let address = head;
		let closed = 0;
		while (address !== 0 && closed < UPVALUE_CHAIN_LIMIT) {
			const cell = this.gc.openCellAddress(address);
			if (cell === 0) break;
			if (firstSlot !== 0 && this.memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD) < firstSlot) break;
			address = this.memory.readRamRecordWord(cell + UPVALUE_NEXT);
			Upvalue.close(this.gc, cell);
			++closed;
		}
		const remaining = firstSlot === 0 ? 0 : address;
		if (head !== remaining) frame.openUpvalueHead = remaining;
		return closed;
	}

	private copyUpvalueToRegister(frame: CallFrame, registers: ValueSlots, registerIndex: number, address: number): void {
		registers.set(registerIndex, Upvalue.load(this.memory, address));
		this.bumpRegisterTop(frame, registerIndex);
	}

	private copyRegisterToUpvalue(address: number, registers: ValueSlots, registerIndex: number): void {
		Upvalue.store(this.gc, address, registers.getTag(registerIndex), registers.getPayload(registerIndex));
	}

	private writeReturnValuesFromRegisters(frame: CallFrame, base: number, count: number, source: ValueSlots, sourceBase: number, sourceCount: number, fixedStack = false): void {
		const targetCount = selectedCallResultCount(count, sourceCount);
		if (targetCount > 0) {
			const registers = fixedStack ? frame.registers : this.ensureRegisterCapacity(frame, base + targetCount - 1);
			const copiedCount = Math.min(sourceCount, targetCount);
			registers.copyRangeFrom(source, base, sourceBase, copiedCount, targetCount - copiedCount);
		}
		frame.setCallResultTop(base + targetCount, count);
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
		if (this.scalarRegisterTop >= 0) this.scalarRegisterTop = Math.max(this.scalarRegisterTop, nextTop);
		else if (nextTop > frame.top) {
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

	private setRegisterClosureFast(frame: CallFrame, registers: ValueSlots, index: number, value: number): void {
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
			case BuiltinFunctionId.TableCopy: {
				const { registers, base } = args;
				if (args.length === 0 || registers.getTag(base) !== ValueTag.Table) {
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				}
				const tables = this.gc.tables, copy = tables.copyOwn(registers.getPayload(base));
				this.charge(tables.arrayCapacity(copy) + 2 * tables.hashSize(copy));
				out.push(valueTable(copy));
				break;
			}
			case BuiltinFunctionId.GetGlobal: {
				if (args.length === 0 || args.registers.getTag(args.base) !== ValueTag.String) {
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				}
				const slot = this.globalBank.find(args.registers.getPayload(args.base));
				if (slot === undefined) out.push(valueNil());
				else out.push(this.globalBank.slots.get(slot));
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
			case BuiltinFunctionId.FrameHeader:
			case BuiltinFunctionId.GetFrameRegister:
			case BuiltinFunctionId.SetFrameRegister:
			case BuiltinFunctionId.GetFrameUpvalue:
			case BuiltinFunctionId.SetFrameUpvalue:
				this.gc.threads.invokeDiagnostic(this.gc, id, args, out);
				break;
			case BuiltinFunctionId.StringByte:
				this.runBuiltinStringByte(args, out);
				break;
			case BuiltinFunctionId.StringChar:
				this.runBuiltinStringChar(args, out);
				break;
			case BuiltinFunctionId.StringFromBytes: {
				if (args.length < 2) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				const { registers, base } = args;
				const address = valueToInteger(registers.get(base)), count = valueToInteger(registers.get(base + 1));
				if (address === null || count === null || count < 0) {
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				}
				if (count === 0) {
					out.push(valueString(this.stringPool.intern('')));
					break;
				}
				const span = this.executionReadView;
				if (!this.memory.bindMappedReadView(address >>> 0, count, MAPPED_BUS_MASTER_CPU, span)) {
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				}
				this.charge(count);
				out.push(valueString(this.stringPool.internBytes(span)));
				break;
			}
			case BuiltinFunctionId.StringSlice: {
				const { registers, base } = args;
				if (args.length < 3 || registers.getTag(base) !== ValueTag.String) {
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				}
				const id = registers.getStringId(base);
				const first = valueToInteger(registers.get(base + 1)), last = valueToInteger(registers.get(base + 2));
				if (first === null || last === null || first < 1 || last < first || last > this.stringPool.byteLength(id)) {
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				}
				const count = last - first + 1;
				this.charge(count);
				out.push(valueString(this.stringPool.internSlice(id, first - 1, count)));
				break;
			}
			case BuiltinFunctionId.SetStringIndex:
				if (args.length === 0 || args.registers.getTag(args.base) !== ValueTag.Table) {
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				}
				this.stringIndexTable = args.registers.get(args.base);
				break;
			case BuiltinFunctionId.CoroutineCreate: {
				const closure = args.length !== 0 && args.registers.getTag(args.base) === ValueTag.Closure
					? this.gc.closureRecordAddress(args.registers.getPayload(args.base)) : 0;
				if (closure === 0) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				out.push(valueThread(this.createThread(closure)));
				break;
			}
			case BuiltinFunctionId.CoroutineRunning:
				out.push(valueThread(this.activeThread.address));
				out.push(valueBool(this.activeThread === this.rootThread));
				break;
			case BuiltinFunctionId.CoroutineStatus:
			case BuiltinFunctionId.CoroutineClose:
			case BuiltinFunctionId.CoroutineIsYieldable: {
				const address = args.length === 0 && id === BuiltinFunctionId.CoroutineIsYieldable ? this.activeThread.address
					: args.length > 0 && args.registers.getTag(args.base) === ValueTag.Thread ? args.registers.getThread(args.base, this.gc) : 0;
				if (address === 0) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				if (id === BuiltinFunctionId.CoroutineIsYieldable) out.push(valueBool(this.coroutineYieldable(address)));
				else if (id === BuiltinFunctionId.CoroutineStatus) {
					out.push(valueInteger(this.readThreadStatus(address)));
				} else {
					const failed = this.readThreadStatus(address) === ThreadStatus.Failed;
					out.push(valueBool(!(failed)));
					if (failed) out.push(this.readThreadError(address));
					this.closeThread(address);
					this.memory.writeRamRecordPair(address + ThreadField.ErrorWord, 0, ValueTag.Nil);
				}
				break;
			}
			case BuiltinFunctionId.CoroutineResume:
			case BuiltinFunctionId.CoroutineYield:
				throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			case BuiltinFunctionId.CollectGarbage: {
				const operation = args.length === 0 ? GarbageCollectionOperation.Collect : integerOperand(args.registers.get(args.base));
				switch (operation) {
					case GarbageCollectionOperation.Collect: this.gc.requestFullCollection(); break;
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

	public createThread(entry: number): number {
		const address = this.luaHeap.allocateThreadRecord(entry);
		if (this.localRootScopeDepth > 0) this.localRoots.push(valueThread(address));
		return address;
	}

	private coroutineYieldable(address: number): boolean {
		if (address === this.rootThread.address) return false;
		for (let index = 0, depth = this.readThreadFrameDepth(address); index < depth; ++index)
			if ((this.readThreadFrameWord(address, index, FrameField.Flags) & (FRAME_COMPLETION | FRAME_EXCEPTION)) !== 0) return false;
		const depth = this.memory.readRamRecordWord(address + ThreadField.ProtectedDepth) & THREAD_CONTROL_COUNT_MASK;
		const protectedBase = this.memory.readRamRecordWord(address + ThreadField.ProtectedBlock) & RAM_RECORD_WORD_MASK;
		for (let index = 0; index < depth; ++index) {
			if ((this.memory.readRamRecordWord(protectedBase + index * PROTECTED_CALL_BYTES + ProtectedField.Flags) & PROTECTED_CALL_KIND_MASK) === ProtectedCallKind.XPCallHandler) return false;
		}
		return true;
	}

	private returnToResumer(source: ValueSlots | null, sourceBase: number, sourceCount: number): void {
		const thread = this.activeThread;
		const rootBase = this.localRoots.length;
		this.localRoots.push(valueThread(thread.address));
		try {
			const resumer = this.bindThread(thread.resumer);
			this.activeThread = resumer;
			this.resumeFrameBank();
			resumer.status = ThreadStatus.Running;
			const caller = resumer.currentFrame!;
			const callBase = resumer.callBase;
			const returnCount = resumer.returnCount;
			const count = selectedCallResultCount(returnCount, sourceCount + 1);
			if (count > 0) {
				const registers = this.ensureRegisterCapacity(caller, callBase + count - 1);
				registers.setBoolean(callBase, source !== null);
				const copied = Math.min(sourceCount, count - 1);
				if (source !== null) registers.copyRangeFrom(source, callBase + 1, sourceBase, copied, count - copied - 1);
				else {
					if (copied !== 0) registers.set(callBase + 1, thread.error);
					registers.clear(count - copied - 1, callBase + copied + 1);
				}
			}
			caller.setCallResultTop(callBase + count, returnCount);
			thread.resumer = 0;
			this.threadSwitchRequested = true;
			this.yieldRequested = true;
			this.charge(count);
		} finally { this.localRoots.length = rootBase; }
	}

	private runCoroutineTransfer(id: BuiltinFunctionId, caller: CallFrame, callBase: number, returnCount: number,
		argumentBase: number, argCount: number, detached?: ValueSlots): void {
		const thread = this.activeThread;
		const source = detached ?? caller.registers;
		if (id === BuiltinFunctionId.CoroutineYield) {
			if (!this.coroutineYieldable(thread.address)) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			thread.setReturnWindow(callBase, returnCount);
			thread.status = ThreadStatus.Suspended;
			this.returnToResumer(source, argumentBase, argCount);
			return;
		}
		if (argCount === 0 || source.getTag(argumentBase) !== ValueTag.Thread) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		const targetAddress = source.getThread(argumentBase, this.gc);
		if (targetAddress === 0) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		const status = this.readThreadStatus(targetAddress);
		const exceptionActive = this.readExceptionReturnFrameDepth() !== -1;
		if (exceptionActive || (status !== ThreadStatus.New && status !== ThreadStatus.Suspended)) {
			const results = this.acquireBuiltinResults();
			try {
				results.push(valueBool(false));
				results.push(valueString(this.stringPool.intern(exceptionActive ? 'cannot resume coroutine across a hardware exception' : 'cannot resume non-suspended coroutine')));
				this.writeReturnValuesFromRegisters(caller, callBase, returnCount, results.slots, 0, results.length);
			} finally { this.releaseBuiltinResults(results); }
			return;
		}
		const target = this.bindThread(targetAddress);
		const fresh = status === ThreadStatus.New;
		thread.setReturnWindow(callBase, returnCount);
		thread.status = ThreadStatus.Normal;
		target.resumer = thread.address;
		target.status = ThreadStatus.Running;
		this.activeThread = target;
		if (fresh) {
			const closure = this.gc.closureRecordAddress(target.entry);
			this.pushFrame(closure, detached ?? caller, 0, 0, false, false, 0, argumentBase + 1, argCount - 1);
			target.entry = 0;
		} else {
			this.resumeFrameBank();
			const frame = target.currentFrame!;
			this.writeReturnValuesFromRegisters(frame, target.callBase, target.returnCount, source, argumentBase + 1, argCount - 1);
		}
		this.threadSwitchRequested = true;
		this.yieldRequested = true;
	}

	private handleThreadError(error: Value): boolean {
		if (this.handleProtectedCallError(error)) return true;
		const thread = this.activeThread;
		if (thread.resumer === 0) return false;
		for (let frame = thread.currentFrame; frame !== null; frame = frame.previous)
			if (frame.isExceptionFrame || frame.returnToCompletionLatch) return false;
		thread.status = ThreadStatus.Failed;
		thread.error = error;
		this.returnToResumer(null, 0, 1);
		return true;
	}

	public closeThread(address: number): void {
		const status = this.readThreadStatus(address);
		if (status === ThreadStatus.Running || status === ThreadStatus.Normal) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		const thread = this.bindThread(address);
		while (thread.currentFrame !== null) {
			this.charge(this.closeUpvalues(thread.currentFrame));
			thread.leaveFrame();
		}
		thread.protectedDepth = 0;
		thread.stackRegisters.clear(thread.stackRegisters.capacity());
		thread.stackTop = 0;
		thread.entry = 0;
		thread.status = ThreadStatus.Dead;
	}

	private runBuiltinFunction(id: BuiltinFunctionId, frame: CallFrame, callBase: number, returnCount: number, argCount: number,
		detached?: ValueSlots, argumentBase = callBase + 1): void {
		this.charge(BUILTIN_FUNCTIONS[id].cost.base);
		if (id === BuiltinFunctionId.PCall || id === BuiltinFunctionId.XPCall) {
			this.startProtectedCall(id, frame, callBase, returnCount, argumentBase, argCount, false, detached);
			return;
		}
		if (id === BuiltinFunctionId.CoroutineResume || id === BuiltinFunctionId.CoroutineYield) {
			this.runCoroutineTransfer(id, frame, callBase, returnCount, argumentBase, argCount, detached);
			return;
		}
		const builtinArgs = this.acquireRegisterBuiltinArgs();
		const results = this.acquireBuiltinResults();
		try {
			builtinArgs.bind(detached ?? frame.registers, argumentBase, argCount);
			this.callBuiltinFunction(id, builtinArgs, results, selectedCallResultCount(returnCount, -1));
			if (id === BuiltinFunctionId.RawSet && this.tableRebuild.record) {
				const j = this.tableRebuild;
				j.result = TableStoreReturn.Call; j.destination = callBase; j.wanted = returnCount >>> 0;
				j.instructionPc = this.currentInstructionPc;
				return;
			}
			if (this.activeThread.frameDepth > 0 && this.activeThread.currentFrame! === frame) {
				this.writeReturnValuesFromRegisters(frame, callBase, returnCount, results.slots, 0, results.length);
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
		detached?: ValueSlots,
	): void {
		let handler = valueNil();
		if (id === BuiltinFunctionId.XPCall) {
			if (argumentCount > 1) handler = (detached ?? caller.registers).get(argumentBase + 1);
			const handlerTag = valueTag(handler);
			if (handlerTag !== ValueTag.Closure
				&& handlerTag !== ValueTag.BuiltinFunction) {
				throw new LuaExecutionError(LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION);
			}
		}
		const kind = id === BuiltinFunctionId.PCall ? ProtectedCallKind.PCall : ProtectedCallKind.XPCallBody;
		const continuationIndex = this.activeThread.pushProtectedCall(kind, returnsToProtectedParent, callBase,
			returnCount, handler);

		const targetArgumentOffset = id === BuiltinFunctionId.PCall ? 1 : 2;
		this.invokeProtectedTarget(
			continuationIndex,
			argumentCount > 0 ? (detached ?? caller.registers).get(argumentBase) : valueNil(),
			argumentBase + targetArgumentOffset,
			Math.max(argumentCount - targetArgumentOffset, 0),
			detached,
		);
	}

	private invokeProtectedTarget(
		continuationIndex: number,
		target: Value,
		argumentBase: number,
		argumentCount: number,
		detached?: ValueSlots,
	): void {
		const caller = this.protectedCaller(continuationIndex);
		switch (valueTag(target)) {
			case ValueTag.Closure: {
				const closure = this.gc.closureRecordAddress(valuePayload(target));
				if (closure === 0) throw new LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
				const frame = this.pushFrame(closure, detached ?? caller, 0, 0, false, false,
					detached === undefined ? caller.pc - INSTRUCTION_BYTES : this.currentInstructionPc, argumentBase, argumentCount);
				frame.protectedContinuationIndex = continuationIndex;
				return;
			}
			case ValueTag.BuiltinFunction: {
				const builtinId = valuePayload(target);
				this.charge(BUILTIN_FUNCTIONS[builtinId].cost.base);
				if (builtinId === BuiltinFunctionId.PCall || builtinId === BuiltinFunctionId.XPCall) {
					const word = this.activeThread.protectedWord(continuationIndex, ProtectedField.Wanted);
					const implicit = (word & CALL_RESULT_EXTEND_TOP) !== 0;
					const base = implicit ? 0 : this.activeThread.protectedWord(continuationIndex, ProtectedField.Base) | 0;
					this.startProtectedCall(builtinId, caller, base, implicit ? DISCARD_CALL_RESULT : 0,
						argumentBase, argumentCount, true, detached);
					return;
				}
				const builtinArgs = this.acquireRegisterBuiltinArgs();
				const results = this.acquireBuiltinResults();
				try {
					builtinArgs.bind(detached ?? caller.registers, argumentBase, argumentCount);
					this.callBuiltinFunction(builtinId, builtinArgs, results, -1);
					if (builtinId === BuiltinFunctionId.RawSet && this.tableRebuild.record) {
						const j = this.tableRebuild;
						j.result = TableStoreReturn.Protected; j.destination = continuationIndex;
						j.instructionPc = this.currentInstructionPc;
						return;
					}
					this.finishProtectedCall(continuationIndex, results.slots, 0, results.length);
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

	private finishProtectedCall(continuationIndex: number, source: ValueSlots, sourceBase: number, sourceCount: number): void {
		if ((this.activeThread.protectedWord(continuationIndex, ProtectedField.Flags) & PROTECTED_CALL_KIND_MASK) === ProtectedCallKind.XPCallHandler) {
			this.finishProtectedCallWithError(continuationIndex, sourceCount > 0 ? source.get(sourceBase) : valueNil());
			return;
		}
		if (this.finishImplicitProtectedHandler(continuationIndex, true)) return;
		const caller = this.protectedCaller(continuationIndex);
		const callBase = this.activeThread.protectedWord(continuationIndex, ProtectedField.Base) | 0;
		const returnCount = this.activeThread.protectedWord(continuationIndex, ProtectedField.Wanted) | 0;
		const resultCount = selectedCallResultCount(returnCount, sourceCount + 1);
		if (resultCount > 0) {
			const registers = this.ensureRegisterCapacity(caller, callBase + resultCount - 1);
			const copiedCount = Math.min(sourceCount, resultCount - 1);
			registers.copyRangeFrom(source, callBase + 1, sourceBase, copiedCount);
			registers.setBoolean(callBase, true);
			registers.clear(resultCount - copiedCount - 1, callBase + copiedCount + 1);
		}
		caller.setCallResultTop(callBase + resultCount, returnCount);
		this.charge(resultCount);
		this.finishProtectedContinuation(continuationIndex, resultCount);
	}

	private finishProtectedCallWithError(
		continuationIndex: number,
		error: Value,
	): void {
		if (this.finishImplicitProtectedHandler(continuationIndex, false)) return;
		const caller = this.protectedCaller(continuationIndex);
		const callBase = this.activeThread.protectedWord(continuationIndex, ProtectedField.Base) | 0;
		const returnCount = this.activeThread.protectedWord(continuationIndex, ProtectedField.Wanted) | 0;
		const resultCount = selectedCallResultCount(returnCount, 2);
		if (resultCount > 0) {
			const registers = this.ensureRegisterCapacity(caller, callBase + resultCount - 1);
			registers.setBoolean(callBase, false);
			if (resultCount > 1) {
				registers.set(callBase + 1, error);
				registers.clear(resultCount - 2, callBase + 2);
			}
		}
		caller.setCallResultTop(callBase + resultCount, returnCount);
		this.charge(resultCount);
		this.finishProtectedContinuation(continuationIndex, resultCount);
	}

	private finishImplicitProtectedHandler(continuationIndex: number, succeeded: boolean): boolean {
		const thread = this.activeThread;
		if ((thread.protectedWord(continuationIndex, ProtectedField.Flags) & PROTECTED_CALL_PARENT) === 0
			|| (thread.protectedWord(continuationIndex, ProtectedField.Wanted) & CALL_RESULT_EXTEND_TOP) === 0) return false;
		// Deliver the protected handler's first return directly. No temporary
		// guest slot is written, regardless of the enclosing operation's result count.
		thread.protectedDepth = continuationIndex;
		const results = this.acquireBuiltinResults();
		try {
			results.push(valueBool(succeeded));
			this.finishProtectedCall(continuationIndex - 1, results.slots, 0, results.length);
		} finally { this.releaseBuiltinResults(results); }
		return true;
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
			this.finishProtectedCall(continuationIndex - 1, caller.registers, callBase, resultCount);
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
			const handler = this.activeThread.protectedHandler(continuationIndex);
			const callBase = this.activeThread.protectedWord(continuationIndex, ProtectedField.Base) | 0;
			const resultWord = this.activeThread.protectedWord(continuationIndex, ProtectedField.Wanted);
			this.charge(1);
			const rootBase = this.localRoots.length;
			try {
				if ((resultWord & CALL_RESULT_EXTEND_TOP) !== 0) {
					this.localRoots.push(error);
					const args = this.acquireRegisterBuiltinArgs();
					try {
						args.bindDetached(error);
						this.invokeProtectedTarget(continuationIndex, handler, 0, 1, args.registers);
					} finally { this.releaseRegisterBuiltinArgs(args); }
				} else {
					const registers = this.ensureRegisterCapacity(caller, callBase);
					registers.set(callBase, error);
					this.bumpRegisterTop(caller, callBase);
					this.invokeProtectedTarget(continuationIndex, handler, callBase, 1);
				}
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
			} finally { this.localRoots.length = rootBase; }
		}
	}

	private runBuiltinNextValue(args: BuiltinArgsView, out: BuiltinResults): void {
		const registers = args.registers, base = args.base;
		if (args.length === 0 || registers.getTag(base) !== ValueTag.Table) throw new LuaExecutionError(LUA_FAULT_REASON_ITERATE_NON_TABLE);
		const address = registers.getPayload(base);
		this.gc.tables.next(address, args.length > 1 ? registers.get(base + 1) : valueNil(), out, 0);
	}

	private stepTableIterator(frame: CallFrame, base: number, destination: number, count: number): boolean {
		const registers = frame.registers, table = base + 1, cursor = base + 2;
		if (registers.getTag(base) !== ValueTag.BuiltinFunction || registers.getPayload(base) !== BuiltinFunctionId.Next
			|| registers.getTag(table) !== ValueTag.Table || registers.getTag(cursor) !== ValueTag.Nil) return false;
		const position = this.gc.tables.nextStoredEntry(registers.getPayload(table),
			registers.getPayload(cursor), registers, destination, count > 1);
		const placed = count > 1 && position !== 0 ? 2 : 1;
		if (count > placed) registers.clear(count - placed, destination + placed);
		registers.setEncoded(cursor, ValueTag.Nil, position);
		this.charge(count);
		this.bumpRegisterTop(frame, destination + count - 1);
		return true;
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
		if (args.length < 2 || registers.getTag(base) !== ValueTag.Table) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		const address = registers.getPayload(base);
		this.gc.tables.load(address, registers.getTag(base + 1), registers.getPayload(base + 1), out, 0);
	}
	private advanceTableStore(frame: CallFrame): boolean {
		const j = this.tableRebuild, receiver = j.record;
		const phase = j.census;
		if (phase === TableCensus.None) this.instructionBudgetRemaining = this.gc.tables.advanceRebuild(j, this.instructionBudgetRemaining);
		else {
			this.currentInstructionPc = j.instructionPc;
			if (!this.gc.tables.advanceCensus(this)) {
				if (phase === TableCensus.RetryFresh) throw LUA_OUT_OF_MEMORY_SIGNAL;
				this.parkTableWrite(frame, receiver, j.key, j.value, 0);
				if (phase === TableCensus.RetryCurrent) this.pendingAllocation!.recovery = AllocationRecovery.Fresh;
				return false;
			}
		}
		if (j.record || j.result === TableStoreReturn.None) return true;
		this.currentInstructionPc = j.instructionPc;
		const results = this.acquireBuiltinResults();
		try {
			results.push(valueTable(receiver));
			if (j.result === TableStoreReturn.Protected) this.finishProtectedCall(j.destination, results.slots, 0, 1);
			else this.writeReturnValuesFromRegisters(frame, j.destination, j.wanted, results.slots, 0, 1);
		} finally {
			this.releaseBuiltinResults(results);
		}
		return true;
	}
	private runBuiltinRawSet(args: BuiltinArgsView, out: BuiltinResults): void {
		const registers = args.registers, base = args.base;
		if (args.length < 3 || registers.getTag(base) !== ValueTag.Table) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		this.gc.tables.set(registers.getPayload(base), registers.get(base + 1), registers.get(base + 2), this);
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
	public captureRuntimeState(completionValues: Value[] = []): CpuRuntimeState {
		completionValues.length = this.completionValueCount;
		for (let i = 0; i < this.completionValueCount; ++i)
			completionValues[i] = this.completionValueSlots.get(i);
		let executionResidencyMask = 0;
		const constantPoolBases = new Array<number>(EXECUTION_DOMAIN_COUNT).fill(0);
		const globalMapBases = new Array<number>(EXECUTION_DOMAIN_COUNT).fill(0);
		for (let index = 0; index < this.executionImagesByDomain.length; index += 1) {
			const image = this.executionImagesByDomain[index];
			if (image !== null) {
				executionResidencyMask |= 1 << index;
				constantPoolBases[index] = image.constantBase;
				globalMapBases[index] = image.globalMapBase;
			}
		}
		return {
			executionCartridgeSlot: this.activeExecutionDomainId,
			programExecutionDomainId: this.programExecutionDomainId,
			systemGlobals: this.systemGlobalBank.captureState(),
			globals: this.globalBank.captureState(),
			executionResidencyMask,
			constantPoolBases, globalMapBases,
			hardHalted: this.hardHalted,
			stringIndexTable: this.stringIndexTable,
			rootThreadAddress: this.rootThread.address,
			activeThreadAddress: this.activeThread.address,
			completionThreadAddress: this.completionThread,
			completionValues,
			lastExecutionDomainId: this.lastExecutionDomainId,
			lastPc: this.lastPc,
			haltedUntilIrqFrameDepth: this.haltedUntilIrqFrameDepth,
			haltedUntilIrqThreadAddress: this.haltedUntilIrqThread,
			interruptEventPending: this.interruptEventPending,
			memoryWriteBlocked: this.memoryWriteBlocked,
			memoryWriteBlockedAddress: this.memoryWriteBlockedAddress,
			stringComparison: { ...this.stringComparison },
			rebuild: this.tableRebuild.record ? { ...this.tableRebuild } : null,
			concat: this.concat.capture(),
			pendingMemory: { ...this.pendingMemory },
			pendingAllocation: this.pendingAllocation === null ? null : { ...this.pendingAllocation },
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
		this.clearCompletionValues();
		this.gc.onRecordRetirement?.(null);
		for (const bank of this.threadBanks) {
			bank.bindAddress(0);
			bank.dropParkedFrameViews();
		}
		this.memory.clearMappedPageWriteWatches();
		this.reindexCanonicalClosures();
		this.executionImagesByDomain.fill(null);
		this.systemGlobalBank.bind(state.systemGlobals);
		this.globalBank.bind(state.globals);
		for (let index = 0; index < this.executionImagesByDomain.length; index += 1) {
			if ((state.executionResidencyMask & (1 << index)) !== 0) {
				const boot = this.executionAddressSpace.resolveDomain((index - 1) as ExecutionDomainId)!;
				this.executionImagesByDomain[index] = this.materializeExecutionImage(boot, this.readExecutionImageHeader(boot), state.constantPoolBases[index], state.globalMapBases[index]);
			}
		}
		this.systemImage = this.executionImagesByDomain[SYSTEM_EXECUTION_DOMAIN_ID + 1]!;
		this.bindPhysicalFrames(this.heapService.thread);
		const executionImage = this.executionImagesByDomain[state.executionCartridgeSlot + 1];
		this.latchActiveExecutionImage(state.executionCartridgeSlot, executionImage);

		this.rootThread.bindAddress(state.rootThreadAddress);
		this.bindPhysicalFrames(this.rootThread);
		this.activeThread = this.rootThread;
		this.activeThread = this.bindThread(state.activeThreadAddress);
		if (this.activeThread.currentFrame !== null) this.activeThread.currentFrame.executionImage = this.activeExecutionImage;
		this.completionThread = state.completionThreadAddress;
		this.threadSwitchRequested = false;
		this.stringIndexTable = state.stringIndexTable;
		if (state.completionValues.length > this.completionValueSlots.capacity()) {
			this.completionValueSlots.resizeCapacity(state.completionValues.length);
		}
		for (let index = 0; index < state.completionValues.length; ++index)
			this.completionValueSlots.set(index, state.completionValues[index]);
		this.completionValueCount = state.completionValues.length;
		this.programExecutionDomainId = state.programExecutionDomainId;
		this.lastExecutionDomainId = state.lastExecutionDomainId;
		this.lastPc = state.lastPc;
		this.haltedUntilIrqFrameDepth = state.haltedUntilIrqFrameDepth;
		this.haltedUntilIrqThread = state.haltedUntilIrqThreadAddress;
		this.interruptEventPending = state.interruptEventPending;
		this.memoryWriteBlocked = state.memoryWriteBlocked;
		this.memoryWriteBlockedAddress = state.memoryWriteBlockedAddress;
		Object.assign(this.stringComparison, state.stringComparison);
		if (state.rebuild) Object.assign(this.tableRebuild, state.rebuild);
		else this.tableRebuild.record = 0;
		this.concat.restore(state.concat);
		Object.assign(this.pendingMemory, state.pendingMemory);
		this.pendingAllocation = state.pendingAllocation === null ? null : { ...state.pendingAllocation };
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
	}

	public visitReachableExecutionRecords(visitor: (closure: number) => void, visitThread?: (thread: number, frameDepth: number) => void): void {
		const objects: number[] = [];
		const upvalues: number[] = [];
		const seen = new Set<number>();
		const add = (value: Value): void => {
			const tag = valueTag(value);
			if (tag === ValueTag.Table) {
				const address = this.gc.tableRecordAddress(valuePayload(value));
				if (address !== 0) objects.push(address);
			} else if (tag === ValueTag.Closure) {
				const closure = this.gc.closureRecordAddress(valuePayload(value));
				if (closure !== 0) objects.push(closure);
			} else if (tag === ValueTag.Thread) objects.push(asThread(value, this.gc));
		};
		const addSlots = (slots: ValueSlots, count: number): void => {
			for (let index = 0; index < count; index += 1) add(slots.get(index));
		};
		addSlots(this.systemGlobalBank.slots, this.systemGlobalBank.count);
		addSlots(this.globalBank.slots, this.globalBank.count);
		addSlots(this.completionValueSlots, this.completionValueCount);
		add(this.stringIndexTable);
		objects.push(this.rootThread.address, this.activeThread.address);
		if (this.completionThread !== 0) objects.push(this.completionThread);
		if (this.haltedUntilIrqThread !== 0) objects.push(this.haltedUntilIrqThread);
		for (const versions of this.staticClosures.addressGroups())
			for (const closure of versions) if (!this.gc.sweepGarbage(closure)) objects.push(closure);
		for (const value of this.localRoots) add(value);
		for (let index = 0; index < this.builtinResultsScratchIndex; index += 1) {
			const slots = this.builtinResultsScratch.peek(index);
			for (let valueIndex = 0; valueIndex < slots.length; valueIndex += 1) add(slots.get(valueIndex));
		}
		while (objects.length > 0 || upvalues.length > 0) {
			if (upvalues.length > 0) {
				const cell = upvalues.pop()!;
				if (seen.has(cell)) continue;
				seen.add(cell);
				if (Upvalue.isOpen(this.memory, cell)) {
					const thread = this.gc.threadRecordAddress(this.memory.readRamRecordWord(cell + UPVALUE_OWNER));
					if (thread !== 0) objects.push(thread);
				}
				add(Upvalue.load(this.memory, cell));
				continue;
			}
			const address = objects.pop()!;
			if (seen.has(address)) continue;
			seen.add(address);
			switch (this.memory.readRamRecordByte(address)) {
				case ValueTag.Closure: {
					const closure = this.gc.closureRecordAddress(address)!;
					visitor(closure);
					for (let index = 0, count = Closure.captureCount(this.memory, closure); index < count; ++index) {
						const cell = this.gc.cellRecordAddress(Closure.captureAddress(this.memory, closure, index));
						if (cell !== 0) upvalues.push(cell);
					}
					break;
				}
				case ValueTag.Table: {
					const meta = this.gc.tables.metatableAddress(address);
					if (meta !== 0) add(valueTable(meta));
					this.gc.tables.forEachStoredEntry(address, (key, value) => { add(key); add(value); });
					break;
				}
				case THREAD_RECORD_KIND: {
					const entry = this.memory.readRamRecordWord(address + ThreadField.Entry);
					if (entry !== 0) objects.push(entry);
					const resumer = this.readThreadResumer(address);
					if (resumer !== 0) objects.push(resumer);
					add(this.readThreadError(address));
					const layout = this.inspectionThreadLayout;
					this.gc.threads.readLayout(address, layout);
					visitThread?.(address, layout.depth);
					for (let index = 0; index < layout.protectedDepth; ++index) {
						const continuation = layout.protectedOffset + index * PROTECTED_CALL_BYTES;
						const flags = this.memory.readRamRecordWord(continuation + ProtectedField.Flags);
						if ((flags & PROTECTED_CALL_KIND_MASK) !== ProtectedCallKind.PCall && (flags & PROTECTED_CALL_HANDLER_BUILTIN) === 0)
							objects.push(this.memory.readRamRecordWord(continuation + ProtectedField.Handler));
					}
					this.inspectionThreadValues.bindRam(this.memory, layout.offset, layout.capacity, false, true);
					addSlots(this.inspectionThreadValues, layout.top);
					for (let index = layout.depth - 1; index >= 0; --index) {
						add(valueClosure(this.readThreadFrameWord(address, index, FrameField.Closure)));
						let head = this.readThreadFrameWord(address, index, FrameField.OpenHead);
						for (let remaining = UPVALUE_CHAIN_LIMIT; head !== 0 && remaining !== 0; --remaining) {
							const cell = this.gc.openCellAddress(head);
							if (cell === 0) break;
							upvalues.push(cell);
							head = this.memory.readRamRecordWord(cell + UPVALUE_NEXT);
						}
					}
					break;
				}
			}
		}
	}

	public chargeCollectionWork(work: number): void {
		if (this.runKind !== CpuRunKind.Idle) this.charge(GC_WORK_WORD_CYCLES * work);
	}

	public assistAllocation(root0: Value, root1: Value, root2: Value, growingThread: number, words: number): number {
		if (this.runKind !== CpuRunKind.Idle) {
			if (this.instructionBudgetRemaining < GC_WORK_WORD_CYCLES) return 0;
			words = Math.min(words, Math.trunc(this.instructionBudgetRemaining / GC_WORK_WORD_CYCLES));
		}
		const work = this.gc.step(root0, root1, root2, growingThread, false, words);
		this.chargeCollectionWork(work);
		return work;
	}

	public collectTrackedHeapBytes(root0: Value = valueNil(), root1: Value = valueNil(), root2: Value = valueNil()): number {
		this.gc.collect(root0, root1, root2);
		return this.luaHeap.usedBytes();
	}

	public publishHeapRemarkHead(): void {
		const memory = this.memory, head = this.heapAllocator.managementOffset() + HEAP_SERVICE_REMARK_HEAD_OFFSET;
		const stringIndex = this.stringIndexTable, comparison = this.stringComparison;
		memory.writeRamRecordWord(head + HeapServiceRemarkHeadField.StringIndexTag, valueTag(stringIndex));
		memory.writeRamRecordPair(head + HeapServiceRemarkHeadField.StringIndexWord, valuePayload(stringIndex), comparison.remaining);
		if (comparison.remaining !== 0) {
			memory.writeRamRecordPair(head + HeapServiceRemarkHeadField.ComparisonLeft, comparison.left, comparison.right);
		}
		const pending = this.pendingAllocation;
		if (pending?.kind === PendingAllocationKind.TableAssignment) {
			memory.writeRamRecordWord(head + HeapServiceRemarkHeadField.Receiver, pending.receiver);
			memory.writeRamRecordPair(head + HeapServiceRemarkHeadField.KeyTag, valueTag(pending.key), valuePayload(pending.key));
			memory.writeRamRecordPair(head + HeapServiceRemarkHeadField.ValueTag, valueTag(pending.value), valuePayload(pending.value));
			memory.writeRamRecordWord(head + HeapServiceRemarkHeadField.HasPendingAssignment, 1);
		} else {
			memory.writeRamRecordWord(head + HeapServiceRemarkHeadField.HasPendingAssignment, 0);
		}
	}

	public markRootHead(heap: GcHeap): void {
		heap.markString(this.modeKey);
		heap.markString(this.indexKey);
		heap.markValue(this.gc.tables.newIndexKey);
		heap.markString(this.lengthKey);
		heap.markString(this.errorInErrorHandlingStringId);
		for (let i = 0; i < this.luaFaultErrorStringIds.length; ++i)
			if (i !== LUA_FAULT_REASON_EXPLICIT_ERROR) heap.markString(this.luaFaultErrorStringIds[i]);
		heap.markValue(this.stringIndexTable);
		if (this.stringComparison.remaining !== 0) { heap.markString(this.stringComparison.left); heap.markString(this.stringComparison.right); }
		if (this.pendingAllocation !== null) this.markPendingAllocationRoots(heap, this.pendingAllocation);
	}

	public markScopedRoots(heap: GcHeap): void {
		for (let i = 0; i < this.builtinResultsScratchIndex; ++i) {
			const slots = this.builtinResultsScratch.peek(i);
			for (let j = 0; j < slots.length; ++j) heap.markValue(slots.get(j));
		}
		for (const value of this.localRoots) heap.markValue(value);
	}

	public pendingOperandTop(thread: number): number {
		return this.concat.registersLeft && this.activeThread.address === thread ? this.concat.nextRegister + this.concat.registersLeft : 0;
	}

	private writeHeapRootBank(address: number, count: number, payloads: number, tags: number, names: number): void {
		this.memory.writeRamRecordPair(address + HeapServiceRootBankField.Count, count, payloads);
		this.memory.writeRamRecordPair(address + HeapServiceRootBankField.Tags, tags, names);
	}

	/** Publish addresses and extents only. Root data stays with its CPU owner. */
	public publishHeapRootBanks(): void {
		const memory = this.memory, descriptor = this.heapAllocator.managementOffset() + HEAP_SERVICE_ROOT_BANKS_OFFSET;
		memory.writeRamRecordPair(descriptor, this.rootThread.address, this.activeThread.address);
		memory.writeRamRecordPair(descriptor + 8, this.completionThread, this.haltedUntilIrqThread);
		const banks = descriptor + HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE;
		this.systemGlobalBank.publishHeapRootBank(banks);
		this.globalBank.publishHeapRootBank(banks + HEAP_SERVICE_ROOT_BANK_SIZE);
		let destination = banks + 2 * HEAP_SERVICE_ROOT_BANK_SIZE;
		for (let plane = 0; plane < EXECUTION_DOMAIN_COUNT; ++plane, destination += HEAP_SERVICE_ROOT_BANK_SIZE) {
			const image = this.executionImagesByDomain[plane];
			this.writeHeapRootBank(destination, image === null ? 0 : image.constantStringRoots.length,
				HEAP_SERVICE_ROOT_PORT_BASE + plane * HEAP_SERVICE_ROOT_PORT_STRIDE, 0, 0);
		}
		this.writeHeapRootBank(destination, this.completionValueCount,
			HEAP_SERVICE_ROOT_PORT_BASE + HeapServiceRootPlane.CompletionPayloads * HEAP_SERVICE_ROOT_PORT_STRIDE,
			HEAP_SERVICE_ROOT_PORT_BASE + HeapServiceRootPlane.CompletionTags * HEAP_SERVICE_ROOT_PORT_STRIDE, 0);
		const count = this.rootBankSlots(GcRootBank.ConcatOperands);
		const source = count === 0 ? 0 : this.concat.source;
		this.writeHeapRootBank(destination + HEAP_SERVICE_ROOT_BANK_SIZE, count,
			HEAP_SERVICE_ROOT_PORT_BASE + HeapServiceRootPlane.ConcatPayloads * HEAP_SERVICE_ROOT_PORT_STRIDE + 4 * source,
			HEAP_SERVICE_ROOT_PORT_BASE + HeapServiceRootPlane.ConcatTags * HEAP_SERVICE_ROOT_PORT_STRIDE + source, 0);
	}

	private readHeapServiceRoot(offset: number, kind: MemoryAccessKind): number {
		const plane = offset >>> HEAP_SERVICE_ROOT_PORT_SHIFT;
		const address = offset & (HEAP_SERVICE_ROOT_PORT_STRIDE - 1);
		const byte = kind === MemoryAccessKind.U8;
		const slot = byte ? address : address >>> 2;
		switch (plane) {
			case HeapServiceRootPlane.SystemConstants:
			case HeapServiceRootPlane.Cart0Constants:
			case HeapServiceRootPlane.Cart1Constants: {
				const image = this.executionImagesByDomain[plane];
				if (!byte && image !== null && slot < image.constantStringRoots.length) return image.constantStringRoots[slot];
				break;
			}
			case HeapServiceRootPlane.CompletionPayloads:
			case HeapServiceRootPlane.CompletionTags:
				if (byte === (plane === HeapServiceRootPlane.CompletionTags) && slot < this.completionValueCount)
					return byte ? this.completionValueSlots.getTag(slot) : this.completionValueSlots.getPayload(slot);
				break;
			case HeapServiceRootPlane.ConcatPayloads:
			case HeapServiceRootPlane.ConcatTags: {
				const concat = this.concat;
				if (byte === (plane === HeapServiceRootPlane.ConcatTags) && concat.active && slot >= concat.source && slot < concat.values.length) {
					const value = concat.values[slot];
					return byte ? valueTag(value) : valuePayload(value);
				}
				break;
			}
		}
		throw new Error('Heap service read is outside its root port.');
	}

	public rootBankSlots(bank: GcRootBank): number {
		if (bank === GcRootBank.SystemGlobals) return this.systemGlobalBank.count;
		if (bank === GcRootBank.Globals) return this.globalBank.count;
		if (bank === GcRootBank.Completion) return this.completionValueCount;
		if (bank === GcRootBank.ConcatOperands) return this.concat.active ? this.concat.values.length - this.concat.source : 0;
		const image = this.executionImagesByDomain[bank - GcRootBank.SystemConstants];
		return image === null ? 0 : image.constantStringRoots.length;
	}

	public markRootBank(heap: GcHeap, bank: GcRootBank, first: number, end: number): void {
		if (bank < GcRootBank.SystemConstants) {
			const names = bank === GcRootBank.SystemGlobals ? this.systemGlobalBank : this.globalBank;
			const slots = names.slots;
			for (let slot = first; slot < end; ++slot) {
				heap.markString(names.name(slot)); heap.markSlot(slots, slot);
			}
			return;
		}
		if (bank === GcRootBank.Completion) {
			for (let slot = first; slot < end; ++slot) heap.markSlot(this.completionValueSlots, slot);
			return;
		}
		if (bank === GcRootBank.ConcatOperands) {
			const values = this.concat.values;
			for (let slot = first; slot < end; ++slot) {
				const v = values[this.concat.source + slot];
				if (valueTag(v) === ValueTag.String) heap.markString(valuePayload(v));
			}
			return;
		}
		const image = this.executionImagesByDomain[bank - GcRootBank.SystemConstants]!;
		for (let slot = first; slot < end; ++slot) heap.markString(image.constantStringRoots[slot]);
	}

	public markRootThreads(heap: GcHeap): void {
		heap.markThread(this.rootThread.address); heap.markThread(this.activeThread.address); heap.markThread(this.completionThread);
		heap.markThread(this.haltedUntilIrqThread);
	}

	public retireStaticClosure(address: number): void {
		const prototype = this.memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS);
		this.staticClosures.retire(prototype, address);
	}

}

// end normalized-body-acceptable
// end repeated-sequence-acceptable
