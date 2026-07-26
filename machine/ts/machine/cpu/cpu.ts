import { StringPool, type StringId } from './string_pool';
import { NO_BLOCKED_MAPPED_WRITE, type Memory } from '../memory/memory';
import type { IrqController } from '../devices/irq/controller';
import {
	addTrackedLuaHeapBytes,
	collectTrackedLuaHeapBytes as refreshTrackedLuaHeapBytes,
	enforceLuaHeapBudget
} from '../memory/lua_heap_usage';
import { BASE_CYCLES, OPCODE_USES_BX, OPCODE_USES_DISP, OpCode } from './opcode_info';
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
	LUA_FAULT_REASON_INDEX_NON_TABLE,
	LUA_FAULT_REASON_ITERATE_NON_TABLE,
	LUA_FAULT_REASON_METATABLE_LOOP,
	LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION,
} from './cop0';
import { EXT_A_BITS, EXT_B_BITS, EXT_BX_BITS, EXT_C_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_OPERAND_BITS, readInstructionWord, signExtend } from './instruction_format';
import {
	BLUA32_FUNCTION_RECORD_SIZE,
	Blua32ConstantTag,
	type Blua32ImageLayout,
} from './blua32_image';
import {
	ExecutionAddressSpace,
	SYSTEM_EXECUTION_DOMAIN_ID,
	type Blua32DecodedExecutionImage,
	type ExecutionDomainId,
} from '../execution_address_space';
import { MEMORY_ACCESS_KIND_ALIGNMENT_MASKS, MemoryAccessKind } from '../memory/access_kind';
import { ScratchBuffer } from '../../common/scratchbuffer';
import { ScratchArrayStack } from '../../common/scratchstack';
import { luaFloorDivide, luaModulo } from '../../lua/numeric';
import { ceilDiv4 } from '../common/numeric';
import { CART_ROM_BASE, RAM_BASE } from '../memory/map';
import {
	BuiltinFunctionId,
	EMPTY_CALL_ARGS,
	StringValue,
	VALUE_TAG,
	ValueTag,
	asStringId,
	createBuiltinFunction,
	valueIsString,
	valueIsTable,
	valueTag,
	valueToString,
	valueTypeName,
	valueTypeNameForLua,
	type BuiltinFunction,
	type NativeArgs,
	type NativeFnCost,
	type NativeFunction,
	type NativeObject,
	type Value,
} from './value';
import { LuaExecutionError, LuaThrownValueError } from './errors';
import { Table } from './table';
import { Closure, EMPTY_CLOSURE_UPVALUES, type OpenUpvalueSlot, type Upvalue } from './closure';
import { ArrayNativeArgsView, RegisterFile, RegisterNativeArgsView } from './register_file';
import {
	DECODED_PAGE_MASK,
	DECODED_PAGE_SHIFT,
	DECODED_PAGE_WORDS,
	createDecodedInstructionPage,
	type Blua32ExecutionImage,
	type Blua32RuntimeFunction,
	type DecodedInstructionPage,
	type TableLoadInlineCache,
} from './execution_image';
import { ProtectedCallContinuation, ProtectedCallKind, type CallFrame } from './call_state';

export { OpCode } from './opcode_info';

// start repeated-sequence-acceptable -- Lua VM/table/register hot paths deliberately keep short copy/update sequences inline.
// start normalized-body-acceptable -- Specialized Lua VM accessors stay split so the fast paths avoid dispatch helpers.

const DEFAULT_NATIVE_COST: NativeFnCost = { base: 1, perArg: 0, perRet: 0 };

const CLOSURE_HEAP_BYTES = 16;
const CLOSURE_UPVALUE_SLOT_HEAP_BYTES = 8;
const NATIVE_FUNCTION_HEAP_BYTES = 16;
const NATIVE_OBJECT_HEAP_BYTES = 24;
const UPVALUE_HEAP_BYTES = 24;

function createNativeFunction(
	hashId: number,
	name: string,
	invoke: (args: NativeArgs, out: Value[]) => void,
	cost?: NativeFnCost,
): NativeFunction {
	const resolvedCost = cost ?? DEFAULT_NATIVE_COST;
	addTrackedLuaHeapBytes(NATIVE_FUNCTION_HEAP_BYTES);
	return {
		[VALUE_TAG]: ValueTag.NativeFunction,
		hashId,
		name,
		cost: resolvedCost,
		invoke: (args, out) => {
			out.length = 0;
			invoke(args, out);
		},
	};
}

function createNativeObject(hashId: number, raw: object, handlers: {
	get: (key: Value) => Value;
	set: (key: Value, value: Value) => void;
	len: () => number;
	nextEntry: (after: Value) => [Value, Value] | null;
}): NativeObject {
	addTrackedLuaHeapBytes(NATIVE_OBJECT_HEAP_BYTES);
	return { [VALUE_TAG]: ValueTag.NativeObject, hashId, raw, get: handlers.get, set: handlers.set, len: handlers.len, nextEntry: handlers.nextEntry, metatable: null };
}

export type CpuValueState =
	| { tag: 'nil' }
	| { tag: 'false' }
	| { tag: 'true' }
	| { tag: 'number'; value: number }
	| { tag: 'string'; id: number }
	| { tag: 'builtin'; id: BuiltinFunctionId }
	| { tag: 'ref'; id: number };

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
	frames: CpuFrameState[];
	protectedCalls: CpuProtectedCallState[];
	completionValues: CpuValueState[];
	objects: CpuObjectState[];
	openUpvalues: number[];
	lastExecutionDomainId: ExecutionDomainId;
	lastPc: number;
	instructionBudgetRemaining: number;
	haltedUntilIrq: boolean;
	interruptEventPending: boolean;
	memoryWriteBlocked: boolean;
	memoryWriteBlockedAddress: number;
	statusWord: number;
	causeWord: number;
	epcWord: number;
	badAddressWord: number;
	luaFaultReasonWord: number;
	nmiReturnCauseWord: number;
	nmiReturnEpcWord: number;
	nmiReturnBadAddressWord: number;
	nmiReturnLuaFaultReasonWord: number;
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
}


const enum TableIndexKeyKind {
	Value,
	Integer,
	Field,
}

export type CpuExecutionObserver = {
	onInstruction(executionDomainId: ExecutionDomainId, pc: number, opcode: number): void;
};

// Pool constant for frame reuse
const MAX_POOLED_FRAMES = 32;
export class CPU {
	public instructionBudgetRemaining: number = 0;
	public completionValues: Value[] = [];
	public lastPc: number = 0;
	public readonly globals: Table;
	public readonly memory: Memory;

	public readonly stringPool: StringPool;
	private indexKey: StringValue = null;
	private haltedUntilIrq = false;
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
	private nmiReturnCauseWord = 0;
	private nmiReturnEpcWord = 0;
	private nmiReturnBadAddressWord = 0;
	private nmiReturnLuaFaultReasonWord = 0;
	private nonMaskableInterruptPending = false;
	private systemExceptionFunctionAddress = 0;
	private yieldRequested = false;
	private readonly frames: CallFrame[] = [];
	private readonly protectedCallContinuations = new ScratchBuffer<ProtectedCallContinuation>(() => new ProtectedCallContinuation(), MAX_POOLED_FRAMES);
	private protectedCallDepth = 0;
	private readonly openUpvalues: OpenUpvalueSlot[] = [];
	private readonly registerNativeArgsScratch = new ScratchBuffer<RegisterNativeArgsView>(() => new RegisterNativeArgsView());
	private registerNativeArgsScratchIndex = 0;
	private readonly arrayNativeArgsScratch = new ScratchBuffer<ArrayNativeArgsView>(() => new ArrayNativeArgsView());
	private arrayNativeArgsScratchIndex = 0;
	private readonly nativeReturnScratch = new ScratchArrayStack<Value>();
	private executionObserver: CpuExecutionObserver | null = null;
	private readonly executionImages: Blua32ExecutionImage[] = [];
	private systemImage!: Blua32ExecutionImage;
	private activeExecutionImage!: Blua32ExecutionImage;
	private readonly staticClosuresByAddress = new Map<number, Closure>();
	public stringIndexTable: Table;
	private systemGlobalNames: StringId[] = [];
	private systemGlobalValues: Value[] = [];
	private systemGlobalSlotByKey: Map<StringId, number> = new Map();
	private globalNames: StringId[] = [];
	private globalValues: Value[] = [];
	private globalSlotByKey: Map<StringId, number> = new Map();
	private readonly framePool: CallFrame[] = [];
	private stackRegisters = new RegisterFile(8);
	private stackTop = 0;
	private nextObjectHashId = 1;

