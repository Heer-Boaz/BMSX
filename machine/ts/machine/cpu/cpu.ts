import { StringPool, type StringId } from './string_pool';
import { NO_BLOCKED_MAPPED_WRITE, type Memory, type RomByteView } from '../memory/memory';
import {
	MAPPED_BUS_MASTER_CPU,
	mappedBusSignalsForCartridgeSlot,
	type MappedBusSignals,
} from '../memory/bus_signals';
import { readLE32 } from '../../common/endian';
import type { IrqController } from '../devices/irq/controller';
import { BASE_CYCLES, OPCODE_USES_BX, OPCODE_USES_DISP, OpCode } from '../../spec/blua32/opcode';
import {
	COP0_BAD_ADDRESS,
	COP0_CAUSE,
	COP0_EPC,
	COP0_EXEC,
	COP0_LUA_FAULT_REASON,
	COP0_STATUS,
	CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD,
	CPU_CAUSE_CODE_ADDRESS_ERROR_STORE,
	CPU_CAUSE_CODE_DATA_BUS_ERROR,
	CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE,
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
import { EXT_A_BITS, EXT_B_BITS, EXT_BX_BITS, EXT_C_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_OPERAND_BITS, signExtend } from '../../spec/blua32/instruction_format';
import {
	BLUA32_CONSTANT_PAYLOAD_OFFSET,
	BLUA32_CONSTANT_RECORD_SIZE,
	BLUA32_CONSTANT_STRING_BYTE_COUNT_OFFSET,
	BLUA32_CONSTANT_TAG_OFFSET,
	BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
	BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
	BLUA32_FUNCTION_FLAGS_OFFSET,
	BLUA32_FUNCTION_MAX_STACK_OFFSET,
	BLUA32_FUNCTION_NUM_PARAMS_OFFSET,
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
	executionDomainBit,
	SYSTEM_EXECUTION_DOMAIN_ID,
	type ExecutionDomainId,
	type ExecutionDomainMask,
} from '../../spec/blua32/execution_domain';
import { MEMORY_ACCESS_KIND_ALIGNMENT_MASKS, MemoryAccessKind } from '../../spec/blua32/memory_access_kind';
import { ScratchBuffer } from '../../common/scratchbuffer';
import { luaFloorDivide, luaModulo } from '../../spec/blua32/numeric';
import { ceilDiv4 } from '../common/numeric';
import { BuiltinFunctionId, LUA_BOOT_PRIMITIVES } from '../../spec/blua32/builtin';
import {
	EMPTY_CALL_ARGS,
	VALUE_TAG,
	ValueTag,
	materializeValue,
	storedValueToString,
	valueFromNumber,
	valueTypeNameForLuaTag,
	BUILTIN_FUNCTIONS,
	type Value,
	type ValueReference,
} from './value';
import { LUA_OUT_OF_MEMORY_SIGNAL, LuaExecutionError, LuaThrownValueError } from './errors';
import { Table } from './table';
import { Closure, EMPTY_CLOSURE_UPVALUES, type Upvalue } from './closure';
import { BuiltinArgsView, BuiltinResults, ValueSlots } from './value_slots';
import {
	DECODED_DISPATCH_BASE_CYCLES,
	DECODED_PAGE_BYTE_MASK,
	DECODED_PAGE_BYTE_SIZE,
	NO_TABLE_LOAD_CACHE_INDEX,
	createDecodedInstructionPage,
	decodedDispatchOp,
	decodedInstructionNeedsRefresh,
	DecodedDispatchOp,
	type Blua32ExecutionImage,
	type Blua32FunctionRecordLatch,
	type DecodedInstructionPage,
	type TableLoadInlineCache,
} from './execution_image';
import { ProtectedCallContinuation, ProtectedCallKind, type CallFrame } from './call_state';
import { LuaHeap } from './lua_heap';

// start repeated-sequence-acceptable -- Lua VM/table/register hot paths deliberately keep short copy/update sequences inline.
// start normalized-body-acceptable -- Specialized Lua VM accessors stay split so the fast paths avoid dispatch helpers.

const executionStringDecoder = new TextDecoder('utf-8', { fatal: true });

const CLOSURE_HEAP_BYTES = 16;
const CLOSURE_UPVALUE_SLOT_HEAP_BYTES = 8;
const UPVALUE_HEAP_BYTES = 24;

export type CpuValueState =
	| { tag: 'nil' }
	| { tag: 'false' }
	| { tag: 'true' }
	| { tag: 'number'; value: number }
	| { tag: 'string'; id: number }
	| { tag: 'builtin'; id: BuiltinFunctionId }
	| { tag: 'table'; id: number }
	| { tag: 'closure'; id: number };

export type CpuObjectState =
	| {
		kind: 'table';
		hashId: number;
		array: CpuValueState[];
		arrayLength: number;
		hash: Array<{ key: CpuValueState; value: CpuValueState; next: number }>;
		hashFree: number;
		metatable: CpuValueState;
	}
	| {
		kind: 'closure';
		hashId: number;
		functionAddress: number;
		canonical: boolean;
		upvalues: number[];
	}
	| {
		kind: 'upvalue';
		hashId: number;
		open: boolean;
		index: number;
		frameIndex: number;
		value: CpuValueState;
	};

export type CpuFrameState = {
	functionAddress: number;
	pc: number;
	closureRef: number;
	registers: CpuValueState[];
	varargs: CpuValueState[];
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
	name: string;
	value: CpuValueState;
};

export type CpuRuntimeState = {
	executionCartridgeSlot: ExecutionDomainId;
	systemGlobals: CpuRootValueState[];
	globals: CpuRootValueState[];
	stringIndexTable: CpuValueState;
	frames: CpuFrameState[];
	protectedCalls: CpuProtectedCallState[];
	completionValues: CpuValueState[];
	objects: CpuObjectState[];
	openUpvalues: number[];
	lastExecutionDomainId: ExecutionDomainId;
	lastPc: number;
	instructionBudgetRemaining: number;
	haltedUntilIrqFrameDepth: number;
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
export class CPU {
	public instructionBudgetRemaining: number = 0;
	public lastPc: number = 0;
	public readonly globals: Table;
	public readonly memory: Memory;

	public readonly luaHeap: LuaHeap;
	public readonly stringPool: StringPool;
	private indexKey!: StringId;
	private modeKey!: StringId;
	private haltedUntilIrqFrameDepth = -1;
	private interruptEventPending = false;
	private memoryWriteBlocked = false;
	private memoryWriteBlockedAddress = 0;
	private currentInstructionPc = 0;
	private lastExecutionDomainId: ExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	private hardHalted = false;
	private statusWord = CPU_STATUS_CART_ENTRY;
	private causeWord = 0;
	private epcWord = 0;
	private badAddressWord = 0;
	private luaFaultReasonWord = 0;
	private exceptionDomainWord = 0;
	private nmiReturnCauseWord = 0;
	private nmiReturnEpcWord = 0;
	private nmiReturnBadAddressWord = 0;
	private nmiReturnLuaFaultReasonWord = 0;
	private nmiReturnExceptionDomainWord = 0;
	private nonMaskableInterruptPending = false;
	private systemExceptionFunctionAddress = 0;
	private yieldRequested = false;
	private executionHook: ExecutionHook | null = null;
	private executionHookDomainMask: ExecutionDomainMask = 0;
	private preMaskableInterruptExecutionHookDomainMask: ExecutionDomainMask = 0;
	private runUntilDepthEntry = this.runUntilDepthNormal;
	private readonly frames: CallFrame[] = [];
	private readonly protectedCallContinuations = new ScratchBuffer<ProtectedCallContinuation>(() => new ProtectedCallContinuation(), MAX_POOLED_FRAMES);
	private protectedCallDepth = 0;
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
	private closureUpvalueWords = new Uint32Array(0);
	private readonly heapObjectStack: Array<Table | Closure> = [];
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
			case ValueTag.Table:
				return this.heapSeen.get(reference as Table) === this.heapEpoch;
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
			case ValueTag.Table:
				if (this.heapSeen.get(valueReference as Table) !== this.heapEpoch) {
					this.heapObjectStack.push(valueReference as Table);
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
			case ValueTag.Table:
				this.heapObjectStack.push(reference as Table);
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

	private readonly executionImages: Blua32ExecutionImage[] = [];
	private systemImage!: Blua32ExecutionImage;
	private activeExecutionImage!: Blua32ExecutionImage;
	private executionBusSignals: MappedBusSignals = MAPPED_BUS_MASTER_CPU;
	private readonly functionRecordLatch: Blua32FunctionRecordLatch = {
		image: null!,
		busSignals: MAPPED_BUS_MASTER_CPU,
		address: 0,
		codeAddress: 0,
		codeByteCount: 0,
		numParams: 0,
		maxStack: 0,
		flags: 0,
		upvalueTableAddress: 0,
		upvalueCount: 0,
	};
	private readonly executionReadView: RomByteView = {
		bytes: new Uint8Array(0),
		byteOffset: 0,
		byteLength: 0,
	};
	private readonly executionTableView: RomByteView = {
		bytes: new Uint8Array(0),
		byteOffset: 0,
		byteLength: 0,
	};
	private readonly staticClosuresByAddress = new Map<number, Closure>();
	private stringIndexTable: Table | null = null;
	private systemGlobalNames: StringId[] = [];
	private systemGlobalSlots = new ValueSlots(0);
	private systemGlobalSlotByKey: Map<StringId, number> = new Map();
	private globalNames: StringId[] = [];
	private globalSlots = new ValueSlots(0);
	private globalSlotByKey: Map<StringId, number> = new Map();
	private readonly framePool: CallFrame[] = [];
	private stackRegisters = new ValueSlots(8);
	private stackTop = 0;
	private completionValueSlots = new ValueSlots(8);
	private completionValueCount = 0;
	private nextObjectHashId = 1;
	private readonly luaFaultErrorStringIds: StringId[] = [];
	private readonly errorInErrorHandlingStringId: StringId;

	constructor(
		memory: Memory,
		private readonly irqController: IrqController,
		private readonly executionAddressSpace: ExecutionAddressSpace,
	) {
		this.memory = memory;
		this.luaHeap = new LuaHeap(this, memory.ramByteCount());
		this.stringPool = new StringPool(this.luaHeap);
		this.globals = this.createTable(0, 0);
		this.indexKey = this.stringPool.intern('__index');
		this.modeKey = this.stringPool.intern('__mode');
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
		this.errorInErrorHandlingStringId = this.stringPool.intern('error in error handling', false);
	}

	public allocateObjectHashId(): number {
		const hashId = this.nextObjectHashId;
		this.nextObjectHashId = hashId + 1;
		return hashId;
	}

	private observeObjectHashId(hashId: number): void {
		if (this.nextObjectHashId <= hashId) {
			this.nextObjectHashId = hashId + 1;
		}
	}

	public createTable(arraySize: number = 0, hashSize: number = 0): Table {
		const hashCapacity = Table.hashCapacity(hashSize);
		this.luaHeap.reserve(Table.trackedHeapBytesForCapacities(arraySize, hashCapacity));
		const table = new Table(this.luaHeap, arraySize, hashCapacity);
		table.hashId = this.allocateObjectHashId();
		return table;
	}

	private ensureStackCapacity(size: number): void {
		const stack = this.stackRegisters;
		if (size <= stack.capacity()) {
			return;
		}
		let nextCapacity = 1 << (32 - Math.clz32(size - 1));
		if (nextCapacity < 8) {
			nextCapacity = 8;
		}
		const next = new ValueSlots(nextCapacity);
		next.copyRangeFrom(stack, 0, 0, this.stackTop);
		this.stackRegisters = next;
		this.refreshFrameRegisterViews();
	}

	private refreshFrameRegisterViews(): void {
		const stack = this.stackRegisters;
		const frames = this.frames;
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

	private loadTableIntegerIndexCached(
		cache: TableLoadInlineCache,
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
		const version = table.getVersion();
		if (cache.table === table && cache.version === version) {
			target.setEncoded(targetIndex, cache.valueTag, cache.valueScalar, cache.valueReference);
			return;
		}
		table.loadInteger(index, target, targetIndex);
		cache.table = table;
		cache.version = version;
		cache.valueTag = target.getTag(targetIndex);
		cache.valueScalar = target.getScalar(targetIndex);
		cache.valueReference = target.getReference(targetIndex);
	}

	private loadTableFieldIndexCached(
		cache: TableLoadInlineCache,
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
			if (!table.resolveStringIndex(
				this.indexKey,
				key,
				target,
				targetIndex,
			)) {
				throw new LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
			}
			return;
		}
		const version = table.getVersion();
		if (cache.table === table && cache.version === version) {
			target.setEncoded(targetIndex, cache.valueTag, cache.valueScalar, cache.valueReference);
			return;
		}
		table.loadStringKey(key, target, targetIndex);
		cache.table = table;
		cache.version = version;
		cache.valueTag = target.getTag(targetIndex);
		cache.valueScalar = target.getScalar(targetIndex);
		cache.valueReference = target.getReference(targetIndex);
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

	private storeTableFieldIndex(
		baseTag: ValueTag,
		baseTable: Table | null,
		key: StringId,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): void {
		switch (baseTag) {
			case ValueTag.Table:
				baseTable!.storeStringKey(key, valueTag, valueScalar, valueReference);
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
			functionAddress: 0,
			executionImage: null!,
			decodedPage: null,
			decodedPageAddress: 0,
			codeAddress: 0,
			codeByteCount: 0,
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
		frame.registers.rebind(this.stackRegisters, 0, 0);
		frame.isExceptionFrame = false;
		frame.isNonMaskableExceptionFrame = false;
		if (this.framePool.length < MAX_POOLED_FRAMES) {
			this.framePool.push(frame);
		}
	}

	private clearCallStack(): void {
		for (let index = 0; index < this.protectedCallDepth; index += 1) {
			const continuation = this.protectedCallContinuations.peek(index);
			continuation.caller = null;
			continuation.target = null;
		}
		this.protectedCallDepth = 0;
		while (this.frames.length > 0) {
			const frame = this.frames.pop()!;
			this.closeUpvalues(frame);
			this.releaseFrame(frame);
		}
		this.stackTop = 0;
	}

	public reset(): void {
		const systemBoot = this.executionAddressSpace.resolveSystemDomain();
		const systemResetFunctionAddress = systemBoot.startupFunctionAddress;
		this.clearCompletionValues();
		this.clearCallStack();
		this.stringIndexTable = null;
		this.haltedUntilIrqFrameDepth = -1;
		this.interruptEventPending = false;
		this.memoryWriteBlocked = false;
		this.memoryWriteBlockedAddress = 0;
		this.hardHalted = false;
		this.statusWord = CPU_STATUS_SYSTEM_ENTRY;
		this.causeWord = 0;
		this.epcWord = 0;
		this.badAddressWord = 0;
		this.luaFaultReasonWord = 0;
		this.exceptionDomainWord = 0;
		this.nmiReturnCauseWord = 0;
		this.nmiReturnEpcWord = 0;
		this.nmiReturnBadAddressWord = 0;
		this.nmiReturnLuaFaultReasonWord = 0;
		this.nmiReturnExceptionDomainWord = 0;
		this.nonMaskableInterruptPending = false;
		this.yieldRequested = false;
		this.staticClosuresByAddress.clear();
		this.executionImages.length = 0;
		this.systemImage = this.activateExecutionImage(systemBoot);
		this.executionImages.push(this.systemImage);
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
		this.globals.clear();
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
		this.reserveGlobalSlots(system, registeredNames.length + nameCount);
		const values = system ? this.systemGlobalSlots : this.globalSlots;
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
				if (system) {
					values.setNil(slot);
				} else {
					this.globals.loadStringKey(key, values, slot);
				}
			}
			slots[index] = slot;
		}
		return slots;
	}

	private reserveGlobalSlots(system: boolean, capacity: number): void {
		const current = system ? this.systemGlobalSlots : this.globalSlots;
		if (capacity <= current.capacity()) {
			return;
		}
		const next = new ValueSlots(capacity);
		next.copyRangeFrom(current, 0, 0, system ? this.systemGlobalNames.length : this.globalNames.length);
		if (system) {
			this.systemGlobalSlots = next;
		} else {
			this.globalSlots = next;
		}
	}

	private activateExecutionImage(executionBoot: Blua32ExecutionBoot): Blua32ExecutionImage {
		this.executionAddressSpace.bindReadOnlyView(
			executionBoot.executionDomainId,
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
			executionBoot.executionDomainId,
			constantTableAddress,
			constTags,
			constScalars,
		);
		const globalSlots = this.registerGlobalNames(
			executionBoot.executionDomainId,
			globalNameTableAddress,
			globalNameCount,
			false,
		);
		const systemGlobalSlots = this.registerGlobalNames(
			executionBoot.executionDomainId,
			systemGlobalNameTableAddress,
			systemGlobalNameCount,
			true,
		);
		const image: Blua32ExecutionImage = {
			executionDomainId: executionBoot.executionDomainId,
			irqFunctionAddress: executionBoot.irqFunctionAddress,
			constTags,
			constScalars,
			globalSlots,
			systemGlobalSlots,
			decodedPages: new Map(),
		};
		return image;
	}

	private residentExecutionImage(executionDomainId: ExecutionDomainId): Blua32ExecutionImage | null {
		for (let index = 0; index < this.executionImages.length; index += 1) {
			const image = this.executionImages[index];
			if (image.executionDomainId === executionDomainId) {
				return image;
			}
		}
		return null;
	}

	private executionImageForDomain(executionDomainId: ExecutionDomainId): Blua32ExecutionImage | null {
		const residentImage = this.residentExecutionImage(executionDomainId);
		if (residentImage) {
			return residentImage;
		}
		const executionBoot = this.executionAddressSpace.resolveDomain(executionDomainId);
		if (!executionBoot) {
			return null;
		}
		const image = this.activateExecutionImage(executionBoot);
		this.executionImages.push(image);
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
		let imageIndex = 0;
		while (this.executionImages[imageIndex].executionDomainId !== executionBoot.executionDomainId) {
			imageIndex += 1;
		}
		const previousImage = this.executionImages[imageIndex];
		const image = this.activateExecutionImage(executionBoot);
		this.executionImages[imageIndex] = image;
		if (executionBoot.executionDomainId === SYSTEM_EXECUTION_DOMAIN_ID) {
			this.systemImage = image;
			this.systemExceptionFunctionAddress = executionBoot.exceptionFunctionAddress;
		}
		if (this.activeExecutionImage === previousImage) {
			this.latchActiveExecutionImage(image);
		}
	}

	public isExecutionDomainResident(executionDomainId: ExecutionDomainId): boolean {
		return this.residentExecutionImage(executionDomainId) !== null;
	}

	private decodedPageForAddress(
		image: Blua32ExecutionImage,
		pageKey: number,
		pageAddress: number,
	): DecodedInstructionPage {
		const existing = image.decodedPages.get(pageKey);
		if (existing !== undefined) {
			return existing;
		}
		const page = createDecodedInstructionPage();
		page.readOnly = this.memory.mappedRangeIsReadOnly(
			pageAddress,
			DECODED_PAGE_BYTE_SIZE,
		);
		image.decodedPages.set(pageKey, page);
		return page;
	}

	private decodedPageForFrame(frame: CallFrame, pc: number): DecodedInstructionPage | null {
		if (((pc - frame.codeAddress) >>> 0) >= frame.codeByteCount) {
			this.hardHalt();
			return null;
		}
		const pageAddress = (pc & ~DECODED_PAGE_BYTE_MASK) >>> 0;
		const cached = frame.decodedPage;
		if (cached !== null
			&& frame.decodedPageAddress === pageAddress) {
			return cached;
		}
		const pageKey = this.memory.mappedPageKey(pageAddress, this.executionBusSignals);
		const page = this.decodedPageForAddress(frame.executionImage, pageKey, pageAddress);
		frame.decodedPage = page;
		frame.decodedPageAddress = pageAddress;
		return page;
	}

	private decodeInstruction(
		frame: CallFrame,
		page: DecodedInstructionPage,
		pageOffset: number,
		pc: number,
		allowFusion: boolean,
	): void {
		const codeEnd = frame.codeAddress + frame.codeByteCount;
		let width = 1;
		let op: number;
		const faultSequence = this.memory.readBusFaultSequence();
		let wideA = 0;
		let wideB = 0;
		let wideC = 0;
		const sourceWord = this.memory.readMappedBusU32BE(pc, this.executionBusSignals);
		if (this.memory.readBusFaultSequence() !== faultSequence) {
			this.hardHalt();
			return;
		}
		let bodyWord = sourceWord;
		op = (sourceWord >>> 18) & 0x3f;
		let ext = sourceWord >>> 24;
		if (op === OpCode.WIDE && pc + INSTRUCTION_BYTES < codeEnd) {
			width = 2;
			wideA = (sourceWord >>> 12) & 0x3f;
			wideB = (sourceWord >>> 6) & 0x3f;
			wideC = sourceWord & 0x3f;
			bodyWord = this.memory.readMappedBusU32BE(
				pc + INSTRUCTION_BYTES,
				this.executionBusSignals,
			);
			if (this.memory.readBusFaultSequence() !== faultSequence) {
				this.hardHalt();
				return;
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
			const usesDisp = OPCODE_USES_DISP[op] !== 0;
			const usesBx = !usesDisp && OPCODE_USES_BX[op] !== 0;
			const extA = usesBx || usesDisp ? 0 : (ext >>> 6) & 0x3;
			const extB = usesBx || usesDisp ? 0 : (ext >>> 3) & 0x7;
			const extC = usesBx || usesDisp ? 0 : (ext & 0x7);
			const aShift = usesDisp
				? MAX_OPERAND_BITS
				: MAX_OPERAND_BITS + (usesBx ? 0 : EXT_A_BITS);
			const bShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + EXT_B_BITS;
			const cShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + EXT_C_BITS;
			const bxLow = (bLow << MAX_OPERAND_BITS) | cLow;
			const rawB = (wideB << bShift) | (extB << MAX_OPERAND_BITS) | bLow;
			const rawC = (wideC << cShift) | (extC << MAX_OPERAND_BITS) | cLow;
			const decodedBx = (wideB << (MAX_BX_BITS + EXT_BX_BITS))
				| ((usesBx ? ext : 0) << MAX_BX_BITS)
				| bxLow;
			page.widths[pageOffset] = width;
			page.sourceWords[pageOffset] = sourceWord;
			page.bodyWords[pageOffset] = bodyWord;
			page.ops[pageOffset] = op;
			page.a[pageOffset] = (wideA << aShift) | (extA << MAX_OPERAND_BITS) | aLow;
			page.b[pageOffset] = rawB;
			page.c[pageOffset] = rawC;
			switch (op) {
				case OpCode.GETGL:
				case OpCode.SETGL:
					page.bx[pageOffset] = frame.executionImage.globalSlots[decodedBx];
					break;
				case OpCode.GETSYS:
				case OpCode.SETSYS:
					page.bx[pageOffset] = frame.executionImage.systemGlobalSlots[decodedBx];
					break;
				default:
					page.bx[pageOffset] = decodedBx;
					break;
			}
			page.sbx[pageOffset] = signExtend(
				decodedBx,
				MAX_BX_BITS + EXT_BX_BITS + ((width - 1) * MAX_OPERAND_BITS),
			);
			page.rkB[pageOffset] = signExtend(
				rawB,
				MAX_OPERAND_BITS + EXT_B_BITS + ((width - 1) * MAX_OPERAND_BITS),
			);
			page.rkC[pageOffset] = signExtend(
				rawC,
				MAX_OPERAND_BITS + EXT_C_BITS + ((width - 1) * MAX_OPERAND_BITS),
			);
			page.disp[pageOffset] = ext;
			if (op === OpCode.GETI || op === OpCode.GETFIELD || op === OpCode.SELF) {
				let cacheIndex = page.tableCacheIndexes[pageOffset];
				if (cacheIndex === NO_TABLE_LOAD_CACHE_INDEX) {
					cacheIndex = page.tableLoadCaches.length;
					page.tableCacheIndexes[pageOffset] = cacheIndex;
					page.tableLoadCaches.push({
						table: null,
						version: 0,
						valueTag: ValueTag.Nil,
						valueScalar: NaN,
						valueReference: null,
					});
				} else {
					const cache = page.tableLoadCaches[cacheIndex];
					cache.table = null;
					cache.version = 0;
					cache.valueTag = ValueTag.Nil;
					cache.valueScalar = NaN;
					cache.valueReference = null;
				}
			}
		}
		page.dispatchOps[pageOffset] = op;
		page.decodeRequired[pageOffset] = page.readOnly ? 0 : 1;
		const fusionCandidate = op === OpCode.SHL || op === OpCode.ADD || op === OpCode.SHR;
		if (!allowFusion || !fusionCandidate || !page.readOnly) {
			page.fusionRequired[pageOffset] = !allowFusion && fusionCandidate && page.readOnly ? 1 : 0;
			return;
		}
		const nextPc = pc + width * INSTRUCTION_BYTES;
		if (nextPc >= codeEnd) {
			page.fusionRequired[pageOffset] = 0;
			return;
		}
		const nextPage = this.decodedPageForFrame(frame, nextPc);
		if (nextPage === null) {
			return;
		}
		if (!nextPage.readOnly) {
			page.fusionRequired[pageOffset] = 0;
			return;
		}
		const nextPageOffset = (nextPc & DECODED_PAGE_BYTE_MASK) >>> 2;
		if (decodedInstructionNeedsRefresh(nextPage, nextPageOffset, false)) {
			this.decodeInstruction(
				frame,
				nextPage,
				nextPageOffset,
				nextPc,
				false,
			);
		}
		if (this.hardHalted) {
			return;
		}
		page.dispatchOps[pageOffset] = decodedDispatchOp(
			op as OpCode,
			nextPage.ops[nextPageOffset] as OpCode,
		);
		page.fusionRequired[pageOffset] = 0;
	}

	private readFunctionRecord(
		image: Blua32ExecutionImage,
		address: number,
		busSignals: MappedBusSignals,
	): boolean {
		const faultSequence = this.memory.readBusFaultSequence();
		const latch = this.functionRecordLatch;
		latch.image = image;
		latch.busSignals = busSignals;
		latch.address = address;
		latch.codeAddress = this.memory.readMappedBusU32LE(
			(address + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET) >>> 0,
			busSignals,
		);
		latch.codeByteCount = this.memory.readMappedBusU32LE(
			(address + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET) >>> 0,
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
		this.statusWord = cartridgeEntry ? CPU_STATUS_CART_ENTRY : CPU_STATUS_SYSTEM_ENTRY;
		this.haltedUntilIrqFrameDepth = -1;
		this.interruptEventPending = false;
		this.memoryWriteBlocked = false;
		this.memoryWriteBlockedAddress = 0;
		this.hardHalted = false;
		this.yieldRequested = false;
		const closure = this.staticClosureAtAddress(functionAddress);
		this.pushLatchedFrame(closure, EMPTY_CALL_ARGS, 0, 0, false);
	}

	public beginCompletionCall(closure: Closure, args: ReadonlyArray<Value> = EMPTY_CALL_ARGS): void {
		this.clearCompletionValues();
		this.yieldRequested = false;
		this.pushFrame(closure, args, 0, 0, true);
	}

	public beginCompletionCallInExecutionDomain(
		executionDomainId: ExecutionDomainId,
		functionAddress: number,
	): void {
		this.clearCompletionValues();
		this.yieldRequested = false;
		this.readFunctionRecord(
			this.executionImageForDomain(executionDomainId)!,
			functionAddress,
			CPU.executionBusSignalsForDomain(executionDomainId),
		);
		this.pushLatchedFrame(
			this.staticClosureAtAddress(functionAddress),
			EMPTY_CALL_ARGS,
			0,
			0,
			true,
		);
	}

	public requestYield(): void {
		this.yieldRequested = true;
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
		this.haltedUntilIrqFrameDepth = this.frames.length;
		this.yieldRequested = false;
	}

	private hardHalt(): void {
		this.hardHalted = true;
		this.haltedUntilIrqFrameDepth = -1;
		this.yieldRequested = false;
	}


	public clearHaltUntilIrq(): void {
		this.haltedUntilIrqFrameDepth = -1;
		this.yieldRequested = false;
	}

	public isHaltedUntilIrq(): boolean {
		return this.haltedUntilIrqFrameDepth === this.frames.length;
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
		return (this.statusWord & CPU_STATUS_USER_MODE_CURRENT) !== 0;
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
		return (this.statusWord & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) !== 0
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
			const returnCauseWord = this.causeWord;
			const returnEpcWord = this.epcWord;
			const returnBadAddressWord = this.badAddressWord;
			const returnLuaFaultReasonWord = this.luaFaultReasonWord;
			const returnExceptionDomainWord = this.exceptionDomainWord;
			this.enterException(
				this.systemExceptionFunctionAddress,
				CPU_CAUSE_NMI,
				this.frames[this.frames.length - 1].pc,
			);
			this.frames[this.frames.length - 1].isNonMaskableExceptionFrame = true;
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
				this.frames[this.frames.length - 1].pc,
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
		this.badAddressWord = address >>> 0;
		this.enterSynchronousException(interruptedFrame, causeWord);
	}

	private enterLuaFaultException(
		reason: number,
		errorTag: ValueTag,
		errorScalar: number,
		errorReference: ValueReference,
	): void {
		this.luaFaultReasonWord = reason;
		this.enterSynchronousException(this.frames[this.frames.length - 1], CPU_CAUSE_CODE_TRAP);
		this.frames[this.frames.length - 1].registers.setEncoded(
			0,
			errorTag,
			errorScalar,
			errorReference,
		);
	}

	private enterException(
		functionAddress: number,
		causeWord: number,
		epcWord: number,
	): void {
		this.exceptionDomainWord = this.frames[this.frames.length - 1].executionImage.executionDomainId >>> 0;
		this.epcWord = epcWord >>> 0;
		this.causeWord = causeWord >>> 0;
		this.statusWord = ((this.statusWord & ~CPU_STATUS_MODE_STACK_MASK)
			| ((this.statusWord << 2) & CPU_STATUS_MODE_STACK_MASK)) >>> 0;
		this.clearHaltAfterAcceptedInterrupt();
		const closure = this.staticClosureAtAddress(functionAddress);
		const frame = this.pushFrame(closure, EMPTY_CALL_ARGS, 0, 0, false)!;
		frame.callSitePc = epcWord;
		frame.isExceptionFrame = true;
	}

	private clearHaltAfterAcceptedInterrupt(): void {
		this.haltedUntilIrqFrameDepth = -1;
		this.yieldRequested = false;
	}

	public getFrameDepth(): number {
		return this.frames.length;
	}

	public runUntilDepth(targetDepth: number, instructionBudget: number): RunResult {
		return this.runUntilDepthEntry(targetDepth, instructionBudget);
	}

	private runUntilDepthNormal(targetDepth: number, instructionBudget: number): RunResult {
		this.instructionBudgetRemaining = instructionBudget;
		const frames = this.frames;
		const dispatchBaseCycles = DECODED_DISPATCH_BASE_CYCLES;
		while (frames.length > targetDepth) {
			try {
				while (frames.length > targetDepth) {
					if (this.hardHalted
						|| this.haltedUntilIrqFrameDepth === frames.length
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
						|| ((this.statusWord & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) !== 0
							&& this.irqController.hasAssertedMaskableInterruptLine())
					) {
						this.enterPendingInterrupt();
						continue;
					}
					const frame = frames[frames.length - 1];
					const image = frame.executionImage;
					const pc = frame.pc;
					const page = this.decodedPageForFrame(frame, pc);
					if (page === null) {
						return RunResult.Halted;
					}
					const pageOffset = (pc & DECODED_PAGE_BYTE_MASK) >>> 2;
					if (decodedInstructionNeedsRefresh(page, pageOffset, true)) {
						this.decodeInstruction(frame, page, pageOffset, pc, true);
					}
					if (this.hardHalted) {
						return RunResult.Halted;
					}
					const width = page.widths[pageOffset];
					const dispatchOp = page.dispatchOps[pageOffset];
					this.currentInstructionPc = pc;
					frame.pc = pc + (width * INSTRUCTION_BYTES);
					this.lastExecutionDomainId = image.executionDomainId;
					this.lastPc = pc + ((width - 1) * INSTRUCTION_BYTES);
					this.instructionBudgetRemaining -= dispatchBaseCycles[dispatchOp];
					this.executeInstruction(
						frame,
						page,
						page.tableCacheIndexes[pageOffset],
						dispatchOp,
						page.a[pageOffset],
						page.b[pageOffset],
						page.c[pageOffset],
						page.bx[pageOffset],
						page.sbx[pageOffset],
						page.rkB[pageOffset],
						page.rkC[pageOffset],
						page.disp[pageOffset],
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
		const frames = this.frames;
		const baseCycles = BASE_CYCLES;
		const executionHook = this.executionHook!;
		const executionDomainMask = this.executionHookDomainMask;
		const preMaskableInterruptExecutionDomainMask =
			this.preMaskableInterruptExecutionHookDomainMask;
		while (frames.length > targetDepth) {
			try {
				while (frames.length > targetDepth) {
					if (this.hardHalted
						|| this.haltedUntilIrqFrameDepth === frames.length
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
					if ((this.statusWord & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) !== 0
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
					const page = this.decodedPageForFrame(frame, pc);
					if (page === null) {
						return RunResult.Halted;
					}
					if ((executionDomainMask & executionDomainBit(image.executionDomainId)) !== 0
						&& executionHook(image.executionDomainId, pc)) {
						return RunResult.ExecutionStopped;
					}
					const pageOffset = (pc & DECODED_PAGE_BYTE_MASK) >>> 2;
					if (decodedInstructionNeedsRefresh(page, pageOffset, false)) {
						this.decodeInstruction(frame, page, pageOffset, pc, false);
					}
					if (this.hardHalted) {
						return RunResult.Halted;
					}
					const width = page.widths[pageOffset];
					const op = page.ops[pageOffset];
					this.currentInstructionPc = pc;
					frame.pc = pc + (width * INSTRUCTION_BYTES);
					this.lastExecutionDomainId = image.executionDomainId;
					this.lastPc = pc + ((width - 1) * INSTRUCTION_BYTES);
					this.instructionBudgetRemaining -= baseCycles[op];
					this.executeInstruction(
						frame,
						page,
						page.tableCacheIndexes[pageOffset],
						op,
						page.a[pageOffset],
						page.b[pageOffset],
						page.c[pageOffset],
						page.bx[pageOffset],
						page.sbx[pageOffset],
						page.rkB[pageOffset],
						page.rkC[pageOffset],
						page.disp[pageOffset],
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
			if (!this.handleProtectedCallError(ValueTag.String, errorStringId, null)) {
				this.enterLuaFaultException(
					LUA_FAULT_REASON_OUT_OF_MEMORY,
					ValueTag.String,
					errorStringId,
					null,
				);
			}
		} else if (error instanceof LuaThrownValueError) {
			if (!this.handleProtectedCallError(error.tag, error.scalar, error.reference)) {
				this.enterLuaFaultException(
					LUA_FAULT_REASON_EXPLICIT_ERROR,
					error.tag,
					error.scalar,
					error.reference,
				);
			}
		} else if (error instanceof LuaExecutionError) {
			const errorStringId = this.luaFaultErrorStringIds[error.reason];
			if (!this.handleProtectedCallError(ValueTag.String, errorStringId, null)) {
				this.enterLuaFaultException(error.reason, ValueTag.String, errorStringId, null);
			}
		} else {
			throw error;
		}
	}

	private unwindToDepth(targetDepth: number): void {
		while (this.frames.length > targetDepth) {
			const frame = this.frames.pop()!;
			this.closeUpvalues(frame);
			this.stackTop = frame.varargBase;
			this.releaseFrame(frame);
		}
		while (this.protectedCallDepth > 0) {
			const continuation = this.protectedCallContinuations.peek(this.protectedCallDepth - 1);
			if (this.frames.indexOf(continuation.caller!) >= 0) {
				break;
			}
			continuation.caller = null;
			continuation.target = null;
			this.protectedCallDepth -= 1;
		}
	}

	private charge(cycles: number): void {
		this.instructionBudgetRemaining -= cycles;
	}

	private skipNextInstruction(frame: CallFrame): void {
		const pc = frame.pc;
		const page = this.decodedPageForFrame(frame, pc);
		if (page === null) {
			return;
		}
		const pageOffset = (pc & DECODED_PAGE_BYTE_MASK) >>> 2;
		if (decodedInstructionNeedsRefresh(page, pageOffset, false)) {
			this.decodeInstruction(frame, page, pageOffset, pc, false);
		}
		if (this.hardHalted) {
			return;
		}
		const nextPc = pc + page.widths[pageOffset] * INSTRUCTION_BYTES;
		if (nextPc < frame.codeAddress
			|| nextPc >= frame.codeAddress + frame.codeByteCount) {
			this.hardHalt();
			return;
		}
		frame.pc = nextPc;
	}

	public readFrameExecutionDomain(frameIndex: number): ExecutionDomainId {
		return this.frames[frameIndex].executionImage.executionDomainId;
	}

	public readLastExecutionDomain(): ExecutionDomainId {
		return this.lastExecutionDomainId;
	}

	public readFrameFunctionAddress(frameIndex: number): number {
		return this.frames[frameIndex].functionAddress;
	}

	public readFramePc(frameIndex: number): number {
		return this.frames[frameIndex].pc;
	}

	public readFrameCallSitePc(childFrameIndex: number): number {
		return this.frames[childFrameIndex].callSitePc;
	}

	public completionCallPending(): boolean {
		for (let frameIndex = this.frames.length - 1; frameIndex >= 0; frameIndex -= 1) {
			if (this.frames[frameIndex].returnToCompletionLatch) {
				return true;
			}
		}
		return false;
	}

	public readFrameReturnsToCompletionLatch(frameIndex: number): boolean {
		return this.frames[frameIndex].returnToCompletionLatch;
	}

	public abortCompletionCall(frameIndex: number): void {
		this.unwindToDepth(frameIndex);
		this.clearCompletionValues();
	}

	public readCompletionValues(target: Value[]): void {
		this.completionValueSlots.copyTo(target, this.completionValueCount);
	}

	public isExceptionFrame(frameIndex: number): boolean {
		return this.frames[frameIndex].isExceptionFrame;
	}

	public isNonMaskableExceptionFrame(frameIndex: number): boolean {
		return this.frames[frameIndex].isNonMaskableExceptionFrame;
	}

	public getFrameRegisterCount(frameIndex: number): number {
		return this.frames[frameIndex].top;
	}

	public readFrameRegister(frameIndex: number, registerIndex: number): Value {
		return this.frames[frameIndex].registers.get(registerIndex);
	}

	public getFrameUpvalueCount(frameIndex: number): number {
		return this.frames[frameIndex].closure.upvalues.length;
	}

	public readFrameUpvalue(frameIndex: number, upvalueIndex: number): Value {
		const upvalue = this.frames[frameIndex].closure.upvalues[upvalueIndex];
		if (upvalue.open) {
			return upvalue.frame!.registers.get(upvalue.index);
		}
		return materializeValue(upvalue.valueTag, upvalue.valueScalar, upvalue.valueReference);
	}

	public readEpcWord(): number {
		return this.epcWord;
	}

	public readCauseWord(): number {
		return this.causeWord;
	}

	public readBadAddressWord(): number {
		return this.badAddressWord;
	}

	public readLuaFaultReasonWord(): number {
		return this.luaFaultReasonWord;
	}

	public readExceptionDomainWord(): number {
		return this.exceptionDomainWord;
	}

	public writeEpcWord(value: number): void {
		this.epcWord = value;
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
		const frame = this.frames[frameIndex];
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
		frame.codeAddress = functionRecord.codeAddress;
		frame.codeByteCount = functionRecord.codeByteCount;
		frame.pc = pc;
	}

	public writeFrameCallSitePc(childFrameIndex: number, pc: number): void {
		this.frames[childFrameIndex].callSitePc = pc;
	}

	public setGlobalByKey(
		key: StringId,
		tag: ValueTag,
		scalar: number,
		reference: ValueReference,
	): void {
		this.globals.storeStringKey(key, tag, scalar, reference);
		const globalSlot = this.globalSlotByKey.get(key);
		if (globalSlot != null) {
			this.globalSlots.setEncoded(globalSlot, tag, scalar, reference);
		}
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
		this.systemGlobalSlots = new ValueSlots(0);
		this.systemGlobalSlotByKey = new Map();
		this.globalNames = [];
		this.globalSlots = new ValueSlots(0);
		this.globalSlotByKey = new Map();
	}

	public syncGlobalSlotsToTable(): void {
		for (let slot = 0; slot < this.globalNames.length; slot += 1) {
			this.globals.storeStringKey(
				this.globalNames[slot],
				this.globalSlots.getTag(slot),
				this.globalSlots.getScalar(slot),
				this.globalSlots.getReference(slot),
			);
		}
	}

	public getGlobalByKey(key: StringId): Value {
		const globalSlot = this.globalSlotByKey.get(key);
		if (globalSlot != null) {
			return this.globalSlots.get(globalSlot);
		}
		this.globals.loadStringKey(key, this.tableScratch, 0);
		const value = this.tableScratch.get(0);
		this.tableScratch.setNil(0);
		return value;
	}

	private executeInstruction(
		frame: CallFrame,
		page: DecodedInstructionPage,
		tableCacheIndex: number,
		op: number,
		a: number,
		b: number,
		c: number,
		bx: number,
		sbx: number,
		rkB: number,
		rkC: number,
		disp: number,
	): void {
		const registers = frame.registers;
		const image = frame.executionImage;
		const tableLoadCaches = page.tableLoadCaches;
		switch (op) {
				case DecodedDispatchOp.FusedShlBxor:
				case DecodedDispatchOp.FusedShrBxor: {
					const left = this.readRKNumber(frame, rkB);
					const right = this.readRKNumber(frame, rkC);
					const shifted = op === DecodedDispatchOp.FusedShlBxor
						? left << (right & 31)
						: left >> (right & 31);
					this.setRegisterNumberFast(frame, registers, a, shifted);
					if (this.instructionBudgetRemaining <= 0) {
						return;
					}
					const pc = frame.pc;
					const secondPage = this.decodedPageForFrame(frame, pc);
					if (secondPage === null) {
						return;
					}
					const secondPageOffset = (pc & DECODED_PAGE_BYTE_MASK) >>> 2;
					if (decodedInstructionNeedsRefresh(secondPage, secondPageOffset, false)) {
						this.decodeInstruction(
							frame,
							secondPage,
							secondPageOffset,
							pc,
							false,
						);
					}
					if (this.hardHalted) {
						return;
					}
					const width = secondPage.widths[secondPageOffset];
					this.currentInstructionPc = pc;
					frame.pc = pc + width * INSTRUCTION_BYTES;
					this.lastExecutionDomainId = image.executionDomainId;
					this.lastPc = pc + ((width - 1) * INSTRUCTION_BYTES);
					this.instructionBudgetRemaining -= BASE_CYCLES[OpCode.BXOR];
					const xorLeft = this.readRKNumber(frame, secondPage.rkB[secondPageOffset]);
					const xorRight = this.readRKNumber(frame, secondPage.rkC[secondPageOffset]);
					this.setRegisterNumberFast(
						frame,
						registers,
						secondPage.a[secondPageOffset],
						xorLeft ^ xorRight,
					);
					return;
				}
				case DecodedDispatchOp.FusedAddShl: {
					const left = this.readRKNumber(frame, rkB);
					const right = this.readRKNumber(frame, rkC);
					this.setRegisterNumberFast(frame, registers, a, left + right);
					if (this.instructionBudgetRemaining <= 0) {
						return;
					}
					const pc = frame.pc;
					const secondPage = this.decodedPageForFrame(frame, pc);
					if (secondPage === null) {
						return;
					}
					const secondPageOffset = (pc & DECODED_PAGE_BYTE_MASK) >>> 2;
					if (decodedInstructionNeedsRefresh(secondPage, secondPageOffset, false)) {
						this.decodeInstruction(
							frame,
							secondPage,
							secondPageOffset,
							pc,
							false,
						);
					}
					if (this.hardHalted) {
						return;
					}
					const width = secondPage.widths[secondPageOffset];
					this.currentInstructionPc = pc;
					frame.pc = pc + width * INSTRUCTION_BYTES;
					this.lastExecutionDomainId = image.executionDomainId;
					this.lastPc = pc + ((width - 1) * INSTRUCTION_BYTES);
					this.instructionBudgetRemaining -= BASE_CYCLES[OpCode.SHL];
					const shiftLeft = this.readRKNumber(frame, secondPage.rkB[secondPageOffset]);
					const shiftRight = this.readRKNumber(frame, secondPage.rkC[secondPageOffset]);
					this.setRegisterNumberFast(
						frame,
						registers,
						secondPage.a[secondPageOffset],
						shiftLeft << (shiftRight & 31),
					);
					return;
				}
				case OpCode.WIDE:
					this.hardHalt();
					return;
				case OpCode.MOV:
					this.copyRegisterFast(frame, registers, a, b);
					return;
				case OpCode.LOADK: {
					this.setRegisterConstantFast(frame, registers, a, image, bx);
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
					this.setRegisterNumberFast(frame, registers, a, sbx);
					return;
				case OpCode.LOADNIL:
					for (let index = 0; index < b; index += 1) {
						this.setRegisterNilFast(frame, registers, a + index);
					}
					return;
				case OpCode.GETSYS:
					registers.copySlotFrom(this.systemGlobalSlots, a, bx);
					this.bumpRegisterTop(frame, a);
					return;
				case OpCode.SETSYS:
					this.systemGlobalSlots.copySlotFrom(registers, bx, a);
					return;
				case OpCode.GETGL:
					registers.copySlotFrom(this.globalSlots, a, bx);
					this.bumpRegisterTop(frame, a);
					return;
				case OpCode.SETGL:
					this.globalSlots.copySlotFrom(registers, bx, a);
					return;
				case OpCode.GETI:
					this.loadTableIntegerIndexCached(
						tableLoadCaches[tableCacheIndex],
						registers.getTag(b),
						registers.getTable(b),
						c,
						registers,
						a,
					);
					this.bumpRegisterTop(frame, a);
					return;
				case OpCode.SETI: {
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
					this.storeTableIntegerIndex(
						registers.getTag(a),
						registers.getTable(a),
						b,
						valueTag,
						valueScalar,
						valueReference,
					);
					return;
				}
				case OpCode.GETFIELD:
					this.loadTableFieldIndexCached(
						tableLoadCaches[tableCacheIndex],
						registers.getTag(b),
						registers.getTable(b),
						image.constScalars[c] as StringId,
						registers,
						a,
					);
					this.bumpRegisterTop(frame, a);
					return;
				case OpCode.SETFIELD: {
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
					this.storeTableFieldIndex(
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
					const baseTag = registers.getTag(b);
					const baseTable = registers.getTable(b);
					const key = image.constScalars[c] as StringId;
					registers.copySlot(a + 1, b);
					this.bumpRegisterTop(frame, a + 1);
					this.loadTableFieldIndexCached(
						tableLoadCaches[tableCacheIndex],
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
					this.setRegisterTableFast(frame, registers, a, this.createTable(b, c));
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
							this.setRegisterNumberFast(frame, registers, a, Math.pow(left, right));
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
				case OpCode.CONCAT: {
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
					return;
				}
				case OpCode.CONCATN: {
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
					return;
				}
				case OpCode.UNM: {
					const value = registers.getNumber(b);
					this.setRegisterNumberFast(frame, registers, a, -value);
					return;
				}
				case OpCode.NOT:
					this.setRegisterBoolFast(frame, registers, a, !registers.isTruthy(b));
					return;
				case OpCode.LEN: {
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
					const value = registers.getNumber(b);
					this.setRegisterNumberFast(frame, registers, a, ~value);
					return;
				}
				case OpCode.EQ: {
					const eq = this.readRKEquals(frame, rkB, rkC);
					if (eq !== (a !== 0)) {
						this.skipNextInstruction(frame);
					}
					return;
				}
				case OpCode.LT: {
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
					const ok = leftTag === ValueTag.String && rightTag === ValueTag.String
						? this.stringPool.toString(leftScalar as StringId)
							< this.stringPool.toString(rightScalar as StringId)
						: (leftTag === ValueTag.Number ? leftScalar : NaN)
							< (rightTag === ValueTag.Number ? rightScalar : NaN);
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
					let value: number;
					switch (b) {
						case COP0_BAD_ADDRESS: value = this.badAddressWord; break;
						case COP0_LUA_FAULT_REASON: value = this.luaFaultReasonWord; break;
						case COP0_STATUS: value = this.statusWord; break;
						case COP0_CAUSE: value = this.causeWord; break;
						case COP0_EPC: value = this.epcWord; break;
						case COP0_EXEC: value = 0; break;
						default: this.hardHalt(); return;
					}
					this.setRegisterNumberFast(frame, registers, a, value);
					return;
				}
				case OpCode.MTC0: {
					if (this.isUserMode()) {
						this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
						return;
					}
					const value = registers.getNumber(a) >>> 0;
					switch (b) {
						case COP0_STATUS: this.statusWord = value; return;
						case COP0_EPC: this.epcWord = value; return;
						case COP0_EXEC: this.executeFunctionAddress(value); return;
						case COP0_BAD_ADDRESS:
						case COP0_LUA_FAULT_REASON:
						case COP0_CAUSE:
							return;
						default: this.hardHalt(); return;
					}
				}
				case OpCode.RFE:
					if (this.isUserMode()) {
						this.enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
						return;
					}
					if (!frame.isExceptionFrame) {
						this.hardHalt();
						return;
					}
					const returnFromNmi = frame.isNonMaskableExceptionFrame;
					const returnPc = this.epcWord;
					const caller = this.frames[this.frames.length - 2];
					if (caller
						&& (returnPc < caller.codeAddress
							|| returnPc >= caller.codeAddress + caller.codeByteCount)) {
						this.hardHalt();
						return;
					}
					this.closeUpvalues(frame);
					this.frames.pop();
					this.stackTop = frame.varargBase;
					this.releaseFrame(frame);
					this.statusWord = ((this.statusWord & ~CPU_STATUS_RFE_RESTORE_MASK)
						| ((this.statusWord >> 2) & CPU_STATUS_RFE_RESTORE_MASK)) >>> 0;
					if (caller) {
						caller.pc = returnPc;
					}
					if (returnFromNmi) {
						this.causeWord = this.nmiReturnCauseWord;
						this.epcWord = this.nmiReturnEpcWord;
						this.badAddressWord = this.nmiReturnBadAddressWord;
						this.luaFaultReasonWord = this.nmiReturnLuaFaultReasonWord;
						this.exceptionDomainWord = this.nmiReturnExceptionDomainWord;
					}
					return;
				case OpCode.LOADKR:
					this.setRegisterConstantFast(frame, registers, a, image, registers.getNumber(b));
					return;

				case OpCode.LE: {
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
					const ok = leftTag === ValueTag.String && rightTag === ValueTag.String
						? this.stringPool.toString(leftScalar as StringId)
							<= this.stringPool.toString(rightScalar as StringId)
						: (leftTag === ValueTag.Number ? leftScalar : NaN)
							<= (rightTag === ValueTag.Number ? rightScalar : NaN);
					if (ok !== (a !== 0)) {
						this.skipNextInstruction(frame);
					}
					return;
				}
				case OpCode.JMP: {
					const targetPc = frame.pc + sbx * INSTRUCTION_BYTES;
					if (targetPc < frame.codeAddress
						|| targetPc >= frame.codeAddress + frame.codeByteCount) {
						this.hardHalt();
						return;
					}
					frame.pc = targetPc;
					return;
				}
				case OpCode.JMPIF: {
					if (registers.isTruthy(a)) {
						const targetPc = frame.pc + sbx * INSTRUCTION_BYTES;
						if (targetPc < frame.codeAddress
							|| targetPc >= frame.codeAddress + frame.codeByteCount) {
							this.hardHalt();
							return;
						}
						frame.pc = targetPc;
					}
					return;
				}
				case OpCode.JMPIFNOT: {
					if (!registers.isTruthy(a)) {
						const targetPc = frame.pc + sbx * INSTRUCTION_BYTES;
						if (targetPc < frame.codeAddress
							|| targetPc >= frame.codeAddress + frame.codeByteCount) {
							this.hardHalt();
							return;
						}
						frame.pc = targetPc;
					}
					return;
				}
				case OpCode.CLOSURE: {
					if (!this.readFunctionRecordOnBus(
						this.activeExecutionImage,
						bx * 16,
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
				case OpCode.GETUP: {
					const upvalue = frame.closure.upvalues[b];
					this.copyUpvalueToRegister(frame, registers, a, upvalue);
					return;
				}
				case OpCode.SETUP: {
					const upvalue = frame.closure.upvalues[b];
					this.copyRegisterToUpvalue(upvalue, registers, a);
					return;
				}
				case OpCode.VARARG: {
					const count = b === 0 ? frame.varargCount : b;
					for (let index = 0; index < count; index += 1) {
						if (index < frame.varargCount) {
							registers.copySlotFrom(this.stackRegisters, a + index, frame.varargBase + index);
							this.bumpRegisterTop(frame, a + index);
						} else {
							this.setRegisterNilFast(frame, registers, a + index);
						}
					}
					if (b === 0) {
						frame.top = a + count;
					}
					return;
				}
				case OpCode.CALL: {
					const argCount = b === 0 ? Math.max(frame.top - a - 1, 0) : b - 1;
					switch (registers.getTag(a)) {
						case ValueTag.BuiltinFunction:
							this.runBuiltinFunction(registers.getBuiltinFunctionId(a), frame, a, c, argCount);
							return;
						case ValueTag.Closure:
							this.pushFrameFromCaller(
								frame,
								registers.getClosure(a),
								a + 1,
								argCount,
								a,
								c,
								false,
								frame.pc - INSTRUCTION_BYTES,
							);
							return;
						default:
							throw new LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
					}
				}
				case OpCode.RET: {
					const total = b === 0 ? Math.max(frame.top - a, 0) : b;
					this.closeUpvalues(frame);
					const frameIndex = this.frames.length - 1;
					if (this.protectedCallDepth > 0) {
						const continuationIndex = this.protectedCallDepth - 1;
						const continuation = this.protectedCallContinuations.peek(continuationIndex);
						if (continuation.target === frame) {
							this.finishProtectedCallFromRegisters(continuationIndex, registers, a, total);
							this.frames.pop();
							this.stackTop = frame.varargBase;
							this.releaseFrame(frame);
							return;
						}
					}
					if (frame.returnToCompletionLatch) {
						this.latchCompletionValues(registers, a, total);
						this.frames.pop();
						this.stackTop = frame.varargBase;
						this.releaseFrame(frame);
						return;
					}
					if (frameIndex === 0) {
						this.latchCompletionValues(registers, a, total);
						this.frames.pop();
						this.stackTop = frame.varargBase;
						this.releaseFrame(frame);
						return;
					}
					const caller = this.frames[frameIndex - 1];
					const writeCount = frame.returnCount === 0 ? total : frame.returnCount;
					if (writeCount > 0) {
						this.ensureRegisterCapacity(caller, frame.returnBase + writeCount - 1);
					}
					this.writeReturnValuesFromRegisters(caller, frame.returnBase, frame.returnCount, registers, a, total);
					this.frames.pop();
					this.stackTop = frame.varargBase;
					this.releaseFrame(frame);
					return;
				}
				case OpCode.LOAD_MEM_D:
				case OpCode.STORE_MEM_D:
				case OpCode.STORE_MEM_WORDS_D: {
					const addr = ((registers.getNumber(b) >>> 0) + (disp << 2)) >>> 0;
					const alignmentMask = op === OpCode.STORE_MEM_WORDS_D
						? MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[MemoryAccessKind.Word]
						: MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[c as MemoryAccessKind];
					if ((addr & alignmentMask) !== 0) {
						this.enterSynchronousAddressException(
							frame,
							op === OpCode.LOAD_MEM_D ? CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD : CPU_CAUSE_CODE_ADDRESS_ERROR_STORE,
							addr,
						);
						return;
					}
					if (op === OpCode.STORE_MEM_WORDS_D) {
						const blockedAddress = this.memory.firstBlockedMappedWordWrite(addr, c);
						if (blockedAddress !== NO_BLOCKED_MAPPED_WRITE) {
							this.blockMappedWrite(frame, blockedAddress);
							return;
						}
						this.charge(ceilDiv4(c));
						this.writeMappedWordSequence(frame, addr, a, c);
						return;
					}
					if (op === OpCode.STORE_MEM_D) {
						if (!this.memory.mappedWriteReady(addr)) {
							this.blockMappedWrite(frame, addr);
							return;
						}
						const faultSequence = this.memory.readBusFaultSequence();
						switch (c) {
							case MemoryAccessKind.Word:
								this.memory.writeMappedWord(addr, registers.getNumber(a) >>> 0);
								break;
							case MemoryAccessKind.U8:
								this.memory.writeMappedU8(addr, registers.getNumber(a));
								break;
							case MemoryAccessKind.U16LE:
								this.memory.writeMappedU16LE(addr, registers.getNumber(a));
								break;
							case MemoryAccessKind.U32LE:
								this.memory.writeMappedU32LE(addr, registers.getNumber(a));
								break;
							case MemoryAccessKind.F32LE:
								this.memory.writeMappedF32LE(addr, registers.getNumber(a));
								break;
							case MemoryAccessKind.F64LE:
								this.memory.writeMappedF64LE(addr, registers.getNumber(a));
								break;
						}
						if (this.memory.readBusFaultSequence() !== faultSequence) {
							this.enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
						}
						return;
					}
					const faultSequence = this.memory.readBusFaultSequence();
					let value: number;
					switch (c) {
						case MemoryAccessKind.Word:
							value = this.memory.readMappedWord(addr);
							break;
						case MemoryAccessKind.U8:
							value = this.memory.readMappedU8(addr);
							break;
						case MemoryAccessKind.U16LE:
							value = this.memory.readMappedU16LE(addr);
							break;
						case MemoryAccessKind.U32LE:
							value = this.memory.readMappedU32LE(addr);
							break;
						case MemoryAccessKind.F32LE:
							value = this.memory.readMappedF32LE(addr);
							break;
						case MemoryAccessKind.F64LE:
							value = this.memory.readMappedF64LE(addr);
							break;
					}
					if (this.memory.readBusFaultSequence() !== faultSequence) {
						this.enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
						return;
					}
					this.setRegisterNumberFast(frame, registers, a, value);
					return;
				}
				case OpCode.LOAD_MEM: {
					const addr = this.readRKNumber(frame, rkB) >>> 0;
					if ((addr & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[c as MemoryAccessKind]) !== 0) {
						this.enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, addr);
						return;
					}
					const faultSequence = this.memory.readBusFaultSequence();
					let value: number;
					switch (c) {
						case MemoryAccessKind.Word:
							value = this.memory.readMappedWord(addr);
							break;
						case MemoryAccessKind.U8:
							value = this.memory.readMappedU8(addr);
							break;
						case MemoryAccessKind.U16LE:
							value = this.memory.readMappedU16LE(addr);
							break;
						case MemoryAccessKind.U32LE:
							value = this.memory.readMappedU32LE(addr);
							break;
						case MemoryAccessKind.F32LE:
							value = this.memory.readMappedF32LE(addr);
							break;
						case MemoryAccessKind.F64LE:
							value = this.memory.readMappedF64LE(addr);
							break;
					}
					if (this.memory.readBusFaultSequence() !== faultSequence) {
						this.enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
						return;
					}
					this.setRegisterNumberFast(frame, registers, a, value);
					return;
				}
				case OpCode.STORE_MEM: {
					const addr = this.readRKNumber(frame, rkB) >>> 0;
					if ((addr & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[c as MemoryAccessKind]) !== 0) {
						this.enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, addr);
						return;
					}
					if (!this.memory.mappedWriteReady(addr)) {
						this.blockMappedWrite(frame, addr);
						return;
					}
					const faultSequence = this.memory.readBusFaultSequence();
					switch (c) {
						case MemoryAccessKind.Word:
							this.memory.writeMappedWord(addr, registers.getNumber(a) >>> 0);
							break;
						case MemoryAccessKind.U8:
							this.memory.writeMappedU8(addr, registers.getNumber(a));
							break;
						case MemoryAccessKind.U16LE:
							this.memory.writeMappedU16LE(addr, registers.getNumber(a));
							break;
						case MemoryAccessKind.U32LE:
							this.memory.writeMappedU32LE(addr, registers.getNumber(a));
							break;
						case MemoryAccessKind.F32LE:
							this.memory.writeMappedF32LE(addr, registers.getNumber(a));
							break;
						case MemoryAccessKind.F64LE:
							this.memory.writeMappedF64LE(addr, registers.getNumber(a));
							break;
					}
					if (this.memory.readBusFaultSequence() !== faultSequence) {
						this.enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
					}
					return;
				}
				case OpCode.STORE_MEM_WORDS: {
					const addr = this.readRKNumber(frame, rkB) >>> 0;
					if ((addr & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[MemoryAccessKind.Word]) !== 0) {
						this.enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, addr);
						return;
					}
					const blockedAddress = this.memory.firstBlockedMappedWordWrite(addr, c);
					if (blockedAddress !== NO_BLOCKED_MAPPED_WRITE) {
						this.blockMappedWrite(frame, blockedAddress);
						return;
					}
					this.charge(ceilDiv4(c));
					this.writeMappedWordSequence(frame, addr, a, c);
					return;
				}
		}
	}

	private prepareFrameRegisters(frame: CallFrame, registerCount: number): ValueSlots {
		const needed = Math.max(registerCount, 1);
		let capacity = 1 << (32 - Math.clz32(needed - 1));
		if (capacity < 8) {
			capacity = 8;
		}
		frame.stackBase = frame.varargBase + frame.varargCount;
		frame.stackCapacity = capacity;
		this.stackTop = frame.stackBase + capacity;
		this.ensureStackCapacity(this.stackTop);
		const registers = frame.registers;
		registers.rebind(this.stackRegisters, frame.stackBase, frame.stackCapacity);
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
		frame.functionAddress = closure.functionAddress;
		frame.executionImage = functionRecord.image;
		frame.decodedPage = null;
		frame.decodedPageAddress = 0;
		frame.codeAddress = functionRecord.codeAddress;
		frame.codeByteCount = functionRecord.codeByteCount;
		frame.pc = functionRecord.codeAddress;
		frame.closure = closure;
		frame.returnBase = returnBase;
		frame.returnCount = returnCount;
		frame.top = functionRecord.numParams;
		frame.returnToCompletionLatch = returnToCompletionLatch;
		frame.callSitePc = functionRecord.codeAddress;
		frame.varargBase = this.stackTop;
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
				this.stackRegisters.set(frame.varargBase + index, args[argIndex + index]);
			}
		}
		this.frames.push(frame);
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
		frame.functionAddress = closure.functionAddress;
		frame.executionImage = functionRecord.image;
		frame.decodedPage = null;
		frame.decodedPageAddress = 0;
		frame.codeAddress = functionRecord.codeAddress;
		frame.codeByteCount = functionRecord.codeByteCount;
		frame.pc = functionRecord.codeAddress;
		frame.closure = closure;
		frame.returnBase = returnBase;
		frame.returnCount = returnCount;
		frame.top = functionRecord.numParams;
		frame.returnToCompletionLatch = returnToCompletionLatch;
		frame.callSitePc = callSitePc;
		frame.varargBase = this.stackTop;
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
				this.stackRegisters.copySlotFrom(
					callerRegisters,
					frame.varargBase + index,
					argBase + functionRecord.numParams + index,
				);
			}
		}
		this.frames.push(frame);
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
		const closure = new Closure(functionRecord.address, upvalues, heapBytes);
		closure.hashId = this.allocateObjectHashId();
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
			const frameIndex = this.frames.indexOf(frame);
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
			this.ensureStackCapacity(this.stackTop + delta);
			if (delta > 0) {
				const stack = this.stackRegisters;
				for (let i = this.frames.length - 1; i > frameIndex; i -= 1) {
					const shifted = this.frames[i];
					stack.moveRange(shifted.varargBase + delta, shifted.varargBase, shifted.varargCount + shifted.stackCapacity);
					shifted.varargBase += delta;
					shifted.stackBase += delta;
				}
			}
			this.stackTop += delta;
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
		switch (image.constTags[constantIndex]) {
			case ValueTag.Nil:
				registers.setNil(registerIndex);
				break;
			case ValueTag.False:
				registers.setBool(registerIndex, false);
				break;
			case ValueTag.True:
				registers.setBool(registerIndex, true);
				break;
			case ValueTag.Number:
				registers.setNumber(registerIndex, image.constScalars[constantIndex]);
				break;
			case ValueTag.String:
				registers.setStringId(registerIndex, image.constScalars[constantIndex] as StringId);
				break;
		}
		this.bumpRegisterTop(frame, registerIndex);
	}

	private writeMappedWordSequence(frame: CallFrame, addr: number, valueBase: number, valueCount: number): void {
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

	private readRKEquals(frame: CallFrame, left: number, right: number): boolean {
		const image = frame.executionImage;
		const registers = frame.registers;
		let leftTag: ValueTag;
		let leftScalar: number;
		let leftReference: ValueReference;
		if (left < 0) {
			const constantIndex = -1 - left;
			leftTag = image.constTags[constantIndex];
			leftScalar = image.constScalars[constantIndex];
			leftReference = null;
		} else {
			leftTag = registers.getTag(left);
			leftScalar = registers.getScalar(left);
			leftReference = registers.getReference(left);
		}
		let rightTag: ValueTag;
		let rightScalar: number;
		let rightReference: ValueReference;
		if (right < 0) {
			const constantIndex = -1 - right;
			rightTag = image.constTags[constantIndex];
			rightScalar = image.constScalars[constantIndex];
			rightReference = null;
		} else {
			rightTag = registers.getTag(right);
			rightScalar = registers.getScalar(right);
			rightReference = registers.getReference(right);
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
				return leftReference === rightReference;
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
			case BuiltinFunctionId.Select:
				this.runBuiltinSelect(args, out);
				break;
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
			case BuiltinFunctionId.Error:
				this.runBuiltinError(args);
				break;
			case BuiltinFunctionId.PCall:
			case BuiltinFunctionId.XPCall:
				throw new Error('Protected calls execute as Lua CPU microcode.');
		}
	}

	private runBuiltinFunction(id: BuiltinFunctionId, frame: CallFrame, callBase: number, returnCount: number, argCount: number): void {
		this.charge(BUILTIN_FUNCTIONS[id].cost.base);
		if (id === BuiltinFunctionId.PCall || id === BuiltinFunctionId.XPCall) {
			this.startProtectedCall(id, frame, callBase, returnCount, callBase + 1, argCount, false);
			return;
		}
		const builtinArgs = this.acquireRegisterBuiltinArgs();
		const results = this.acquireBuiltinResults();
		try {
			builtinArgs.bind(frame.registers, callBase + 1, argCount);
			this.callBuiltinFunction(id, builtinArgs, results);
			if (this.frames.length > 0 && this.frames[this.frames.length - 1] === frame) {
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
		const continuationIndex = this.protectedCallDepth;
		const continuation = this.protectedCallContinuations.get(continuationIndex);
		this.protectedCallDepth = continuationIndex + 1;
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
		const continuation = this.protectedCallContinuations.peek(continuationIndex);
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
		const continuation = this.protectedCallContinuations.peek(continuationIndex);
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
		const continuation = this.protectedCallContinuations.peek(continuationIndex);
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
		const continuation = this.protectedCallContinuations.peek(continuationIndex);
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
		const continuation = this.protectedCallContinuations.peek(continuationIndex);
		const caller = continuation.caller!;
		const callBase = continuation.callBase;
		const returnsToProtectedParent = continuation.returnsToProtectedParent;
		continuation.target = null;
		continuation.caller = null;
		this.protectedCallDepth = continuationIndex;
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
			if (this.protectedCallDepth === 0) {
				return false;
			}
			const continuationIndex = this.protectedCallDepth - 1;
			const continuation = this.protectedCallContinuations.peek(continuationIndex);
			const caller = continuation.caller!;
			const callerIndex = this.frames.indexOf(caller);
			for (let frameIndex = this.frames.length - 1; frameIndex > callerIndex; frameIndex -= 1) {
				if (this.frames[frameIndex].isExceptionFrame) {
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
		const source = this.stringPool.toString(registers.getStringId(base));
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
		if (position < 1) {
			out.push(ValueTag.Nil);
			return;
		}
		let current = 1;
		for (const char of source) {
			if (current === position) {
				out.push(ValueTag.Number, char.codePointAt(0) as number);
				return;
			}
			current += 1;
		}
		out.push(ValueTag.Nil);
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

	public captureRuntimeState(): CpuRuntimeState {
		this.syncGlobalSlotsToTable();
		const objectOrdinals = new Map<Table | Closure | Upvalue, number>();
		const objects: CpuObjectState[] = [];

		const ensureObjectId = (object: Table | Closure | Upvalue, kind: CpuObjectState['kind']): number => {
			if (objectOrdinals.has(object)) {
				return objectOrdinals.get(object) as number;
			}
			const id = objects.length;
			objectOrdinals.set(object, id);
			objects.length = id + 1;
			objects[id] = captureObjectState(object, kind);
			return id;
		};

		const captureStoredValueState = (
			tag: ValueTag,
			scalar: number,
			reference: ValueReference,
		): CpuValueState => {
			switch (tag) {
				case ValueTag.Nil:
					return { tag: 'nil' };
				case ValueTag.False:
					return { tag: 'false' };
				case ValueTag.True:
					return { tag: 'true' };
				case ValueTag.Number:
					return { tag: 'number', value: scalar };
				case ValueTag.String:
					return { tag: 'string', id: scalar as StringId };
				case ValueTag.BuiltinFunction:
					return { tag: 'builtin', id: scalar as BuiltinFunctionId };
				case ValueTag.Table:
					return { tag: 'table', id: ensureObjectId(reference as Table, 'table') };
				case ValueTag.Closure:
					return { tag: 'closure', id: ensureObjectId(reference as Closure, 'closure') };
			}
		};

		const captureObjectState = (object: Table | Closure | Upvalue, kind: CpuObjectState['kind']): CpuObjectState => {
			switch (kind) {
				case 'table': {
					const table = object as Table;
					const tableState = table.captureRuntimeState();
					const hash = new Array(tableState.hashSize);
					for (let index = 0; index < tableState.hashSize; index += 1) {
						const keySlot = tableState.arrayCapacity + index;
						const valueSlot = tableState.arrayCapacity + tableState.hashSize + index;
						hash[index] = {
							key: captureStoredValueState(
								tableState.tags[keySlot],
								tableState.scalars[keySlot],
								tableState.references[keySlot],
							),
							value: captureStoredValueState(
								tableState.tags[valueSlot],
								tableState.scalars[valueSlot],
								tableState.references[valueSlot],
							),
							next: tableState.hashNext[index],
						};
					}
					const array = new Array(tableState.arrayCapacity);
					for (let index = 0; index < tableState.arrayCapacity; index += 1) {
						array[index] = captureStoredValueState(
							tableState.tags[index],
							tableState.scalars[index],
							tableState.references[index],
						);
					}
					return {
						kind: 'table',
						hashId: table.hashId,
						array,
						arrayLength: tableState.arrayLength,
						hash,
						hashFree: tableState.hashFree,
						metatable: captureStoredValueState(
							tableState.metatable ? ValueTag.Table : ValueTag.Nil,
							NaN,
							tableState.metatable,
						),
					};
				}
				case 'upvalue': {
					const upvalue = object as Upvalue;
					let frameIndex = -1;
					let valueTag = upvalue.valueTag;
					let valueScalar = upvalue.valueScalar;
					let valueReference = upvalue.valueReference;
					if (upvalue.open) {
						frameIndex = this.frames.indexOf(upvalue.frame);
						valueTag = upvalue.frame!.registers.getTag(upvalue.index);
						valueScalar = upvalue.frame!.registers.getScalar(upvalue.index);
						valueReference = upvalue.frame!.registers.getReference(upvalue.index);
					}
					return {
						kind: 'upvalue',
						hashId: upvalue.hashId,
						open: upvalue.open,
						index: upvalue.index,
						frameIndex,
						value: captureStoredValueState(valueTag, valueScalar, valueReference),
					};
				}
				case 'closure': {
					const closure = object as Closure;
					const upvalues = new Array(closure.upvalues.length);
					for (let index = 0; index < closure.upvalues.length; index += 1) {
						upvalues[index] = ensureObjectId(closure.upvalues[index], 'upvalue');
					}
					return {
						kind: 'closure',
						hashId: closure.hashId,
						functionAddress: closure.functionAddress,
						canonical: this.staticClosuresByAddress.get(closure.functionAddress) === closure,
						upvalues,
					};
				}
			}
		};

		const systemGlobals: CpuRootValueState[] = [];
		for (let slot = 0; slot < this.systemGlobalNames.length; slot += 1) {
			systemGlobals.push({
				name: this.stringPool.toString(this.systemGlobalNames[slot]),
				value: captureStoredValueState(
					this.systemGlobalSlots.getTag(slot),
					this.systemGlobalSlots.getScalar(slot),
					this.systemGlobalSlots.getReference(slot),
				),
			});
		}

		const globals: CpuRootValueState[] = [];
		this.globals.forEachStoredEntry((
			keyTag,
			keyScalar,
			_keyReference,
			valueTag,
			valueScalar,
			valueReference,
		) => {
			if (keyTag !== ValueTag.String) {
				return;
			}
			globals.push({
				name: this.stringPool.toString(keyScalar as StringId),
				value: captureStoredValueState(valueTag, valueScalar, valueReference),
			});
		});

		const frames = new Array<CpuFrameState>(this.frames.length);
		for (let frameIndex = 0; frameIndex < this.frames.length; frameIndex += 1) {
			const frame = this.frames[frameIndex];
			const registers = new Array<CpuValueState>(frame.top);
			for (let registerIndex = 0; registerIndex < frame.top; registerIndex += 1) {
				registers[registerIndex] = captureStoredValueState(
					frame.registers.getTag(registerIndex),
					frame.registers.getScalar(registerIndex),
					frame.registers.getReference(registerIndex),
				);
			}
			const varargs = new Array<CpuValueState>(frame.varargCount);
			for (let varargIndex = 0; varargIndex < frame.varargCount; varargIndex += 1) {
				const slot = frame.varargBase + varargIndex;
				varargs[varargIndex] = captureStoredValueState(
					this.stackRegisters.getTag(slot),
					this.stackRegisters.getScalar(slot),
					this.stackRegisters.getReference(slot),
				);
			}
			frames[frameIndex] = {
				functionAddress: frame.functionAddress,
				pc: frame.pc,
				closureRef: ensureObjectId(frame.closure, 'closure'),
				registers,
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
		const protectedCalls = new Array<CpuProtectedCallState>(this.protectedCallDepth);
		for (let index = 0; index < this.protectedCallDepth; index += 1) {
			const continuation = this.protectedCallContinuations.peek(index);
			const caller = continuation.caller!;
			protectedCalls[index] = {
				kind: continuation.kind,
				callerFrameIndex: this.frames.indexOf(caller),
				targetFrameIndex: continuation.target === null ? -1 : this.frames.indexOf(continuation.target),
				returnsToProtectedParent: continuation.returnsToProtectedParent,
				callBase: continuation.callBase,
				returnCount: continuation.returnCount,
				handlerRegister: continuation.handlerRegister,
			};
		}

		const completionValues = new Array<CpuValueState>(this.completionValueCount);
		for (let index = 0; index < this.completionValueCount; index += 1) {
			completionValues[index] = captureStoredValueState(
				this.completionValueSlots.getTag(index),
				this.completionValueSlots.getScalar(index),
				this.completionValueSlots.getReference(index),
			);
		}

		const openUpvalues: number[] = [];
		for (let frameIndex = 0; frameIndex < this.frames.length; frameIndex += 1) {
			let upvalue = this.frames[frameIndex].openUpvalueHead;
			while (upvalue) {
				openUpvalues.push(ensureObjectId(upvalue, 'upvalue'));
				upvalue = upvalue.nextOpen;
			}
		}
		const stringIndexTable = captureStoredValueState(
			this.stringIndexTable ? ValueTag.Table : ValueTag.Nil,
			NaN,
			this.stringIndexTable,
		);

		return {
			executionCartridgeSlot: this.activeExecutionImage.executionDomainId,
			systemGlobals,
			globals,
			stringIndexTable,
			frames,
			protectedCalls,
			completionValues,
			objects,
			openUpvalues,
			lastExecutionDomainId: this.lastExecutionDomainId,
			lastPc: this.lastPc,
			instructionBudgetRemaining: this.instructionBudgetRemaining,
			haltedUntilIrqFrameDepth: this.haltedUntilIrqFrameDepth,
			interruptEventPending: this.interruptEventPending,
			memoryWriteBlocked: this.memoryWriteBlocked,
			memoryWriteBlockedAddress: this.memoryWriteBlockedAddress,
			statusWord: this.statusWord,
			causeWord: this.causeWord,
			epcWord: this.epcWord,
			badAddressWord: this.badAddressWord,
			luaFaultReasonWord: this.luaFaultReasonWord,
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
		type RestoredObject = Table | Closure | Upvalue;
		const restoredObjects = new Array<RestoredObject>(state.objects.length);
		const executionImage = state.executionCartridgeSlot === SYSTEM_EXECUTION_DOMAIN_ID
			? this.systemImage
			: this.executionImageForDomain(state.executionCartridgeSlot)!;
		let maxRestoredHashId = 0;

		for (let index = 0; index < state.objects.length; index += 1) {
			const objectState = state.objects[index];
			if (objectState.hashId > maxRestoredHashId) {
				maxRestoredHashId = objectState.hashId;
			}
			switch (objectState.kind) {
				case 'table': {
					this.luaHeap.restoreAllocate(Table.trackedHeapBytesForCapacities(0, 0));
					const table = new Table(this.luaHeap, 0, 0);
					table.hashId = objectState.hashId;
					restoredObjects[index] = table;
					break;
				}
				case 'closure': {
					const upvalues = new Array<Upvalue>(objectState.upvalues.length);
					if (objectState.canonical) {
						const closure = this.staticClosureAtAddress(objectState.functionAddress);
						closure.hashId = objectState.hashId;
						restoredObjects[index] = closure;
					} else {
						const heapBytes = CLOSURE_HEAP_BYTES + (upvalues.length * CLOSURE_UPVALUE_SLOT_HEAP_BYTES);
						this.luaHeap.restoreAllocate(heapBytes);
						const closure = new Closure(objectState.functionAddress, upvalues, heapBytes);
						closure.hashId = objectState.hashId;
						restoredObjects[index] = closure;
					}
					break;
				}
				case 'upvalue':
					this.luaHeap.restoreAllocate(UPVALUE_HEAP_BYTES);
					restoredObjects[index] = {
						hashId: objectState.hashId,
						open: false,
						index: objectState.index,
						frame: null,
						valueTag: ValueTag.Nil,
						valueScalar: NaN,
						valueReference: null,
						nextOpen: null,
					};
					break;
			}
		}
		this.observeObjectHashId(maxRestoredHashId);

		let restoredTag = ValueTag.Nil;
		let restoredScalar = NaN;
		let restoredReference: ValueReference = null;
		const decodeValueState = (valueState: CpuValueState): void => {
			switch (valueState.tag) {
				case 'nil':
					restoredTag = ValueTag.Nil;
					restoredScalar = NaN;
					restoredReference = null;
					return;
				case 'false':
					restoredTag = ValueTag.False;
					restoredScalar = NaN;
					restoredReference = null;
					return;
				case 'true':
					restoredTag = ValueTag.True;
					restoredScalar = NaN;
					restoredReference = null;
					return;
				case 'number':
					restoredTag = ValueTag.Number;
					restoredScalar = valueFromNumber(valueState.value);
					restoredReference = null;
					return;
				case 'string':
					restoredTag = ValueTag.String;
					restoredScalar = valueState.id;
					restoredReference = null;
					return;
				case 'builtin':
					restoredTag = ValueTag.BuiltinFunction;
					restoredScalar = valueState.id;
					restoredReference = null;
					return;
				case 'table':
					restoredTag = ValueTag.Table;
					restoredScalar = NaN;
					restoredReference = restoredObjects[valueState.id] as Table;
					return;
				case 'closure':
					restoredTag = ValueTag.Closure;
					restoredScalar = NaN;
					restoredReference = restoredObjects[valueState.id] as Closure;
			}
		};

		for (let index = 0; index < state.objects.length; index += 1) {
			const objectState = state.objects[index];
			switch (objectState.kind) {
				case 'table': {
					const table = restoredObjects[index] as Table;
					const arrayCapacity = objectState.array.length;
					const hashSize = objectState.hash.length;
					const tags = new Uint8Array(arrayCapacity + (hashSize * 2));
					const scalars = new Float64Array(tags.length);
					scalars.fill(NaN);
					const references = new Array<ValueReference>(tags.length);
					references.fill(null);
					const hashNext = new Int32Array(hashSize);
					for (let slot = 0; slot < arrayCapacity; slot += 1) {
						decodeValueState(objectState.array[slot]);
						tags[slot] = restoredTag;
						scalars[slot] = restoredScalar;
						references[slot] = restoredReference;
					}
					for (let slot = 0; slot < hashSize; slot += 1) {
						const keySlot = arrayCapacity + slot;
						const valueSlot = arrayCapacity + hashSize + slot;
						decodeValueState(objectState.hash[slot].key);
						tags[keySlot] = restoredTag;
						scalars[keySlot] = restoredScalar;
						references[keySlot] = restoredReference;
						decodeValueState(objectState.hash[slot].value);
						tags[valueSlot] = restoredTag;
						scalars[valueSlot] = restoredScalar;
						references[valueSlot] = restoredReference;
						hashNext[slot] = objectState.hash[slot].next;
					}
					decodeValueState(objectState.metatable);
					this.observeObjectHashId(table.restoreRuntimeState({
						tags,
						scalars,
						references,
						arrayCapacity,
						arrayLength: objectState.arrayLength,
						hashSize,
						hashNext,
						hashFree: objectState.hashFree,
						metatable: restoredReference as Table | null,
					}));
					break;
				}
				case 'closure': {
					const closure = restoredObjects[index] as Closure;
					closure.functionAddress = objectState.functionAddress;
					for (let upvalueIndex = 0; upvalueIndex < objectState.upvalues.length; upvalueIndex += 1) {
						closure.upvalues[upvalueIndex] = restoredObjects[objectState.upvalues[upvalueIndex]] as Upvalue;
					}
					break;
				}
				case 'upvalue': {
					const upvalue = restoredObjects[index] as Upvalue;
					upvalue.open = objectState.open;
					upvalue.index = objectState.index;
					upvalue.frame = null;
					decodeValueState(objectState.value);
					upvalue.valueTag = restoredTag;
					upvalue.valueScalar = restoredScalar;
					upvalue.valueReference = restoredReference;
					break;
				}
			}
		}

		this.clearCompletionValues();
		this.clearCallStack();
		this.globals.clear();
		this.globals.prepareRestoreStorage(0, Table.hashCapacity(state.globals.length));
		this.latchActiveExecutionImage(executionImage);
		this.systemGlobalSlots.clear(this.systemGlobalNames.length);
		this.globalSlots.clear(this.globalNames.length);

		for (let frameIndex = 0; frameIndex < state.frames.length; frameIndex += 1) {
			const frameState = state.frames[frameIndex];
			this.readFunctionRecordOnBus(
				executionImage,
				frameState.functionAddress,
				this.executionBusSignals,
			);
			const functionRecord = this.functionRecordLatch;
			const frame = this.acquireFrame();
			frame.functionAddress = frameState.functionAddress;
			frame.executionImage = functionRecord.image;
			frame.codeAddress = functionRecord.codeAddress;
			frame.codeByteCount = functionRecord.codeByteCount;
			frame.pc = frameState.pc;
			frame.closure = restoredObjects[frameState.closureRef] as Closure;
			frame.returnBase = frameState.returnBase;
			frame.returnCount = frameState.returnCount;
			frame.returnToCompletionLatch = frameState.returnToCompletionLatch;
			frame.callSitePc = frameState.callSitePc;
			frame.isExceptionFrame = frameState.isExceptionFrame;
			frame.isNonMaskableExceptionFrame = frameState.isNonMaskableExceptionFrame;
			frame.varargBase = this.stackTop;
			frame.varargCount = frameState.varargs.length;
			const registers = this.prepareFrameRegisters(frame, functionRecord.maxStack);
			for (let registerIndex = 0; registerIndex < frameState.registers.length; registerIndex += 1) {
				decodeValueState(frameState.registers[registerIndex]);
				registers.setEncoded(
					registerIndex,
					restoredTag,
					restoredScalar,
					restoredReference,
				);
			}
			for (let varargIndex = 0; varargIndex < frameState.varargs.length; varargIndex += 1) {
				decodeValueState(frameState.varargs[varargIndex]);
				this.stackRegisters.setEncoded(
					frame.varargBase + varargIndex,
					restoredTag,
					restoredScalar,
					restoredReference,
				);
			}
			frame.top = frameState.top;
			this.frames.push(frame);
		}
		for (let index = 0; index < state.protectedCalls.length; index += 1) {
			const continuationState = state.protectedCalls[index];
			const continuation = this.protectedCallContinuations.get(index);
			continuation.kind = continuationState.kind;
			continuation.caller = this.frames[continuationState.callerFrameIndex];
			continuation.target = continuationState.targetFrameIndex < 0 ? null : this.frames[continuationState.targetFrameIndex];
			continuation.returnsToProtectedParent = continuationState.returnsToProtectedParent;
			continuation.callBase = continuationState.callBase;
			continuation.returnCount = continuationState.returnCount;
			continuation.handlerRegister = continuationState.handlerRegister;
		}
		this.protectedCallDepth = state.protectedCalls.length;

		for (let index = 0; index < state.openUpvalues.length; index += 1) {
			const upvalueState = state.objects[state.openUpvalues[index]] as Extract<CpuObjectState, { kind: 'upvalue' }>;
			const upvalue = restoredObjects[state.openUpvalues[index]] as Upvalue;
			const frame = this.frames[upvalueState.frameIndex];
			upvalue.open = true;
			upvalue.index = upvalueState.index;
			upvalue.frame = frame;
			upvalue.valueTag = ValueTag.Nil;
			upvalue.valueScalar = NaN;
			upvalue.valueReference = null;
			this.linkOpenUpvalue(frame, upvalue);
		}

		for (let index = 0; index < state.systemGlobals.length; index += 1) {
			const entry = state.systemGlobals[index];
			decodeValueState(entry.value);
			this.setSystemGlobalByKey(
				this.stringPool.intern(entry.name),
				restoredTag,
				restoredScalar,
				restoredReference,
			);
		}
		for (let index = 0; index < state.globals.length; index += 1) {
			const entry = state.globals[index];
			decodeValueState(entry.value);
			this.setGlobalByKey(
				this.stringPool.intern(entry.name),
				restoredTag,
				restoredScalar,
				restoredReference,
			);
		}
		decodeValueState(state.stringIndexTable);
		this.stringIndexTable = restoredReference as Table | null;
		if (state.completionValues.length > this.completionValueSlots.capacity()) {
			let capacity = this.completionValueSlots.capacity() * 2;
			while (capacity < state.completionValues.length) {
				capacity *= 2;
			}
			this.completionValueSlots = new ValueSlots(capacity);
		}
		for (let index = 0; index < state.completionValues.length; index += 1) {
			decodeValueState(state.completionValues[index]);
			this.completionValueSlots.setEncoded(
				index,
				restoredTag,
				restoredScalar,
				restoredReference,
			);
		}
		this.completionValueCount = state.completionValues.length;
		this.lastExecutionDomainId = state.lastExecutionDomainId;
		this.lastPc = state.lastPc;
		this.instructionBudgetRemaining = state.instructionBudgetRemaining;
		this.haltedUntilIrqFrameDepth = state.haltedUntilIrqFrameDepth;
		this.interruptEventPending = state.interruptEventPending;
		this.memoryWriteBlocked = state.memoryWriteBlocked;
		this.memoryWriteBlockedAddress = state.memoryWriteBlockedAddress;
		this.statusWord = state.statusWord;
		this.causeWord = state.causeWord;
		this.epcWord = state.epcWord;
		this.badAddressWord = state.badAddressWord;
		this.luaFaultReasonWord = state.luaFaultReasonWord;
		this.exceptionDomainWord = state.exceptionDomainWord;
		this.nmiReturnCauseWord = state.nmiReturnCauseWord;
		this.nmiReturnEpcWord = state.nmiReturnEpcWord;
		this.nmiReturnBadAddressWord = state.nmiReturnBadAddressWord;
		this.nmiReturnLuaFaultReasonWord = state.nmiReturnLuaFaultReasonWord;
		this.nmiReturnExceptionDomainWord = state.nmiReturnExceptionDomainWord;
		this.nonMaskableInterruptPending = state.nonMaskableInterruptPending;
		this.yieldRequested = state.yieldRequested;
		this.collectTrackedHeapBytes();
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
		for (const page of image.decodedPages.values()) {
			for (let index = 0; index < page.tableLoadCaches.length; index += 1) {
				const cache = page.tableLoadCaches[index];
				cache.table = null;
				cache.version = 0;
				cache.valueTag = ValueTag.Nil;
				cache.valueScalar = NaN;
				cache.valueReference = null;
			}
		}
		for (let index = 0; index < image.constTags.length; index += 1) {
			if (image.constTags[index] === ValueTag.String) {
				this.stringPool.markReachable(image.constScalars[index] as StringId);
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

		objectStack.push(this.globals);
		for (let slot = 0; slot < this.systemGlobalNames.length; slot += 1) {
			this.pushHeapRegister(this.systemGlobalSlots, slot);
		}
		for (let slot = 0; slot < this.globalNames.length; slot += 1) {
			this.pushHeapRegister(this.globalSlots, slot);
		}
		if (this.stringIndexTable) {
			objectStack.push(this.stringIndexTable);
		}
		for (let index = 0; index < this.completionValueCount; index += 1) {
			this.pushHeapRegister(this.completionValueSlots, index);
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
		for (let index = 0; index < this.executionImages.length; index += 1) {
			this.pushHeapImage(this.executionImages[index]);
		}
		for (let frameIndex = 0; frameIndex < this.frames.length; frameIndex += 1) {
			const frame = this.frames[frameIndex];
			this.pushHeapImage(frame.executionImage);
			if (frame.closure.heapBytes !== 0) {
				objectStack.push(frame.closure);
			}
			for (let registerIndex = 0; registerIndex < frame.top; registerIndex += 1) {
				this.pushHeapRegister(frame.registers, registerIndex);
			}
			for (let index = 0; index < frame.varargCount; index += 1) {
				this.pushHeapRegister(this.stackRegisters, frame.varargBase + index);
			}
			let upvalue = frame.openUpvalueHead;
			while (upvalue) {
				upvalueStack.push(upvalue);
				upvalue = upvalue.nextOpen;
			}
		}
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
		this.stringPool.reclaimUnreachableTracked();
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
