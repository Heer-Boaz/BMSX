import { ReturnSource, ValueMoveKind } from '../../spec/blua32/instruction_format';
import { GcHeap, GcRootBank, GC_WORK_WORD_CYCLES } from './gc_heap';
import { PendingMemoryKind, type PendingMemoryOperation } from './memory_operation';
import { valueAdd, valueSubtract, valueMultiply, valueDivide, valueFloorDivide, valueModulo, valuePower, valueNegate, integerOperand, wordOperand, } from './value_arithmetic';
import { numberToF32Bits } from '../../common/float32';
import { CART_READ_ADDRESS_MASK, CART_READ_SLOT_SHIFT, CART_ROM_BASE, CART_ROM_END, CART_ROM_SIZE, CPU_RESET_BANK_ADDRESS, CPU_RESET_BANK_END, CPU_IRQ_VECTOR_ADDRESS, CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_FIXED_FRAME_ADDRESS, CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_ADDRESS, CPU_FIXED_VALUE_COUNT, CPU_FIXED_VALUE_END, DYNAMIC_RAM_BASE, HEAP_PAGE_SIZE, MAIN_RAM_SIZE, RAM_BASE, RUNTIME_MANAGEMENT_SIZE, RAM_RECORD_WORD_MASK, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE } from '../../spec/bmsx/memory_map';
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
import type { DeviceScheduler } from '../scheduler/device';
import { BASE_CYCLES, INLINE_STRING_COMPARE_BYTES, TABLE_INDEX_VISIT_CYCLES, OPCODE_COUNT, OPCODE_USES_BX, OPCODE_USES_DISP, OPCODE_RK_OPERANDS, RK_OPERAND_B, RK_OPERAND_C, OpCode, decodeValueCount } from '../../spec/blua32/opcode';
import {
	cop0FieldImplemented, cop0ReadAsZero,
	COP0_BAD_ADDRESS,
	COP0_CAUSE,
	COP0_EPC,
	COP0_EXEC, COP0_CONTEXT, COP0_RAM_END, COP0_SYSTEM_VECTOR, COP0_PREVIOUS_ACTIVE, COP0_EXCEPTION_TARGET, COP0_IRQ_VECTOR, COP0_CURRENT, COP0_EVENT_CYCLES,
	CPU_EXCEPTION_TARGET_ADDRESS_MASK, CPU_EXCEPTION_TARGET_SOCKET_SHIFT, CPU_INTERRUPT_STATE_HALT,
	COP0_LUA_FAULT_REASON,
	COP0_STATUS,
	CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD,
	CPU_CAUSE_CODE_ADDRESS_ERROR_STORE,
	CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR,
	CPU_CAUSE_CODE_DATA_BUS_ERROR,
	CPU_CAUSE_CODE_SYSCALL,
	CPU_CAUSE_CODE_REGISTER_WINDOW,
	CPU_CAUSE_CODE_REFERENCE_STORE,
	CPU_CAUSE_CODE_STORAGE_WINDOW,
	CPU_CAUSE_CODE_FUNCTION_BINDING,
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
	CPU_STATUS_USER_MODE_CURRENT, CPU_STATUS_INHIBIT_RESET,
	LUA_FAULT_REASON_ASSIGN_NON_TABLE,
	LUA_FAULT_REASON_CALL_NON_FUNCTION,
	LUA_FAULT_REASON_EXPLICIT_ERROR,
	LUA_FAULT_REASON_INDEX_NAN,
	LUA_FAULT_REASON_INDEX_NON_TABLE,
	LUA_FAULT_REASON_INVALID_ARGUMENT,
	LUA_FAULT_REASON_ITERATE_NON_TABLE,
	LUA_FAULT_REASON_METATABLE_LOOP,
	LUA_FAULT_REASON_OUT_OF_MEMORY,
	LUA_FAULT_REASON_UNKNOWN,
} from '../../spec/blua32/cop0';
import {
	BASE_OPERAND_A_BITS, BASE_OPERAND_BC_BITS, CLOSURE_ADDRESS_REGISTER_FLAG,
	CLOSURE_DESTINATION_EXT_MASK,
	CLOSURE_DESTINATION_EXT_SHIFT, INSTRUCTION_BYTES, MAX_OPERAND_BITS,
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
	BLUA32_FUNCTION_STATIC, BLUA32_FUNCTION_RESIDENT, BLUA32_FUNCTION_CODE,
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
	executionImageBindingOffset, EXECUTION_IMAGE_BINDING_RAM_STRINGS_OFFSET, EXECUTION_IMAGE_BINDING_SPAN_OFFSET,
	EXECUTION_IMAGE_BINDING_STRINGS_OFFSET, GLOBAL_BANK_OFFSET, SYSTEM_GLOBAL_BANK_OFFSET,
} from '../../spec/blua32/execution_domain';
import { MEMORY_ACCESS_KIND_ALIGNMENT_MASKS, VALUE_MEMORY_SIZE, VALUE_MEMORY_TAG_OFFSET, MemoryAccessKind } from '../../spec/blua32/memory_access_kind';
import { ScratchBuffer } from '../../common/scratchbuffer';
import { luaShiftLeft, luaShiftRight, NumericOrder } from '../../spec/blua32/numeric';
import {
	MAPPED_PAGE_BYTE_MASK,
	MAPPED_PAGE_BYTE_SIZE,
	mappedPageDomainIndex, mappedPageAddressKey,
} from '../memory/mapped_page';
import { BuiltinFunctionId, BUILTIN_FUNCTION_COUNT } from '../../spec/blua32/builtin';
import {
	EMPTY_CALL_ARGS,
	ValueTag,
	valueTable, valueClosure, valueNil, valueInteger, valueFloat, valueFloatBits, valuePayload, valueFromTag,
	canonicalTableKey, valueIsInteger, valueIsFloat, valueIsNumber, asInteger, asFloat, compareNumbers, valuesEqual, valueString, valueBool, valueThread, asThread,
	isNil, valueTag, valueToInteger,
	type Value,
} from './value';
import { LUA_OUT_OF_MEMORY_SIGNAL, LuaExecutionError, LuaThrownValueError } from './errors';
import { TableRecords, TableHeader, TABLE_INDEX_CHAIN_LIMIT, HASH_STORE_DECLINED,
	TableLookupStatus, type TableLookupResult } from './table';