	constructor(
		memory: Memory,
		private readonly irqController: IrqController,
		private readonly executionAddressSpace: ExecutionAddressSpace,
	) {
		this.memory = memory;
		this.stringPool = new StringPool(true);
		this.globals = this.createTable(0, 0);
		this.stringIndexTable = this.createTable(0, 0);
		this.indexKey = StringValue.get(this.stringPool.intern('__index'));
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

	public createTable(arraySize: number, hashSize: number): Table {
		const table = new Table(arraySize, hashSize);
		table.hashId = this.allocateObjectHashId();
		return table;
	}

	public createNativeFunction(name: string, invoke: (args: NativeArgs, out: Value[]) => void, cost?: NativeFnCost): NativeFunction {
		return createNativeFunction(this.allocateObjectHashId(), name, invoke, cost);
	}

	public createNativeObject(raw: object, handlers: {
		get: (key: Value) => Value;
		set: (key: Value, value: Value) => void;
		len: () => number;
		nextEntry: (after: Value) => [Value, Value] | null;
	}): NativeObject {
		return createNativeObject(this.allocateObjectHashId(), raw, handlers);
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
		const next = new RegisterFile(nextCapacity);
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

	private acquireRegisterNativeArgs(): RegisterNativeArgsView {
		const args = this.registerNativeArgsScratch.get(this.registerNativeArgsScratchIndex);
		this.registerNativeArgsScratchIndex += 1;
		return args;
	}

	private releaseRegisterNativeArgs(args: RegisterNativeArgsView): void {
		args.clear();
		this.registerNativeArgsScratchIndex -= 1;
	}

	private acquireArrayNativeArgs(values: ReadonlyArray<Value>): ArrayNativeArgsView {
		const args = this.arrayNativeArgsScratch.get(this.arrayNativeArgsScratchIndex);
		this.arrayNativeArgsScratchIndex += 1;
		args.bind(values);
		return args;
	}

	private releaseArrayNativeArgs(args: ArrayNativeArgsView): void {
		args.clear();
		this.arrayNativeArgsScratchIndex -= 1;
	}

	private findOpenUpvalue(frame: CallFrame, index: number): Upvalue | null {
		const openUpvalues = this.openUpvalues;
		for (let slot = 0; slot < openUpvalues.length; slot += 1) {
			const entry = openUpvalues[slot];
			if (entry.frame === frame && entry.index === index) {
				return entry.upvalue;
			}
		}
		return null;
	}

	private resolveTableIndexChain(table: Table, key: Value, kind: TableIndexKeyKind): Value {
		let current = table;
		for (let depth = 0; depth < 32; depth += 1) {
			const value = kind === TableIndexKeyKind.Integer
				? current.getInteger(key as number)
				: kind === TableIndexKeyKind.Field
					? current.getStringKey(key as StringValue)
					: current.get(key);
			if (value !== null) {
				return value;
			}
			const metatable = current.metatable;
			if (metatable === null) {
				return null;
			}
			const indexer = metatable.getStringKey(this.indexKey);
			if (!(valueIsTable(indexer))) {
				return null;
			}
			current = indexer;
		}
		throw new LuaExecutionError('Metatable __index loop detected.', LUA_FAULT_REASON_METATABLE_LOOP);
	}

	private loadTableIndex(base: Value, key: Value): Value {
		switch (valueTag(base)) {
			case ValueTag.Table: {
				const table = base as Table;
				if (table.metatable === null) {
					return table.get(key);
				}
				return this.resolveTableIndexChain(table, key, TableIndexKeyKind.Value);
			}
			case ValueTag.String: {
				const table = this.stringIndexTable;
				if (table.metatable === null) {
					return table.get(key);
				}
				return this.resolveTableIndexChain(table, key, TableIndexKeyKind.Value);
			}
			case ValueTag.NativeObject: {
				const nativeObject = base as NativeObject;
				const directValue = nativeObject.get(key);
				const metatable = nativeObject.metatable;
				if (directValue !== null || metatable === null) {
					return directValue;
				}
				const indexer = metatable.getStringKey(this.indexKey);
				if (valueIsTable(indexer)) {
					return this.resolveTableIndexChain(indexer, key, TableIndexKeyKind.Value);
				}
				return null;
			}
			default:
				throw new LuaExecutionError('Attempted to index field on a non-table value.', LUA_FAULT_REASON_INDEX_NON_TABLE);
		}
	}

	private loadTableIntegerIndexCached(cache: TableLoadInlineCache, base: Value, index: number): Value {
		const indexKind = TableIndexKeyKind.Integer;
		switch (valueTag(base)) {
			case ValueTag.Table: {
				const table = base as Table;
				if (table.metatable === null) {
					const version = table.getVersion();
					if (cache.table === table && cache.version === version) {
						return cache.value;
					}
					const value = table.getInteger(index);
					cache.table = table;
					cache.version = version;
					cache.value = value;
					return value;
				}
				return this.resolveTableIndexChain(table, index, indexKind);
			}
			case ValueTag.String: {
				const table = this.stringIndexTable;
				if (table.metatable === null) {
					const version = table.getVersion();
					if (cache.table === table && cache.version === version) {
						return cache.value;
					}
					const value = table.getInteger(index);
					cache.table = table;
					cache.version = version;
					cache.value = value;
					return value;
				}
				return this.resolveTableIndexChain(table, index, indexKind);
			}
			case ValueTag.NativeObject: {
				const nativeObject = base as NativeObject;
				const directValue = nativeObject.get(index);
				if (directValue !== null || nativeObject.metatable === null) {
					return directValue;
				}
				const indexer = nativeObject.metatable.getStringKey(this.indexKey);
				if (valueIsTable(indexer)) {
					return this.resolveTableIndexChain(indexer, index, indexKind);
				}
				return directValue;
			}
			default:
				throw new LuaExecutionError('Attempted to index field on a non-table value.', LUA_FAULT_REASON_INDEX_NON_TABLE);
		}
	}

	private loadTableFieldIndexCached(cache: TableLoadInlineCache, base: Value, key: StringValue): Value {
		switch (valueTag(base)) {
			case ValueTag.Table: {
				const table = base as Table;
				if (table.metatable === null) {
					const version = table.getVersion();
					if (cache.table === table && cache.version === version) {
						return cache.value;
					}
					const value = table.getStringKey(key);
					cache.table = table;
					cache.version = version;
					cache.value = value;
					return value;
				}
				return this.resolveTableIndexChain(table, key, TableIndexKeyKind.Field);
			}
			case ValueTag.String: {
				const table = this.stringIndexTable;
				if (table.metatable === null) {
					const version = table.getVersion();
					if (cache.table === table && cache.version === version) {
						return cache.value;
					}
					const value = table.getStringKey(key);
					cache.table = table;
					cache.version = version;
					cache.value = value;
					return value;
				}
				return this.resolveTableIndexChain(table, key, TableIndexKeyKind.Field);
			}
			case ValueTag.NativeObject: {
				const nativeObject = base as NativeObject;
				const directValue = nativeObject.get(key);
				if (directValue !== null || nativeObject.metatable === null) {
					return directValue;
				}
				const indexer = nativeObject.metatable.getStringKey(this.indexKey);
				if (valueIsTable(indexer)) {
					return this.resolveTableIndexChain(indexer, key, TableIndexKeyKind.Field);
				}
				return directValue;
			}
			default:
				throw new LuaExecutionError('Attempted to index field on a non-table value.', LUA_FAULT_REASON_INDEX_NON_TABLE);
		}
	}

	private storeTableIndex(base: Value, key: Value, value: Value): void {
		switch (valueTag(base)) {
			case ValueTag.Table:
				(base as Table).set(key, value);
				return;
			case ValueTag.NativeObject:
				(base as NativeObject).set(key, value);
				return;
			default:
				throw new LuaExecutionError('Attempted to assign to a non-table value.', LUA_FAULT_REASON_ASSIGN_NON_TABLE);
		}
	}

	private storeTableIntegerIndex(base: Value, index: number, value: Value): void {
		switch (valueTag(base)) {
			case ValueTag.Table:
				(base as Table).setInteger(index, value);
				return;
			case ValueTag.NativeObject:
				(base as NativeObject).set(index, value);
				return;
			default:
				throw new LuaExecutionError('Attempted to assign to a non-table value.', LUA_FAULT_REASON_ASSIGN_NON_TABLE);
		}
	}

	private storeTableFieldIndex(base: Value, key: StringValue, value: Value): void {
		switch (valueTag(base)) {
			case ValueTag.Table:
				(base as Table).setStringKey(key, value);
				return;
			case ValueTag.NativeObject:
				(base as NativeObject).set(key, value);
				return;
			default:
				throw new LuaExecutionError('Attempted to assign to a non-table value.', LUA_FAULT_REASON_ASSIGN_NON_TABLE);
		}
	}

	private acquireFrame(): CallFrame {
		if (this.framePool.length > 0) {
			return this.framePool.pop()!;
		}
		return {
			functionAddress: 0,
			functionRecord: null!,
			pc: 0,
			varargBase: 0,
			varargCount: 0,
			stackBase: 0,
			stackCapacity: 0,
			registers: new RegisterFile(0),
			closure: null!,
			returnBase: 0,
			returnCount: 0,
			top: 0,
			returnToCompletionLatch: false,
			callSitePc: 0,
			isExceptionFrame: false,
			isNonMaskableExceptionFrame: false,
		};
	}

	private releaseFrame(frame: CallFrame): void {
		frame.varargBase = 0;
		frame.varargCount = 0;
		frame.stackBase = 0;
		frame.stackCapacity = 0;
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
		this.openUpvalues.length = 0;
		this.stackTop = 0;
	}

	public resetExecutionImages(systemImage: Blua32DecodedExecutionImage): void {
		this.staticClosuresByAddress.clear();
		this.executionImages.length = 0;
		this.systemImage = this.activateExecutionImage(systemImage);
		this.executionImages.push(this.systemImage);
		this.systemExceptionFunctionAddress = this.systemImage.boot.exceptionFunctionAddress;
		this.hardHalted = false;
		this.activeExecutionImage = this.systemImage;
	}

	public clearExecutionEnvironment(): void {
		this.completionValues.length = 0;
		this.clearCallStack();
		this.clearGlobalSlots();
		this.globals.clear();
	}

	private registerGlobalNames(names: ReadonlyArray<string>, system: boolean): Uint32Array {
		const slotByKey = system ? this.systemGlobalSlotByKey : this.globalSlotByKey;
		const registeredNames = system ? this.systemGlobalNames : this.globalNames;
		const values = system ? this.systemGlobalValues : this.globalValues;
		const slots = new Uint32Array(names.length);
		for (let index = 0; index < names.length; index += 1) {
			const key = this.stringPool.intern(names[index], false);
			let slot = slotByKey.get(key);
			if (slot === undefined) {
				slot = registeredNames.length;
				slotByKey.set(key, slot);
				registeredNames.push(key);
				values.push(system ? null : this.globals.get(StringValue.get(key)));
			}
			slots[index] = slot;
		}
		return slots;
	}

	private activateExecutionImage(decodedImage: Blua32DecodedExecutionImage): Blua32ExecutionImage {
		const layout = decodedImage.layout;
		const constPool = new Array<Value>(layout.constants.length);
		for (let index = 0; index < layout.constants.length; index += 1) {
			const constant = layout.constants[index];
			switch (constant.tag) {
				case Blua32ConstantTag.Nil:
					constPool[index] = null;
					break;
				case Blua32ConstantTag.False:
					constPool[index] = false;
					break;
				case Blua32ConstantTag.True:
					constPool[index] = true;
					break;
				case Blua32ConstantTag.Number:
					constPool[index] = constant.value;
					break;
				case Blua32ConstantTag.String:
					constPool[index] = StringValue.get(this.stringPool.intern(constant.value, false));
					break;
			}
		}
		const globalSlots = this.registerGlobalNames(layout.globalNames, false);
		const systemGlobalSlots = this.registerGlobalNames(layout.systemGlobalNames, true);
		const decoded = this.decodeText(layout, globalSlots, systemGlobalSlots);
		const image: Blua32ExecutionImage = {
			...decodedImage,
			functions: new Array(layout.functions.length),
			constPool,
			globalSlots,
			systemGlobalSlots,
			decodedPages: decoded.pages,
			decodedWordCount: layout.header.textByteCount / INSTRUCTION_BYTES,
			tableLoadCaches: decoded.tableLoadCaches,
			staticClosures: new Array(layout.functions.length),
		};
		for (let index = 0; index < layout.functions.length; index += 1) {
			const functionRecord: Blua32RuntimeFunction = {
				...layout.functions[index],
				image,
				index,
			};
			image.functions[index] = functionRecord;
		}
		this.bindStaticClosures(image);
		const startup = this.functionRecordInImage(image, decodedImage.boot.startupFunctionAddress);
		const irq = this.functionRecordInImage(image, decodedImage.boot.irqFunctionAddress);
		const exception = this.functionRecordInImage(image, decodedImage.boot.exceptionFunctionAddress);
		if (!startup || !irq || !exception
			|| !startup.staticClosure || !irq.staticClosure || !exception.staticClosure) {
			throw new Error('BLua32 boot vector does not name a static function record.');
		}
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
		const decodedImage = this.executionAddressSpace.resolveDomain(executionDomainId);
		if (decodedImage === null) {
			return null;
		}
		const image = this.activateExecutionImage(decodedImage);
		this.executionImages.push(image);
		return image;
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

	private bindStaticClosures(image: Blua32ExecutionImage): void {
		for (let index = 0; index < image.functions.length; index += 1) {
			const functionRecord = image.functions[index];
			if (functionRecord.staticClosure) {
				image.staticClosures[index] = this.staticClosureAtAddress(functionRecord.address);
			}
		}
	}

	public replaceExecutionImage(decodedImage: Blua32DecodedExecutionImage): void {
		let imageIndex = 0;
		while (this.executionImages[imageIndex].executionDomainId !== decodedImage.executionDomainId) {
			imageIndex += 1;
		}
		const previousImage = this.executionImages[imageIndex];
		const image = this.activateExecutionImage(decodedImage);
		this.executionImages[imageIndex] = image;
		if (decodedImage.executionDomainId === SYSTEM_EXECUTION_DOMAIN_ID) {
			this.systemImage = image;
			this.systemExceptionFunctionAddress = image.boot.exceptionFunctionAddress;
		}
		if (this.activeExecutionImage === previousImage) {
			this.activeExecutionImage = image;
		}
	}

	public isExecutionDomainResident(executionDomainId: ExecutionDomainId): boolean {
		return this.residentExecutionImage(executionDomainId) !== null;
	}

	public setExecutionObserver(observer: CpuExecutionObserver | null): void {
		this.executionObserver = observer;
	}

	private decodeText(
		layout: Blua32ImageLayout,
		globalSlots: Uint32Array,
		systemGlobalSlots: Uint32Array,
	): {
		pages: DecodedInstructionPage[];
		tableLoadCaches: TableLoadInlineCache[];
	} {
		const codeOffset = layout.header.textAddress - layout.address;
		const code = layout.bytes.subarray(codeOffset, codeOffset + layout.header.textByteCount);
		const instructionCount = code.length / INSTRUCTION_BYTES;
		const decodedPages = new Array<DecodedInstructionPage>((instructionCount + DECODED_PAGE_WORDS - 1) >> DECODED_PAGE_SHIFT);
		for (let pageIndex = 0; pageIndex < decodedPages.length; pageIndex += 1) {
			decodedPages[pageIndex] = createDecodedInstructionPage();
		}
		const tableLoadCaches: TableLoadInlineCache[] = [];
		for (let wordIndex = 0; wordIndex < instructionCount;) {
			const page = this.decodedPageForWrite(decodedPages, wordIndex);
			const pageOffset = wordIndex & DECODED_PAGE_MASK;
			let width = 1;
			let wideA = 0;
			let wideB = 0;
			let wideC = 0;
			let instr = readInstructionWord(code, wordIndex);
			let op = (instr >>> 18) & 0x3f;
			let ext = instr >>> 24;
			if (op === OpCode.WIDE && wordIndex + 1 < instructionCount) {
				width = 2;
				wideA = (instr >>> 12) & 0x3f;
				wideB = (instr >>> 6) & 0x3f;
				wideC = instr & 0x3f;
				instr = readInstructionWord(code, wordIndex + 1);
				op = (instr >>> 18) & 0x3f;
				ext = instr >>> 24;
			}
			const aLow = (instr >>> 12) & 0x3f;
			const bLow = (instr >>> 6) & 0x3f;
			const cLow = instr & 0x3f;
			const usesDisp = OPCODE_USES_DISP[op] !== 0;
			const usesBx = !usesDisp && OPCODE_USES_BX[op] !== 0;
			const extA = usesBx || usesDisp ? 0 : (ext >>> 6) & 0x3;
			const extB = usesBx || usesDisp ? 0 : (ext >>> 3) & 0x7;
			const extC = usesBx || usesDisp ? 0 : (ext & 0x7);
			const aShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + (usesBx ? 0 : EXT_A_BITS);
			const bShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + EXT_B_BITS;
			const cShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + EXT_C_BITS;
			const bxLow = (bLow << MAX_OPERAND_BITS) | cLow;
			const rawB = (wideB << bShift) | (extB << MAX_OPERAND_BITS) | bLow;
			const rawC = (wideC << cShift) | (extC << MAX_OPERAND_BITS) | cLow;
			const decodedBx = (wideB << (MAX_BX_BITS + EXT_BX_BITS)) | ((usesBx ? ext : 0) << MAX_BX_BITS) | bxLow;
			page.widths[pageOffset] = width;
			page.words[pageOffset] = instr;
			page.ops[pageOffset] = op;
			page.a[pageOffset] = (wideA << aShift) | (extA << MAX_OPERAND_BITS) | aLow;
			page.b[pageOffset] = rawB;
			page.c[pageOffset] = rawC;
			switch (op) {
				case OpCode.GETGL:
				case OpCode.SETGL:
					page.bx[pageOffset] = globalSlots[decodedBx];
					break;
				case OpCode.GETSYS:
				case OpCode.SETSYS:
					page.bx[pageOffset] = systemGlobalSlots[decodedBx];
					break;
				default:
					page.bx[pageOffset] = decodedBx;
					break;
			}
			page.sbx[pageOffset] = signExtend(decodedBx, MAX_BX_BITS + EXT_BX_BITS + ((width - 1) * MAX_OPERAND_BITS));
			page.rkB[pageOffset] = signExtend(rawB, MAX_OPERAND_BITS + EXT_B_BITS + ((width - 1) * MAX_OPERAND_BITS));
			page.rkC[pageOffset] = signExtend(rawC, MAX_OPERAND_BITS + EXT_C_BITS + ((width - 1) * MAX_OPERAND_BITS));
			page.disp[pageOffset] = ext;
			if (op === OpCode.GETI || op === OpCode.GETFIELD || op === OpCode.SELF) {
				page.tableCacheIndexes[pageOffset] = tableLoadCaches.length;
				tableLoadCaches.push({ table: null, version: 0, value: null });
			}
			wordIndex += width;
		}
		return { pages: decodedPages, tableLoadCaches };
	}

	private decodedPageForWrite(decodedPages: DecodedInstructionPage[], wordIndex: number): DecodedInstructionPage {
		return decodedPages[wordIndex >>> DECODED_PAGE_SHIFT];
	}

	private decodedPageAt(image: Blua32ExecutionImage, wordIndex: number): DecodedInstructionPage {
		return image.decodedPages[wordIndex >>> DECODED_PAGE_SHIFT];
	}

	private functionRecordInImage(image: Blua32ExecutionImage, address: number): Blua32RuntimeFunction | null {
		const offset = address - image.layout.header.functionTableAddress;
		if ((offset & (BLUA32_FUNCTION_RECORD_SIZE - 1)) !== 0
			|| offset < 0
			|| offset >= image.functions.length * BLUA32_FUNCTION_RECORD_SIZE) {
			return null;
		}
		return image.functions[offset / BLUA32_FUNCTION_RECORD_SIZE];
	}

	private functionRecordInExecutionDomain(
		executionImage: Blua32ExecutionImage,
		address: number,
	): Blua32RuntimeFunction | null {
		if (address >= CART_ROM_BASE) {
			return this.functionRecordInImage(executionImage, address);
		}
		if (address >= RAM_BASE) {
			return null;
		}
		return this.functionRecordInImage(this.systemImage, address);
	}

	private functionRecordOnSelectedBus(address: number): Blua32RuntimeFunction | null {
		const executionDomainId = this.executionAddressSpace.domainIdOnBus(address);
		if (executionDomainId === null) {
			return null;
		}
		const image = this.executionImageForDomain(executionDomainId);
		return image === null ? null : this.functionRecordInImage(image, address);
	}

	public systemStartupFunctionAddress(): number {
		return this.systemImage.boot.startupFunctionAddress;
	}

	public isCartridgeExecutionActive(): boolean {
		return this.activeExecutionImage.executionDomainId >= 0;
	}

	public activeCartridgeSlot(): ExecutionDomainId {
		return this.activeExecutionImage.executionDomainId;
	}

	public start(functionAddress: number, args: ReadonlyArray<Value> = EMPTY_CALL_ARGS, statusWord = CPU_STATUS_CART_ENTRY): void {
		this.completionValues.length = 0;
		this.clearCallStack();
		this.haltedUntilIrq = false;
		this.interruptEventPending = false;
		this.memoryWriteBlocked = false;
		this.memoryWriteBlockedAddress = 0;
		this.hardHalted = false;
		this.statusWord = statusWord >>> 0;
		this.causeWord = 0;
		this.epcWord = 0;
		this.badAddressWord = 0;
		this.luaFaultReasonWord = 0;
		this.nmiReturnCauseWord = 0;
		this.nmiReturnEpcWord = 0;
		this.nmiReturnBadAddressWord = 0;
		this.nmiReturnLuaFaultReasonWord = 0;
		this.nonMaskableInterruptPending = false;
		this.yieldRequested = false;
		const functionRecord = this.functionRecordOnSelectedBus(functionAddress)!;
		this.activeExecutionImage = functionRecord.image;
		const closure = functionRecord.image.staticClosures[functionRecord.index];
		this.pushFrame(closure, args, 0, 0, false);
		enforceLuaHeapBudget();
	}

	private executeFunctionAddress(functionAddress: number): void {
		const functionRecord = this.functionRecordOnSelectedBus(functionAddress);
		if (functionRecord === null || !functionRecord.staticClosure) {
			this.hardHalt();
			return;
		}
		const image = functionRecord.image;
		this.clearCallStack();
		this.activeExecutionImage = image;
		const cartridgeEntry = image.executionDomainId >= 0;
		this.statusWord = cartridgeEntry ? CPU_STATUS_CART_ENTRY : CPU_STATUS_SYSTEM_ENTRY;
		this.haltedUntilIrq = false;
		this.interruptEventPending = false;
		this.memoryWriteBlocked = false;
		this.memoryWriteBlockedAddress = 0;
		this.hardHalted = false;
		this.yieldRequested = false;
		const closure = image.staticClosures[functionRecord.index];
		this.pushFrame(closure, EMPTY_CALL_ARGS, 0, 0, false);
	}

	public call(closure: Closure, args: ReadonlyArray<Value> = EMPTY_CALL_ARGS, returnCount: number = 0): void {
		this.completionValues.length = 0;
		this.yieldRequested = false;
		this.pushFrame(closure, args, 0, returnCount, false);
	}

	public beginCompletionCall(closure: Closure, args: ReadonlyArray<Value> = EMPTY_CALL_ARGS): void {
		this.completionValues.length = 0;
		this.yieldRequested = false;
		this.pushFrame(closure, args, 0, 0, true);
	}

	public requestYield(): void {
		this.yieldRequested = true;
	}

	public haltUntilIrq(): void {
		if (this.interruptEventPending) {
			this.interruptEventPending = false;
			return;
		}
		this.haltedUntilIrq = true;
		this.yieldRequested = false;
	}

	private hardHalt(): void {
		this.hardHalted = true;
		this.haltedUntilIrq = false;
		this.yieldRequested = false;
	}


	public clearHaltUntilIrq(): void {
		this.haltedUntilIrq = false;
		this.yieldRequested = false;
	}

	public isHaltedUntilIrq(): boolean {
		return this.haltedUntilIrq;
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
			const wasHalted = this.haltedUntilIrq;
			const returnCauseWord = this.causeWord;
			const returnEpcWord = this.epcWord;
			const returnBadAddressWord = this.badAddressWord;
			const returnLuaFaultReasonWord = this.luaFaultReasonWord;
			this.enterException(
				this.systemImage,
				this.systemExceptionFunctionAddress,
				CPU_CAUSE_NMI,
				this.frames[this.frames.length - 1].pc,
			);
			this.frames[this.frames.length - 1].isNonMaskableExceptionFrame = true;
			this.nmiReturnCauseWord = returnCauseWord;
			this.nmiReturnEpcWord = returnEpcWord;
			this.nmiReturnBadAddressWord = returnBadAddressWord;
			this.nmiReturnLuaFaultReasonWord = returnLuaFaultReasonWord;
			if (!wasHalted) this.interruptEventPending = true;
			return true;
		}
		if (this.canAcceptMaskableInterruptLine()) {
			const image = this.isUserMode() ? this.activeExecutionImage : this.systemImage;
			const wasHalted = this.haltedUntilIrq;
			this.enterException(
				image,
				image.boot.irqFunctionAddress,
				CPU_CAUSE_IRQ,
				this.frames[this.frames.length - 1].pc,
			);
			if (!wasHalted) this.interruptEventPending = true;
			return true;
		}
		return false;
	}

	private enterSynchronousException(interruptedFrame: CallFrame, causeWord: number): void {
		interruptedFrame.pc = this.currentInstructionPc;
		this.enterException(this.systemImage, this.systemExceptionFunctionAddress, causeWord, this.currentInstructionPc);
	}

	private enterSynchronousAddressException(interruptedFrame: CallFrame, causeWord: number, address: number): void {
		this.badAddressWord = address >>> 0;
		this.enterSynchronousException(interruptedFrame, causeWord);
	}

	private enterLuaFaultException(error: LuaExecutionError | LuaThrownValueError): void {
		this.luaFaultReasonWord = error instanceof LuaExecutionError
			? error.reason
			: LUA_FAULT_REASON_EXPLICIT_ERROR;
		this.enterSynchronousException(this.frames[this.frames.length - 1], CPU_CAUSE_CODE_TRAP);
	}

	private enterException(
		image: Blua32ExecutionImage,
		functionAddress: number,
		causeWord: number,
		epcWord: number,
	): void {
		this.epcWord = epcWord >>> 0;
		this.causeWord = causeWord >>> 0;
		this.statusWord = ((this.statusWord & ~CPU_STATUS_MODE_STACK_MASK)
			| ((this.statusWord << 2) & CPU_STATUS_MODE_STACK_MASK)) >>> 0;
		this.clearHaltAfterAcceptedInterrupt();
		const functionRecord = this.functionRecordInImage(image, functionAddress)!;
		const closure = image.staticClosures[functionRecord.index];
		const frame = this.pushFrame(closure, EMPTY_CALL_ARGS, 0, 0, false)!;
		frame.callSitePc = epcWord;
		frame.isExceptionFrame = true;
	}

	private clearHaltAfterAcceptedInterrupt(): void {
		this.haltedUntilIrq = false;
		this.yieldRequested = false;
	}

	public getFrameDepth(): number {
		return this.frames.length;
	}

	public runUntilDepth(targetDepth: number, instructionBudget: number): RunResult {
		this.instructionBudgetRemaining = instructionBudget;
		const frames = this.frames;
		const executionObserver = this.executionObserver;
		const baseCycles = BASE_CYCLES;
		while (frames.length > targetDepth) {
			try {
				while (frames.length > targetDepth) {
					if (this.hardHalted || this.haltedUntilIrq || this.memoryWriteBlocked) {
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
					const image = frame.functionRecord.image;
					const pc = frame.pc;
					const wordIndex = (pc - image.layout.header.textAddress) / INSTRUCTION_BYTES;
					if ((wordIndex >>> 0) >= image.decodedWordCount) {
						this.hardHalt();
						return RunResult.Halted;
					}
					const pageIndex = wordIndex >>> DECODED_PAGE_SHIFT;
					const page = image.decodedPages[pageIndex];
					const pageOffset = wordIndex & DECODED_PAGE_MASK;
					const width = page.widths[pageOffset];
					const op = page.ops[pageOffset];
					this.currentInstructionPc = pc;
					frame.pc = pc + (width * INSTRUCTION_BYTES);
					this.lastExecutionDomainId = image.executionDomainId;
					this.lastPc = pc + ((width - 1) * INSTRUCTION_BYTES);
					if (executionObserver) {
						executionObserver.onInstruction(image.executionDomainId, pc, op);
					}
					this.instructionBudgetRemaining -= baseCycles[op];
					this.executeInstruction(
						frame,
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
				if (!this.handleProtectedCallError(error)) {
					if (error instanceof LuaExecutionError || error instanceof LuaThrownValueError) {
						this.enterLuaFaultException(error);
					} else {
						throw error;
					}
				}
			}
		}
		return RunResult.Halted;
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
		const image = frame.functionRecord.image;
		const wordIndex = (frame.pc - image.layout.header.textAddress) / INSTRUCTION_BYTES;
		if ((wordIndex >>> 0) >= image.decodedWordCount) {
			this.hardHalt();
			return;
		}
		const page = this.decodedPageAt(image, wordIndex);
		const width = page.widths[wordIndex & DECODED_PAGE_MASK];
		const nextPc = frame.pc + width * INSTRUCTION_BYTES;
		const functionRecord = frame.functionRecord;
		if (nextPc < functionRecord.codeAddress
			|| nextPc >= functionRecord.codeAddress + functionRecord.codeByteCount) {
			this.hardHalt();
			return;
		}
		frame.pc = nextPc;
	}

	public readFrameExecutionDomain(frameIndex: number): ExecutionDomainId {
		return this.frames[frameIndex].functionRecord.image.executionDomainId;
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
		return this.readUpvalue(this.frames[frameIndex].closure.upvalues[upvalueIndex]);
	}

	public readEpcWord(): number {
		return this.epcWord;
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
		const functionRecord = this.functionRecordInImage(image, functionAddress)!;
		const frame = this.frames[frameIndex];
		if (functionRecord.maxStack > frame.stackCapacity) {
			this.ensureRegisterCapacity(frame, functionRecord.maxStack - 1);
		}
		if (functionRecord.staticClosure && functionRecord.upvalues.length === 0) {
			frame.closure = image.staticClosures[functionRecord.index];
		} else {
			frame.closure.functionAddress = functionRecord.address;
		}
		frame.functionAddress = functionRecord.address;
		frame.functionRecord = functionRecord;
		frame.pc = pc;
	}

	public writeFrameCallSitePc(childFrameIndex: number, pc: number): void {
		this.frames[childFrameIndex].callSitePc = pc;
	}

	public setGlobalByKey(key: StringValue, value: Value): void {
		this.globals.set(key, value);
		const globalSlot = this.globalSlotByKey.get(key.id);
		if (globalSlot !== undefined) {
			this.globalValues[globalSlot] = value;
		}
	}

	public setSystemGlobalByKey(key: StringValue, value: Value): void {
		const slot = this.systemGlobalSlotByKey.get(key.id);
		if (slot === undefined) {
			throw new Error(`System global '${this.stringPool.toString(key.id)}' has no register slot.`);
		}
		this.systemGlobalValues[slot] = value;
	}

	public clearGlobalSlots(): void {
		this.systemGlobalNames = [];
		this.systemGlobalValues = [];
		this.systemGlobalSlotByKey = new Map();
		this.globalNames = [];
		this.globalValues = [];
		this.globalSlotByKey = new Map();
	}

	public syncGlobalSlotsToTable(): void {
		for (let slot = 0; slot < this.globalNames.length; slot += 1) {
			this.globals.set(StringValue.get(this.globalNames[slot]), this.globalValues[slot]);
		}
	}

	public getGlobalByKey(key: StringValue): Value {
		const globalSlot = this.globalSlotByKey.get(key.id);
		if (globalSlot !== undefined) {
			return this.globalValues[globalSlot];
		}
		return this.globals.get(key);
	}

	private setSystemGlobalBySlot(slot: number, value: Value): void {
		this.systemGlobalValues[slot] = value;
	}

	private setGlobalBySlot(slot: number, value: Value): void {
		this.globalValues[slot] = value;
	}

	private getSystemGlobalBySlot(slot: number): Value {
		return this.systemGlobalValues[slot];
	}

	private getGlobalBySlot(slot: number): Value {
		return this.globalValues[slot];
	}

	private executeInstruction(
		frame: CallFrame,
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
		const image = frame.functionRecord.image;
		switch (op) {
				case OpCode.WIDE:
					this.hardHalt();
					return;
				case OpCode.MOV:
					this.copyRegisterFast(frame, registers, a, b);
					return;
				case OpCode.LOADK: {
					this.setRegisterFast(frame, registers, a, image.constPool[bx]);
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
					this.setRegisterFast(frame, registers, a, this.getSystemGlobalBySlot(bx));
					return;
				case OpCode.SETSYS:
					this.setSystemGlobalBySlot(bx, registers.get(a));
					return;
				case OpCode.GETGL:
					this.setRegisterFast(frame, registers, a, this.getGlobalBySlot(bx));
					return;
				case OpCode.SETGL:
					this.setGlobalBySlot(bx, registers.get(a));
					return;
				case OpCode.GETI:
					this.setRegisterFast(frame, registers, a, this.loadTableIntegerIndexCached(image.tableLoadCaches[tableCacheIndex], registers.get(b), c));
					return;
				case OpCode.SETI:
					this.storeTableIntegerIndex(registers.get(a), b, this.readRK(frame, rkC));
					return;
				case OpCode.GETFIELD:
					this.setRegisterFast(frame, registers, a, this.loadTableFieldIndexCached(image.tableLoadCaches[tableCacheIndex], registers.get(b), image.constPool[c] as StringValue));
					return;
				case OpCode.SETFIELD:
					this.storeTableFieldIndex(registers.get(a), image.constPool[b] as StringValue, this.readRK(frame, rkC));
					return;
				case OpCode.SELF: {
					const base = registers.get(b);
					const key = image.constPool[c] as StringValue;
					this.setRegisterFast(frame, registers, a + 1, base);
					this.setRegisterFast(frame, registers, a, this.loadTableFieldIndexCached(image.tableLoadCaches[tableCacheIndex], base, key));
					return;
				}
		case OpCode.HALT:
			this.haltUntilIrq();
			return;
				case OpCode.GETT: {
					this.setRegisterFast(frame, registers, a, this.loadTableIndex(registers.get(b), this.readRK(frame, rkC)));
					return;
				}
				case OpCode.SETT:
					this.storeTableIndex(registers.get(a), this.readRK(frame, rkB), this.readRK(frame, rkC));
					return;
				case OpCode.NEWT:
					this.setRegisterTableFast(frame, registers, a, this.createTable(b, c));
					enforceLuaHeapBudget();
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
				case OpCode.SHR: {
					const left = this.readRK(frame, rkB) as number;
					const right = this.readRK(frame, rkC) as number;
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
					const left = this.readRK(frame, rkB);
					const right = this.readRK(frame, rkC);
					const text = valueToString(left, this.stringPool) + valueToString(right, this.stringPool);
					const handle = this.stringPool.intern(text);
					this.setRegisterStringFast(frame, registers, a, StringValue.get(handle));
					return;
				}
				case OpCode.CONCATN: {
					let text = '';
					for (let index = 0; index < c; index += 1) {
						text += valueToString(registers.get(b + index), this.stringPool);
					}
					const handle = this.stringPool.intern(text);
					this.setRegisterStringFast(frame, registers, a, StringValue.get(handle));
					return;
				}
				case OpCode.UNM: {
					const value = registers.get(b) as number;
					this.setRegisterNumberFast(frame, registers, a, -value);
					return;
				}
				case OpCode.NOT:
					this.setRegisterBoolFast(frame, registers, a, !registers.isTruthy(b));
					return;
				case OpCode.LEN: {
					const value = registers.get(b);
					switch (valueTag(value)) {
						case ValueTag.String: {
							const cp = this.stringPool.codepointCount(asStringId(value as StringValue));
							this.setRegisterNumberFast(frame, registers, a, cp);
							return;
						}
						case ValueTag.Table:
							this.setRegisterNumberFast(frame, registers, a, (value as Table).arrayLength);
							return;
						default:
							this.setRegisterNumberFast(frame, registers, a, (value as NativeObject).len());
							return;
					}
				}
				case OpCode.BNOT: {
					const value = registers.get(b) as number;
					this.setRegisterNumberFast(frame, registers, a, ~value);
					return;
				}
				case OpCode.EQ: {
					const left = this.readRK(frame, rkB);
					const right = this.readRK(frame, rkC);
					const eq = left === right;
					if (eq !== (a !== 0)) {
						this.skipNextInstruction(frame);
					}
					return;
				}
				case OpCode.LT: {
					const left = this.readRK(frame, rkB);
					const right = this.readRK(frame, rkC);
					const ok = valueIsString(left) && valueIsString(right)
						? this.stringPool.toString(asStringId(left)) < this.stringPool.toString(asStringId(right))
						: (left as number) < (right as number);
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
					const value = (registers.get(a) as number) >>> 0;
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
					if (caller !== undefined
						&& (returnPc < caller.functionRecord.codeAddress
							|| returnPc >= caller.functionRecord.codeAddress + caller.functionRecord.codeByteCount)) {
						this.hardHalt();
						return;
					}
					this.closeUpvalues(frame);
					this.frames.pop();
					this.stackTop = frame.varargBase;
					this.releaseFrame(frame);
					this.statusWord = ((this.statusWord & ~CPU_STATUS_RFE_RESTORE_MASK)
						| ((this.statusWord >> 2) & CPU_STATUS_RFE_RESTORE_MASK)) >>> 0;
					if (caller !== undefined) {
						caller.pc = returnPc;
					}
					if (returnFromNmi) {
						this.causeWord = this.nmiReturnCauseWord;
						this.epcWord = this.nmiReturnEpcWord;
						this.badAddressWord = this.nmiReturnBadAddressWord;
						this.luaFaultReasonWord = this.nmiReturnLuaFaultReasonWord;
					}
					return;
				case OpCode.LOADKR:
					this.setRegisterFast(frame, registers, a, image.constPool[registers.get(b) as number]);
					return;

				case OpCode.LE: {
					const left = this.readRK(frame, rkB);
					const right = this.readRK(frame, rkC);
					const ok = valueIsString(left) && valueIsString(right)
						? this.stringPool.toString(asStringId(left)) <= this.stringPool.toString(asStringId(right))
						: (left as number) <= (right as number);
					if (ok !== (a !== 0)) {
						this.skipNextInstruction(frame);
					}
					return;
				}
				case OpCode.JMP: {
					const targetPc = frame.pc + sbx * INSTRUCTION_BYTES;
					const functionRecord = frame.functionRecord;
					if (targetPc < functionRecord.codeAddress
						|| targetPc >= functionRecord.codeAddress + functionRecord.codeByteCount) {
						this.hardHalt();
						return;
					}
					frame.pc = targetPc;
					return;
				}
				case OpCode.JMPIF: {
					if (registers.isTruthy(a)) {
						const targetPc = frame.pc + sbx * INSTRUCTION_BYTES;
						const functionRecord = frame.functionRecord;
						if (targetPc < functionRecord.codeAddress
							|| targetPc >= functionRecord.codeAddress + functionRecord.codeByteCount) {
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
						const functionRecord = frame.functionRecord;
						if (targetPc < functionRecord.codeAddress
							|| targetPc >= functionRecord.codeAddress + functionRecord.codeByteCount) {
							this.hardHalt();
							return;
						}
						frame.pc = targetPc;
					}
					return;
				}
				case OpCode.CLOSURE: {
					const functionRecord = this.functionRecordInExecutionDomain(
						frame.functionRecord.image,
						bx * 16,
					);
					if (!functionRecord) {
						this.hardHalt();
						return;
					}
					this.setRegisterClosureFast(frame, registers, a, this.createClosure(frame, functionRecord));
					enforceLuaHeapBudget();
					return;
				}
				case OpCode.GETUP: {
					const upvalue = frame.closure.upvalues[b];
					this.setRegisterFast(frame, registers, a, this.readUpvalue(upvalue));
					return;
				}
				case OpCode.SETUP: {
					const upvalue = frame.closure.upvalues[b];
					this.writeUpvalue(upvalue, registers.get(a));
					return;
				}
				case OpCode.VARARG: {
					const count = b === 0 ? frame.varargCount : b;
					for (let index = 0; index < count; index += 1) {
						const value = index < frame.varargCount ? this.stackRegisters.get(frame.varargBase + index) : null;
						this.setRegisterFast(frame, registers, a + index, value);
					}
					if (b === 0) {
						frame.top = a + count;
					}
					return;
				}
				case OpCode.CALL: {
					const callee = registers.get(a);
					const argCount = b === 0 ? Math.max(frame.top - a - 1, 0) : b - 1;
					switch (valueTag(callee)) {
						case ValueTag.BuiltinFunction:
							this.runBuiltinFunction(callee as BuiltinFunction, frame, a, c, argCount);
							return;
						case ValueTag.NativeFunction: {
							const nativeFunction = callee as NativeFunction;
							this.charge(nativeFunction.cost.base);
							const nativeArgs = this.acquireRegisterNativeArgs();
							const results = this.nativeReturnScratch.acquire();
							try {
								nativeArgs.bind(registers, a + 1, argCount);
								nativeFunction.invoke(nativeArgs, results);
								if (this.frames.length > 0 && this.frames[this.frames.length - 1] === frame) {
									this.writeReturnValues(frame, a, c, results);
								}
								enforceLuaHeapBudget();
							} finally {
								this.releaseRegisterNativeArgs(nativeArgs);
								this.nativeReturnScratch.release(results);
							}
							return;
						}
						case ValueTag.Closure:
							this.pushFrameFromCaller(frame, callee as Closure, a + 1, argCount, a, c, false, frame.pc - INSTRUCTION_BYTES);
							return;
						default:
							throw new LuaExecutionError('Attempted to call a non-function value.', LUA_FAULT_REASON_CALL_NON_FUNCTION);
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
						this.captureValuesIntoArrayFromRegisters(this.completionValues, registers, a, total);
						this.frames.pop();
						this.stackTop = frame.varargBase;
						this.releaseFrame(frame);
						return;
					}
					if (frameIndex === 0) {
						this.captureValuesIntoArrayFromRegisters(this.completionValues, registers, a, total);
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
					const addr = (registers.get(b) as number) + (disp << 2);
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
						const value = registers.get(a);
						const faultSequence = this.memory.readBusFaultSequence();
						switch (c) {
							case MemoryAccessKind.Word:
								this.memory.writeMappedValue(addr, value);
								break;
							case MemoryAccessKind.U8:
								this.memory.writeMappedU8(addr, value as number);
								break;
							case MemoryAccessKind.U16LE:
								this.memory.writeMappedU16LE(addr, value as number);
								break;
							case MemoryAccessKind.U32LE:
								this.memory.writeMappedU32LE(addr, value as number);
								break;
							case MemoryAccessKind.F32LE:
								this.memory.writeMappedF32LE(addr, value as number);
								break;
							case MemoryAccessKind.F64LE:
								this.memory.writeMappedF64LE(addr, value as number);
								break;
						}
						if (this.memory.readBusFaultSequence() !== faultSequence) {
							this.enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
						}
						return;
					}
					const faultSequence = this.memory.readBusFaultSequence();
					let value: Value;
					switch (c) {
						case MemoryAccessKind.Word:
							value = this.memory.readMappedValue(addr);
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
					this.setRegisterFast(frame, registers, a, value);
					return;
				}
				case OpCode.LOAD_MEM: {
					const addr = this.readRK(frame, rkB) as number;
					if ((addr & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[c as MemoryAccessKind]) !== 0) {
						this.enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, addr);
						return;
					}
					const faultSequence = this.memory.readBusFaultSequence();
					let value: Value;
					switch (c) {
						case MemoryAccessKind.Word:
							value = this.memory.readMappedValue(addr);
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
					this.setRegisterFast(frame, registers, a, value);
					return;
				}
				case OpCode.STORE_MEM: {
					const addr = this.readRK(frame, rkB) as number;
					if ((addr & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[c as MemoryAccessKind]) !== 0) {
						this.enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, addr);
						return;
					}
					if (!this.memory.mappedWriteReady(addr)) {
						this.blockMappedWrite(frame, addr);
						return;
					}
					const value = registers.get(a);
					const faultSequence = this.memory.readBusFaultSequence();
					switch (c) {
						case MemoryAccessKind.Word:
							this.memory.writeMappedValue(addr, value);
							break;
						case MemoryAccessKind.U8:
							this.memory.writeMappedU8(addr, value as number);
							break;
						case MemoryAccessKind.U16LE:
							this.memory.writeMappedU16LE(addr, value as number);
							break;
						case MemoryAccessKind.U32LE:
							this.memory.writeMappedU32LE(addr, value as number);
							break;
						case MemoryAccessKind.F32LE:
							this.memory.writeMappedF32LE(addr, value as number);
							break;
						case MemoryAccessKind.F64LE:
							this.memory.writeMappedF64LE(addr, value as number);
							break;
					}
					if (this.memory.readBusFaultSequence() !== faultSequence) {
						this.enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
					}
					return;
				}
				case OpCode.STORE_MEM_WORDS: {
					const addr = this.readRK(frame, rkB) as number;
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

	private prepareFrameRegisters(frame: CallFrame, registerCount: number): RegisterFile {
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
		const functionRecord = this.functionRecordInExecutionDomain(
			this.activeExecutionImage,
			closure.functionAddress,
		);
		if (functionRecord === null) {
			this.hardHalt();
			return null;
		}
		const frame = this.acquireFrame();
		frame.functionAddress = closure.functionAddress;
		frame.functionRecord = functionRecord;
		frame.pc = functionRecord.codeAddress;
		frame.closure = closure;
		frame.returnBase = returnBase;
		frame.returnCount = returnCount;
		frame.top = functionRecord.numParams;
		frame.returnToCompletionLatch = returnToCompletionLatch;
		frame.callSitePc = functionRecord.codeAddress;
		frame.varargBase = this.stackTop;
		frame.varargCount = functionRecord.isVararg ? Math.max(args.length - functionRecord.numParams, 0) : 0;
		const registers = this.prepareFrameRegisters(frame, functionRecord.maxStack);

		let argIndex = 0;
		for (let index = 0; index < functionRecord.numParams; index += 1) {
			registers.set(index, argIndex < args.length ? args[argIndex] : null);
			argIndex += 1;
		}
		if (functionRecord.isVararg) {
			for (let index = 0; index < frame.varargCount; index += 1) {
				this.stackRegisters.set(frame.varargBase + index, args[argIndex + index]);
			}
		}
		this.frames.push(frame);
		return frame;
	}

	private pushFrameFromCaller(caller: CallFrame, closure: Closure, argBase: number, argCount: number, returnBase: number, returnCount: number, returnToCompletionLatch: boolean, callSitePc: number): CallFrame | null {
		const functionRecord = this.functionRecordInExecutionDomain(
			this.activeExecutionImage,
			closure.functionAddress,
		);
		if (functionRecord === null) {
			this.hardHalt();
			return null;
		}
		const frame = this.acquireFrame();
		frame.functionAddress = closure.functionAddress;
		frame.functionRecord = functionRecord;
		frame.pc = functionRecord.codeAddress;
		frame.closure = closure;
		frame.returnBase = returnBase;
		frame.returnCount = returnCount;
		frame.top = functionRecord.numParams;
		frame.returnToCompletionLatch = returnToCompletionLatch;
		frame.callSitePc = callSitePc;
		frame.varargBase = this.stackTop;
		frame.varargCount = functionRecord.isVararg ? Math.max(argCount - functionRecord.numParams, 0) : 0;

		const callerRegisters = caller.registers;
		const registers = this.prepareFrameRegisters(frame, functionRecord.maxStack);
		const copiedCount = Math.min(functionRecord.numParams, argCount);
		if (copiedCount > 0) {
			registers.copyRangeFrom(callerRegisters, 0, argBase, copiedCount);
		}
		for (let index = copiedCount; index < functionRecord.numParams; index += 1) {
			registers.setNil(index);
		}
		if (functionRecord.isVararg) {
			for (let index = 0; index < frame.varargCount; index += 1) {
				this.stackRegisters.set(frame.varargBase + index, callerRegisters.get(argBase + functionRecord.numParams + index));
			}
		}
		this.frames.push(frame);
		return frame;
	}

	private createClosure(frame: CallFrame, functionRecord: Blua32RuntimeFunction): Closure {
		if (functionRecord.staticClosure && functionRecord.upvalues.length === 0) {
			return functionRecord.image.staticClosures[functionRecord.index];
		}
		const upvalues = new Array<Upvalue>(functionRecord.upvalues.length);
		for (let index = 0; index < functionRecord.upvalues.length; index += 1) {
			const desc = functionRecord.upvalues[index];
			if (desc.inStack) {
				let upvalue = this.findOpenUpvalue(frame, desc.index);
					if (!upvalue) {
						upvalue = { hashId: this.allocateObjectHashId(), open: true, index: desc.index, frame, value: null };
						this.openUpvalues.push({ frame, index: desc.index, upvalue });
						addTrackedLuaHeapBytes(UPVALUE_HEAP_BYTES);
					}
				upvalues[index] = upvalue;
				continue;
			}
			upvalues[index] = frame.closure.upvalues[desc.index];
		}
		const heapBytes = CLOSURE_HEAP_BYTES + (upvalues.length * CLOSURE_UPVALUE_SLOT_HEAP_BYTES);
		addTrackedLuaHeapBytes(heapBytes);
		const closure = new Closure(functionRecord.address, upvalues, heapBytes);
		closure.hashId = this.allocateObjectHashId();
		return closure;
	}

	private closeUpvalues(frame: CallFrame): void {
		const openUpvalues = this.openUpvalues;
		let write = 0;
		for (let index = 0; index < openUpvalues.length; index += 1) {
			const entry = openUpvalues[index];
			if (entry.frame === frame) {
				const upvalue = entry.upvalue;
				upvalue.value = frame.registers.get(upvalue.index);
				upvalue.open = false;
				upvalue.frame = null;
				continue;
			}
			openUpvalues[write] = entry;
			write += 1;
		}
		openUpvalues.length = write;
	}

	private readUpvalue(upvalue: Upvalue): Value {
		if (upvalue.open) {
			return upvalue.frame.registers.get(upvalue.index);
		}
		return upvalue.value;
	}

	private writeUpvalue(upvalue: Upvalue, value: Value): void {
		if (upvalue.open) {
			upvalue.frame.registers.set(upvalue.index, value);
			return;
		}
		upvalue.value = value;
	}

	private writeReturnValuesFromRegisters(frame: CallFrame, base: number, count: number, source: RegisterFile, sourceBase: number, sourceCount: number): void {
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

	private captureValuesIntoArrayFromRegisters(target: Value[], source: RegisterFile, sourceBase: number, sourceCount: number): void {
		target.length = sourceCount;
		for (let index = 0; index < sourceCount; index += 1) {
			target[index] = source.get(sourceBase + index);
		}
	}

	private writeReturnValues(frame: CallFrame, base: number, count: number, values: Value[]): void {
		if (count === 0) {
			for (let index = 0; index < values.length; index += 1) {
				this.setRegister(frame, base + index, values[index]);
			}
			frame.top = base + values.length;
			return;
		}
		for (let index = 0; index < count; index += 1) {
			const value = index < values.length ? values[index] : null;
			this.setRegister(frame, base + index, value);
		}
		frame.top = base + count;
	}

	private ensureRegisterCapacity(frame: CallFrame, index: number): RegisterFile {
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

	private copyRegisterFast(frame: CallFrame, registers: RegisterFile, dst: number, src: number): void {
		registers.copySlot(dst, src);
		this.bumpRegisterTop(frame, dst);
	}

	private setRegisterNilFast(frame: CallFrame, registers: RegisterFile, index: number): void {
		registers.setNil(index);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterBoolFast(frame: CallFrame, registers: RegisterFile, index: number, value: boolean): void {
		registers.setBool(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterNumberFast(frame: CallFrame, registers: RegisterFile, index: number, value: number): void {
		registers.setNumber(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterStringFast(frame: CallFrame, registers: RegisterFile, index: number, value: StringValue): void {
		registers.setString(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterTableFast(frame: CallFrame, registers: RegisterFile, index: number, value: Table): void {
		registers.setTable(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterClosureFast(frame: CallFrame, registers: RegisterFile, index: number, value: Closure): void {
		registers.setClosure(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterFast(frame: CallFrame, registers: RegisterFile, index: number, value: Value): void {
		registers.set(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegister(frame: CallFrame, index: number, value: Value): void {
		const registers = this.ensureRegisterCapacity(frame, index);
		this.setRegisterFast(frame, registers, index, value);
	}

	private writeMappedWordSequence(frame: CallFrame, addr: number, valueBase: number, valueCount: number): void {
		const faultSequence = this.memory.readBusFaultSequence();
		let writeAddr = addr;
		for (let offset = 0; offset < valueCount; offset += 1) {
			this.memory.writeMappedValue(writeAddr, frame.registers.get(valueBase + offset));
			if (this.memory.readBusFaultSequence() !== faultSequence) {
				this.enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
				return;
			}
			writeAddr += 4;
		}
	}

	private readRK(frame: CallFrame, rk: number): Value {
		if (rk < 0) {
			const index = -1 - rk;
			return frame.functionRecord.image.constPool[index];
		}
		return frame.registers.get(rk);
	}

	public callBuiltinFunction(fn: BuiltinFunction, args: ReadonlyArray<Value>, out: Value[]): void {
		const nativeArgs = this.acquireArrayNativeArgs(args);
		try {
			this.callBuiltinFunctionView(fn, nativeArgs, out);
		} finally {
			this.releaseArrayNativeArgs(nativeArgs);
		}
	}

	private callBuiltinFunctionView(fn: BuiltinFunction, args: NativeArgs, out: Value[]): void {
		out.length = 0;
		switch (fn.id) {
			case BuiltinFunctionId.Next:
				this.runBuiltinNextValue(args.get(0), args.get(1), out);
				break;
			case BuiltinFunctionId.Type:
				this.runBuiltinType(args.get(0), out);
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
			case BuiltinFunctionId.Error:
				this.runBuiltinError(args);
				break;
			case BuiltinFunctionId.PCall:
			case BuiltinFunctionId.XPCall:
				throw new Error('Protected calls execute as Lua CPU microcode.');
		}
	}

	private runBuiltinFunction(fn: BuiltinFunction, frame: CallFrame, callBase: number, returnCount: number, argCount: number): void {
		this.charge(fn.cost.base);
		if (fn.id === BuiltinFunctionId.PCall || fn.id === BuiltinFunctionId.XPCall) {
			this.startProtectedCall(fn.id, frame, callBase, returnCount, callBase + 1, argCount, false);
			return;
		}
		const nativeArgs = this.acquireRegisterNativeArgs();
		const results = this.nativeReturnScratch.acquire();
		try {
			nativeArgs.bind(frame.registers, callBase + 1, argCount);
			this.callBuiltinFunctionView(fn, nativeArgs, results);
			if (this.frames.length > 0 && this.frames[this.frames.length - 1] === frame) {
				this.writeReturnValues(frame, callBase, returnCount, results);
			}
		} finally {
			this.releaseRegisterNativeArgs(nativeArgs);
			this.nativeReturnScratch.release(results);
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
			const handler = argumentCount > 1 ? caller.registers.get(argumentBase + 1) : null;
			const handlerTag = valueTag(handler);
			if (handlerTag !== ValueTag.Closure
				&& handlerTag !== ValueTag.BuiltinFunction
				&& handlerTag !== ValueTag.NativeFunction) {
				throw new LuaExecutionError('xpcall error handler must be a function.', LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION);
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
			argumentCount > 0 ? caller.registers.get(argumentBase) : null,
			argumentBase + targetArgumentOffset,
			Math.max(argumentCount - targetArgumentOffset, 0),
		);
	}

	private invokeProtectedTarget(continuationIndex: number, target: Value, argumentBase: number, argumentCount: number): void {
		const continuation = this.protectedCallContinuations.peek(continuationIndex);
		const caller = continuation.caller!;
		switch (valueTag(target)) {
			case ValueTag.Closure:
				continuation.target = this.pushFrameFromCaller(
					caller,
					target as Closure,
					argumentBase,
					argumentCount,
					0,
					0,
					false,
					caller.pc - INSTRUCTION_BYTES,
				);
				return;
			case ValueTag.BuiltinFunction: {
				const builtinFunction = target as BuiltinFunction;
				this.charge(builtinFunction.cost.base);
				if (builtinFunction.id === BuiltinFunctionId.PCall || builtinFunction.id === BuiltinFunctionId.XPCall) {
					this.startProtectedCall(builtinFunction.id, caller, continuation.callBase, 0, argumentBase, argumentCount, true);
					return;
				}
				const nativeArgs = this.acquireRegisterNativeArgs();
				const results = this.nativeReturnScratch.acquire();
				try {
					nativeArgs.bind(caller.registers, argumentBase, argumentCount);
					this.callBuiltinFunctionView(builtinFunction, nativeArgs, results);
					this.finishProtectedCallFromArray(continuationIndex, results);
				} finally {
					this.releaseRegisterNativeArgs(nativeArgs);
					this.nativeReturnScratch.release(results);
				}
				return;
			}
			case ValueTag.NativeFunction: {
				const nativeFunction = target as NativeFunction;
				this.charge(nativeFunction.cost.base);
				const nativeArgs = this.acquireRegisterNativeArgs();
				const results = this.nativeReturnScratch.acquire();
				try {
					nativeArgs.bind(caller.registers, argumentBase, argumentCount);
					nativeFunction.invoke(nativeArgs, results);
					enforceLuaHeapBudget();
					this.finishProtectedCallFromArray(continuationIndex, results);
				} finally {
					this.releaseRegisterNativeArgs(nativeArgs);
					this.nativeReturnScratch.release(results);
				}
				return;
			}
			default:
				throw new LuaExecutionError('Attempted to call a non-function value.', LUA_FAULT_REASON_CALL_NON_FUNCTION);
		}
	}

	private finishProtectedCallFromArray(continuationIndex: number, values: Value[]): void {
		const continuation = this.protectedCallContinuations.peek(continuationIndex);
		if (continuation.kind === ProtectedCallKind.XPCallHandler) {
			this.finishProtectedCallWithError(continuationIndex, values.length > 0 ? values[0] : null);
			return;
		}
		const resultCount = this.writeProtectedResultsFromArray(continuation, true, values);
		this.finishProtectedContinuation(continuationIndex, resultCount);
	}

	private finishProtectedCallFromRegisters(continuationIndex: number, source: RegisterFile, sourceBase: number, sourceCount: number): void {
		const continuation = this.protectedCallContinuations.peek(continuationIndex);
		if (continuation.kind === ProtectedCallKind.XPCallHandler) {
			this.finishProtectedCallWithError(continuationIndex, sourceCount > 0 ? source.get(sourceBase) : null);
			return;
		}
		const resultCount = this.writeProtectedResultsFromRegisters(continuation, true, source, sourceBase, sourceCount);
		this.finishProtectedContinuation(continuationIndex, resultCount);
	}

	private finishProtectedCallWithError(continuationIndex: number, errorValue: Value): void {
		const continuation = this.protectedCallContinuations.peek(continuationIndex);
		const caller = continuation.caller!;
		const resultCount = continuation.returnCount === 0 ? 2 : continuation.returnCount;
		if (resultCount > 0) {
			const registers = this.ensureRegisterCapacity(caller, continuation.callBase + resultCount - 1);
			registers.setBool(continuation.callBase, false);
			if (resultCount > 1) {
				registers.set(continuation.callBase + 1, errorValue);
				for (let index = 2; index < resultCount; index += 1) {
					registers.setNil(continuation.callBase + index);
				}
			}
		}
		caller.top = continuation.callBase + resultCount;
		this.finishProtectedContinuation(continuationIndex, resultCount);
	}

	private writeProtectedResultsFromArray(continuation: ProtectedCallContinuation, prefix: boolean, values: Value[]): number {
		const caller = continuation.caller!;
		const resultCount = continuation.returnCount === 0 ? values.length + 1 : continuation.returnCount;
		if (resultCount > 0) {
			const registers = this.ensureRegisterCapacity(caller, continuation.callBase + resultCount - 1);
			registers.setBool(continuation.callBase, prefix);
			const copiedCount = Math.min(values.length, resultCount - 1);
			for (let index = 0; index < copiedCount; index += 1) {
				registers.set(continuation.callBase + index + 1, values[index]);
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
		source: RegisterFile,
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

	private handleProtectedCallError(error: unknown): boolean {
		let errorValue: Value;
		if (error instanceof LuaThrownValueError) {
			errorValue = error.value;
		} else if (error instanceof LuaExecutionError) {
			errorValue = StringValue.get(this.stringPool.intern(error.message));
		} else {
			return false;
		}

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
				const result = continuation.kind === ProtectedCallKind.XPCallHandler
					? StringValue.get(this.stringPool.intern('error in error handling'))
					: errorValue;
				this.finishProtectedCallWithError(continuationIndex, result);
				return true;
			}

			continuation.kind = ProtectedCallKind.XPCallHandler;
			continuation.target = null;
			const handler = caller.registers.get(continuation.handlerRegister);
			this.setRegister(caller, continuation.callBase, errorValue);
			try {
				this.invokeProtectedTarget(continuationIndex, handler, continuation.callBase, 1);
				return true;
			} catch (handlerError) {
				if (handlerError instanceof LuaThrownValueError) {
					errorValue = handlerError.value;
					continue;
				}
				if (handlerError instanceof LuaExecutionError) {
					errorValue = StringValue.get(this.stringPool.intern(handlerError.message));
					continue;
				}
				throw handlerError;
			}
		}
	}

	private runBuiltinNextValue(target: Value, keyValue: Value, out: Value[]): void {
		out.length = 0;
		switch (valueTag(target)) {
			case ValueTag.Table: {
				const entry = (target as Table).nextEntry(keyValue);
				if (entry === null) {
					out.push(null);
					return;
				}
				out.push(entry[0], entry[1]);
				return;
			}
			case ValueTag.NativeObject: {
				const entry = (target as NativeObject).nextEntry(keyValue);
				if (entry === null) {
					out.push(null);
					return;
				}
				out.push(entry[0], entry[1]);
				return;
			}
			default:
				throw new LuaExecutionError('Attempted to iterate a non-table value.', LUA_FAULT_REASON_ITERATE_NON_TABLE);
		}
	}

	private runBuiltinType(value: Value, out: Value[]): void {
		out.push(StringValue.get(this.stringPool.intern(valueTypeNameForLua(value))));
	}

	private runBuiltinSetMetatable(args: NativeArgs, out: Value[]): void {
		const target = args.get(0);
		const metatable = args.get(1) as Table | null;
		if (valueIsTable(target)) {
			target.metatable = metatable;
			out.push(target);
			return;
		}
		(target as NativeObject).metatable = metatable;
		out.push(target);
	}

	private runBuiltinGetMetatable(args: NativeArgs, out: Value[]): void {
		const target = args.get(0);
		if (valueIsTable(target)) {
			out.push(target.metatable);
			return;
		}
		out.push((target as NativeObject).metatable);
	}

	private runBuiltinRawGet(args: NativeArgs, out: Value[]): void {
		out.push((args.get(0) as Table).get(args.get(1)));
	}

	private runBuiltinRawSet(args: NativeArgs, out: Value[]): void {
		const target = args.get(0) as Table;
		target.set(args.get(1), args.get(2));
		out.push(target);
	}

	private runBuiltinSelect(args: NativeArgs, out: Value[]): void {
		const selector = args.get(0);
		const count = args.length - 1;
		if (valueIsString(selector) && this.stringPool.toString(asStringId(selector)) === '#') {
			out.push(count);
			return;
		}
		const startSelector = selector as number;
		const start = startSelector >= 0
			? startSelector
			: count + startSelector + 1;
		for (let index = start; index <= count; index += 1) {
			if (index >= 1 && index < args.length) {
				out.push(args.get(index));
			}
		}
	}

	private runBuiltinStringByte(args: NativeArgs, out: Value[]): void {
		const source = this.stringPool.toString(asStringId(args.get(0) as StringValue));
		let position = 1;
		if (args.length > 1) {
			const positionValue = args.get(1);
			if (positionValue !== null) {
				position = Math.trunc(positionValue as number);
			}
		}
		if (position < 1) {
			out.push(null);
			return;
		}
		let current = 1;
		for (const char of source) {
			if (current === position) {
				out.push(char.codePointAt(0) as number);
				return;
			}
			current += 1;
		}
		out.push(null);
	}

	private runBuiltinStringChar(args: NativeArgs, out: Value[]): void {
		let result = '';
		for (let index = 0; index < args.length; index += 1) {
			result += String.fromCodePoint(Math.trunc(args.get(index) as number));
		}
		out.push(StringValue.get(this.stringPool.intern(result)));
	}

	private runBuiltinError(args: NativeArgs): never {
		const value = args.get(0);
		throw new LuaThrownValueError(value, valueToString(value, this.stringPool));
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

		const captureValueState = (value: Value): CpuValueState => {
			switch (valueTag(value)) {
				case ValueTag.Nil:
					return { tag: 'nil' };
				case ValueTag.False:
					return { tag: 'false' };
				case ValueTag.True:
					return { tag: 'true' };
				case ValueTag.Number:
					return { tag: 'number', value: value as number };
				case ValueTag.String:
					return { tag: 'string', id: (value as StringValue).id };
				case ValueTag.BuiltinFunction:
					return { tag: 'builtin', id: (value as BuiltinFunction).id };
				case ValueTag.Table:
					return { tag: 'ref', id: ensureObjectId(value as Table, 'table') };
				case ValueTag.Closure:
					return { tag: 'ref', id: ensureObjectId(value as Closure, 'closure') };
				case ValueTag.NativeFunction:
				case ValueTag.NativeObject:
					throw new Error(`Runtime snapshot cannot preserve ${valueTypeName(value)} value.`);
			}
		};

		const captureObjectState = (object: Table | Closure | Upvalue, kind: CpuObjectState['kind']): CpuObjectState => {
			switch (kind) {
				case 'table': {
					const table = object as Table;
					const tableState = table.captureRuntimeState();
					const hash = new Array(tableState.hash.length);
					for (let index = 0; index < tableState.hash.length; index += 1) {
						const node = tableState.hash[index];
						hash[index] = {
							key: captureValueState(node.key),
							value: captureValueState(node.value),
							next: node.next,
						};
					}
					const array = new Array(tableState.array.length);
					for (let index = 0; index < tableState.array.length; index += 1) {
						array[index] = captureValueState(tableState.array[index]);
					}
					return {
						kind: 'table',
						hashId: table.hashId,
						array,
						arrayLength: tableState.arrayLength,
						hash,
						hashFree: tableState.hashFree,
						metatable: captureValueState(tableState.metatable),
					};
				}
				case 'upvalue': {
					const upvalue = object as Upvalue;
					let frameIndex = -1;
					let value = upvalue.value;
					if (upvalue.open) {
						frameIndex = this.frames.indexOf(upvalue.frame);
						value = upvalue.frame.registers.get(upvalue.index);
					}
					return {
						kind: 'upvalue',
						hashId: upvalue.hashId,
						open: upvalue.open,
						index: upvalue.index,
						frameIndex,
						value: captureValueState(value),
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
			const value = this.systemGlobalValues[slot];
			const tag = valueTag(value);
			if (tag === ValueTag.NativeFunction || tag === ValueTag.NativeObject) {
				continue;
			}
			systemGlobals.push({
				name: this.stringPool.toString(this.systemGlobalNames[slot]),
				value: captureValueState(value),
			});
		}

		const globals: CpuRootValueState[] = [];
		this.globals.forEachEntry((key, value) => {
			if (!valueIsString(key)) {
				return;
			}
			const tag = valueTag(value);
			if (tag === ValueTag.NativeFunction || tag === ValueTag.NativeObject) {
				return;
			}
			globals.push({
				name: this.stringPool.toString(asStringId(key)),
				value: captureValueState(value),
			});
		});

		const frames = new Array<CpuFrameState>(this.frames.length);
		for (let frameIndex = 0; frameIndex < this.frames.length; frameIndex += 1) {
			const frame = this.frames[frameIndex];
			const registers = new Array<CpuValueState>(frame.top);
			for (let registerIndex = 0; registerIndex < frame.top; registerIndex += 1) {
				registers[registerIndex] = captureValueState(frame.registers.get(registerIndex));
			}
			const varargs = new Array<CpuValueState>(frame.varargCount);
			for (let varargIndex = 0; varargIndex < frame.varargCount; varargIndex += 1) {
				varargs[varargIndex] = captureValueState(this.stackRegisters.get(frame.varargBase + varargIndex));
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

		const completionValues = new Array<CpuValueState>(this.completionValues.length);
		for (let index = 0; index < this.completionValues.length; index += 1) {
			completionValues[index] = captureValueState(this.completionValues[index]);
		}

		const openUpvalues = new Array<number>(this.openUpvalues.length);
		for (let index = 0; index < this.openUpvalues.length; index += 1) {
			openUpvalues[index] = ensureObjectId(this.openUpvalues[index].upvalue, 'upvalue');
		}

		return {
			executionCartridgeSlot: this.activeExecutionImage.executionDomainId,
			systemGlobals,
			globals,
			frames,
			protectedCalls,
			completionValues,
			objects,
			openUpvalues,
			lastExecutionDomainId: this.lastExecutionDomainId,
			lastPc: this.lastPc,
			instructionBudgetRemaining: this.instructionBudgetRemaining,
			haltedUntilIrq: this.haltedUntilIrq,
			interruptEventPending: this.interruptEventPending,
			memoryWriteBlocked: this.memoryWriteBlocked,
			memoryWriteBlockedAddress: this.memoryWriteBlockedAddress,
			statusWord: this.statusWord,
			causeWord: this.causeWord,
			epcWord: this.epcWord,
			badAddressWord: this.badAddressWord,
			luaFaultReasonWord: this.luaFaultReasonWord,
			nmiReturnCauseWord: this.nmiReturnCauseWord,
			nmiReturnEpcWord: this.nmiReturnEpcWord,
			nmiReturnBadAddressWord: this.nmiReturnBadAddressWord,
			nmiReturnLuaFaultReasonWord: this.nmiReturnLuaFaultReasonWord,
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
					const table = new Table(0, 0);
					table.hashId = objectState.hashId;
					restoredObjects[index] = table;
					break;
				}
				case 'closure': {
					const upvalues = new Array<Upvalue>(objectState.upvalues.length);
					if (objectState.canonical) {
						const closure = this.staticClosuresByAddress.get(objectState.functionAddress)!;
						closure.hashId = objectState.hashId;
						restoredObjects[index] = closure;
					} else {
						const heapBytes = CLOSURE_HEAP_BYTES + (upvalues.length * CLOSURE_UPVALUE_SLOT_HEAP_BYTES);
						addTrackedLuaHeapBytes(heapBytes);
						const closure = new Closure(objectState.functionAddress, upvalues, heapBytes);
						closure.hashId = objectState.hashId;
						restoredObjects[index] = closure;
					}
					break;
				}
				case 'upvalue':
					addTrackedLuaHeapBytes(UPVALUE_HEAP_BYTES);
					restoredObjects[index] = { hashId: objectState.hashId, open: false, index: objectState.index, frame: null, value: null };
					break;
			}
		}
		this.observeObjectHashId(maxRestoredHashId);

		const restoreValue = (valueState: CpuValueState): Value => {
			switch (valueState.tag) {
				case 'nil':
					return null;
				case 'false':
					return false;
				case 'true':
					return true;
				case 'number':
					return valueState.value;
				case 'string':
					return StringValue.get(valueState.id);
				case 'builtin':
					return createBuiltinFunction(valueState.id);
				case 'ref':
					return restoredObjects[valueState.id] as Table | Closure;
			}
		};

		for (let index = 0; index < state.objects.length; index += 1) {
			const objectState = state.objects[index];
			switch (objectState.kind) {
				case 'table': {
					const table = restoredObjects[index] as Table;
					table.restoreRuntimeState({
						array: objectState.array.map(restoreValue),
						arrayLength: objectState.arrayLength,
						hash: objectState.hash.map(node => ({
							key: restoreValue(node.key),
							value: restoreValue(node.value),
							next: node.next,
						})),
						hashFree: objectState.hashFree,
						metatable: restoreValue(objectState.metatable) as Table | null,
					});
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
					upvalue.value = objectState.open ? null : restoreValue(objectState.value);
					break;
				}
			}
		}

		this.completionValues.length = 0;
		this.clearCallStack();
		this.globals.clear();
		this.activeExecutionImage = executionImage;
		this.systemGlobalValues.fill(null);
		this.globalValues.fill(null);

		for (let frameIndex = 0; frameIndex < state.frames.length; frameIndex += 1) {
			const frameState = state.frames[frameIndex];
			const functionRecord = this.functionRecordInExecutionDomain(executionImage, frameState.functionAddress)!;
			const frame = this.acquireFrame();
			frame.functionAddress = frameState.functionAddress;
			frame.functionRecord = functionRecord;
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
				registers.set(registerIndex, restoreValue(frameState.registers[registerIndex]));
			}
			for (let varargIndex = 0; varargIndex < frameState.varargs.length; varargIndex += 1) {
				this.stackRegisters.set(frame.varargBase + varargIndex, restoreValue(frameState.varargs[varargIndex]));
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
			upvalue.value = null;
			this.openUpvalues.push({ frame, index: upvalue.index, upvalue });
		}

		for (let index = 0; index < state.systemGlobals.length; index += 1) {
			const entry = state.systemGlobals[index];
			this.setSystemGlobalByKey(StringValue.get(this.stringPool.intern(entry.name)), restoreValue(entry.value));
		}
		for (let index = 0; index < state.globals.length; index += 1) {
			const entry = state.globals[index];
			this.setGlobalByKey(StringValue.get(this.stringPool.intern(entry.name)), restoreValue(entry.value));
		}
		for (let index = 0; index < state.completionValues.length; index += 1) {
			this.completionValues[index] = restoreValue(state.completionValues[index]);
		}
		this.lastExecutionDomainId = state.lastExecutionDomainId;
		this.lastPc = state.lastPc;
		this.instructionBudgetRemaining = state.instructionBudgetRemaining;
		this.haltedUntilIrq = state.haltedUntilIrq;
		this.interruptEventPending = state.interruptEventPending;
		this.memoryWriteBlocked = state.memoryWriteBlocked;
		this.memoryWriteBlockedAddress = state.memoryWriteBlockedAddress;
		this.statusWord = state.statusWord;
		this.causeWord = state.causeWord;
		this.epcWord = state.epcWord;
		this.badAddressWord = state.badAddressWord;
		this.luaFaultReasonWord = state.luaFaultReasonWord;
		this.nmiReturnCauseWord = state.nmiReturnCauseWord;
		this.nmiReturnEpcWord = state.nmiReturnEpcWord;
		this.nmiReturnBadAddressWord = state.nmiReturnBadAddressWord;
		this.nmiReturnLuaFaultReasonWord = state.nmiReturnLuaFaultReasonWord;
		this.nonMaskableInterruptPending = state.nonMaskableInterruptPending;
		this.yieldRequested = state.yieldRequested;
		refreshTrackedLuaHeapBytes();
	}

	public collectTrackedHeapBytes(extraRoots: ReadonlyArray<Value> = []): number {
		const seen = new WeakSet<object>();
		const seenImages = new WeakSet<object>();
		let total = 0;
		const valueStack: Value[] = [];
		const upvalueStack: Upvalue[] = [];
		this.stringPool.beginReachabilityEpoch();
		if (this.indexKey !== null) {
			this.stringPool.markReachable(asStringId(this.indexKey));
		}

		const pushValue = (value: Value): void => {
			switch (valueTag(value)) {
				case ValueTag.Nil:
				case ValueTag.False:
				case ValueTag.True:
				case ValueTag.Number:
					return;
				case ValueTag.String:
					this.stringPool.markReachable(asStringId(value as StringValue));
					return;
				default:
					valueStack.push(value);
			}
		};
		const pushImage = (image: Blua32ExecutionImage): void => {
			if (seenImages.has(image)) {
				return;
			}
			seenImages.add(image);
			for (let index = 0; index < image.constPool.length; index += 1) {
				pushValue(image.constPool[index]);
			}
		};

		pushValue(this.globals);
		for (let slot = 0; slot < this.systemGlobalValues.length; slot += 1) {
			pushValue(this.systemGlobalValues[slot]);
		}
		for (let slot = 0; slot < this.globalValues.length; slot += 1) {
			pushValue(this.globalValues[slot]);
		}
		pushValue(this.stringIndexTable);
		this.memory.collectRootValues(pushValue);
		for (let index = 0; index < this.completionValues.length; index += 1) {
			pushValue(this.completionValues[index]);
		}
		for (let index = 0; index < this.executionImages.length; index += 1) {
			pushImage(this.executionImages[index]);
		}
		for (let frameIndex = 0; frameIndex < this.frames.length; frameIndex += 1) {
			const frame = this.frames[frameIndex];
			pushImage(frame.functionRecord.image);
			pushValue(frame.closure);
			for (let registerIndex = 0; registerIndex < frame.top; registerIndex += 1) {
				pushValue(frame.registers.get(registerIndex));
			}
			for (let index = 0; index < frame.varargCount; index += 1) {
				pushValue(this.stackRegisters.get(frame.varargBase + index));
			}
		}
		for (let index = 0; index < this.openUpvalues.length; index += 1) {
			upvalueStack.push(this.openUpvalues[index].upvalue);
		}
		for (let index = 0; index < extraRoots.length; index += 1) {
			pushValue(extraRoots[index]);
		}
		while (valueStack.length > 0 || upvalueStack.length > 0) {
			if (upvalueStack.length > 0) {
				const upvalue = upvalueStack.pop()!;
				if (seen.has(upvalue)) {
					continue;
				}
				seen.add(upvalue);
				total += UPVALUE_HEAP_BYTES;
				if (upvalue.open) {
					pushValue(upvalue.frame.registers.get(upvalue.index));
				}
				else {
					pushValue(upvalue.value);
				}
				continue;
			}
			const value = valueStack.pop()!;
			switch (valueTag(value)) {
				case ValueTag.Table: {
					const table = value as Table;
					if (seen.has(table)) {
						continue;
					}
					seen.add(table);
					total += table.getTrackedHeapBytes();
					table.walkTrackedValues(pushValue);
					continue;
				}
				case ValueTag.BuiltinFunction: {
					const builtinFunction = value as BuiltinFunction;
					if (seen.has(builtinFunction)) {
						continue;
					}
					seen.add(builtinFunction);
					continue;
				}
				case ValueTag.NativeFunction: {
					const nativeFunction = value as NativeFunction;
					if (seen.has(nativeFunction)) {
						continue;
					}
					seen.add(nativeFunction);
					total += NATIVE_FUNCTION_HEAP_BYTES;
					continue;
				}
				case ValueTag.NativeObject: {
					const nativeObject = value as NativeObject;
					if (seen.has(nativeObject)) {
						continue;
					}
					seen.add(nativeObject);
					total += NATIVE_OBJECT_HEAP_BYTES;
					if (nativeObject.metatable !== null) {
						pushValue(nativeObject.metatable);
					}
					continue;
				}
				case ValueTag.Closure: {
					const closure = value as Closure;
					if (seen.has(closure)) {
						continue;
					}
					seen.add(closure);
					total += closure.heapBytes;
					for (let index = 0; index < closure.upvalues.length; index += 1) {
						upvalueStack.push(closure.upvalues[index]);
					}
					continue;
				}
				default:
					continue;
			}
		}
		this.stringPool.reclaimUnreachableTracked();
		total += this.stringPool.trackedLuaHeapBytes();
		return total;
	}

}

// end normalized-body-acceptable
// end repeated-sequence-acceptable