import * as Closure from './closure';
import { CLOSURE_BINDING_FLAGS, CLOSURE_CANONICAL, CLOSURE_LATCHED_PROTOTYPE, CLOSURE_PROTOTYPE_ADDRESS, sameFunctionPrototype, type FunctionPrototype } from './closure';
import { StaticClosureIndex } from './static_closure_index';
import { UPVALUE_NEXT, UPVALUE_CHAIN_LIMIT, UPVALUE_VALUE_WORD, UPVALUE_OWNER } from './upvalue';
import * as Upvalue from './upvalue';
import { ValueSlots } from './value_slots';
import { GlobalBank } from './global_bank';
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
	IMAGE_STRING_RAM_ORDINAL, loadImageStringBinding, storeImageStringBinding,
	type Blua32ExecutionImage,
	type ExecutionImageRelocation,
	type Blua32FunctionRecordLatch,
	type DecodedInstructionPage,
} from './execution_image';
import { FRAME_CONTROL_BYTES, FRAME_WINDOW_MASK, FRAME_COMPLETION, FRAME_EXTEND_RESULT_TOP, FrameField, frameBankWord, frameExecutionBank, CALL_RESULT_EXTEND_TOP, SINGLE_CALL_RESULT, DISCARD_CALL_RESULT, selectedCallResultCount, CallFrame, frameCaptureCount, FRAME_RESIDENT_ACTIVATION, registerWindowBucket } from './call_state';
import { CompiledCodeLookup } from './compiled_code_lookup';
import { Thread, ThreadStatus, THREAD_RECORD_KIND } from './thread';
import { ThreadField, ThreadLayout, THREAD_CONTROL_COUNT_MASK, THREAD_HEAP_BYTES, THREAD_STACK_SLOT_BYTES, MAX_THREAD_VALUE_SLOTS } from './thread_record';
import { LuaAllocationMode, LuaHeap } from './lua_heap';
import { HeapAllocator } from './heap_allocator';
import { HeapService } from './heap_service';
import {
	HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET, HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET, HEAP_SERVICE_DESCRIPTOR_SIZE,
	HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET,
	HEAP_SERVICE_CAPTURE_BINDING_OFFSET, HEAP_SERVICE_FIRMWARE_DATA_OFFSET,
	HeapServiceCaptureBindingField,
	HEAP_SERVICE_ENTRY_COUNT, HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_IMAGE_ADDRESS_OFFSET, HEAP_SERVICE_IMAGE_FLAG, HEAP_SERVICE_IMAGE_HEADER_SIZE,
	HEAP_SERVICE_VALUE_COUNT, HeapServiceClosureField, HeapServiceOperation,
	HeapServiceProjection, HeapServiceResidentField,
	HEAP_SERVICE_RESIDENT_OFFSET, HEAP_SERVICE_MANAGEMENT_ADDRESS, HEAP_SERVICE_CALL_CYCLES_ADDRESS,
	HEAP_SERVICE_CALL_RUN_KIND_ADDRESS, HEAP_SERVICE_CALL_FAULT_ADDRESS, HEAP_SERVICE_RESULT_FAULT,
	HeapServiceRecordKind, HeapServiceRecordMode,
	HEAP_SERVICE_REMARK_HEAD_OFFSET, HeapServiceRemarkHeadField,
	HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE, HEAP_SERVICE_ROOT_BANKS_OFFSET, HEAP_SERVICE_ROOT_PORT_BASE,
	HEAP_SERVICE_ROOT_PORT_BYTES, HEAP_SERVICE_ROOT_PORT_SHIFT, HEAP_SERVICE_ROOT_PORT_STRIDE,
	HeapServiceRootBankField, HeapServiceRootPlane,
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
	executionResidencyMask: ExecutionDomainMask;
	hardHalted: boolean;
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
	pendingMemory: PendingMemoryOperation;
	statusWord: number;
	systemVectorWord: number;
	previousRootContextWord: number;
	previousActiveContextWord: number;
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

export const enum CpuRunKind { Idle, Direct, Scheduled }

class StringComparisonLatch {
	left = 0; right = 0; offset = 0; remaining = 0;
	order = 0; skipLess = false; skipTie = false;
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


const enum ExecutionImageUpdate { Replace, Restore, Select }

export class CPU implements MappedPageInvalidator {
	/** Current runUntilDepth grant; consumed by the caller, not checkpoint state. */
	public instructionBudgetRemaining: number = 0;
	public lastPc: number = 0;
	public readonly rootThread: Thread;
	public activeThread: Thread;
	private unpublishedRomMask: ExecutionDomainMask = 0;
	private readonly threadBanks: readonly Thread[];
	private readonly irqThread: Thread;
	private completionThread = 0;
	private readonly inspectionThreadLayout = new ThreadLayout();
	private readonly inspectionThreadValues = new ValueSlots(0);
	public readonly memory: Memory;

	public readonly luaHeap: LuaHeap;
	public readonly heapAllocator: HeapAllocator;
	public readonly gc: GcHeap;
	private readonly heapService: HeapService;
	private readonly closureArgs: number[];
	public readonly stringPool: StringPool;
	private haltedUntilIrqFrameDepth = -1;
	private haltedUntilIrqThread = 0;
	private interruptEventPending = false;
	private memoryWriteBlocked = false;
	private memoryWriteBlockedAddress = 0;
	private runKind = CpuRunKind.Idle;
	private deviceClock: DeviceScheduler | null = null;
	private stringComparison = new StringComparisonLatch();
	private readonly pendingMemory: PendingMemoryOperation = { kind: PendingMemoryKind.None, instructionPc: 0, nextPc: 0, address: 0, accessKind: MemoryAccessKind.Word, registerIndex: 0, wordCount: 0 };
	private currentInstructionPc = 0;
	private scalarRegisterTop = -1;
	private lastExecutionDomainId: ExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	private hardHalted = false;
	private readonly cop0Words = new Uint32Array(COP0_PREVIOUS_ACTIVE + 1);
	private exceptionDomainWord = 0;
	private nmiReturnCauseWord = 0;
	private nmiReturnEpcWord = 0;
	private nmiReturnBadAddressWord = 0;
	private nmiReturnLuaFaultReasonWord = 0;
	private nmiReturnExceptionDomainWord = 0;
	private nonMaskableInterruptPending = false;
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
	private readonly capturedClosureArgs = [0, 0, 0, 0, 0, 0];
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
	private readonly staticClosures: StaticClosureIndex;
	private stateReplacementListeners: Set<() => void> | null = null;
	private readonly systemGlobalBank: GlobalBank;
	private readonly globalBank: GlobalBank;
	private completionValueSlots = new ValueSlots(8);
	private completionValueCount = 0;

	constructor(
		memory: Memory,
		private readonly irqController: IrqController,
		private readonly executionAddressSpace: ExecutionAddressSpace,
		// The interpreter is the default: on BMSX's high-level opcodes the
		// generated JavaScript costs more time, memory and warm-up than it saves.
		private readonly executionBackend = CpuExecutionBackend.Interpreter,
	) {
		this.memory = memory;
		this.staticClosures = new StaticClosureIndex(memory);
		memory.setRamBusEnd(DYNAMIC_RAM_BASE);
		this.cop0Words[COP0_STATUS] = CPU_STATUS_CART_ENTRY;
		this.heapAllocator = new HeapAllocator(memory);
		this.luaHeap = new LuaHeap(this);
		this.closureArgs = [this.heapAllocator.managementOffset(), HeapServiceRecordKind.CanonicalClosure, 0, 0, HeapServiceRecordMode.Direct, 0];
		this.stringPool = new StringPool(this.luaHeap, this.memory, this.heapAllocator);
		this.gc = new GcHeap(this, this.luaHeap, memory, this.heapAllocator);
		this.heapService = new HeapService(this.gc);
		const management = this.heapAllocator.managementOffset();
		this.systemGlobalBank = new GlobalBank(memory, this.gc, management + SYSTEM_GLOBAL_BANK_OFFSET);
		this.globalBank = new GlobalBank(memory, this.gc, management + GLOBAL_BANK_OFFSET);
		this.rootThread = new Thread(this.gc);
		this.threadBanks = [this.rootThread, new Thread(this.gc), new Thread(this.gc)];
		this.irqThread = new Thread(this.gc);
		this.activeThread = this.rootThread;
		this.memory.attachMappedPageInvalidator(this);
	}

	private initializeResetBank(): void {
		const memory = this.memory, offset = CPU_RESET_BANK_ADDRESS - RAM_BASE, end = CPU_RESET_BANK_END - RAM_BASE;
		const frames = CPU_FIXED_FRAME_ADDRESS - RAM_BASE;
		const frameBytes = CPU_FIXED_FRAME_COUNT * FRAME_CONTROL_BYTES;
		const values = CPU_FIXED_VALUE_ADDRESS - RAM_BASE, valuesEnd = CPU_FIXED_VALUE_END - RAM_BASE;
		memory.ramData().fill(0, offset, end);
		memory.ramData().fill(0, frames, frames + frameBytes);
		memory.ramData().fill(0, values, valuesEnd);
		memory.invalidateRamWrite(offset, end - offset);
		memory.invalidateRamWrite(frames, frameBytes);
		memory.invalidateRamWrite(values, valuesEnd - values);
		memory.writeRamRecordPair(CPU_RESET_BANK_ADDRESS + ThreadField.StackBlock, CPU_FIXED_VALUE_ADDRESS, CPU_FIXED_VALUE_COUNT);
		memory.writeRamRecordWord(CPU_RESET_BANK_ADDRESS + ThreadField.FrameCapacity, CPU_FIXED_FRAME_COUNT);
		memory.writeRamRecordWord(CPU_RESET_BANK_ADDRESS + ThreadField.FrameBlock, CPU_FIXED_FRAME_ADDRESS);
		this.rootThread.bindAddress(CPU_RESET_BANK_ADDRESS);
		this.rootThread.bindStack();
		this.rootThread.reserveFrameViews(CPU_FIXED_FRAME_COUNT);
		memory.writeRamRecordPair(CPU_INTERRUPTED_CONTEXT_ADDRESS, 0, 0);
		memory.writeRamRecordWord(CPU_IRQ_VECTOR_ADDRESS, 0);
		this.irqThread.bindAddress(0);
		this.rootThread.status = ThreadStatus.Running;
		this.activeThread = this.rootThread;
		this.completionThread = CPU_RESET_BANK_ADDRESS;
	}

	private bindFixedIrqBank(): void {
		this.irqThread.bindAddress(CPU_RESET_BANK_ADDRESS);
		this.irqThread.bindStack();
		this.irqThread.reserveFrameViews(CPU_FIXED_FRAME_COUNT);
	}

	public createTable(arraySize: number = 0, hashSize: number = 0): number {
		const hashCapacity = TableRecords.hashCapacity(hashSize);
		const address = this.luaHeap.allocateRecord(TableRecords.HEADER_BYTES, true, 5 * arraySize,
			TableHeader.ArrayStorage, valueNil(), valueNil(), valueNil(), TableRecords.HEADER_CHARGE + TableRecords.allocationCharge(arraySize, hashCapacity),
			LuaAllocationMode.Direct, TableRecords.hashStorageBytes(hashCapacity), TableHeader.HashStorage);
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

	private tableIndexAddress(base: Value): number {
		switch (valueTag(base)) {
			case ValueTag.Table: return valuePayload(base);
			case ValueTag.String: {
				const address = this.gc.diagnosticWord(HeapServiceRemarkHeadField.StringIndexWord);
				if (address !== 0) return address;
				break;
			}
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
			this.instructionBudgetRemaining -= this.gc.tables.resolveIndex(record, key, result, remaining);
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
		args.bindDetached(receiver, operand, assignment);
		try {
			const tag = valueTag(method);
			if (tag !== ValueTag.Closure) {
				this.localRoots.push(method, receiver, operand);
				if (assignment !== undefined) this.localRoots.push(assignment);
			}
			switch (tag) {
				case ValueTag.Closure: {
					const closure = Closure.recordAddress(this.memory, valuePayload(method));
					if (closure === 0) throw new LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
					this.pushFrame(closure, args.registers, destination, result, false, false, this.currentInstructionPc, 0, args.length, true);
					break;
				}
				case ValueTag.CodeFunction:
					this.pushFrame(0, args.registers, destination, result, false, false, this.currentInstructionPc, 0, args.length, true, valuePayload(method));
					break;
				case ValueTag.ResidentFunction:
					this.beginResidentCall(valuePayload(method), args.registers, args.base, args.length, destination, result);
					break;
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
		this.instructionBudgetRemaining -= this.gc.tables.resolveIndex(this.tableIndexAddress(base), key, result);
		return this.finishTableRead(frame, targetIndex, base, key, result);
	}
	private resolveTableFieldIndexCached(base: Value, page: DecodedInstructionPage, pageOffset: number, key: StringId): TableLookupResult {
		const result = this.tableLookupResult;
		this.instructionBudgetRemaining -= this.gc.tables.resolveStringIndexCached(this.tableIndexAddress(base), key, page.tableCacheSlots[pageOffset], result);
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
		if (tables.tryStore(receiver, key, value) !== HASH_STORE_DECLINED) return false;
		this.enterTableStorageFault(receiver, key, value, 0);
		return true;
	}

	private enterTableStorageFault(receiver: number, key: Value, value: Value, extra: number): void {
		// The table unit could not write into the existing backing. A
		// precise exception supplies the resolved instruction operands,
		// not an allocator entry point or a native continuation.
		const cycles = this.remainingDeviceCycles();
		const vector = this.enterException(this.systemImage, this.cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_STORAGE_WINDOW,
			this.currentInstructionPc, valueTable(receiver), canonicalTableKey(key), value, valueInteger(extra), 5);
		vector?.registers.setInteger(4, cycles);
	}

	// The linked allocate_record body owns admission, assistance and retry.
	private beginClosureReservation(frame: CallFrame, destination: number, prototype: number, domain: number, nextPc: number): void {
		const base = this.heapService.closureContinuationAddress, memory = this.memory;
		memory.writeRamRecordPair(base + HeapServiceClosureField.Destination, destination + 1, this.currentInstructionPc);
		memory.writeRamRecordPair(base + HeapServiceClosureField.LastPc, this.lastPc, nextPc);
		frame.pc = this.currentInstructionPc;
		const args = this.closureArgs;
		args[2] = prototype;
		args[3] = domain;
		args[5] = this.remainingDeviceCycles();
		this.beginHeapService(this.systemImage.heapServiceFunctions![HeapServiceOperation.AllocateRecord], args);
	}

	private beginMappedCanonicalClosure(frame: CallFrame, destination: number): void {
		const record = this.functionRecordLatch, memory = this.memory, management = this.heapAllocator.managementOffset();
		const base = this.heapService.closureContinuationAddress, binding = management + HEAP_SERVICE_CAPTURE_BINDING_OFFSET;
		memory.writeRamRecordPair(base + HeapServiceClosureField.Destination, destination + 1, this.currentInstructionPc);
		memory.writeRamRecordPair(base + HeapServiceClosureField.LastPc, this.lastPc, frame.pc);
		frame.pc = this.currentInstructionPc;
		memory.writeRamRecordPair(binding + HeapServiceCaptureBindingField.Prototype, record.functionAddress, record.executionDomainId);
		memory.writeRamRecordPair(binding + HeapServiceCaptureBindingField.BindingFlags, CLOSURE_CANONICAL | CLOSURE_LATCHED_PROTOTYPE, record.codeAddress);
		memory.writeRamRecordPair(binding + HeapServiceCaptureBindingField.Params, record.numParams, record.maxStack);
		memory.writeRamRecordPair(binding + HeapServiceCaptureBindingField.Flags, record.flags, record.upvalueTableAddress);
		memory.writeRamRecordWord(binding + HeapServiceCaptureBindingField.Count, record.recordUpvalueCount);
		const args = this.capturedClosureArgs;
		args[0] = management; args[1] = RAM_BASE + frame.controlOffset; args[2] = frame.thread.address;
		args[3] = RAM_BASE + binding; args[5] = this.remainingDeviceCycles();
		this.beginHeapService(this.systemImage.heapServiceFunctions![HeapServiceOperation.CapturedClosure], args);
	}

	private finishClosureReservation(): void {
		const base = this.heapService.closureContinuationAddress, memory = this.memory;
		const destination = memory.readRamRecordWord(base + HeapServiceClosureField.Destination);
		if (destination === 0) return;
		this.currentInstructionPc = memory.readRamRecordWord(base + HeapServiceClosureField.InstructionPc);
		this.lastPc = memory.readRamRecordWord(base + HeapServiceClosureField.LastPc);
		this.lastExecutionDomainId = this.activeExecutionDomainId;
		memory.writeRamRecordWord(base + HeapServiceClosureField.Destination, 0);
		const frame = this.activeThread.currentFrame!;
		const offset = this.heapServiceResult();
		if (offset === 0) {
			this.retireNumericLuaFault(LUA_FAULT_REASON_OUT_OF_MEMORY);
			return;
		}
		const address = RAM_BASE + offset;
		this.staticClosures.insert(memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS), address);
		this.setRegisterClosureFast(frame, frame.registers, destination - 1, address);
		frame.pc = memory.readRamRecordWord(base + HeapServiceClosureField.NextPc);
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
		const slot = tables.tryStore(assignment.receiver, field, value, assignment.slot);
		if (slot === HASH_STORE_DECLINED) {
			this.enterTableStorageFault(assignment.receiver, field, value, extraHashSlots);
			return true;
		}
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
				const method = this.gc.tables.lengthMetamethod(record);
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
		if (this.fixedInterruptDefersReset()) throw new Error('System IRQ must retire before reset.');
		if (this.heapServiceActive()) throw new Error('Heap service must retire before CPU reset.');
		// Publish the last admitted execution context before detaching views.
		// A second reset in the board bank has not admitted another context.
		const previousRoot = this.rootThread.address;
		if (previousRoot !== 0 && previousRoot !== CPU_RESET_BANK_ADDRESS) {
			this.cop0Words[COP0_CONTEXT] = previousRoot;
			this.cop0Words[COP0_PREVIOUS_ACTIVE] = this.fixedInterruptActive()
				? this.memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS) : this.activeThread.address;
		}
		this.compiledCodeCache.retireAll();
		const systemBoot = this.executionAddressSpace.resolveSystemDomain();
		const systemResetFunctionAddress = systemBoot.startupFunctionAddress;
		this.clearCompletionValues();
		this.systemGlobalBank.slots.unbind();
		this.globalBank.slots.unbind();
		for (let index = 1; index < this.threadBanks.length; ++index) this.threadBanks[index].bindAddress(0);
		this.haltedUntilIrqFrameDepth = -1;
		this.haltedUntilIrqThread = 0;
		this.interruptEventPending = false;
		this.memoryWriteBlocked = false;
		this.memoryWriteBlockedAddress = 0;
		this.pendingMemory.kind = PendingMemoryKind.None;
		this.stringComparison = new StringComparisonLatch();
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
		this.initializeResetBank();
		this.executionImagesByDomain.fill(null);
		this.unpublishedRomMask = 0;
		const header = this.readExecutionImageHeader(systemBoot);
		this.systemImage = this.materializeExecutionImage(systemBoot, header, ExecutionImageUpdate.Select);
		this.executionImagesByDomain[SYSTEM_EXECUTION_DOMAIN_ID + 1] = this.systemImage;
		this.cop0Words[COP0_SYSTEM_VECTOR] = systemBoot.exceptionFunctionAddress;
		this.latchActiveExecutionImage(SYSTEM_EXECUTION_DOMAIN_ID, this.systemImage);
		if (!this.readFunctionRecordOnBus(this.systemImage, systemResetFunctionAddress, this.executionBusSignals)) {
			this.hardHalt();
			return;
		}
		this.enterDirectFrame();
	}


	private decodeConstantPool(
		executionDomainId: ExecutionDomainId,
		bytes: Uint8Array, byteOffset: number,
		constTags: Uint8Array, constWords: Uint32Array,
		stringBinding: number, restoring: boolean,
		constantStringSlots: Uint32Array,
	): number {
		let stringIndex = 0, ramCount = 0;
		const stringCount = constantStringSlots.length;
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
				case Blua32ConstantTag.Builtin: {
					const id = readLE32(bytes, recordByteOffset + BLUA32_CONSTANT_PAYLOAD_OFFSET);
					if (executionDomainId !== SYSTEM_EXECUTION_DOMAIN_ID || id >= BUILTIN_FUNCTION_COUNT)
						throw new Error('BLua32 builtin constant is invalid for this image.');
					constTags[index] = ValueTag.BuiltinFunction;
					constWords[index] = id;
					break;
				}
				case Blua32ConstantTag.String: {
					if (stringBinding === 0) {
						constantStringSlots[stringIndex++] = index;
						constTags[index] = ValueTag.UnboundStringLiteral;
						break;
					}
					let id: StringId;
					if (restoring) {
						id = loadImageStringBinding(this.memory, stringBinding, stringCount, stringIndex, ramCount);
						ramCount += +isRamStringId(id);
					} else {
						id = this.stringPool.resolveImageRecord(executionDomainId,
							readLE32(bytes, recordByteOffset + BLUA32_CONSTANT_PAYLOAD_OFFSET));
						ramCount = storeImageStringBinding(this.memory, stringBinding, stringCount, stringIndex, ramCount, id);
					}
					constantStringSlots[stringIndex++] = index;
					constTags[index] = ValueTag.String;
					constWords[index] = id;
					break;
				}
				default:
					throw new Error('BLua32 constant tag is invalid.');
			}
		}
		return ramCount;
	}

	private releaseImageData(base: number, bytes: number): void {
		for (const bank of this.threadBanks) bank.dropParkedFrameViews();
		if (base !== 0) this.luaHeap.releaseRecord(base, bytes);
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

	private readExecutionImageHeader(executionBoot: Blua32ExecutionBoot, previous: Blua32ExecutionImage | null = null) {
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
		if (constantCount > CART_ROM_SIZE / BLUA32_CONSTANT_RECORD_SIZE) {
			throw new Error('BLua32 constant table exceeds the ROM address window.');
		}
		const constantTableAddress = readLE32(bytes, byteOffset + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET);
		let constantBytes = bytes, constantOffset = 0;
		if (constantCount !== 0) {
			this.executionAddressSpace.bindReadOnlyView(executionBoot.executionDomainId, constantTableAddress,
				constantCount * BLUA32_CONSTANT_RECORD_SIZE, this.executionTableView);
			constantBytes = this.executionTableView.bytes;
			constantOffset = this.executionTableView.byteOffset;
		}
		const reused = previous !== null && previous.constantRecordBytes === constantBytes
			&& previous.constantRecordOffset === constantOffset && previous.constTags.length === constantCount ? previous : null;
		let stringCount = 0;
		if (reused !== null) {
			stringCount = reused.constantStringSlots.length;
		} else {
			for (let i = 0; i < constantCount; ++i) {
				const tag = readLE32(constantBytes, constantOffset + i * BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_TAG_OFFSET);
				stringCount += +(tag === Blua32ConstantTag.String);
			}
		}
		const nameBytes = 4 * (globalNameCount + systemGlobalNameCount);
		const imageBindingBytes = nameBytes + 4 * stringCount;
		if (imageBindingBytes > MAIN_RAM_SIZE) throw new Error('BLua32 image bank extents exceed main RAM.');
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
			heapServiceFunctions = new Uint32Array(HEAP_SERVICE_ENTRY_COUNT);
			for (let index = 0; index < HEAP_SERVICE_ENTRY_COUNT; ++index) {
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
			constantBytes, constantOffset, constantCount, stringCount, nameBytes, imageBindingBytes, reused,
			globalNameTableAddress: readLE32(bytes, byteOffset + BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET),
			globalNameCount,
			systemGlobalNameTableAddress: readLE32(bytes, byteOffset + BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET),
			systemGlobalNameCount,
			stringBucketAddress: readLE32(bytes, byteOffset + BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET),
			stringBucketCount: readLE32(bytes, byteOffset + BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET),
			romFunctions, heapServiceFunctions,
		};
	}

	private materializeExecutionImage(
		executionBoot: Blua32ExecutionBoot,
		header: ReturnType<CPU['readExecutionImageHeader']>,
		update: ExecutionImageUpdate,
	): Blua32ExecutionImage {
		const executionDomainId = executionBoot.executionDomainId;
		const { constantBytes, constantOffset, constantCount, stringCount, nameBytes, imageBindingBytes, reused, globalNameTableAddress, globalNameCount,
			systemGlobalNameTableAddress, systemGlobalNameCount } = header;
		const binding = executionImageBindingOffset(this.heapAllocator.managementOffset(), executionDomainId);
		const restoring = update === ExecutionImageUpdate.Restore;
		const selecting = update === ExecutionImageUpdate.Select;
		const imageBindingBase = selecting ? 0 : restoring ? this.memory.readRamRecordWord(binding)
			: imageBindingBytes === 0 ? 0 : this.luaHeap.allocateRecord(imageBindingBytes, false, 0, 0);
		if (!restoring && !selecting) {
			this.registerGlobalNames(executionDomainId, globalNameTableAddress, globalNameCount, this.globalBank, imageBindingBase);
			this.registerGlobalNames(executionDomainId, systemGlobalNameTableAddress, systemGlobalNameCount,
				this.systemGlobalBank, imageBindingBase + 4 * globalNameCount);
		}
		let constWords: Uint32Array, constTags: Uint8Array, constantStringSlots: Uint32Array, ramStringCount = 0;
		const stringBinding = selecting ? 0 : restoring ? this.memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET) : imageBindingBase + nameBytes;
		if (reused === null) {
			const buffer = new ArrayBuffer(constantCount * 5);
			constWords = new Uint32Array(buffer, 0, constantCount);
			constTags = new Uint8Array(buffer, constantCount * 4, constantCount);
			constantStringSlots = new Uint32Array(stringCount);
			ramStringCount = this.decodeConstantPool(executionDomainId, constantBytes, constantOffset, constTags, constWords,
				stringBinding, restoring, constantStringSlots);
		} else {
			// Only the String bindings belong to the restored guest state.
			// Literal words and tags still belong to the mounted ROM.
			({ constWords, constTags, constantStringSlots } = reused);
			for (let i = 0; i < constantStringSlots.length; ++i) {
				const id = stringBinding === 0 ? 0 : loadImageStringBinding(this.memory, stringBinding, stringCount, i, ramStringCount);
				constTags[constantStringSlots[i]] = stringBinding === 0 ? ValueTag.UnboundStringLiteral : ValueTag.String;
				constWords[constantStringSlots[i]] = id;
				ramStringCount += +isRamStringId(id);
			}
		}
		const image: Blua32ExecutionImage = {
			executionDomainId,
			irqFunctionAddress: executionBoot.irqFunctionAddress,
			staticEnd: executionBoot.staticEnd,
			heapServiceFunctions: header.heapServiceFunctions,
			constTags,
			constWords,
			constantRecordBytes: constantBytes,
			constantRecordOffset: constantOffset,
			constantStringSlots,
			globalNameCount, systemNameCount: systemGlobalNameCount,
			romFunctions: header.romFunctions,
			romCallBindings: new RomCallBindings(),
			decodedPages: new Map(),
			compiledCodeLookup: null,
		};
		if (!restoring && !selecting) {
			this.memory.writeRamRecordPair(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET, stringBinding, ramStringCount);
			this.memory.writeRamRecordPair(binding, imageBindingBase, imageBindingBytes);
		}
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
		const header = this.readExecutionImageHeader(executionBoot);
		const binding = executionImageBindingOffset(this.heapAllocator.managementOffset(), executionDomainId);
		if (this.memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_SPAN_OFFSET) !== header.imageBindingBytes) return null;
		const image = this.materializeExecutionImage(executionBoot, header, ExecutionImageUpdate.Restore);
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
		return this.findStaticClosureFromLatch() || this.allocateStaticClosureFromLatch();
	}

	private findStaticClosureFromLatch(): number {
		const record = this.functionRecordLatch;
		const closures = this.staticClosures.find(record.functionAddress);
		if (closures === undefined) return 0;
		let match = 0;
		for (const address of closures) {
			if ((match !== 0 && address >= match) || this.gc.sweepGarbage(address)) continue;
			this.readClosureBinding(address, this.memory.readRamRecordByte(address + CLOSURE_BINDING_FLAGS), this.canonicalBinding);
			if (sameFunctionPrototype(this.canonicalBinding, record)) match = address;
		}
		return match;
	}

	private allocateStaticClosureFromLatch(): number {
		const record = this.functionRecordLatch;
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
		if (this.heapServiceActive() || this.fixedInterruptActive()) throw new Error('Fixed execution must retire before replacing code execution.');
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
				const binding = executionImageBindingOffset(this.heapAllocator.managementOffset(), domain);
				const oldBase = this.memory.readRamRecordWord(binding);
				const oldBytes = this.memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_SPAN_OFFSET);
				const image = this.materializeExecutionImage(boot, headers[i], ExecutionImageUpdate.Replace);
				this.executionImagesByDomain[imageIndex] = image;
				this.unpublishedRomMask &= ~executionDomainBit(domain);
				if (domain === SYSTEM_EXECUTION_DOMAIN_ID) {
					this.systemImage = image;
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
				if (previous !== null) this.releaseImageData(oldBase, oldBytes);
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
		address: number, key: number, slot: number, privateFirmware = false,
	): DecodedInstructionPage {
		const pages = privateFirmware ? (image.privateDecodedPages ??= new Map()) : image.decodedPages;
		const existing = pages.get(key);
		if (existing !== undefined) {
			return existing;
		}
		const binding = this.mappedPageBinding;
		this.memory.bindMappedPage(address, mappedBusSignalsForCartridgeSlot(slot) | MAPPED_BUS_INSTRUCTION_FETCH, binding);
		const page = createDecodedInstructionPage(binding, privateFirmware);
		pages.set(binding.key, page);
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

	/** A borrowed bank, not retained across a Thread switch or fixed activation. */
	public bindThread(address: number, authored = false): Thread {
		let cached: Thread | undefined;
		if (address === this.rootThread.address) cached = this.rootThread;
		else if (address === CPU_RESET_BANK_ADDRESS) cached = this.irqThread;
		else {
			for (let i = 1; i < this.threadBanks.length; ++i) {
				const bank = this.threadBanks[i];
				if (bank.address === address) { cached = bank; break; }
			}
		}
		if (cached !== undefined) {
			// An inactive context's frame or Value backing can be edited in RAM.
			if (authored) this.bindPhysicalFrames(cached);
			return cached;
		}
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
		const romReplaced = (address === SYSTEM_ROM_BASE && end === SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE)
			|| (address === CART_ROM_BASE && end === CART_ROM_END);
		if (romReplaced) {
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
			// A constant table can be in a different physical ROM from its header.
			if (romReplaced) image.constantRecordBytes = null;
			if (address < SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE || (address >= CART_ROM_BASE && address < CART_ROM_END))
				image.romCallBindings.invalidate();
			this.rebindDecodedRange(image.decodedPages, invalidationStart, endKey);
			if (image.privateDecodedPages !== undefined && address < SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE)
				this.rebindDecodedRange(image.privateDecodedPages, invalidationStart, endKey);
		}
	}

	private rebindDecodedRange(pages: Map<number, DecodedInstructionPage>, firstKey: number, endKey: number): void {
		for (const [key, page] of pages) {
			if (key >= firstKey && key < endKey) {
				this.compiledCodeCache.retirePage(page);
				this.memory.bindMappedPage(key >>> 0, mappedBusSignalsForCartridgeSlot(mappedPageDomainIndex(key) === 2 ? 1 : 0) | MAPPED_BUS_INSTRUCTION_FETCH, page);
				page.refreshState.fill(DECODED_REFRESH_DECODE);
			}
		}
	}

	private decodedPageForFrame(frame: CallFrame, pc: number, privateFirmware = false): DecodedInstructionPage {
		const pageAddress = (pc & ~MAPPED_PAGE_BYTE_MASK) >>> 0;
		const slot = privateFirmware ? 0 : this.memory.cartridgeController.selectedSlot(this.executionBusSignals);
		const key = mappedPageAddressKey(pageAddress, slot);
		const cached = frame.decodedPage;
		if (cached !== null && cached.key === key && cached.privateFirmware === privateFirmware) {
			return cached;
		}
		const page = this.decodedPageForAddress(frame.executionImage, pageAddress, key, slot, privateFirmware);
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
				bodyPage = this.decodedPageForFrame(frame, (pc + INSTRUCTION_BYTES) >>> 0, page.privateFirmware);
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
				if (page.c[pageOffset] > MemoryAccessKind.Value
					&& (op === OpCode.LOAD_MEM_D || op === OpCode.STORE_MEM_D)) {
					page.ops[pageOffset] = DecodedDispatchOp.ReservedMemory;
				}
			} else if (OPCODE_USES_BX[op] !== 0) {
				page.a[pageOffset] = (wideA << MAX_OPERAND_BITS) | aLow
					| (op === OpCode.CLOSURE ? (wideC & CLOSURE_DESTINATION_EXT_MASK) << CLOSURE_DESTINATION_EXT_SHIFT : 0);
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
				if (op === OpCode.LOADK && (bx >= image.constWords.length || image.constTags[bx] === ValueTag.UnboundStringLiteral)) {
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
				if (rawC > MemoryAccessKind.Value && (op === OpCode.LOAD_MEM || op === OpCode.STORE_MEM)
					&& (op !== OpCode.LOAD_MEM || page.privateFirmware || rawC !== MemoryAccessKind.ContextWord)) {
					page.ops[pageOffset] = DecodedDispatchOp.ReservedMemory;
				} else {
					const constantCount = image.constWords.length;
					if ((op === OpCode.ITERN && rawC === 0)
						|| -page.b[pageOffset] > constantCount || -page.c[pageOffset] > constantCount
						|| (page.b[pageOffset] < 0 && image.constTags[-1 - page.b[pageOffset]] === ValueTag.UnboundStringLiteral)
						|| (page.c[pageOffset] < 0 && image.constTags[-1 - page.c[pageOffset]] === ValueTag.UnboundStringLiteral)
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
			if (this.resetBankSelected() || index >= (system ? image.systemNameCount : image.globalNameCount)) {
				page.ops[pageOffset] = DecodedDispatchOp.InvalidImageOperand;
			} else {
				const binding = executionImageBindingOffset(this.heapAllocator.managementOffset(), image.executionDomainId);
				const base = this.memory.readRamRecordWord(binding) + (system ? 4 * image.globalNameCount : 0);
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

	public systemResetInhibited(): boolean {
		return this.fixedInterruptDefersReset() || this.heapServiceActive() || (this.cop0Words[COP0_STATUS] & CPU_STATUS_INHIBIT_RESET) !== 0;
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

	// The existing physical root address is the bank selector carried in snapshots.
	private resetBankSelected(): boolean {
		return this.activeThread.address === CPU_RESET_BANK_ADDRESS;
	}

	public fixedInterruptActive(): boolean {
		return this.activeThread === this.irqThread;
	}

	public fixedInterruptDefersReset(): boolean {
		return this.fixedInterruptActive() && !this.hardHalted;
	}

	private executingSystemRom(): boolean {
		return this.activeExecutionDomainId === SYSTEM_EXECUTION_DOMAIN_ID
			&& ((this.currentInstructionPc - SYSTEM_ROM_BASE) >>> 0) < SYSTEM_ROM_SIZE;
	}

	// The scalar and generated backends retire the same control write.
	private executeControlWrite(frame: CallFrame, source: number, field: number): void {
		if (this.isUserMode()) {
			this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
			return;
		}
		if (source >= frame.registers.capacity()) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		const value = wordOperand(frame.registers.get(source));
		switch (field) {
			case COP0_STATUS: {
				const writeMask = this.executingSystemRom() ? -1 : ~CPU_STATUS_INHIBIT_RESET;
				const previous = this.cop0Words[COP0_STATUS], status = (previous & ~writeMask) | (value & writeMask);
				this.cop0Words[COP0_STATUS] = status;
				if ((previous & ~status & CPU_STATUS_INHIBIT_RESET) !== 0) this.requestYield();
				return;
			}
			case COP0_EPC: this.cop0Words[COP0_EPC] = value; return;
			case COP0_EXEC: this.executeFunctionAddress(value); return;
			case COP0_CONTEXT: this.activateRootContext(value); return;
			case COP0_CURRENT: this.selectExecutionContext(frame, value); return;
			case COP0_RAM_END: this.selectRamEnd(frame, value); return;
			case COP0_SYSTEM_VECTOR:
			case COP0_IRQ_VECTOR: this.installSystemVector(frame, value, field); return;
			case COP0_EXCEPTION_TARGET: this.transferExceptionVector(frame, value); return;
			case COP0_PREVIOUS_ACTIVE:
			case COP0_BAD_ADDRESS:
			case COP0_LUA_FAULT_REASON:
			case COP0_EVENT_CYCLES:
			case COP0_CAUSE: return;
			default: this.hardHalt(); return;
		}
	}

	private selectRamEnd(frame: CallFrame, address: number): void {
		if (!this.executingSystemRom()) {
			this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
			return;
		}
		const end = (address & ~(HEAP_PAGE_SIZE - 1)) >>> 0;
		if (end < DYNAMIC_RAM_BASE || end > RAM_BASE + this.memory.ramByteCount() - RUNTIME_MANAGEMENT_SIZE) {
			this.enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, address);
			return;
		}
		this.memory.setRamBusEnd(end);
		this.requestYield();
	}

	private selectExecutionContext(frame: CallFrame, address: number): void {
		if (!this.executingSystemRom() || this.resetBankSelected()) {
			this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
			return;
		}
		if ((address & 3) !== 0 || address < this.memory.ramBusEnd()
			|| !this.memory.isRamRange(address, THREAD_HEAP_BYTES, true)) {
			this.enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, address);
			return;
		}
		this.activeThread = this.bindThread(address, true);
		this.resumeFrameBank();
		this.threadSwitchRequested = this.yieldRequested = true;
	}

	private activateRootContext(address: number): void {
		const memory = this.memory;
		if (this.fixedInterruptActive() || !this.resetBankSelected() || this.isUserMode() || this.activeThread.frameDepth !== 1
			|| (address & 3) !== 0 || address < memory.ramBusEnd() || !memory.isRamRange(address, THREAD_HEAP_BYTES, true)) {
			this.hardHalt();
			return;
		}
		const stack = memory.readRamRecordWord(address + ThreadField.StackBlock);
		const values = memory.readRamRecordWord(address + ThreadField.StackCapacity);
		const frames = memory.readRamRecordWord(address + ThreadField.FrameBlock);
		const frameCount = memory.readRamRecordWord(address + ThreadField.FrameCapacity);
		if (memory.readRamRecordWord(address + ThreadField.FrameDepth) !== 1 || frameCount < 2 || frameCount > MAIN_RAM_SIZE / FRAME_CONTROL_BYTES || values > MAX_THREAD_VALUE_SLOTS
			|| ((stack | frames) & 3) !== 0 || stack < memory.ramBusEnd() || frames < memory.ramBusEnd()
			|| !memory.isRamRange(stack, values * THREAD_STACK_SLOT_BYTES, true)
			|| !memory.isRamRange(frames, frameCount * FRAME_CONTROL_BYTES, true)) {
			this.hardHalt();
			return;
		}
		const pc = memory.readRamRecordWord(frames + FrameField.Pc);
		const fn = memory.readRamRecordWord(frames + FrameField.Function);
		const flags = memory.readRamRecordWord(frames + FrameField.Flags);
		if (frameExecutionBank(flags) !== SYSTEM_EXECUTION_DOMAIN_ID || pc >= SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE
			|| !admitsFunctionPc(this.systemImage.romFunctions, fn, pc)) {
			this.hardHalt();
			return;
		}
		this.globalBank.bind();
		this.systemGlobalBank.bind();
		const image = this.systemImage;
		const binding = executionImageBindingOffset(this.heapAllocator.managementOffset(), SYSTEM_EXECUTION_DOMAIN_ID);
		const strings = memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET), slots = image.constantStringSlots;
		let ramCount = 0;
		for (let index = 0; index < slots.length; ++index) {
			const id = loadImageStringBinding(memory, strings, slots.length, index, ramCount), slot = slots[index];
			image.constTags[slot] = ValueTag.String;
			image.constWords[slot] = id;
			ramCount += +isRamStringId(id);
		}
		this.compiledCodeCache.retireAll();
		for (const page of image.decodedPages.values()) {
			page.widths.fill(0);
			page.refreshState.fill(DECODED_REFRESH_DECODE);
		}
		memory.writeRamRecordWord(CPU_RESET_BANK_ADDRESS + ThreadField.FrameDepth, 0);
		this.activeThread.stackTop = 0;
		this.bindFixedIrqBank();
		this.rootThread.bindAddress(address);
		this.bindPhysicalFrames(this.rootThread);
		this.completionThread = address;
		this.cop0Words[COP0_CONTEXT] = 0;
		this.cop0Words[COP0_PREVIOUS_ACTIVE] = 0;
		this.requestYield();
	}

	private installSystemVector(frame: CallFrame, address: number, field: number): void {
		// Supervisor status alone is not authority: the cartridge vector also
		// executes with the current user bit clear.
		if (!this.executingSystemRom()) {
			this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
			return;
		}
		const directory = this.systemImage.romFunctions;
		const lane = directory.mappedCode ? -1 : romFunctionVersionLane(directory, address);
		if (lane < 0 || directory.versions[lane + RomFunctionLane.UpvalueCount] !== 0
			|| directory.versions[lane + RomFunctionLane.FirstPc] >= directory.versions[lane + RomFunctionLane.EndPc]) {
			this.enterSynchronousAddressException(frame, (address & 3) !== 0
				? CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD : CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, address);
			return;
		}
		if (field === COP0_IRQ_VECTOR) this.memory.writeRamRecordWord(CPU_IRQ_VECTOR_ADDRESS, address);
		else this.cop0Words[COP0_SYSTEM_VECTOR] = address;
	}

	private transferExceptionVector(frame: CallFrame, target: number): void {
		if (!this.executingSystemRom()) {
			this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
			return;
		}
		if (!frame.isExceptionFrame) {
			this.hardHalt();
			return;
		}
		const address = target & CPU_EXCEPTION_TARGET_ADDRESS_MASK;
		const signals = mappedBusSignalsForCartridgeSlot(target >>> CPU_EXCEPTION_TARGET_SOCKET_SHIFT);
		if (!this.readFunctionRecordOnBus(this.systemImage, address, signals)
			|| (this.functionRecordLatch.flags & BLUA32_FUNCTION_STATIC) === 0) {
			this.hardHalt();
			return;
		}
		// Only the outer fixed exception can transfer into the retained frame bank.
		const resumesContext = this.fixedInterruptActive() && frame.previous === null;
		if (this.resetBankSelected() && this.functionRecordLatch.executionDomainId >= 0 && !resumesContext) {
			this.hardHalt();
			return;
		}
		const nmi = frame.isNonMaskableExceptionFrame;
		this.charge(this.closeUpvalues(frame));
		this.activeThread.leaveFrame();
		if (resumesContext) this.resumeInterruptedContext();
		this.enterLatchedExceptionFrame(nmi, this.cop0Words[COP0_EPC]);
	}

	private resumeInterruptedContext(): void {
		const context = this.memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS);
		this.memory.writeRamRecordPair(CPU_INTERRUPTED_CONTEXT_ADDRESS, 0, 0);
		const thread = this.bindThread(context);
		if (thread.currentFrameViewMatches()) thread.bindStack(true);
		else this.bindPhysicalFrames(thread);
		this.activeThread = thread;
		this.threadSwitchRequested = this.yieldRequested = true;
	}

	private executeFunctionAddress(functionAddress: number): void {
		// Publish a receiving bank before a normal execution transfer.
		if (this.resetBankSelected()) { this.hardHalt(); return; }
		if (!this.readFunctionRecordOnBus(this.activeExecutionImage, functionAddress, MAPPED_BUS_MASTER_CPU)
			|| (this.functionRecordLatch.flags & BLUA32_FUNCTION_STATIC) === 0) {
			this.hardHalt();
			return;
		}
		const image = this.functionRecordLatch.image;
		this.clearCallStack();
		this.latchActiveExecutionImage(image.executionDomainId, image);
		this.programExecutionDomainId = image.executionDomainId;
		const cartridgeEntry = image.executionDomainId >= 0;
		if (cartridgeEntry) {
			this.systemGlobalBank.bind();
			this.globalBank.bind();
		}
		this.cop0Words[COP0_STATUS] = cartridgeEntry ? CPU_STATUS_CART_ENTRY : CPU_STATUS_SYSTEM_ENTRY;
		this.haltedUntilIrqFrameDepth = -1;
		this.haltedUntilIrqThread = 0;
		this.interruptEventPending = false;
		this.memoryWriteBlocked = false;
		this.memoryWriteBlockedAddress = 0;
		this.pendingMemory.kind = PendingMemoryKind.None;
		this.stringComparison = new StringComparisonLatch();
		this.hardHalted = false;
		this.yieldRequested = false;
		this.enterDirectFrame();
	}

	public beginCompletionCall(closure: number, args: ReadonlyArray<Value> = EMPTY_CALL_ARGS): void {
		if (this.heapServiceActive() || this.fixedInterruptActive()) throw new Error('Fixed execution must retire before replacing code execution.');
		if (this.stringComparison.remaining !== 0) throw new Error('Pending CPU work must retire before replacing code execution.');
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
		if (this.heapServiceActive() || this.fixedInterruptActive()) throw new Error('Fixed execution must retire before replacing code execution.');
		if (this.stringComparison.remaining !== 0) throw new Error('Pending CPU work must retire before replacing code execution.');
		this.gc.finishFinalMark();
		const image = this.executionImageForDomain(executionDomainId);
		if (image === null || !this.readFunctionRecord(image, functionAddress, CPU.executionBusSignalsForDomain(executionDomainId))) {
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

	public hasFramesAbove(context: number, depth: number): boolean {
		return (this.fixedInterruptActive() && this.memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS) === context)
			|| this.readThreadFrameDepth(context) > depth;
	}

	public peekPendingInterrupt(): AcceptedInterruptKind {
		if (this.fixedInterruptActive()) return AcceptedInterruptKind.None;
		if (this.nonMaskableInterruptPending) {
			return AcceptedInterruptKind.NonMaskable;
		}
		if (this.canAcceptMaskableInterruptLine()) {
			return AcceptedInterruptKind.Maskable;
		}
		return AcceptedInterruptKind.None;
	}

	public enterPendingInterrupt(): boolean {
		if (this.fixedInterruptActive() || this.pendingMemory.kind !== PendingMemoryKind.None || this.stringComparison.remaining !== 0 || this.heapServiceActive()) return false;
		if (this.nonMaskableInterruptPending) {
			this.nonMaskableInterruptPending = false;
			const hadHaltLatch = this.haltedUntilIrqFrameDepth >= 0;
			const returnCauseWord = this.cop0Words[COP0_CAUSE];
			const returnEpcWord = this.cop0Words[COP0_EPC];
			const returnBadAddressWord = this.cop0Words[COP0_BAD_ADDRESS];
			const returnLuaFaultReasonWord = this.cop0Words[COP0_LUA_FAULT_REASON];
			const returnExceptionDomainWord = this.exceptionDomainWord;
			this.clearHaltAfterAcceptedInterrupt();
			this.enterException(
				this.systemImage,
				this.cop0Words[COP0_SYSTEM_VECTOR],
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
		const enabledFlags = (this.cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) !== 0
			? this.irqController.enabledPendingFlags() : 0;
		if (enabledFlags !== 0) {
			const user = this.isUserMode(), canDetach = !this.resetBankSelected();
			const irqVector = user && canDetach ? this.memory.readRamRecordWord(CPU_IRQ_VECTOR_ADDRESS) : 0;
			const domain = user && irqVector === 0 ? this.programExecutionDomainId : SYSTEM_EXECUTION_DOMAIN_ID;
			const image = this.executionImageForDomain(domain)!;
			const vector = irqVector !== 0 ? irqVector : image.irqFunctionAddress;
			const epc = this.activeThread.currentFrame!.pc;
			const accepted = enabledFlags | (this.isHaltedUntilIrq() ? CPU_INTERRUPT_STATE_HALT : 0);
			if (this.haltedUntilIrqFrameDepth < 0) this.interruptEventPending = true;
			this.clearHaltAfterAcceptedInterrupt();
			this.latchExceptionEntry(CPU_CAUSE_IRQ, epc);
			if (!this.readFunctionRecordOnBus(image, vector, CPU.executionBusSignalsForDomain(domain))) {
				this.hardHalt();
				return true;
			}
			if (canDetach && (irqVector !== 0 || (!user && (this.functionRecordLatch.flags & BLUA32_FUNCTION_CODE) !== 0))) {
				this.memory.writeRamRecordPair(CPU_INTERRUPTED_CONTEXT_ADDRESS, this.activeThread.address, accepted);
				this.activeThread = this.irqThread;
			}
			this.enterLatchedExceptionFrame(false, epc);
			return true;
		}
		return false;
	}

	private enterSynchronousException(interruptedFrame: CallFrame, causeWord: number): CallFrame | null {
		interruptedFrame.pc = this.currentInstructionPc;
		return this.enterException(this.systemImage, this.cop0Words[COP0_SYSTEM_VECTOR], causeWord, this.currentInstructionPc);
	}

	private enterSynchronousAddressException(interruptedFrame: CallFrame, causeWord: number, address: number): void {
		this.cop0Words[COP0_BAD_ADDRESS] = address >>> 0;
		this.enterSynchronousException(interruptedFrame, causeWord);
	}

	private enterInstructionFetchException(interruptedFrame: CallFrame, causeWord: number, pc: number): void {
		this.instructionBudgetRemaining -= 1;
		interruptedFrame.pc = pc;
		this.enterException(this.systemImage, this.cop0Words[COP0_SYSTEM_VECTOR], causeWord, pc);
	}

	private executeSupervisorCall(frame: CallFrame, source: number, window: number): void {
		const vector = this.cop0Words[COP0_SYSTEM_VECTOR], token = frame.registers.get(source);
		if (window === 0) {
			this.enterException(this.systemImage, vector, CPU_CAUSE_CODE_SYSCALL, frame.pc, token);
		} else {
			this.enterException(this.systemImage, vector, CPU_CAUSE_CODE_SYSCALL, frame.pc, token, valueInteger(source), valueInteger(window - 1));
		}
	}

	private enterRegisterWindowException(issuer: CallFrame, valueEnd: number, frameEnd: number, op: OpCode, operand: number): void {
		const deadline = this.remainingDeviceCycles();
		issuer.pc = this.currentInstructionPc;
		this.enterException(this.systemImage, this.cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_REGISTER_WINDOW,
			this.currentInstructionPc, valueInteger(valueEnd), valueInteger(frameEnd), valueInteger(op | (operand << 8)), valueInteger(deadline));
	}

	private enterLuaFaultException(error: Value): void {
		this.cop0Words[COP0_LUA_FAULT_REASON] = LUA_FAULT_REASON_EXPLICIT_ERROR;
		this.enterException(this.systemImage, this.cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_TRAP,
			this.currentInstructionPc, error);
	}

	private retireNumericLuaFault(reason: number): void {
		this.cop0Words[COP0_LUA_FAULT_REASON] = reason;
		// A managed handler needs the progress already published by the
		// issuing instruction; the cold numeric vector uses a precise retry.
		if (this.resetBankSelected()) {
			this.enterSynchronousException(this.activeThread.currentFrame!, CPU_CAUSE_CODE_TRAP);
			return;
		}
		this.enterException(this.systemImage, this.cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_TRAP, this.currentInstructionPc);
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
		this.charge(this.closeUpvalues(frame));
		frame.thread.leaveFrame();
		if (this.fixedInterruptActive() && this.irqThread.frameDepth === 0) this.resumeInterruptedContext();
		const caller = this.activeThread.currentFrame;
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
		argument?: Value,
		secondArgument?: Value,
		thirdArgument?: Value,
		fourthArgument?: Value,
		supplied?: number,
		tail?: ValueSlots,
		tailSource = 0,
		tailDestination = 0,
	): CallFrame | null {
		this.latchExceptionEntry(causeWord, epcWord);
		if (this.fixedInterruptActive()) {
			// A second synchronous fault cannot enter another detached context.
			this.hardHalt();
			return null;
		}
		if (vectorImage === this.systemImage && !this.resetBankSelected()) {
			this.memory.writeRamRecordPair(CPU_INTERRUPTED_CONTEXT_ADDRESS, this.activeThread.address, 0);
			this.activeThread = this.irqThread;
			this.threadSwitchRequested = this.yieldRequested = true;
		}
		return this.placeExceptionVector(vectorImage, functionAddress, causeWord === CPU_CAUSE_NMI, epcWord,
			argument, secondArgument, thirdArgument, fourthArgument, supplied, tail, tailSource, tailDestination);
	}

	private latchExceptionEntry(causeWord: number, epcWord: number): void {
		this.exceptionDomainWord = this.activeExecutionDomainId >>> 0;
		this.cop0Words[COP0_EPC] = epcWord >>> 0;
		this.cop0Words[COP0_CAUSE] = causeWord >>> 0;
		this.cop0Words[COP0_STATUS] = ((this.cop0Words[COP0_STATUS] & ~CPU_STATUS_MODE_STACK_MASK)
			| ((this.cop0Words[COP0_STATUS] << 2) & CPU_STATUS_MODE_STACK_MASK)) >>> 0;
		this.yieldRequested = false;
	}

	private placeExceptionVector(vectorImage: Blua32ExecutionImage, functionAddress: number, nmi: boolean, epcWord: number,
		argument?: Value, secondArgument?: Value, thirdArgument?: Value, fourthArgument?: Value, supplied?: number,
		tail?: ValueSlots, tailSource = 0, tailDestination = 0): CallFrame | null {
		if (!this.readFunctionRecordOnBus(vectorImage, functionAddress, CPU.executionBusSignalsForDomain(vectorImage.executionDomainId))) {
			this.hardHalt();
			return null;
		}
		return this.enterLatchedExceptionFrame(nmi, epcWord, argument, secondArgument, thirdArgument, fourthArgument,
			supplied, tail, tailSource, tailDestination);
	}

	private enterLatchedExceptionFrame(nmi: boolean, epcWord: number,
		argument?: Value, secondArgument?: Value, thirdArgument?: Value, fourthArgument?: Value, supplied?: number,
		tail?: ValueSlots, tailSource = 0, tailDestination = 0): CallFrame | null {
		try {
			return this.enterDirectFrame(epcWord, nmi, argument, secondArgument, thirdArgument, fourthArgument,
				supplied, tail, tailSource, tailDestination);
		} catch (error) {
			if (error !== LUA_OUT_OF_MEMORY_SIGNAL) throw error;
			this.hardHalt();
			return null;
		}
	}

	// Direct machine entry binds the sampled Function and no capture environment.
	private enterDirectFrame(epcWord?: number, nmi = false,
		argument?: Value, secondArgument?: Value, thirdArgument?: Value, fourthArgument?: Value, supplied?: number,
		tail?: ValueSlots, tailSource = 0, tailDestination = 0): CallFrame | null {
		const entry = this.functionRecordLatch;
		const { functionAddress, codeAddress, numParams, maxStack, executionDomainId } = entry;
		const thread = this.activeThread, base = thread.stackTop;
		const argumentCount = supplied ?? (fourthArgument !== undefined ? 4 : thirdArgument !== undefined ? 3
			: secondArgument !== undefined ? 2 : argument !== undefined ? 1 : 0);
		const capacity = Math.max(1, numParams, maxStack, argumentCount);
		const end = base + capacity;
		const exception = epcWord !== undefined, boardBank = thread.address === CPU_RESET_BANK_ADDRESS;
		if (!exception && !boardBank && !thread.frameSpaceFits(end)) {
			this.hardHalt();
			return null;
		}
		if (end > MAX_THREAD_VALUE_SLOTS) throw LUA_OUT_OF_MEMORY_SIGNAL;
		const image = entry.image!;
		if (boardBank) {
			const frames = exception ? thread.frameDepth + 1 : thread.frameDepth + 2;
			if (end > CPU_FIXED_VALUE_COUNT || frames > CPU_FIXED_FRAME_COUNT) throw LUA_OUT_OF_MEMORY_SIGNAL;
		} else if (exception && !thread.frameSpaceFits(end, 1)) {
			throw LUA_OUT_OF_MEMORY_SIGNAL;
		}
		const frame = thread.acquireFrame();
		frame.executionImage = image;
		frame.decodedPage = null;
		frame.initializeControl(functionAddress, codeAddress, epcWord ?? codeAddress, false, executionDomainId,
			base + numParams, argumentCount, 0, 0, Math.max(numParams, argumentCount), 0, base, capacity);
		const initialized = exception ? Math.max(1, numParams) : numParams;
		if (tail === undefined) frame.registers.clear(initialized);
		else {
			// The exception bank can overlap the source. Move the actual Value
			// window before writing its prefix; only absent formals are nilled.
			frame.registers.copyRangeFrom(tail, tailDestination, tailSource, argumentCount - tailDestination,
				Math.max(0, initialized - argumentCount));
		}
		if (argument !== undefined) frame.registers.set(0, argument);
		if (secondArgument !== undefined) frame.registers.set(1, secondArgument);
		if (thirdArgument !== undefined) frame.registers.set(2, thirdArgument);
		if (fourthArgument !== undefined) frame.registers.set(3, fourthArgument);
		if (epcWord !== undefined) frame.enterException(nmi);
		thread.stackTop = end;
		thread.enterFrame(frame);
		this.latchActiveExecutionImage(executionDomainId, image);
		return frame;
	}

	private clearHaltAfterAcceptedInterrupt(): void {
		this.haltedUntilIrqFrameDepth = -1;
		this.haltedUntilIrqThread = 0;
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
		const frame = this.prepareHeapServiceFrame(functionAddress, 0, args.length, 0, 0);
		const copied = Math.min(frame.top, args.length);
		for (let index = 0; index < copied; ++index) frame.registers.setInteger(index, args[index]);
		frame.registers.clear(frame.top - copied, copied);
		this.memory.writeRamRecordWord(this.heapService.resultAddress, 0);
		frame.thread.enterFrame(frame);
		return true;
	}

	private remainingDeviceCycles(): number {
		// Bare CPU execution supplies only an explicit clock horizon.
		return this.deviceClock === null
			? Math.max(0, this.instructionBudgetRemaining)
			: this.deviceClock.cyclesUntilDeadline();
	}

	public runUntilDepth(targetDepth: number, instructionBudget: number, target: number = this.rootThread.address,
		kind = CpuRunKind.Direct, deviceClock: DeviceScheduler | null = null): RunResult {
		if (this.heapServiceActive()) {
			const resident = (this.memory.readRamRecordWord(this.heapService.thread.firstFrame!.controlOffset + FrameField.Flags) & FRAME_RESIDENT_ACTIVATION) !== 0;
			this.runKind = kind;
			this.deviceClock = deviceClock;
			try {
				this.runUntilDepthInstrumented(0, instructionBudget, true);
				if (!this.heapServiceActive()) {
					// The fixed activation may have changed the physical Thread
					// layout or retired an inactive bank's previous referent.
					this.activeThread.bindStack(true);
					if (this.activeThread !== this.rootThread) this.rootThread.bindStack(true);
					this.globalBank.bind();
					this.systemGlobalBank.bind();
					for (let i = 1; i < this.threadBanks.length; ++i) {
						const bank = this.threadBanks[i];
						if (bank !== this.activeThread && bank.address !== 0) bank.bindAddress(0);
					}
					try {
						if (resident) this.finishResidentCall();
						else this.finishClosureReservation();
					} catch (error) {
						this.handleRunLoopError(error);
					}
				}
				return this.hardHalted ? RunResult.Halted : RunResult.Yielded;
			} finally {
				this.runKind = CpuRunKind.Idle;
				this.deviceClock = null;
			}
		}
		if (this.unpublishedRomMask !== 0) throw new Error('Installed ROM must be published before CPU execution.');
		this.runKind = kind;
		this.deviceClock = deviceClock;
		try {
			for (;;) {
				const result = this.runUntilDepthEntry(this.activeThread.address === target ? targetDepth : 0, instructionBudget);
				if (!this.threadSwitchRequested) return result;
				this.threadSwitchRequested = false;
				this.yieldRequested = false;
				instructionBudget = this.instructionBudgetRemaining;
				if (instructionBudget <= 0) return RunResult.Yielded;
			}
		} finally {
			this.runKind = CpuRunKind.Idle;
			this.deviceClock = null;
		}
	}

	private runUntilDepthNormal(targetDepth: number, instructionBudget: number): RunResult {
		this.instructionBudgetRemaining = instructionBudget;
		const thread = this.activeThread, canInterrupt = !this.fixedInterruptActive();
		let scalarFrame: CallFrame | null = null, nextPc = 0;
		try {
			while (thread.frameDepth > targetDepth) {
				try {
					if (this.instructionBudgetRemaining > 0 && !this.memoryWriteBlocked && !this.hardHalted
						&& !this.yieldRequested && !this.isHaltedUntilIrq()) {
						this.resumePendingMemoryOperation();
						if (this.stringComparison.remaining !== 0) this.advanceStringComparison(thread.currentFrame!);
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
						if (canInterrupt && (this.nonMaskableInterruptPending || this.canAcceptMaskableInterruptLine())) {
								if (scalarFrame !== null) { this.publishScalarFrontier(scalarFrame, nextPc); scalarFrame = null; }
							this.enterPendingInterrupt();
							if (thread !== this.activeThread) {
								this.threadSwitchRequested = true;
								return RunResult.Yielded;
							}
							continue;
						}
						let pc = scalarFrame === null ? frame.pc : nextPc;
						if ((pc & (INSTRUCTION_BYTES - 1)) !== 0) {
							this.cop0Words[COP0_BAD_ADDRESS] = pc;
							this.enterInstructionFetchException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, pc);
							continue;
						}
						if (image === null || (this.resetBankSelected() && pc >= SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE)) {
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
							if (SCALAR_LOCAL_PC[dispatchOp] || (dispatchOp === OpCode.MOV && page.c[pageOffset] <= ValueMoveKind.Tag)) {
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
		const canInterrupt = !service && !this.fixedInterruptActive();
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
					if (canInterrupt && this.nonMaskableInterruptPending) {
						this.enterPendingInterrupt();
						continue;
					}
					if (canInterrupt && this.canAcceptMaskableInterruptLine()) {
						const interruptedFrame = thread.currentFrame!;
						if ((preMaskableInterruptExecutionDomainMask
							& executionDomainBit(this.activeExecutionDomainId)) !== 0
							&& executionHook(this.activeExecutionDomainId, interruptedFrame.pc)) {
							return RunResult.ExecutionStopped;
						}
						this.enterPendingInterrupt();
						if (thread !== this.activeThread) {
							this.threadSwitchRequested = true;
							return RunResult.Yielded;
						}
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
					if (image === null || (!service && this.resetBankSelected() && pc >= SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE)) {
						this.cop0Words[COP0_BAD_ADDRESS] = pc;
						this.enterInstructionFetchException(frame, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, pc);
						continue;
					}
					const page = this.decodedPageForFrame(frame, pc, service);
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
					this.executeInstruction(
						frame,
						page,
						pageOffset,
						op,
						targetDepth,
						false,
						service,
					);
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
			this.retireNumericLuaFault(LUA_FAULT_REASON_OUT_OF_MEMORY);
		} else if (error instanceof LuaThrownValueError) {
			this.enterLuaFaultException(error.value);
		} else if (error instanceof LuaExecutionError) {
			this.retireNumericLuaFault(error.reason);
		} else throw error;
	}

	private unwindToDepth(targetDepth: number): void {
		const unwinding = this.activeThread.frameDepth > targetDepth;
		if (unwinding) this.abortStalledMemoryWrite();
		while (this.activeThread.frameDepth > targetDepth) {
			const frame = this.activeThread.currentFrame!;
			this.closeUpvalues(frame);
			frame.thread.leaveFrame();
		}
		if (unwinding) this.resumeFrameBank();
	}

	private charge(cycles: number): void {
		this.instructionBudgetRemaining -= cycles;
	}

	private skipNextInstruction(frame: CallFrame, privateFirmware = false): void {
		const pc = frame.pc;
		const page = this.decodedPageForFrame(frame, pc, privateFirmware);
		const pageOffset = (pc & MAPPED_PAGE_BYTE_MASK) >>> 2;
		if ((page.refreshState[pageOffset] & DECODED_REFRESH_DECODE) !== 0
			&& !this.decodeInstruction(frame, page, pageOffset, pc, false)) {
			return;
		}
		const nextPc = (pc + page.widths[pageOffset] * INSTRUCTION_BYTES) >>> 0;
		frame.pc = nextPc;
	}

	public readFrameExecutionDomain(frameIndex: number): ExecutionDomainId {
		return this.readThreadFrameExecutionDomain(this.activeThread.address, frameIndex);
	}

	public readLastExecutionDomain(): ExecutionDomainId {
		return this.lastExecutionDomainId;
	}

	/** Instruction start (including WIDE), inspected only during CPU execution. */
	public readCurrentInstructionPc(): number {
		return this.currentInstructionPc;
	}

	public readFrameFunctionAddress(frameIndex: number): number {
		return this.readThreadFrameWord(this.activeThread.address, frameIndex, FrameField.Function);
	}

	public readFramePc(frameIndex: number): number {
		return this.readThreadFrameWord(this.activeThread.address, frameIndex, FrameField.Pc);
	}

	public readFrameCallSitePc(childFrameIndex: number): number {
		return this.readThreadFrameWord(this.activeThread.address, childFrameIndex, FrameField.CallSite);
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
		if (this.fixedInterruptActive()) throw new Error('Fixed execution must retire before replacing code execution.');
		this.unwindToDepth(frameIndex);
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
		return this.readThreadFrameWord(this.activeThread.address, frameIndex, FrameField.Top) & FRAME_WINDOW_MASK;
	}

	public readFrameRegister(frameIndex: number, registerIndex: number): Value {
		return this.readThreadRegister(this.activeThread.address, frameIndex, registerIndex);
	}

	public getFrameUpvalueCount(frameIndex: number): number {
		return frameCaptureCount(this.memory, this.readThreadFrameWord(this.activeThread.address, frameIndex, FrameField.Closure));
	}

	public readFrameUpvalue(frameIndex: number, upvalueIndex: number): Value {
		const closure = this.readThreadFrameWord(this.activeThread.address, frameIndex, FrameField.Closure);
		if (closure === 0) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		return this.readClosureUpvalue(closure, upvalueIndex);
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
		if (this.heapServiceActive() || this.fixedInterruptActive() || this.stringComparison.remaining !== 0) throw new Error('Pending CPU work must retire before replacing code execution.');
		const image = this.executionImageForDomain(executionDomainId);
		if (image === null || !admitsFunctionPc(image.romFunctions, functionAddress, pc)
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
		const record = this.functionRecordLatch;
		if (record.romBacked && record.executionDomainId === SYSTEM_EXECUTION_DOMAIN_ID
			&& (record.flags & (BLUA32_FUNCTION_CODE | BLUA32_FUNCTION_STATIC)) === (BLUA32_FUNCTION_CODE | BLUA32_FUNCTION_STATIC)
			&& record.recordUpvalueCount === 0) {
			registers.setEncoded(a, ValueTag.CodeFunction, functionAddress);
			this.bumpRegisterTop(frame, a);
			return;
		}
		if (record.romBacked && record.executionDomainId === SYSTEM_EXECUTION_DOMAIN_ID
			&& (record.flags & BLUA32_FUNCTION_RESIDENT) !== 0) {
			registers.setEncoded(a, ValueTag.ResidentFunction, functionAddress);
			this.bumpRegisterTop(frame, a);
			return;
		}
		if (record.recordUpvalueCount === 0 && (record.flags & BLUA32_FUNCTION_STATIC) !== 0) {
			const closure = this.findStaticClosureFromLatch();
			if (closure !== 0) {
				this.setRegisterClosureFast(frame, registers, a, closure);
				return;
			}
			if (this.systemImage.heapServiceFunctions === null) {
				this.enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
				return;
			}
			if (record.romBacked)
				this.beginClosureReservation(frame, a, record.functionAddress, record.executionDomainId, frame.pc);
			else this.beginMappedCanonicalClosure(frame, a);
			this.requestYield();
			return;
		}
		// Exception entry decodes the vector on the same record latch.
		const { executionDomainId, codeAddress, numParams, maxStack, flags, upvalueTableAddress, recordUpvalueCount, romBacked } = record;
		const cycles = this.remainingDeviceCycles();
		const vector = this.enterException(this.systemImage, this.cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_FUNCTION_BINDING,
			this.currentInstructionPc, valueInteger(a), valueInteger(functionAddress), valueInteger(executionDomainId), valueInteger(codeAddress), 11);
		if (vector !== null) {
			const operands = vector.registers;
			operands.setInteger(4, numParams);
			operands.setInteger(5, maxStack);
			operands.setInteger(6, flags);
			operands.setInteger(7, upvalueTableAddress);
			operands.setInteger(8, recordUpvalueCount);
			operands.setInteger(9, +romBacked);
			operands.setInteger(10, cycles);
		}
	}

	private executeCall(frame: CallFrame, a: number, b: number, c: number): boolean {
		const registers = frame.registers;
		const argCount = decodeValueCount(b, Math.max(frame.top - a - 1, 0));
		const capacity = registers.capacity();
		if (a >= capacity) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		switch (registers.getTag(a)) {
			case ValueTag.CodeFunction:
				return this.pushFrame(0, frame, a, c, false, false, frame.pc - INSTRUCTION_BYTES, a + 1, argCount, true,
					registers.getPayload(a)) !== null;
			case ValueTag.ResidentFunction:
				this.beginResidentCall(registers.getPayload(a), frame.thread.stackRegisters, frame.stackBase + a + 1, argCount, a, c);
				return false;
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
				const closure = Closure.recordAddress(this.memory, registers.getPayload(a));
				if (closure === 0) throw new LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
				return this.pushFrame(closure, frame, a, c, false, false, frame.pc - INSTRUCTION_BYTES, a + 1, argCount, true) !== null;
			}
			default:
				throw new LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
		}
	}

	private executeReturn(frame: CallFrame, a: number, b: number, mode = ReturnSource.Registers): boolean {
		let source = frame.registers, first = a, total: number;
		if (mode !== ReturnSource.Registers) {
			if (a >= source.capacity() || source.getTag(a) !== ValueTag.Integer) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			const base = frame.varargBase, available = Math.max(frame.stackBase - base, 0);
			const start = Math.min(source.getPayload(a), available);
			const suffix = available - start;
			first = base + start;
			total = Math.min(decodeValueCount(b, suffix), suffix);
			source = frame.thread.stackRegisters;
		} else {
			total = decodeValueCount(b, Math.max(frame.top - a, 0));
			if (total !== 0 && a + total > source.capacity()) {
				const copied = this.returnSourceCount(frame, total);
				if (copied !== 0 && a + copied > source.capacity()) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			}
		}
		const caller = frame.previous;
		if (frame.returnToCompletionLatch || caller === null) {
			this.charge(this.closeUpvalues(frame));
			const completes = frame.returnToCompletionLatch;
			this.latchCompletionValues(source, first, total);
			this.charge(total);
			frame.thread.leaveFrame();
			this.resumeFrameBank();
			return !completes;
		}
		const destination = frame.returnBase, result = frame.returnCount;
		const selected = selectedCallResultCount(result, total), end = destination + selected;
		const copied = Math.min(total, selected), padded = selected - copied;
		const sourceSlot = mode === ReturnSource.Registers ? frame.stackBase + a : first;
		const top = (result & CALL_RESULT_EXTEND_TOP) === 0 || end > caller.top ? end : -1;
		let capacity = 0;
		if (selected !== 0 && end > caller.stackCapacity) {
			capacity = this.admitRegisterWindow(frame, caller, end, OpCode.RET, a);
			if (capacity === 0) return false;
		}
		this.charge(this.closeUpvalues(frame));
		if (capacity !== 0) caller.growRegisterWindow(capacity);
		this.placeRegisterWindow(caller, destination, sourceSlot, copied, padded, top);
		frame.thread.leaveFrame();
		this.resumeFrameBank();
		return true;
	}

	/** A receiver may discard part or all of the produced range without reading it. */
	private returnSourceCount(frame: CallFrame, produced: number): number {
		if (frame.returnToCompletionLatch || frame.previous === null) return produced;
		return Math.min(produced, selectedCallResultCount(frame.returnCount, produced));
	}

	private executeVararg(frame: CallFrame, a: number, b: number): boolean {
		const available = frame.varargCount, count = decodeValueCount(b, available);
		const end = a + count;
		const top = b === 0 || (count !== 0 && end > frame.top) ? end : -1;
		if (count === 0) {
			if (top >= 0) frame.top = top;
			return false;
		}
		const source = frame.varargBase, copied = Math.min(count, available), padded = count - copied;
		if (end > frame.stackCapacity) {
			const capacity = this.admitRegisterWindow(frame, frame, end, OpCode.VARARG, a);
			if (capacity === 0) return true;
			frame.growRegisterWindow(capacity);
		}
		this.placeRegisterWindow(frame, a, source, copied, padded, top);
		return false;
	}

	// A RET's issuing frame remains live until the receiving window fits.
	private admitRegisterWindow(issuer: CallFrame, receiver: CallFrame, end: number, op: OpCode, operand: number): number {
		const capacity = registerWindowBucket(end), extent = receiver.stackBase + capacity;
		if (extent <= receiver.thread.stackRegisters.capacity()) return capacity;
		if (this.resetBankSelected()) this.enterSynchronousException(issuer, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
		else this.enterRegisterWindowException(issuer, extent, 0, op, operand);
		return 0;
	}

	private placeRegisterWindow(frame: CallFrame, destination: number, source: number, copied: number, padded: number, top: number): void {
		frame.registers.copyRangeFrom(frame.thread.stackRegisters, destination, source, copied, padded);
		this.charge(copied + padded);
		if (top >= 0) frame.top = top;
	}

	private executeMemoryLoad(frame: CallFrame, destination: number, kind: MemoryAccessKind, address: number): void {
		if ((address & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[kind]) !== 0) {
			this.enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, address);
			return;
		}
		const cpuProtected = !this.isUserMode() && this.executingSystemRom();
		if (kind === MemoryAccessKind.Value) {
			if (!cpuProtected) {
				this.enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
				return;
			}
			const offset = this.memory.readMappedValueOffset(address);
			if (offset === undefined) {
				this.enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
				return;
			}
			const ram = this.memory.ramView;
			frame.registers.setEncoded(destination, ram.getUint8(offset + VALUE_MEMORY_TAG_OFFSET) as ValueTag, ram.getUint32(offset, true));
			this.bumpRegisterTop(frame, destination);
			return;
		}
		const faultSequence = this.memory.readBusFaultSequence();
		let value: Value;
		switch (kind) {
			case MemoryAccessKind.Word: value = valueInteger(this.memory.readMappedWord(address, cpuProtected) | 0); break;
			case MemoryAccessKind.U8: value = valueInteger(this.memory.readMappedU8(address, cpuProtected)); break;
			case MemoryAccessKind.U16LE: value = valueInteger(this.memory.readMappedU16LE(address, cpuProtected)); break;
			case MemoryAccessKind.U32LE: value = valueInteger(this.memory.readMappedU32LE(address, undefined, cpuProtected) | 0); break;
			case MemoryAccessKind.F32LE: value = valueFloatBits(this.memory.readMappedU32LE(address, undefined, cpuProtected)); break;
			case MemoryAccessKind.F64LE: value = valueFloat(this.memory.readMappedF64LE(address, cpuProtected)); break;
			case MemoryAccessKind.ContextWord:
				if (!cpuProtected || !this.fixedInterruptActive()) {
					this.enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
					return;
				}
				value = valueInteger(this.memory.readMappedBusU32LE(address,
					CPU.executionBusSignalsForDomain((this.exceptionDomainWord | 0) as ExecutionDomainId)));
				break;
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
		if (kind === MemoryAccessKind.Value) {
			if (this.isUserMode() || !this.executingSystemRom()) {
				this.enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
				return;
			}
			const registers = frame.registers;
			if (!this.memory.writeMappedValue(address, registers.getPayload(source), registers.getTag(source)))
				this.enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
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
		const cpuProtected = !this.isUserMode() && this.executingSystemRom();
		switch (kind) {
			case MemoryAccessKind.Word: this.memory.writeMappedWord(address, wordOperand(value), cpuProtected); break;
			case MemoryAccessKind.U8: this.memory.writeMappedU8(address, wordOperand(value), cpuProtected); break;
			case MemoryAccessKind.U16LE: this.memory.writeMappedU16LE(address, wordOperand(value), cpuProtected); break;
			case MemoryAccessKind.U32LE: this.memory.writeMappedU32LE(address, wordOperand(value), undefined, cpuProtected); break;
			case MemoryAccessKind.F32LE:
				if (!valueIsNumber(value)) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				this.memory.writeMappedU32LE(address, valueIsFloat(value) ? valuePayload(value) : numberToF32Bits(asInteger(value)), undefined, cpuProtected); break;
			case MemoryAccessKind.F64LE:
				if (!valueIsNumber(value)) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				this.memory.writeMappedF64LE(address, valueIsInteger(value) ? asInteger(value) : asFloat(value), cpuProtected); break;
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
		const cpuProtected = !this.isUserMode() && this.executingSystemRom();
		const available = Math.max(0, Math.min(valueCount, frame.registers.capacity() - valueBase));
		let writeAddr = addr;
		for (let offset = 0; offset < available; offset += 1) {
			this.memory.writeMappedWord(writeAddr, wordOperand(frame.registers.get(valueBase + offset)), cpuProtected);
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

	private executeCompiledBlock(frame: CallFrame, page: DecodedInstructionPage, word: number, targetDepth: number, rewritten: boolean): Value | undefined {
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
					if (exit.page.ops[exit.exitWord] === OpCode.MFC0 && exit.exitB === COP0_EVENT_CYCLES)
						this.setRegisterIntegerFast(frame, registers, exit.exitA, this.remainingDeviceCycles());
					else if (this.isUserMode()) this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
					else this.hardHalt();
					redispatch = true; break;
				case CompiledBlockExit.WriteControl:
					this.executeControlWrite(frame, exit.exitA, exit.exitB); redispatch = true; break;
				case CompiledBlockExit.SupervisorCall:
					this.executeSupervisorCall(frame, exit.exitA, exit.exitB); redispatch = true; break;
				case CompiledBlockExit.ExceptionReturn: this.returnFromException(frame); redispatch = true; break;
				case CompiledBlockExit.CreateClosure:
					this.executeClosure(frame, exit.exitA, exit.exitBx, exit.exitC); redispatch = true; break;
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
				case CompiledBlockExit.Vararg: redispatch = this.executeVararg(frame, exit.exitA, exit.exitB); break;
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
					if (this.copyRegisterToUpvalue(frame, frame.captureAddress(exit.exitB), registers, exit.exitA)) return;
					break;
				case CompiledBlockExit.InvalidOperand:
				case CompiledBlockExit.InvalidConstant: throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				case CompiledBlockExit.Length:
					if (this.executeLength(frame, exit.exitA, exit.exitB)) return;
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
					if (invoked) return;
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
	): Value | undefined {
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
					else if (kind === ValueMoveKind.Tag) this.setRegisterIntegerFast(frame, registers, a, registers.getTag(b));
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
					registers.set(a, this.systemGlobalBank.slots.get(page.bx[pageOffset]));
					this.bumpRegisterTop(frame, a);
					return;
				case OpCode.SETSYS:
					this.systemGlobalBank.writeSlot(page.bx[pageOffset], registers.get(a));
					return;
				case OpCode.GETGL:
					registers.set(a, this.globalBank.slots.get(page.bx[pageOffset]));
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
						this.storeTableIndex(frame, base, valueInteger(index), value);
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
					this.storeTableFieldIndexCached(frame, registers.get(a), page, pageOffset, image.constWords[page.b[pageOffset]], this.readRKValue(frame, page.c[pageOffset]));
					return;
				case OpCode.HALT: this.haltUntilIrq(); return;
				case OpCode.GETT:
					this.loadTableIndex(registers.get(page.b[pageOffset]), this.readRKValue(frame, page.c[pageOffset]), frame, a); return;
				case OpCode.SETT:
					this.storeTableIndex(frame, registers.get(a), this.readRKValue(frame, page.b[pageOffset]), this.readRKValue(frame, page.c[pageOffset]));
					return;
				case OpCode.ARGC:
					this.setRegisterIntegerFast(frame, registers, a, frame.argumentCount);
					return;
				case OpCode.SVC:
					this.executeSupervisorCall(frame, a, page.b[pageOffset]);
					return;
				case OpCode.RESERVED_10:
					this.enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
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
						this.skipNextInstruction(frame, page.privateFirmware);
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
					if (ok !== (a !== 0)) this.skipNextInstruction(frame, page.privateFirmware); return;
				}

				case OpCode.MFC0: {
					const field = page.b[pageOffset];
					if (field !== COP0_EVENT_CYCLES && this.isUserMode()) {
						this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
						return;
					}
					if (!cop0FieldImplemented(field)) { this.hardHalt(); return; }
					if (a >= registers.capacity()) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
					const value = field === COP0_CURRENT ? frame.thread.address : field === COP0_EVENT_CYCLES ? this.remainingDeviceCycles()
						: field === COP0_RAM_END ? this.memory.ramBusEnd()
						: cop0ReadAsZero(field) ? 0 : this.cop0Words[field];
					this.setRegisterIntegerFast(frame, registers, a, value);
					return;
				}
				case OpCode.MTC0:
					this.executeControlWrite(frame, a, page.b[pageOffset]);
					return;
				case OpCode.RFE:
					this.returnFromException(frame);
					return;
				case OpCode.LOADKR: {
					const constantIndex = wordOperand(registers.get(page.b[pageOffset]));
					if (constantIndex >= image.constTags.length || image.constTags[constantIndex] === ValueTag.UnboundStringLiteral) {
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
					if (ok !== (a !== 0)) this.skipNextInstruction(frame, page.privateFirmware); return;
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
					this.copyRegisterToUpvalue(frame, address, registers, a);
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
							supplied, a, page.c[pageOffset], frame.pc - INSTRUCTION_BYTES);
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
						else if ((this.memory.readRamRecordWord(frame.controlOffset + FrameField.Flags) & FRAME_RESIDENT_ACTIVATION) !== 0) {
							this.memory.writeRamRecordPair(this.heapAllocator.managementOffset() + HEAP_SERVICE_RESIDENT_OFFSET + HeapServiceResidentField.SourceBase, a, count);
						} else {
							this.memory.writeRamRecordWord(this.heapService.resultAddress, count === 0 ? 0 : registers.getPayload(a));
							this.charge(count);
						}
						frame.thread.leaveFrame();
					} else this.executeReturn(frame, a, page.b[pageOffset], page.c[pageOffset]);
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

	private beginResidentCall(address: number, source: ValueSlots, first: number, supplied: number, base: number, result: number): void {
		const directory = this.systemImage.romFunctions, lane = romFunctionVersionLane(directory, address);
		if (lane < 0 || (directory.versions[lane + RomFunctionLane.Flags] & BLUA32_FUNCTION_RESIDENT) === 0)
			throw new LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
		const copied = Math.min(supplied, directory.versions[lane + RomFunctionLane.NumParams]);
		if (supplied !== 0 && first + supplied > source.capacity()) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		const callee = this.prepareHeapServiceFrame(address, 0, supplied, base, result, this.currentInstructionPc);
		callee.registers.copyRangeFrom(source, 0, first, copied, callee.top - copied);
		this.charge(callee.top);
		this.enterResidentFrame(callee);
	}

	private enterResidentFrame(frame: CallFrame): void {
		const flags = frame.controlOffset + FrameField.Flags;
		this.memory.writeRamRecordWord(flags, this.memory.readRamRecordWord(flags) | FRAME_RESIDENT_ACTIVATION);
		const context = this.heapAllocator.managementOffset() + HEAP_SERVICE_RESIDENT_OFFSET;
		this.memory.writeRamRecordPair(context, this.currentInstructionPc, this.lastPc);
		this.memory.writeRamRecordPair(context + HeapServiceResidentField.SourceCycles, this.remainingDeviceCycles(), this.runKind);
		frame.thread.enterFrame(frame);
		this.requestYield();
	}

	private finishResidentCall(): void {
		const context = this.heapAllocator.managementOffset() + HEAP_SERVICE_RESIDENT_OFFSET, memory = this.memory;
		this.currentInstructionPc = memory.readRamRecordWord(context + HeapServiceResidentField.IssuePc);
		this.lastPc = memory.readRamRecordWord(context + HeapServiceResidentField.LastPc);
		this.lastExecutionDomainId = this.activeExecutionDomainId;
		const sourceBase = memory.readRamRecordWord(context + HeapServiceResidentField.SourceBase);
		const count = memory.readRamRecordWord(context + HeapServiceResidentField.SourceCount);
		if (count === HEAP_SERVICE_RESULT_FAULT) {
			this.retireNumericLuaFault(sourceBase);
			return;
		}
		const thread = this.heapService.thread, frame = thread.firstFrame!, source = thread.stackRegisters;
		const caller = this.activeThread.currentFrame!;
		const result = frame.returnCount;
		const copied = Math.min(count, selectedCallResultCount(result, count));
		this.writeReturnValuesFromRegisters(caller, frame.returnBase, result, source, sourceBase, copied);
	}

	private prepareHeapServiceFrame(functionAddress: number, stackBase: number, supplied: number, returnBase: number, returnCount: number, callSite?: number): CallFrame {
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
			stackBase + numParams, supplied, returnBase, returnCount, numParams, 0, stackBase, capacity);
		thread.stackTop = stackBase + capacity;
		return frame;
	}

	private executeHeapServiceAccess(frame: CallFrame, register: number, kind: MemoryAccessKind, address: number, load: boolean): void {
		const memory = this.memory;
		if (kind === MemoryAccessKind.Value) {
			const data = RAM_BASE + this.heapAllocator.managementOffset() + HEAP_SERVICE_FIRMWARE_DATA_OFFSET;
			if ((address & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[kind]) !== 0
				|| ((address < memory.ramBusEnd() || address > this.heapService.thread.address - VALUE_MEMORY_SIZE)
					&& ((address - data) >>> 0) > RUNTIME_MANAGEMENT_SIZE - HEAP_SERVICE_FIRMWARE_DATA_OFFSET - VALUE_MEMORY_SIZE)
				|| ((address + VALUE_MEMORY_TAG_OFFSET - this.heapService.projectionAddress) >>> 0) < VALUE_MEMORY_SIZE) {
				throw new Error('Tagged Value access requires an aligned private RAM span.');
			}
			const tags = address + VALUE_MEMORY_TAG_OFFSET;
			const slots = frame.registers;
			if (load) {
				const word = memory.readRamRecordWord(address);
				slots.setEncoded(register, memory.readRamRecordByte(tags), word);
				this.bumpRegisterTop(frame, register);
			} else {
				memory.writeRamRecordWord(address, slots.getPayload(register));
				memory.writeRamRecordByte(tags, slots.getTag(register));
			}
			return;
		}
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

			} else if (address === HEAP_SERVICE_MANAGEMENT_ADDRESS && kind !== MemoryAccessKind.U8) {
				word = this.heapAllocator.managementOffset();
			} else if (kind !== MemoryAccessKind.U8
				&& (address === HEAP_SERVICE_CALL_CYCLES_ADDRESS || address === HEAP_SERVICE_CALL_RUN_KIND_ADDRESS)) {
				word = memory.readRamRecordWord(this.heapAllocator.managementOffset() + HEAP_SERVICE_RESIDENT_OFFSET
					+ HeapServiceResidentField.SourceCycles + address - HEAP_SERVICE_CALL_CYCLES_ADDRESS);
			} else {
				const slot = address >>> CART_READ_SLOT_SHIFT;
				const busAddress = address & CART_READ_ADDRESS_MASK;
				const view = this.executionReadView;
				if ((slot !== 0 && busAddress < CART_ROM_BASE)
					|| !memory.bindRomByteView(busAddress, kind === MemoryAccessKind.U8 ? 1 : 4, slot, view)) {
					throw new Error('Heap service read is outside installed RAM and ROM.');
				}
				word = kind === MemoryAccessKind.U8 ? view.bytes[view.byteOffset] : readLE32(view.bytes, view.byteOffset);
			}
			this.setRegisterIntegerFast(frame, frame.registers, register, word);
		} else {
			if (address === HEAP_SERVICE_CALL_FAULT_ADDRESS && kind !== MemoryAccessKind.U8) {
				const reason = wordOperand(frame.registers.get(register));
				memory.writeRamRecordPair(this.heapAllocator.managementOffset() + HEAP_SERVICE_RESIDENT_OFFSET + HeapServiceResidentField.SourceBase,
					reason, HEAP_SERVICE_RESULT_FAULT);
				do this.heapService.thread.leaveFrame(); while (this.heapServiceActive());
				return;
			}
			if (address < memory.ramBusEnd() || address >= this.heapService.thread.address) {
				const data = RAM_BASE + this.heapAllocator.managementOffset() + HEAP_SERVICE_FIRMWARE_DATA_OFFSET;
				if (((address - data) >>> 0) >= RUNTIME_MANAGEMENT_SIZE - HEAP_SERVICE_FIRMWARE_DATA_OFFSET)
					throw new Error('Heap service write is outside its private RAM port.');
			}
			const word = wordOperand(frame.registers.get(register));
			if (((address - this.heapService.projectionAddress) >>> 0) < 4) {
				if (kind === MemoryAccessKind.U8) throw new Error('Heap projection requires a word store.');
				this.writeHeapServiceProjection(word);
			} else if (kind === MemoryAccessKind.U8) memory.writeRamRecordByte(address, word);
			else memory.writeRamRecordWord(address, word);
		}
	}

	private writeHeapServiceProjection(word: number): void {
		if (word !== HeapServiceProjection.PublishRoots) throw new Error('Unknown heap projection store command.');
		this.publishHeapRemarkHead();
		this.publishHeapRootBanks();
	}

	private pushFrame(
		closure: number, args: CallFrame | ValueSlots | ReadonlyArray<Value>,
		returnBase: number, returnCount: number, returnToCompletionLatch: boolean,
		exception?: boolean, callSitePc?: number, argBase?: number, supplied?: number,
	): CallFrame;
	private pushFrame(
		closure: number, args: CallFrame | ValueSlots,
		returnBase: number, returnCount: number, returnToCompletionLatch: false,
		exception: false, callSitePc: number, argBase: number, supplied: number, ordinaryCall: true, codeFunction?: number,
	): CallFrame | null;
	private pushFrame(
		closure: number, args: CallFrame | ValueSlots | ReadonlyArray<Value>,
		returnBase: number, returnCount: number, returnToCompletionLatch: boolean,
		exception = false, callSitePc?: number, argBase = 0, supplied = 0, ordinaryCall = false, codeFunction = 0,
	): CallFrame | null {
		const flags = closure !== 0 ? this.memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS) : 0;
		const domain = closure !== 0 ? Closure.executionDomain(flags) : SYSTEM_EXECUTION_DOMAIN_ID;
		const image = this.executionImageForDomain(domain)!;
		const prototype = closure !== 0 ? this.memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS) : codeFunction;
		let entry: Readonly<Closure.FunctionEntry>;
		if ((flags & Closure.CLOSURE_LATCHED_PROTOTYPE) !== 0) {
			Closure.readLatchedEntry(this.memory, closure, this.latchedCallEntry);
			entry = this.latchedCallEntry;
		} else entry = image.romCallBindings.bind(this.memory, image, prototype, this.executionReadView);
		const { codeAddress, numParams, maxStack, flags: functionFlags } = entry;
		const thread = this.activeThread;
		const fromFrame = args instanceof CallFrame;
		const fromSlots = fromFrame || args instanceof ValueSlots;
		const shared = fromFrame;
		const first = fromFrame ? args.stackBase + argBase : argBase;
		const count = fromSlots ? supplied : args.length;
		const argumentBase = shared ? first : thread.stackTop;
		const vararg = (functionFlags & BLUA32_FUNCTION_VARARG) !== 0;
		const extras = vararg ? Math.max(count - numParams, 0) : 0;
		const stackBase = vararg ? argumentBase + count : argumentBase;
		const capacity = Math.max(1, numParams, maxStack);
		const end = stackBase + capacity;
		if (end > MAX_THREAD_VALUE_SLOTS) throw LUA_OUT_OF_MEMORY_SIGNAL;
		const varargBase = argumentBase + numParams;
		const fits = thread.frameSpaceFits(end);
		if (ordinaryCall && !fits) {
			if (this.resetBankSelected()) throw LUA_OUT_OF_MEMORY_SIGNAL;
			if (shared) {
				this.enterRegisterWindowException(args, end, thread.frameDepth + 2, OpCode.CALL, argBase - 1);
				return null;
			}
			// The lookup already selected the method and charged every visit.
			// Preserve its actual operands in the fixed vector's register window,
			// and leave the interrupted PC at the instruction's successor.
			const vector = this.enterException(this.systemImage, this.cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_REGISTER_WINDOW,
				this.currentInstructionPc, valueInteger(end), valueInteger(thread.frameDepth + 2), valueInteger(0),
				valueInteger(this.remainingDeviceCycles()), 12 + count, args as ValueSlots, first, 12);
			if (vector !== null) {
				const registers = vector.registers;
				const frameFlags = frameBankWord(domain) | ((returnCount & CALL_RESULT_EXTEND_TOP) === 0 ? 0 : FRAME_EXTEND_RESULT_TOP);
				registers.setInteger(4, prototype);
				registers.setInteger(5, codeAddress);
				registers.setInteger(6, closure);
				registers.setInteger(7, frameFlags);
				registers.setInteger(8, numParams);
				registers.setInteger(9, stackBase);
				registers.setInteger(10, returnBase);
				registers.setInteger(11, returnCount & ~CALL_RESULT_EXTEND_TOP);
			}
			return null;
		}
		const frame = thread.acquireFrame();
		if (!ordinaryCall && !fits) this.ensureStackCapacity(end, valueClosure(closure), true, exception);
		frame.executionImage = image;
		frame.decodedPage = null;
		frame.initializeControl(prototype, codeAddress, callSitePc ?? codeAddress, returnToCompletionLatch,
			domain, varargBase, count, returnBase, returnCount, numParams, closure, stackBase, capacity);
		const copied = Math.min(numParams, count);
		if (fromSlots) {
			const slots = fromFrame ? args.thread.stackRegisters : args;
			if (shared) {
				this.placeSharedFormals(frame, first, copied, numParams - copied, vararg);
			} else {
				this.placeDetachedFormals(frame, slots, first, copied, numParams - copied, varargBase, extras);
			}
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

	private placeSharedFormals(frame: CallFrame, first: number, copied: number, padded: number, relocate: boolean): void {
		const stack = frame.thread.stackRegisters;
		if (relocate) {
			frame.registers.copyRangeFrom(stack, 0, first, copied, padded);
			stack.clear(copied, first);
		} else frame.registers.clear(padded, copied);
		this.charge(relocate ? copied + padded : padded);
	}

	private placeDetachedFormals(frame: CallFrame, source: ValueSlots, first: number, copied: number, padded: number,
		varargBase: number, extras: number): void {
		frame.registers.copyRangeFrom(source, 0, first, copied, padded);
		if (extras !== 0) frame.thread.stackRegisters.copyRangeFrom(source, varargBase, first + copied + padded, extras);
		this.charge(copied + padded + extras);
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

	private copyRegisterToUpvalue(frame: CallFrame, address: number, registers: ValueSlots, registerIndex: number): boolean {
		const cell = address & Upvalue.UPVALUE_ADDRESS_MASK;
		const tag = registers.getTag(registerIndex), word = registers.getPayload(registerIndex);
		if (Upvalue.tryStoreDirect(this.memory, cell, tag, word)) return false;
		this.cop0Words[COP0_BAD_ADDRESS] = RAM_BASE + cell;
		this.enterException(this.systemImage, this.cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_REFERENCE_STORE,
			frame.pc, valueFromTag(tag, word));
		return true;
	}

	private writeReturnValuesFromRegisters(frame: CallFrame, base: number, count: number, source: ValueSlots, sourceBase: number, sourceCount: number, fixedStack = false): void {
		const targetCount = selectedCallResultCount(count, sourceCount);
		const end = base + targetCount;
		if (targetCount > 0) {
			if (!fixedStack && end > frame.stackCapacity) {
				const capacity = registerWindowBucket(end), extent = frame.stackBase + capacity;
				if (extent > frame.thread.stackRegisters.capacity()) {
					if (this.resetBankSelected()) throw LUA_OUT_OF_MEMORY_SIGNAL;
					const top = (count & CALL_RESULT_EXTEND_TOP) === 0 ? end : Math.max(end, frame.top);
					const vector = this.enterException(this.systemImage, this.cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_REGISTER_WINDOW,
						this.currentInstructionPc, valueInteger(extent), valueInteger(top), valueInteger(-1),
						valueInteger(this.remainingDeviceCycles()), 6 + sourceCount, source, sourceBase, 6);
					if (vector !== null) {
						vector.registers.setInteger(4, base);
						vector.registers.setInteger(5, targetCount);
					}
					return;
				}
				frame.growRegisterWindow(capacity);
			}
			const copiedCount = Math.min(sourceCount, targetCount);
			frame.registers.copyRangeFrom(source, base, sourceBase, copiedCount, targetCount - copiedCount);
		}
		frame.setCallResultTop(end, count);
		this.charge(targetCount);
	}

	private ensureRegisterCapacity(frame: CallFrame, index: number): ValueSlots {
		const registers = frame.registers;
		if (index >= frame.stackCapacity) {
			const capacity = registerWindowBucket(index + 1);
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

	private callBuiltinFunction(id: BuiltinFunctionId, args: BuiltinArgsView, out: BuiltinResults): void {
		switch (id) {
			case BuiltinFunctionId.Next:
				this.runBuiltinNextValue(args, out);
				break;
			case BuiltinFunctionId.ToInteger: {
				const integer = valueToInteger(args.length > 0 ? args.registers.get(args.base) : valueNil());
				out.push(integer === null ? valueNil() : valueInteger(integer));
				break;
			}
			case BuiltinFunctionId.GetMetatable:
				this.runBuiltinGetMetatable(args, out);
				break;
			case BuiltinFunctionId.RawGet:
				this.runBuiltinRawGet(args, out);
				break;
			case BuiltinFunctionId.GetGlobal: {
				if (args.length === 0 || args.registers.getTag(args.base) !== ValueTag.String) {
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				}
				const slot = this.globalBank.find(args.registers.getPayload(args.base));
				if (slot === undefined) out.push(valueNil());
				else out.push(this.globalBank.slots.get(slot));
				break;
			}
			case BuiltinFunctionId.FrameCount:
			case BuiltinFunctionId.FrameHeader:
			case BuiltinFunctionId.GetFrameRegister:
			case BuiltinFunctionId.SetFrameRegister:
			case BuiltinFunctionId.GetFrameUpvalue:
				this.gc.threads.invokeDiagnostic(this.gc, id, args, out);
				break;
			case BuiltinFunctionId.StringByte:
				this.runBuiltinStringByte(args, out);
				break;
			case BuiltinFunctionId.CoroutineRunning:
				out.push(valueThread(this.activeThread.address));
				out.push(valueBool(this.activeThread === this.rootThread));
				break;
			case BuiltinFunctionId.CoroutineStatus: {
				const address = args.length > 0 && args.registers.getTag(args.base) === ValueTag.Thread
					? args.registers.getThread(args.base, this.gc) : 0;
				if (address === 0) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				out.push(valueInteger(this.readThreadStatus(address)));
				break;
			}
			case BuiltinFunctionId.Error:
				this.runBuiltinError(args);
				break;
		}
	}

	private runBuiltinFunction(id: BuiltinFunctionId, frame: CallFrame, callBase: number, returnCount: number, argCount: number,
		detached?: ValueSlots, argumentBase = callBase + 1): void {
		this.charge(BUILTIN_FUNCTIONS[id].cost.base);
		const builtinArgs = this.acquireRegisterBuiltinArgs();
		const results = this.acquireBuiltinResults();
		try {
			builtinArgs.bind(detached ?? frame.registers, argumentBase, argCount);
			this.callBuiltinFunction(id, builtinArgs, results);
			if (this.activeThread.frameDepth > 0 && this.activeThread.currentFrame! === frame) {
				this.writeReturnValuesFromRegisters(frame, callBase, returnCount, results.slots, 0, results.length);
			}
		} finally {
			this.releaseRegisterBuiltinArgs(builtinArgs);
			this.releaseBuiltinResults(results);
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
		for (let index = 0; index < this.executionImagesByDomain.length; index += 1) {
			const image = this.executionImagesByDomain[index];
			if (image !== null) {
				executionResidencyMask |= 1 << index;
			}
		}
		return {
			executionCartridgeSlot: this.activeExecutionDomainId,
			programExecutionDomainId: this.programExecutionDomainId,
			executionResidencyMask,
			hardHalted: this.hardHalted,
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
			pendingMemory: { ...this.pendingMemory },
			statusWord: this.cop0Words[COP0_STATUS],
			systemVectorWord: this.cop0Words[COP0_SYSTEM_VECTOR],
			previousRootContextWord: this.cop0Words[COP0_CONTEXT],
			previousActiveContextWord: this.cop0Words[COP0_PREVIOUS_ACTIVE],
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

	/** Bulk restore replaces the state behind host observations, rather than replaying RAM stores. */
	public onStateReplaced(listener: () => void): void {
		(this.stateReplacementListeners ??= new Set()).add(listener);
	}

	public restoreRuntimeState(state: CpuRuntimeState): void {
		this.compiledCodeCache.retireAll();
		this.clearCompletionValues();
		if (this.stateReplacementListeners !== null)
			for (const listener of this.stateReplacementListeners) listener();
		for (const bank of this.threadBanks) {
			bank.bindAddress(0);
			bank.dropParkedFrameViews();
		}
		this.memory.clearMappedPageWriteWatches();
		const boardBank = state.rootThreadAddress === CPU_RESET_BANK_ADDRESS;
		if (boardBank) {
			this.staticClosures.clear();
			this.systemGlobalBank.slots.unbind();
			this.globalBank.slots.unbind();
		} else {
			this.reindexCanonicalClosures();
			this.systemGlobalBank.bind();
			this.globalBank.bind();
		}
		for (let index = 0; index < this.executionImagesByDomain.length; index += 1) {
			if ((state.executionResidencyMask & (1 << index)) !== 0) {
				const boot = this.executionAddressSpace.resolveDomain((index - 1) as ExecutionDomainId)!;
				const header = this.readExecutionImageHeader(boot, this.executionImagesByDomain[index]);
				this.executionImagesByDomain[index] = this.materializeExecutionImage(boot, header, boardBank ? ExecutionImageUpdate.Select : ExecutionImageUpdate.Restore);
			} else this.executionImagesByDomain[index] = null;
		}
		this.systemImage = this.executionImagesByDomain[SYSTEM_EXECUTION_DOMAIN_ID + 1]!;
		this.bindPhysicalFrames(this.heapService.thread);
		const executionImage = this.executionImagesByDomain[state.executionCartridgeSlot + 1];
		this.latchActiveExecutionImage(state.executionCartridgeSlot, executionImage);

		this.rootThread.bindAddress(state.rootThreadAddress);
		this.bindPhysicalFrames(this.rootThread);
		this.activeThread = this.rootThread;
		this.activeThread = this.bindThread(state.activeThreadAddress);
		if (!boardBank) {
			this.bindFixedIrqBank();
			if (this.fixedInterruptActive()) this.bindPhysicalFrames(this.irqThread);
		} else {
			this.irqThread.bindAddress(0);
			this.irqThread.dropParkedFrameViews();
		}
		if (this.activeThread.currentFrame !== null) this.activeThread.currentFrame.executionImage = this.activeExecutionImage;
		this.completionThread = state.completionThreadAddress;
		this.threadSwitchRequested = false;
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
		Object.assign(this.pendingMemory, state.pendingMemory);
		this.cop0Words[COP0_STATUS] = state.statusWord;
		this.cop0Words[COP0_SYSTEM_VECTOR] = state.systemVectorWord;
		this.cop0Words[COP0_CONTEXT] = state.previousRootContextWord;
		this.cop0Words[COP0_PREVIOUS_ACTIVE] = state.previousActiveContextWord;
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
		add(valueFromTag(this.gc.diagnosticWord(HeapServiceRemarkHeadField.StringIndexTag), this.gc.diagnosticWord(HeapServiceRemarkHeadField.StringIndexWord)));
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

	public assistAllocation(root0: Value, root1: Value, root2: Value, growingThread: number, words: number,
		sourceCycles = this.instructionBudgetRemaining): number {
		if (this.runKind !== CpuRunKind.Idle) {
			if (sourceCycles < GC_WORK_WORD_CYCLES) return 0;
			words = Math.min(words, Math.trunc(sourceCycles / GC_WORK_WORD_CYCLES));
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
		const comparison = this.stringComparison;
		memory.writeRamRecordWord(head + HeapServiceRemarkHeadField.ComparisonRemaining, comparison.remaining);
		if (comparison.remaining !== 0) {
			memory.writeRamRecordPair(head + HeapServiceRemarkHeadField.ComparisonLeft, comparison.left, comparison.right);
		}
	}

	public markRootHead(heap: GcHeap): void {
		heap.markString(heap.diagnosticWord(HeapServiceRemarkHeadField.Mode));
		heap.markString(heap.diagnosticWord(HeapServiceRemarkHeadField.Index));
		heap.markString(heap.diagnosticWord(HeapServiceRemarkHeadField.NewIndex));
		heap.markString(heap.diagnosticWord(HeapServiceRemarkHeadField.Length));
		heap.markString(heap.diagnosticWord(HeapServiceRemarkHeadField.Error));
		const faults = heap.diagnosticWord(HeapServiceRemarkHeadField.FaultIds);
		for (let reason = 0; reason <= LUA_FAULT_REASON_INDEX_NAN; ++reason)
			if (reason !== LUA_FAULT_REASON_EXPLICIT_ERROR) heap.markString(this.memory.readRamRecordWord(faults + reason * 4));
		heap.markValue(valueFromTag(heap.diagnosticWord(HeapServiceRemarkHeadField.StringIndexTag), heap.diagnosticWord(HeapServiceRemarkHeadField.StringIndexWord)));
		if (this.stringComparison.remaining !== 0) { heap.markString(this.stringComparison.left); heap.markString(this.stringComparison.right); }

	}

	public markScopedRoots(heap: GcHeap): void {
		for (let i = 0; i < this.builtinResultsScratchIndex; ++i) {
			const slots = this.builtinResultsScratch.peek(i);
			for (let j = 0; j < slots.length; ++j) heap.markValue(slots.get(j));
		}
		for (const value of this.localRoots) heap.markValue(value);
	}

	/** Publish addresses and extents only. Root data stays with its CPU owner. */
	public publishHeapRootBanks(): void {
		const memory = this.memory, descriptor = this.heapAllocator.managementOffset() + HEAP_SERVICE_ROOT_BANKS_OFFSET;
		memory.writeRamRecordPair(descriptor, this.rootThread.address, this.activeThread.address);
		memory.writeRamRecordPair(descriptor + 8, this.completionThread, this.haltedUntilIrqThread);
		const destination = descriptor + HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE;
		memory.writeRamRecordPair(destination, this.completionValueCount,
			HEAP_SERVICE_ROOT_PORT_BASE + HeapServiceRootPlane.CompletionPayloads * HEAP_SERVICE_ROOT_PORT_STRIDE);
		memory.writeRamRecordWord(destination + HeapServiceRootBankField.Tags,
			HEAP_SERVICE_ROOT_PORT_BASE + HeapServiceRootPlane.CompletionTags * HEAP_SERVICE_ROOT_PORT_STRIDE);
	}

	private readHeapServiceRoot(offset: number, kind: MemoryAccessKind): number {
		const plane = offset >>> HEAP_SERVICE_ROOT_PORT_SHIFT;
		const address = offset & (HEAP_SERVICE_ROOT_PORT_STRIDE - 1);
		const byte = kind === MemoryAccessKind.U8;
		const slot = byte ? address : address >>> 2;
		if (byte === (plane === HeapServiceRootPlane.CompletionTags) && slot < this.completionValueCount)
			return byte ? this.completionValueSlots.getTag(slot) : this.completionValueSlots.getPayload(slot);
		throw new Error('Heap service read is outside its root port.');
	}

	public rootBankSlots(bank: GcRootBank): number {
		if (bank === GcRootBank.SystemGlobals) return this.systemGlobalBank.count;
		if (bank === GcRootBank.Globals) return this.globalBank.count;
		if (bank === GcRootBank.Completion) return this.completionValueCount;
		const binding = executionImageBindingOffset(this.heapAllocator.managementOffset(), (bank - GcRootBank.Cart0Constants) as ExecutionDomainId);
		return this.memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_RAM_STRINGS_OFFSET);
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
		const binding = executionImageBindingOffset(this.heapAllocator.managementOffset(), (bank - GcRootBank.Cart0Constants) as ExecutionDomainId);
		const strings = this.memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET);
		for (let slot = first; slot < end; ++slot)
			heap.markString(this.memory.readRamRecordWord(strings + 4 * slot) & ~IMAGE_STRING_RAM_ORDINAL);
	}

	public markRootThreads(heap: GcHeap): void {
		heap.markThread(this.rootThread.address); heap.markThread(this.activeThread.address); heap.markThread(this.completionThread);
		heap.markThread(this.haltedUntilIrqThread);
	}

}

// end normalized-body-acceptable
// end repeated-sequence-acceptable
