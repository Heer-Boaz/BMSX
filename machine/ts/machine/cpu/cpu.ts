import { StringPool, type StringId } from './string_pool';
import type { Memory } from '../memory/memory';
import type { IrqController } from '../devices/irq/controller';
import {
	addTrackedLuaHeapBytes,
	collectTrackedLuaHeapBytes as refreshTrackedLuaHeapBytes,
	enforceLuaHeapBudget
} from '../memory/lua_heap_usage';
import { formatNumber } from '../common/number_format';
import { BASE_CYCLES, OPCODE_USES_BX, OPCODE_USES_DISP, OpCode } from './opcode_info';
import { CpuExecutionProfiler, formatCpuProfilerReport, type CpuProfilerReportOptions } from './profiler';
import { EXT_A_BITS, EXT_B_BITS, EXT_BX_BITS, EXT_C_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_OPERAND_BITS, readInstructionWord, signExtend } from './instruction_format';
import { MEMORY_ACCESS_KIND_NAMES, MemoryAccessKind } from '../memory/access_kind';
import { ScratchBuffer } from '../../common/scratchbuffer';
import { ScratchArrayStack } from '../../common/scratchstack';
import { luaModulo } from '../../lua/numeric';
import { ceilDiv4, ceilLog2, nextPowerOfTwo } from '../common/numeric';

export { OpCode } from './opcode_info';

// start repeated-sequence-acceptable -- Lua VM/table/register hot paths deliberately keep short copy/update sequences inline.
// start normalized-body-acceptable -- Specialized Lua VM accessors stay split so the fast paths avoid dispatch helpers.

const STRING_VALUE_KIND = 'string_value';
const TABLE_VALUE_KIND = 'table';

export class StringValue {
	public readonly kind = STRING_VALUE_KIND;
	public readonly id: StringId;

	private constructor(id: StringId) {
		this.id = id;
	}

	public static get(id: StringId): StringValue {
		let value = STRING_VALUES[id];
		if (value === undefined) {
			value = new StringValue(id);
			STRING_VALUES[id] = value;
		}
		return value;
	}
}

const STRING_VALUES: StringValue[] = [];

export type Value = null | boolean | number | StringValue | Table | Closure | BuiltinFunction | NativeFunction | NativeObject;
export const EMPTY_CALL_ARGS: ReadonlyArray<Value> = [];

export function valueIsString(value: unknown): value is StringValue {
	return value !== null
		&& value !== undefined
		&& (value as { readonly kind?: string }).kind === STRING_VALUE_KIND;
}

export function asStringId(value: StringValue): StringId {
	return value.id;
}

export const isTruthyValue = (value: Value): boolean => value !== null && value !== false;

export type SourcePosition = {
	line: number;
	column: number;
};

export type SourceRange = {
	path: string;
	start: SourcePosition;
	end: SourcePosition;
};

export type LocalSlotDebug = {
	name: string;
	register: number;
	definition: SourceRange;
	scope: SourceRange;
};

const BUILTIN_FUNCTION_KIND = 'builtin_function';
const NATIVE_FUNCTION_KIND = 'native_function';
const NATIVE_OBJECT_KIND = 'native_object';

export type NativeFnCost = {
	base: number;
	perArg: number;
	perRet: number;
};

export const enum BuiltinFunctionId {
	Next,
	Type,
	SetMetatable,
	GetMetatable,
	RawGet,
	RawSet,
	Select,
	StringByte,
	StringChar,
	Error,
	PCall,
	XPCall,
}

export class LuaThrownValueError extends Error {
	public readonly value: Value;

	public constructor(value: Value, message: string) {
		super(message);
		this.name = 'LuaThrownValueError';
		this.value = value;
	}
}

export type BuiltinFunction = {
	readonly kind: typeof BUILTIN_FUNCTION_KIND;
	readonly id: BuiltinFunctionId;
	readonly name: string;
	readonly cost: NativeFnCost;
};

const BUILTIN_COST_TIER1: NativeFnCost = { base: 1, perArg: 0, perRet: 0 };
const BUILTIN_COST_TIER2: NativeFnCost = { base: 2, perArg: 0, perRet: 0 };
const BUILTIN_COST_TIER4: NativeFnCost = { base: 4, perArg: 0, perRet: 0 };
const BUILTIN_FUNCTION_HEAP_BYTES = 16;

export function createBuiltinFunction(id: BuiltinFunctionId): BuiltinFunction {
	addTrackedLuaHeapBytes(BUILTIN_FUNCTION_HEAP_BYTES);
	switch (id) {
		case BuiltinFunctionId.Next:
			return { kind: BUILTIN_FUNCTION_KIND, id, name: 'next', cost: BUILTIN_COST_TIER1 };
		case BuiltinFunctionId.Type:
			return { kind: BUILTIN_FUNCTION_KIND, id, name: 'type', cost: BUILTIN_COST_TIER1 };
		case BuiltinFunctionId.SetMetatable:
			return { kind: BUILTIN_FUNCTION_KIND, id, name: 'setmetatable', cost: BUILTIN_COST_TIER2 };
		case BuiltinFunctionId.GetMetatable:
			return { kind: BUILTIN_FUNCTION_KIND, id, name: 'getmetatable', cost: BUILTIN_COST_TIER2 };
		case BuiltinFunctionId.RawGet:
			return { kind: BUILTIN_FUNCTION_KIND, id, name: 'rawget', cost: BUILTIN_COST_TIER1 };
		case BuiltinFunctionId.RawSet:
			return { kind: BUILTIN_FUNCTION_KIND, id, name: 'rawset', cost: BUILTIN_COST_TIER1 };
		case BuiltinFunctionId.Select:
			return { kind: BUILTIN_FUNCTION_KIND, id, name: 'select', cost: BUILTIN_COST_TIER1 };
		case BuiltinFunctionId.StringByte:
			return { kind: BUILTIN_FUNCTION_KIND, id, name: 'string.byte', cost: BUILTIN_COST_TIER2 };
		case BuiltinFunctionId.StringChar:
			return { kind: BUILTIN_FUNCTION_KIND, id, name: 'string.char', cost: BUILTIN_COST_TIER2 };
		case BuiltinFunctionId.Error:
			return { kind: BUILTIN_FUNCTION_KIND, id, name: 'error', cost: BUILTIN_COST_TIER2 };
		case BuiltinFunctionId.PCall:
			return { kind: BUILTIN_FUNCTION_KIND, id, name: 'pcall', cost: BUILTIN_COST_TIER4 };
		case BuiltinFunctionId.XPCall:
			return { kind: BUILTIN_FUNCTION_KIND, id, name: 'xpcall', cost: BUILTIN_COST_TIER4 };
	}
}

export type NativeFunction = {
	readonly kind: typeof NATIVE_FUNCTION_KIND;
	readonly name: string;
	invoke(args: NativeArgs, out: Value[]): void;
	readonly cost: NativeFnCost;
};

export type NativeArgs = ReadonlyArray<Value>;

export type NativeObject = {
	readonly kind: typeof NATIVE_OBJECT_KIND;
	readonly raw: object;
	get(key: Value): Value;
	set(key: Value, value: Value): void;
	len?: () => number;
	nextEntry?: (after: Value) => [Value, Value] | null;
	metatable: Table | null;
};

function valueTypeName(value: Value): string {
	if (value === null) return 'nil';
	if (typeof value === 'boolean') return 'boolean';
	if (typeof value === 'number') return 'number';
	if (valueIsString(value)) return 'string';
	if (value instanceof Table) return 'table';
	if (isBuiltinFunction(value)) return 'builtin_function';
	if (isNativeFunction(value)) return 'native_function';
	if (isNativeObject(value)) return 'native_object';
	return 'closure';
}

const DEFAULT_NATIVE_COST: NativeFnCost = { base: 1, perArg: 0, perRet: 0 };

const TABLE_HEAP_BYTES = 32;
const TABLE_ARRAY_SLOT_HEAP_BYTES = 8;
const TABLE_HASH_SLOT_HEAP_BYTES = 20;
const CLOSURE_HEAP_BYTES = 16;
const CLOSURE_UPVALUE_SLOT_HEAP_BYTES = 8;
const NATIVE_FUNCTION_HEAP_BYTES = 16;
const NATIVE_OBJECT_HEAP_BYTES = 24;
const UPVALUE_HEAP_BYTES = 24;
const EMPTY_TABLE_HASH_NEXT = new Int32Array(0);

export function createNativeFunction(
	name: string,
	invoke: (args: ReadonlyArray<Value>, out: Value[]) => void,
	cost?: NativeFnCost,
): NativeFunction {
	const resolvedCost = cost ?? DEFAULT_NATIVE_COST;
	addTrackedLuaHeapBytes(NATIVE_FUNCTION_HEAP_BYTES);
	return {
		kind: NATIVE_FUNCTION_KIND,
		name,
		cost: resolvedCost,
		// Keep diagnostics aligned with the C++ runtime when native calls receive wrong arg types.
		invoke: (args, out) => {
			out.length = 0;
			try {
				invoke(args, out);
			} catch (err) {
				if (err instanceof TypeError) {
					const argTypes = args.map(valueTypeName).join(', ');
					err.message = `Native function argument type mismatch. fn=${name} args=[${argTypes}] error=${err.message}`;
				}
				throw err;
			}
		},
	};
}

export function createNativeObject(raw: object, handlers: {
	get: (key: Value) => Value;
	set: (key: Value, value: Value) => void;
	len?: () => number;
	nextEntry?: (after: Value) => [Value, Value] | null;
}): NativeObject {
	addTrackedLuaHeapBytes(NATIVE_OBJECT_HEAP_BYTES);
	return { kind: NATIVE_OBJECT_KIND, raw, get: handlers.get, set: handlers.set, len: handlers.len, nextEntry: handlers.nextEntry, metatable: null };
}

export function isBuiltinFunction(value: Value): value is BuiltinFunction {
	return (value as BuiltinFunction)?.kind === BUILTIN_FUNCTION_KIND;
}

export function isNativeFunction(value: Value): value is NativeFunction {
	return (value as NativeFunction)?.kind === NATIVE_FUNCTION_KIND;
}

export function isNativeObject(value: Value): value is NativeObject {
	return (value as NativeObject)?.kind === NATIVE_OBJECT_KIND;
}

export type ProgramRuntimeSymbols = {
	protoIds: string[];
	globalNames: string[];
	systemGlobalNames: string[];
	// BLua module exports: maps a module export slot name (e.g. "foo__update") to the
	// proto id of the exported function, but ONLY for static closures (no upvalues).
	// The linker uses this to resolve an export reference directly to that proto (a
	// link-time symbol / static closure) instead of a runtime global-slot load.
	exportProtoIdBySlot: { [slotName: string]: string };
};

export type ProgramMetadata = ProgramRuntimeSymbols & {
	debugRanges: ReadonlyArray<SourceRange | null>;
	localSlotsByProto: ReadonlyArray<ReadonlyArray<LocalSlotDebug>>;
	upvalueNamesByProto: ReadonlyArray<ReadonlyArray<string>>;
};

export type CpuFrameSnapshot = {
	protoIndex: number;
	pc: number;
	registers: Value[];
};

export type CpuRuntimeRefSegment = string | number;

const CPU_RUNTIME_METATABLE_SEGMENT = '@metatable';
export type CpuValueState =
	| { tag: 'nil' }
	| { tag: 'false' }
	| { tag: 'true' }
	| { tag: 'number'; value: number }
	| { tag: 'string'; id: number }
	| { tag: 'ref'; id: number }
	| { tag: 'stable_ref'; path: CpuRuntimeRefSegment[] };

export type CpuObjectState =
	| {
		kind: 'table';
		array: CpuValueState[];
		arrayLength: number;
		hash: Array<{ key: CpuValueState; value: CpuValueState; next: number }>;
		hashFree: number;
		metatable: CpuValueState;
	}
	| {
		kind: 'closure';
		protoIndex: number;
		upvalues: number[];
	}
	| {
		kind: 'upvalue';
		open: boolean;
		index: number;
		frameIndex: number;
		value: CpuValueState;
	};

export type CpuFrameState = {
	protoIndex: number;
	pc: number;
	closureRef: number;
	registers: CpuValueState[];
	varargs: CpuValueState[];
	returnBase: number;
	returnCount: number;
	top: number;
	captureReturns: boolean;
	callSitePc: number;
	isInterruptFrame: boolean;
	savedMaskableEnabled: boolean;
};

export type CpuRootValueState = {
	name: string;
	value: CpuValueState;
};

export type CpuRuntimeState = {
	globals: CpuRootValueState[];
	moduleCache: CpuRootValueState[];
	frames: CpuFrameState[];
	lastReturnValues: CpuValueState[];
	objects: CpuObjectState[];
	openUpvalues: number[];
	lastPc: number;
	lastInstruction: number;
	instructionBudgetRemaining: number;
	haltedUntilIrq: boolean;
	maskableInterruptsEnabled: boolean;
	maskableInterruptsRestoreEnabled: boolean;
	nonMaskableInterruptPending: boolean;
	yieldRequested: boolean;
};

export const enum AcceptedInterruptKind {
	None,
	Maskable,
	NonMaskable,
}

export type Program = {
	code: Uint8Array;
	programRom: Uint8Array;
	programRomTextByteLength: number;
	constPool: Value[];
	protos: Proto[];
	moduleProtos: ProgramModuleProto[];
	moduleExports: ProgramModuleExport[];
	moduleProtoMap: Map<string, number>;
	stringPool: StringPool;
	constPoolStringPool: StringPool;
};

export type ProgramModuleProto = {
	path: string;
	protoIndex: number;
};

export type ProgramModuleExport = {
	path: string;
	exportPathKey: string;
	slotName: string;
};

export type Proto = {
	entryPC: number;
	codeLen: number;
	numParams: number;
	isVararg: boolean;
	maxStack: number;
	upvalueDescs: UpvalueDesc[];
	staticClosure: boolean;
};

export type UpvalueDesc = {
	inStack: boolean;
	index: number;
};

export type Closure = {
	protoIndex: number;
	upvalues: Upvalue[];
	heapBytes?: number;
};

export function valueIsClosure(value: Value): value is Closure {
	return value !== null && value !== undefined && (value as Closure).protoIndex !== undefined;
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

type Upvalue = {
	open: boolean;
	index: number;
	frame: CallFrame;
	value: Value;
};

const EMPTY_CLOSURE_UPVALUES: Upvalue[] = [];

type OpenUpvalueSlot = {
	frame: CallFrame;
	index: number;
	upvalue: Upvalue;
};

type CallFrame = {
	protoIndex: number;
	pc: number;
	varargBase: number;
	varargCount: number;
	stackBase: number;
	stackCapacity: number;
	registers: RegisterFile;
	closure: Closure;
	returnBase: number;
	returnCount: number;
	top: number;
	captureReturns: boolean;
	callSitePc: number;
	isInterruptFrame: boolean;
	savedMaskableEnabled: boolean;
};

type HashNode = {
	key: Value;
	value: Value;
	next: number;
};

export type TableRuntimeState = {
	array: Value[];
	arrayLength: number;
	hash: HashNode[];
	hashFree: number;
	metatable: Table | null;
};

export class Table {
	public readonly kind = TABLE_VALUE_KIND;
	private array: Value[];
	public arrayLength = 0;
	private hashKeys: Value[];
	private hashValues: Value[];
	private hashNext: Int32Array;
	private hashFree = -1;
	private tableMetatable: Table | null = null;
	private version = 1;

	private static readonly numberBuffer = new ArrayBuffer(8);
	private static readonly float64View = new Float64Array(Table.numberBuffer);
	private static readonly uint32View = new Uint32Array(Table.numberBuffer);
	private static readonly objectIds = new WeakMap<object, number>();
	private static nextObjectId = 1;

	public static [Symbol.hasInstance](value: unknown): boolean {
		return value !== null
			&& value !== undefined
			&& (value as { readonly kind?: string }).kind === TABLE_VALUE_KIND;
	}

	constructor(arraySize: number, hashSize: number) {
		this.array = new Array<Value>(arraySize);
		this.array.fill(null);
		const size = hashSize > 0 ? nextPowerOfTwo(hashSize) : 0;
		this.hashKeys = new Array<Value>(size);
		this.hashKeys.fill(null);
		this.hashValues = new Array<Value>(size);
		this.hashValues.fill(null);
		this.hashNext = new Int32Array(size);
		this.hashNext.fill(-1);
		this.hashFree = size > 0 ? size - 1 : -1;
		addTrackedLuaHeapBytes(this.getTrackedHeapBytes());
	}

	public get metatable(): Table | null {
		return this.tableMetatable;
	}

	public set metatable(metatable: Table | null) {
		this.tableMetatable = metatable;
		this.bumpVersion();
	}

	public get(key: Value): Value {
		if (key === null) {
			throw new Error('Table index is nil.');
		}
		const index = this.getArrayIndex(key);
		if (index !== null && index < this.array.length) {
			return this.array[index];
		}
		const nodeIndex = this.findNodeIndex(key);
		if (nodeIndex >= 0) {
			return this.hashValues[nodeIndex];
		}
		return null;
	}

	public set(key: Value, value: Value): void {
		if (key === null) {
			throw new Error('Table index is nil.');
		}
		const index = this.getArrayIndex(key);
		if (index !== null) {
			if (index < this.array.length) {
				if (value === null) {
					this.array[index] = value;
					if (index < this.arrayLength) {
						this.arrayLength = index;
					}
					this.bumpVersion();
					return;
				}
				this.array[index] = value;
				if (index === this.arrayLength) {
					this.updateArrayLengthFrom(this.arrayLength);
				}
				this.bumpVersion();
				return;
			}
			if (value === null) {
				this.removeFromHash(key);
				if (index < this.arrayLength) {
					this.arrayLength = index;
				}
				this.bumpVersion();
				return;
			}
			const nodeIndex = this.findNodeIndex(key);
			if (nodeIndex >= 0) {
				this.hashValues[nodeIndex] = value;
				this.bumpVersion();
				return;
			}
			if (this.hashKeys.length === 0 || this.hashFree < 0) {
				this.rehash(key);
			}
			this.rawSet(key, value);
			this.bumpVersion();
			return;
		}
		if (value === null) {
			this.removeFromHash(key);
			this.bumpVersion();
			return;
		}
		const nodeIndex = this.findNodeIndex(key);
		if (nodeIndex >= 0) {
			this.hashValues[nodeIndex] = value;
			this.bumpVersion();
			return;
		}
		if (this.hashKeys.length === 0 || this.hashFree < 0) {
			this.rehash(key);
		}
		this.rawSet(key, value);
		this.bumpVersion();
	}

	public getInteger(indexValue: number): Value {
		const index = indexValue - 1;
		if (index >= 0 && index < this.array.length) {
			return this.array[index];
		}
		const nodeIndex = this.findNodeIndex(indexValue);
		if (nodeIndex >= 0) {
			return this.hashValues[nodeIndex];
		}
		return null;
	}

	public setInteger(indexValue: number, value: Value): void {
		const index = indexValue - 1;
		if (index >= 0 && index < this.array.length) {
			if (value === null) {
				this.array[index] = value;
				if (index < this.arrayLength) {
					this.arrayLength = index;
				}
				this.bumpVersion();
				return;
			}
			this.array[index] = value;
			if (index === this.arrayLength) {
				this.updateArrayLengthFrom(this.arrayLength);
			}
			this.bumpVersion();
			return;
		}
		if (value === null) {
			this.removeFromHash(indexValue);
			if (index >= 0 && index < this.arrayLength) {
				this.arrayLength = index;
			}
			this.bumpVersion();
			return;
		}
		const nodeIndex = this.findNodeIndex(indexValue);
		if (nodeIndex >= 0) {
			this.hashValues[nodeIndex] = value;
			this.bumpVersion();
			return;
		}
		if (this.hashKeys.length === 0 || this.hashFree < 0) {
			this.rehash(indexValue);
		}
		this.rawSet(indexValue, value);
		this.bumpVersion();
	}

	public getStringKey(key: StringValue): Value {
		const nodeIndex = this.findNodeIndex(key);
		if (nodeIndex >= 0) {
			return this.hashValues[nodeIndex];
		}
		return null;
	}

	public setStringKey(key: StringValue, value: Value): void {
		if (value === null) {
			this.removeFromHash(key);
			this.bumpVersion();
			return;
		}
		const nodeIndex = this.findNodeIndex(key);
		if (nodeIndex >= 0) {
			this.hashValues[nodeIndex] = value;
			this.bumpVersion();
			return;
		}
		if (this.hashKeys.length === 0 || this.hashFree < 0) {
			this.rehash(key);
		}
		this.rawSet(key, value);
		this.bumpVersion();
	}

	public clear(): void {
		const previousBytes = this.getTrackedHeapBytes();
		this.array.length = 0;
		this.arrayLength = 0;
		this.hashKeys.length = 0;
		this.hashValues.length = 0;
		this.hashNext = EMPTY_TABLE_HASH_NEXT;
		this.hashFree = -1;
		this.bumpVersion();
		addTrackedLuaHeapBytes(this.getTrackedHeapBytes() - previousBytes);
	}

	public forEachEntry(visitor: (key: Value, value: Value) => void): void {
		for (let index = 0; index < this.array.length; index += 1) {
			const value = this.array[index];
			if (value === null) {
				continue;
			}
			visitor(index + 1, value);
		}
		for (let index = 0; index < this.hashKeys.length; index += 1) {
			const key = this.hashKeys[index];
			if (key !== null) {
				visitor(key, this.hashValues[index]);
			}
		}
	}

	public getVersion(): number {
		return this.version;
	}

	public captureRuntimeState(): TableRuntimeState {
		const array = this.array.slice();
		const hash: HashNode[] = new Array(this.hashKeys.length);
		for (let index = 0; index < this.hashKeys.length; index += 1) {
			hash[index] = { key: this.hashKeys[index], value: this.hashValues[index], next: this.hashNext[index] };
		}
		return {
			array,
			arrayLength: this.arrayLength,
			hash,
			hashFree: this.hashFree,
			metatable: this.tableMetatable,
		};
	}

	public restoreRuntimeState(state: TableRuntimeState): void {
		const previousBytes = this.getTrackedHeapBytes();
		this.array = state.array.slice();
		this.arrayLength = state.arrayLength;
		this.hashKeys = new Array<Value>(state.hash.length);
		this.hashValues = new Array<Value>(state.hash.length);
		this.hashNext = new Int32Array(state.hash.length);
		for (let index = 0; index < state.hash.length; index += 1) {
			const node = state.hash[index];
			this.hashKeys[index] = node.key;
			this.hashValues[index] = node.value;
			this.hashNext[index] = node.next;
		}
		this.hashFree = state.hashFree;
		this.tableMetatable = state.metatable;
		this.bumpVersion();
		addTrackedLuaHeapBytes(this.getTrackedHeapBytes() - previousBytes);
	}

	public walkTrackedValues(visitor: (value: Value) => void): void {
		visitor(this.tableMetatable);
		for (let index = 0; index < this.array.length; index += 1) {
			const value = this.array[index];
			if (value !== null) {
				visitor(value);
			}
		}
		for (let index = 0; index < this.hashKeys.length; index += 1) {
			visitor(this.hashKeys[index]);
			visitor(this.hashValues[index]);
		}
	}

	public getTrackedHeapBytes(): number {
		return TABLE_HEAP_BYTES
			+ (this.array.length * TABLE_ARRAY_SLOT_HEAP_BYTES)
			+ (this.hashKeys.length * TABLE_HASH_SLOT_HEAP_BYTES);
	}

	public nextEntry(after: Value): [Value, Value] | null {
		if (after === null) {
			for (let index = 0; index < this.array.length; index += 1) {
				const value = this.array[index];
				if (value !== null) {
					return [index + 1, value];
				}
			}
			for (let index = 0; index < this.hashKeys.length; index += 1) {
				const key = this.hashKeys[index];
				if (key !== null) {
					return [key, this.hashValues[index]];
				}
			}
			return null;
		}
		const index = this.getArrayIndex(after);
		if (index !== null && index < this.array.length) {
			if (this.array[index] === null) {
				return null;
			}
			for (let cursor = index + 1; cursor < this.array.length; cursor += 1) {
				const value = this.array[cursor];
				if (value !== null) {
					return [cursor + 1, value];
				}
			}
			for (let i = 0; i < this.hashKeys.length; i += 1) {
				const key = this.hashKeys[i];
				if (key !== null) {
					return [key, this.hashValues[i]];
				}
			}
			return null;
		}
		const nodeIndex = this.findNodeIndex(after);
		if (nodeIndex < 0) {
			return null;
		}
		for (let i = nodeIndex + 1; i < this.hashKeys.length; i += 1) {
			const key = this.hashKeys[i];
			if (key !== null) {
				return [key, this.hashValues[i]];
			}
		}
		return null;
	}

	public nextEntryFromCursor(arrayCursor: number, hashCursor: number, previousHashKey: Value = null): [number, number, Value, Value] | null {
		for (let index = arrayCursor; index < this.array.length; index += 1) {
			const value = this.array[index];
			if (value !== null) {
				return [index + 1, 0, index + 1, value];
			}
		}
		const hashStart = hashCursor > 0 ? hashCursor - 1 : 0;
		for (let index = hashStart; index < this.hashKeys.length; index += 1) {
			const key = this.hashKeys[index];
			if (key !== null) {
				if (hashCursor > 0 && index === hashCursor - 1 && previousHashKey !== null && this.keyEquals(key, previousHashKey)) {
					continue;
				}
				return [this.array.length, index + 1, key, this.hashValues[index]];
			}
		}
		return null;
	}

	private static getObjectId(value: object): number {
		const existing = Table.objectIds.get(value);
		if (existing !== undefined) {
			return existing;
		}
		const id = Table.nextObjectId;
		Table.nextObjectId += 1;
		Table.objectIds.set(value, id);
		return id;
	}

	private hashValue(key: Value): number {
		if (typeof key === 'number') {
			if (Number.isNaN(key)) {
				return 0x7ff80000;
			}
			const normalized = key === 0 ? 0 : key;
			Table.float64View[0] = normalized;
			return (Table.uint32View[0] ^ Table.uint32View[1]) >>> 0;
		}
		if (typeof key === 'boolean') {
			return key ? 0x9e3779b9 : 0x85ebca6b;
		}
		if (valueIsString(key)) {
			return (key.id * 2654435761) >>> 0;
		}
		return (Table.getObjectId(key as object) * 2654435761) >>> 0;
	}

	private keyEquals(a: Value, b: Value): boolean {
		if (typeof a === 'number' && typeof b === 'number') {
			if (Number.isNaN(a) && Number.isNaN(b)) {
				return true;
			}
			return a === b;
		}
		if (valueIsString(a) && valueIsString(b)) {
			return a.id === b.id;
		}
		return a === b;
	}

	private findNodeIndex(key: Value): number {
		if (this.hashKeys.length === 0) {
			return -1;
		}
		const mask = this.hashKeys.length - 1;
		let index = (this.hashValue(key) & mask) >>> 0;
		while (index >= 0) {
			const nodeKey = this.hashKeys[index];
			if (nodeKey !== null && this.keyEquals(nodeKey, key)) {
				return index;
			}
			index = this.hashNext[index];
		}
		return -1;
	}

	private getFreeIndex(): number {
		const start = this.hashFree >= 0 ? this.hashFree : this.hashKeys.length - 1;
		for (let i = start; i >= 0; i -= 1) {
			if (this.hashKeys[i] === null) {
				this.hashFree = i - 1;
				return i;
			}
		}
		this.hashFree = -1;
		return -1;
	}

	private rehash(key: Value): void {
		let totalKeys = 0;
		const counts: number[] = [];

		const countIntegerKey = (index: number): void => {
			const log = ceilLog2(index);
			while (counts.length <= log) {
				counts.push(0);
			}
			counts[log] += 1;
		};

		for (let i = 0; i < this.array.length; i += 1) {
			if (this.array[i] !== null) {
				totalKeys += 1;
				countIntegerKey(i + 1);
			}
		}
		for (let i = 0; i < this.hashKeys.length; i += 1) {
			const key = this.hashKeys[i];
			if (key !== null) {
				totalKeys += 1;
				const index = this.getArrayIndex(key);
				if (index !== null) {
					countIntegerKey(index + 1);
				}
			}
		}
		if (key !== null) {
			totalKeys += 1;
			const index = this.getArrayIndex(key);
			if (index !== null) {
				countIntegerKey(index + 1);
			}
		}

		let arraySize = 0;
		let arrayKeys = 0;
		let total = 0;
		let power = 1;
		for (let i = 0; i < counts.length; i += 1) {
			total += counts[i];
			if (total > power / 2) {
				arraySize = power;
				arrayKeys = total;
			}
			power *= 2;
		}

		const hashKeys = totalKeys - arrayKeys;
		const hashSize = hashKeys > 0 ? nextPowerOfTwo(hashKeys) : 0;
		this.resize(arraySize, hashSize);
	}

	private resize(newArraySize: number, newHashSize: number): void {
		const previousBytes = this.getTrackedHeapBytes();
		const oldArray = this.array;
		const oldHashKeys = this.hashKeys;
		const oldHashValues = this.hashValues;

		this.array = new Array<Value>(newArraySize);
		this.array.fill(null);
		this.arrayLength = 0;
		this.hashKeys = new Array<Value>(newHashSize);
		this.hashKeys.fill(null);
		this.hashValues = new Array<Value>(newHashSize);
		this.hashValues.fill(null);
		this.hashNext = new Int32Array(newHashSize);
		this.hashNext.fill(-1);
		this.hashFree = newHashSize > 0 ? newHashSize - 1 : -1;

		for (let i = 0; i < oldArray.length; i += 1) {
			if (oldArray[i] !== null) {
				this.rawSet(i + 1, oldArray[i]);
			}
		}
		for (let i = 0; i < oldHashKeys.length; i += 1) {
			const key = oldHashKeys[i];
			if (key !== null) {
				this.rawSet(key, oldHashValues[i]);
			}
		}
		addTrackedLuaHeapBytes(this.getTrackedHeapBytes() - previousBytes);
	}

	private rawSet(key: Value, value: Value): void {
		const index = this.getArrayIndex(key);
		if (index !== null && index < this.array.length) {
			this.array[index] = value;
			if (value === null) {
				if (index < this.arrayLength) {
					this.arrayLength = index;
				}
			} else if (index === this.arrayLength) {
				this.updateArrayLengthFrom(this.arrayLength);
			}
			return;
		}
		this.insertHash(key, value);
		if (index !== null && index === this.arrayLength) {
			this.updateArrayLengthFrom(this.arrayLength);
		}
	}

	private insertHash(key: Value, value: Value): void {
		if (this.hashKeys.length === 0) {
			this.rehash(key);
			this.rawSet(key, value);
			return;
		}
		const mask = this.hashKeys.length - 1;
		const mainIndex = (this.hashValue(key) & mask) >>> 0;
		const mainKey = this.hashKeys[mainIndex];
		if (mainKey === null) {
			this.hashKeys[mainIndex] = key;
			this.hashValues[mainIndex] = value;
			this.hashNext[mainIndex] = -1;
			return;
		}
		const freeIndex = this.getFreeIndex();
		if (freeIndex < 0) {
			this.rehash(key);
			this.rawSet(key, value);
			return;
		}
		const mainIndexOfOccupied = (this.hashValue(mainKey) & mask) >>> 0;
		if (mainIndexOfOccupied !== mainIndex) {
			this.hashKeys[freeIndex] = mainKey;
			this.hashValues[freeIndex] = this.hashValues[mainIndex];
			this.hashNext[freeIndex] = this.hashNext[mainIndex];
			let prev = mainIndexOfOccupied;
			while (this.hashNext[prev] !== mainIndex) {
				prev = this.hashNext[prev];
			}
			this.hashNext[prev] = freeIndex;
			this.hashKeys[mainIndex] = key;
			this.hashValues[mainIndex] = value;
			this.hashNext[mainIndex] = -1;
			return;
		}
		this.hashKeys[freeIndex] = key;
		this.hashValues[freeIndex] = value;
		this.hashNext[freeIndex] = this.hashNext[mainIndex];
		this.hashNext[mainIndex] = freeIndex;
	}

	private removeFromHash(key: Value): void {
		if (this.hashKeys.length === 0) {
			return;
		}
		const mask = this.hashKeys.length - 1;
		const mainIndex = (this.hashValue(key) & mask) >>> 0;
		let prev = -1;
		let index = mainIndex;
		while (index >= 0) {
			const nodeKey = this.hashKeys[index];
			if (nodeKey !== null && this.keyEquals(nodeKey, key)) {
				const next = this.hashNext[index];
				if (prev >= 0) {
					this.hashNext[prev] = next;
					this.hashKeys[index] = null;
					this.hashValues[index] = null;
					this.hashNext[index] = -1;
					if (index > this.hashFree) {
						this.hashFree = index;
					}
					return;
				}
				if (next >= 0) {
					this.hashKeys[index] = this.hashKeys[next];
					this.hashValues[index] = this.hashValues[next];
					this.hashNext[index] = this.hashNext[next];
					this.hashKeys[next] = null;
					this.hashValues[next] = null;
					this.hashNext[next] = -1;
					if (next > this.hashFree) {
						this.hashFree = next;
					}
					return;
				}
				this.hashKeys[index] = null;
				this.hashValues[index] = null;
				this.hashNext[index] = -1;
				if (index > this.hashFree) {
					this.hashFree = index;
				}
				return;
			}
			prev = index;
			index = this.hashNext[index];
		}
	}

	private getArrayIndex(key: Value): number | null {
		if (typeof key !== 'number') {
			return null;
		}
		if (!Number.isFinite(key)) {
			return null;
		}
		if (key < 1) {
			return null;
		}
		if (!Number.isInteger(key)) {
			return null;
		}
		return key - 1;
	}

	private hasArrayIndex(index: number): boolean {
		if (index < this.array.length) {
			const value = this.array[index];
			return value !== null;
		}
		const key = index + 1;
		return this.findNodeIndex(key) >= 0;
	}

	private updateArrayLengthFrom(startIndex: number): void {
		let newLength = startIndex;
		while (this.hasArrayIndex(newLength)) {
			newLength += 1;
		}
		this.arrayLength = newLength;
	}

	private bumpVersion(): void {
		this.version = (this.version + 1) >>> 0;
		if (this.version === 0) {
			this.version = 1;
		}
	}
}

const enum RegisterTag {
	Nil,
	False,
	True,
	Number,
	String,
	Table,
	Closure,
	BuiltinFunction,
	NativeFunction,
	NativeObject,
}

class RegisterFile {
	private tags: Uint8Array;
	private numbers: Float64Array;
	private refs: Value[];
	private base = 0;
	private size: number;

	constructor(size: number) {
		this.tags = new Uint8Array(size);
		this.numbers = new Float64Array(size);
		this.refs = new Array<Value>(size);
		this.size = size;
		for (let index = 0; index < size; index += 1) {
			this.refs[index] = null;
		}
	}

	public capacity(): number {
		return this.size;
	}

	public rebind(source: RegisterFile, base: number, size: number): void {
		this.tags = source.tags;
		this.numbers = source.numbers;
		this.refs = source.refs;
		this.base = base;
		this.size = size;
	}

	public clear(count: number): void {
		const start = this.base;
		const end = start + count;
		this.tags.fill(RegisterTag.Nil, start, end);
		for (let slot = start; slot < end; slot += 1) {
			this.refs[slot] = null;
		}
	}

	public copyFrom(source: RegisterFile, count: number): void {
		const dstBase = this.base;
		const srcBase = source.base;
		for (let index = 0; index < count; index += 1) {
			const dst = dstBase + index;
			const src = srcBase + index;
			this.tags[dst] = source.tags[src];
			this.numbers[dst] = source.numbers[src];
			this.refs[dst] = source.refs[src];
		}
	}

	public copyTo(target: Value[], count: number): void {
		target.length = count;
		for (let index = 0; index < count; index += 1) {
			target[index] = this.get(index);
		}
	}

	public copySlot(dst: number, src: number): void {
		const dstSlot = this.base + dst;
		const srcSlot = this.base + src;
		this.tags[dstSlot] = this.tags[srcSlot];
		this.numbers[dstSlot] = this.numbers[srcSlot];
		this.refs[dstSlot] = this.refs[srcSlot];
	}

	public copyRangeFrom(source: RegisterFile, dstBase: number, srcBase: number, count: number): void {
		const dstOffset = this.base;
		const srcOffset = source.base;
		for (let index = 0; index < count; index += 1) {
			const dst = dstOffset + dstBase + index;
			const src = srcOffset + srcBase + index;
			this.tags[dst] = source.tags[src];
			this.numbers[dst] = source.numbers[src];
			this.refs[dst] = source.refs[src];
		}
	}

	public moveRange(dstBase: number, srcBase: number, count: number): void {
		const base = this.base;
		if (count <= 0 || dstBase === srcBase) {
			return;
		}
		if (dstBase > srcBase) {
			for (let index = count - 1; index >= 0; index -= 1) {
				const dst = base + dstBase + index;
				const src = base + srcBase + index;
				this.tags[dst] = this.tags[src];
				this.numbers[dst] = this.numbers[src];
				this.refs[dst] = this.refs[src];
			}
			return;
		}
		for (let index = 0; index < count; index += 1) {
			const dst = base + dstBase + index;
			const src = base + srcBase + index;
			this.tags[dst] = this.tags[src];
			this.numbers[dst] = this.numbers[src];
			this.refs[dst] = this.refs[src];
		}
	}

	public isNumber(index: number): boolean {
		return this.tags[this.base + index] === RegisterTag.Number;
	}

	public getNumber(index: number): number {
		return this.numbers[this.base + index];
	}

	public isTruthy(index: number): boolean {
		const tag = this.tags[this.base + index];
		return tag !== RegisterTag.Nil && tag !== RegisterTag.False;
	}

	public get(index: number): Value {
		const slot = this.base + index;
		switch (this.tags[slot]) {
			case RegisterTag.Nil:
				return null;
			case RegisterTag.False:
				return false;
			case RegisterTag.True:
				return true;
			case RegisterTag.Number:
				return this.numbers[slot];
			case RegisterTag.String:
			case RegisterTag.Table:
			case RegisterTag.Closure:
			case RegisterTag.BuiltinFunction:
			case RegisterTag.NativeFunction:
			case RegisterTag.NativeObject:
				return this.refs[slot];
			default:
				throw new Error('Invalid register tag.');
		}
	}

	public setNil(index: number): void {
		const slot = this.base + index;
		this.tags[slot] = RegisterTag.Nil;
		this.refs[slot] = null;
	}

	public setBool(index: number, value: boolean): void {
		const slot = this.base + index;
		this.tags[slot] = value ? RegisterTag.True : RegisterTag.False;
		this.refs[slot] = null;
	}

	public setNumber(index: number, value: number): void {
		const slot = this.base + index;
		this.tags[slot] = RegisterTag.Number;
		this.numbers[slot] = value;
		this.refs[slot] = null;
	}

	public setString(index: number, value: StringValue): void {
		const slot = this.base + index;
		this.tags[slot] = RegisterTag.String;
		this.refs[slot] = value;
	}

	public setTable(index: number, value: Table): void {
		const slot = this.base + index;
		this.tags[slot] = RegisterTag.Table;
		this.refs[slot] = value;
	}

	public setClosure(index: number, value: Closure): void {
		const slot = this.base + index;
		this.tags[slot] = RegisterTag.Closure;
		this.refs[slot] = value;
	}

	public setBuiltinFunction(index: number, value: BuiltinFunction): void {
		const slot = this.base + index;
		this.tags[slot] = RegisterTag.BuiltinFunction;
		this.refs[slot] = value;
	}

	public setNativeFunction(index: number, value: NativeFunction): void {
		const slot = this.base + index;
		this.tags[slot] = RegisterTag.NativeFunction;
		this.refs[slot] = value;
	}

	public setNativeObject(index: number, value: NativeObject): void {
		const slot = this.base + index;
		this.tags[slot] = RegisterTag.NativeObject;
		this.refs[slot] = value;
	}

	public set(index: number, value: Value): void {
		if (value === null) {
			this.setNil(index);
			return;
		}
		if (typeof value === 'number') {
			this.setNumber(index, value);
			return;
		}
		if (typeof value === 'boolean') {
			this.setBool(index, value);
			return;
		}
		if (valueIsString(value)) {
			this.setString(index, value);
			return;
		}
		if (value instanceof Table) {
			this.setTable(index, value);
			return;
		}
		if (isBuiltinFunction(value)) {
			this.setBuiltinFunction(index, value);
			return;
		}
		if (isNativeFunction(value)) {
			this.setNativeFunction(index, value);
			return;
		}
		if (isNativeObject(value)) {
			this.setNativeObject(index, value);
			return;
		}
		this.setClosure(index, value);
	}
}

type NativeArgsProxyHandle = {
	view: NativeArgsView;
	proxy: NativeArgs;
};

class NativeArgsView {
	private registers: RegisterFile | null = null;
	private values: ReadonlyArray<Value> | null = null;
	private base = 0;
	public length = 0;

	public bindRegisters(registers: RegisterFile, base: number, length: number): void {
		this.registers = registers;
		this.values = null;
		this.base = base;
		this.length = length;
	}

	public bindArray(values: ReadonlyArray<Value>): void {
		this.registers = null;
		this.values = values;
		this.base = 0;
		this.length = values.length;
	}

	public clear(): void {
		this.registers = null;
		this.values = null;
		this.base = 0;
		this.length = 0;
	}

	public at(index: number): Value | undefined {
		if (index < 0 || index >= this.length) {
			return undefined;
		}
		if (this.values !== null) {
			return this.values[index];
		}
		return this.registers!.get(this.base + index);
	}

	public map<U>(callback: (value: Value, index: number, array: NativeArgs) => U): U[] {
		const output = new Array<U>(this.length);
		const proxy = this as unknown as NativeArgs;
		for (let index = 0; index < this.length; index += 1) {
			output[index] = callback(this.at(index)!, index, proxy);
		}
		return output;
	}
}

const nativeArgsIndexPattern = /^(0|[1-9]\d*)$/;
const nativeArgsProxyHandler: ProxyHandler<NativeArgsView> = {
	get(target, property) {
		if (typeof property === 'string' && nativeArgsIndexPattern.test(property)) {
			return target.at(property.length === 1 ? (property.charCodeAt(0) - 48) : Number(property));
		}
		const value = Reflect.get(target, property, target);
		// disable-next-line defensive_typeof_function_pattern -- Proxy trap binds NativeArgsView methods returned by Reflect.get.
		return typeof value === 'function' ? value.bind(target) : value;
	},
};

type TableLoadInlineCache = {
	table: Table | null;
	version: number;
	value: Value;
};

const DECODED_PAGE_SHIFT = 8;
const DECODED_PAGE_WORDS = 1 << DECODED_PAGE_SHIFT;
const DECODED_PAGE_MASK = DECODED_PAGE_WORDS - 1;

type DecodedInstructionPage = {
	widths: Uint8Array;
	ops: Uint8Array;
	a: Uint16Array;
	b: Uint16Array;
	c: Uint16Array;
	bx: Uint32Array;
	sbx: Int32Array;
	rkB: Int32Array;
	rkC: Int32Array;
	disp: Uint8Array;
	words: Uint32Array;
	tableCacheIndexes: Uint32Array;
};

// Pool constant for frame reuse
const MAX_POOLED_FRAMES = 32;
export class CPU {
	public instructionBudgetRemaining: number = 0;
	public lastReturnValues: Value[] = [];
	public lastPc: number = 0;
	public lastInstruction: number = 0;
	public readonly globals: Table;
	public readonly memory: Memory;

	public program: Program = null;
	private metadata: ProgramMetadata | null = null;
	public readonly stringPool: StringPool;
	private indexKey: StringValue = null;
	private haltedUntilIrq = false;
	private maskableInterruptsEnabled = true;
	private maskableInterruptsRestoreEnabled = true;
	private nonMaskableInterruptPending = false;
	private hostExternalCallDepth = 0;
	private yieldRequested = false;
	private readonly frames: CallFrame[] = [];
	private readonly openUpvalues: OpenUpvalueSlot[] = [];
	private readonly nativeArgsScratch = new ScratchBuffer<NativeArgsProxyHandle>(() => {
		const view = new NativeArgsView();
		return { view, proxy: new Proxy(view, nativeArgsProxyHandler) as unknown as NativeArgs };
	});
	private nativeArgsScratchIndex = 0;
	private readonly debugRegistersScratch: Value[] = [];
	private readonly nativeReturnScratch = new ScratchArrayStack<Value>();
	public readonly profiler = new CpuExecutionProfiler();
	private profilerEnabled = false;
	private profilerConfigured = false;
	private profilerRuntimeSymbols!: ProgramRuntimeSymbols;
	private externalReturnSink: Value[] | null = null;
	private decodedPages: DecodedInstructionPage[] = [];
	private tableLoadCaches: TableLoadInlineCache[] = [];
	public stringIndexTable: Table | null = null;
	private systemGlobalNames: StringId[] = [];
	private systemGlobalValues: Value[] = [];
	private systemGlobalSlotByKey: Map<StringId, number> = new Map();
	private globalNames: StringId[] = [];
	private globalValues: Value[] = [];
	private globalSlotByKey: Map<StringId, number> = new Map();
	private readonly framePool: CallFrame[] = [];
	private readonly staticClosures: Closure[] = [];
	private stackRegisters = new RegisterFile(8);
	private stackTop = 0;

	constructor(memory: Memory) {
		this.memory = memory;
		this.stringPool = new StringPool(true);
		this.globals = new Table(0, 0);
		this.indexKey = StringValue.get(this.stringPool.intern('__index'));
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

	private acquireNativeArgsProxy(): NativeArgsProxyHandle {
		const handle = this.nativeArgsScratch.get(this.nativeArgsScratchIndex);
		this.nativeArgsScratchIndex += 1;
		return handle;
	}

	private releaseNativeArgsProxy(handle: NativeArgsProxyHandle): void {
		handle.view.clear();
		this.nativeArgsScratchIndex -= 1;
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
			if (!(indexer instanceof Table)) {
				return null;
			}
			current = indexer;
		}
		throw new Error('Metatable __index loop detected.');
	}

	private loadTableIndex(base: Value, key: Value): Value {
		if (base instanceof Table) {
			if (base.metatable === null) {
				return base.get(key);
			}
			return this.resolveTableIndexChain(base, key, TableIndexKeyKind.Value);
		}
		if (valueIsString(base)) {
			const indexTable = this.stringIndexTable;
			if (indexTable === null) {
				return null;
			}
			if (indexTable.metatable === null) {
				return indexTable.get(key);
			}
			return this.resolveTableIndexChain(indexTable, key, TableIndexKeyKind.Value);
		}
		if (isNativeObject(base)) {
			const directValue = base.get(key);
			const metatable = base.metatable;
			if (directValue !== null || metatable === null) {
				return directValue;
			}
			const indexer = metatable.getStringKey(this.indexKey);
			if (indexer instanceof Table) {
				return this.resolveTableIndexChain(indexer, key, TableIndexKeyKind.Value);
			}
			return null;
		}
		throw new Error('Attempted to index field on a non-table value.');
	}

	private loadTableIntegerIndexCached(cacheIndex: number, base: Value, index: number): Value {
		const indexKind = TableIndexKeyKind.Integer;
		if (base instanceof Table) {
			if (base.metatable === null) {
				const cache = this.tableLoadCaches[cacheIndex];
				const version = base.getVersion();
				if (cache.table === base && cache.version === version) {
					return cache.value;
				}
				const value = base.getInteger(index);
				cache.table = base;
				cache.version = version;
				cache.value = value;
				return value;
			}
			return this.resolveTableIndexChain(base, index, indexKind);
		}
		if (valueIsString(base)) {
			const table = this.stringIndexTable;
			if (table === null) {
				return null;
			}
			if (table.metatable === null) {
				const cache = this.tableLoadCaches[cacheIndex];
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
		if (isNativeObject(base)) {
			const directValue = base.get(index);
			if (directValue !== null || base.metatable === null) {
				return directValue;
			}
			const indexer = base.metatable.getStringKey(this.indexKey);
			if (indexer instanceof Table) {
				return this.resolveTableIndexChain(indexer, index, indexKind);
			}
			return directValue;
		}
		throw new Error('Attempted to index field on a non-table value.');
	}

	private loadTableFieldIndexCached(cacheIndex: number, base: Value, key: StringValue): Value {
		if (base instanceof Table) {
			if (base.metatable === null) {
				const cache = this.tableLoadCaches[cacheIndex];
				const version = base.getVersion();
				if (cache.table === base && cache.version === version) {
					return cache.value;
				}
				const value = base.getStringKey(key);
				cache.table = base;
				cache.version = version;
				cache.value = value;
				return value;
			}
			return this.resolveTableIndexChain(base, key, TableIndexKeyKind.Field);
		}
		if (valueIsString(base)) {
			const table = this.stringIndexTable;
			if (table === null) {
				return null;
			}
			if (table.metatable === null) {
				const cache = this.tableLoadCaches[cacheIndex];
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
		if (isNativeObject(base)) {
			const directValue = base.get(key);
			if (directValue !== null || base.metatable === null) {
				return directValue;
			}
			const indexer = base.metatable.getStringKey(this.indexKey);
			if (indexer instanceof Table) {
				return this.resolveTableIndexChain(indexer, key, TableIndexKeyKind.Field);
			}
			return directValue;
		}
		throw new Error('Attempted to index field on a non-table value.');
	}

	private storeTableIndex(base: Value, key: Value, value: Value): void {
		if (base instanceof Table) {
			base.set(key, value);
			return;
		}
		if (isNativeObject(base)) {
			base.set(key, value);
			return;
		}
		throw new Error('Attempted to assign to a non-table value.');
	}

	private storeTableIntegerIndex(base: Value, index: number, value: Value): void {
		if (base instanceof Table) {
			base.setInteger(index, value);
			return;
		}
		if (isNativeObject(base)) {
			base.set(index, value);
			return;
		}
		throw new Error('Attempted to assign to a non-table value.');
	}

	private storeTableFieldIndex(base: Value, key: StringValue, value: Value): void {
		if (base instanceof Table) {
			base.setStringKey(key, value);
			return;
		}
		if (isNativeObject(base)) {
			base.set(key, value);
			return;
		}
		throw new Error('Attempted to assign to a non-table value.');
	}

	private acquireFrame(): CallFrame {
		if (this.framePool.length > 0) {
			return this.framePool.pop()!;
		}
		return {
			protoIndex: 0,
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
			captureReturns: false,
			callSitePc: 0,
			isInterruptFrame: false,
			savedMaskableEnabled: true,
		};
	}

	private releaseFrame(frame: CallFrame): void {
		frame.varargBase = 0;
		frame.varargCount = 0;
		frame.stackBase = 0;
		frame.stackCapacity = 0;
		frame.registers.rebind(this.stackRegisters, 0, 0);
		frame.isInterruptFrame = false;
		frame.savedMaskableEnabled = true;
		if (this.framePool.length < MAX_POOLED_FRAMES) {
			this.framePool.push(frame);
		}
	}

	private clearCallStack(): void {
		while (this.frames.length > 0) {
			const frame = this.frames.pop()!;
			this.closeUpvalues(frame);
			this.releaseFrame(frame);
		}
		this.openUpvalues.length = 0;
		this.stackTop = 0;
	}

	public setProgram(program: Program, runtimeSymbols: ProgramRuntimeSymbols, metadata: ProgramMetadata | null): void {
		// Keep slot-backed globals materialized in the globals table before swapping programs.
		// SETGL/SETSYS mutate the slot arrays directly, and append/reload paths rebuild the next
		// slot layout from `globals`, so without this sync flattened module exports can fall back to nil.
		this.syncGlobalSlotsToTable();
		this.program = program;
		this.memory.setProgramRom(program.programRom, program.programRomTextByteLength);
		this.metadata = metadata;
		const constPool = program.constPool;
		const programPool = program.constPoolStringPool;
		for (let index = 0; index < constPool.length; index += 1) {
			const value = constPool[index];
			if (valueIsString(value)) {
				constPool[index] = StringValue.get(this.stringPool.intern(programPool.toString(asStringId(value)), false));
			}
		}
		program.constPoolStringPool = this.stringPool;
		this.indexKey = StringValue.get(this.stringPool.intern('__index'));
		this.materializeStaticClosures(program);
		this.initializeGlobalSlots(runtimeSymbols);
		this.decodeProgram(program);
		this.profilerRuntimeSymbols = runtimeSymbols;
		this.profilerConfigured = false;
		if (this.profilerEnabled) {
			this.configureProfiler();
		}
	}

	private materializeStaticClosures(program: Program): void {
		const protos = program.protos;
		const closures = this.staticClosures;
		const existingCount = closures.length;
		closures.length = protos.length;
		for (let index = existingCount; index < protos.length; index += 1) {
			closures[index] = { protoIndex: index, upvalues: EMPTY_CLOSURE_UPVALUES, heapBytes: 0 };
		}
		for (let index = 0; index < protos.length; index += 1) {
			const closure = closures[index];
			closure.protoIndex = index;
			closure.upvalues = EMPTY_CLOSURE_UPVALUES;
			closure.heapBytes = 0;
		}
	}

	private initializeGlobalSlots(runtimeSymbols: ProgramRuntimeSymbols): void {
		const systemNames = runtimeSymbols.systemGlobalNames;
		const globalNames = runtimeSymbols.globalNames;
		this.systemGlobalNames = new Array(systemNames.length);
		this.systemGlobalValues = new Array(systemNames.length);
		this.systemGlobalSlotByKey = new Map();
		for (let index = 0; index < systemNames.length; index += 1) {
			const key = this.stringPool.intern(systemNames[index], false);
			this.systemGlobalNames[index] = key;
			this.systemGlobalSlotByKey.set(key, index);
			this.systemGlobalValues[index] = this.globals.get(StringValue.get(key));
		}
		this.globalNames = new Array(globalNames.length);
		this.globalValues = new Array(globalNames.length);
		this.globalSlotByKey = new Map();
		for (let index = 0; index < globalNames.length; index += 1) {
			const key = this.stringPool.intern(globalNames[index], false);
			this.globalNames[index] = key;
			this.globalSlotByKey.set(key, index);
			this.globalValues[index] = this.globals.get(StringValue.get(key));
		}
	}

	private decodeProgram(program: Program): void {
		const code = program.code;
		const instructionCount = code.length / INSTRUCTION_BYTES;
		const decodedPages = new Array<DecodedInstructionPage>((instructionCount + DECODED_PAGE_WORDS - 1) >> DECODED_PAGE_SHIFT);
		const tableLoadCaches: TableLoadInlineCache[] = [];
		for (let protoIndex = 0; protoIndex < program.protos.length; protoIndex += 1) {
			const proto = program.protos[protoIndex];
			const startWord = proto.entryPC / INSTRUCTION_BYTES;
			const endWord = startWord + proto.codeLen / INSTRUCTION_BYTES;
			for (let wordIndex = startWord; wordIndex < endWord;) {
				const page = this.decodedPageForWrite(decodedPages, wordIndex);
				const pageOffset = wordIndex & DECODED_PAGE_MASK;
				let width = 1;
				let wideA = 0;
				let wideB = 0;
				let wideC = 0;
				let instr = readInstructionWord(code, wordIndex);
				let op = (instr >>> 18) & 0x3f;
				let ext = instr >>> 24;
				if (op === OpCode.WIDE) {
					if (wordIndex + 1 >= instructionCount) {
						throw new Error('Malformed program: WIDE instruction at end of program.');
					}
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
				page.bx[pageOffset] = decodedBx;
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
		}
		this.decodedPages = decodedPages;
		this.tableLoadCaches = tableLoadCaches;
	}

	private decodedPageForWrite(decodedPages: DecodedInstructionPage[], wordIndex: number): DecodedInstructionPage {
		const pageIndex = wordIndex >>> DECODED_PAGE_SHIFT;
		let page = decodedPages[pageIndex];
		if (!page) {
			page = {
				widths: new Uint8Array(DECODED_PAGE_WORDS),
				ops: new Uint8Array(DECODED_PAGE_WORDS),
				a: new Uint16Array(DECODED_PAGE_WORDS),
				b: new Uint16Array(DECODED_PAGE_WORDS),
				c: new Uint16Array(DECODED_PAGE_WORDS),
				bx: new Uint32Array(DECODED_PAGE_WORDS),
				sbx: new Int32Array(DECODED_PAGE_WORDS),
				rkB: new Int32Array(DECODED_PAGE_WORDS),
				rkC: new Int32Array(DECODED_PAGE_WORDS),
				disp: new Uint8Array(DECODED_PAGE_WORDS),
				words: new Uint32Array(DECODED_PAGE_WORDS),
				tableCacheIndexes: new Uint32Array(DECODED_PAGE_WORDS),
			};
			decodedPages[pageIndex] = page;
		}
		return page;
	}

	private configureProfiler(): void {
		this.profiler.configureProgram(this.program, this.profilerRuntimeSymbols, this.metadata, this.buildProfilerOpcodeByWord());
		this.profilerConfigured = true;
	}

	private buildProfilerOpcodeByWord(): Uint8Array {
		const opcodeByWord = new Uint8Array(this.program.code.length / INSTRUCTION_BYTES);
		const decodedPages = this.decodedPages;
		for (let pageIndex = 0; pageIndex < decodedPages.length; pageIndex += 1) {
			const page = decodedPages[pageIndex];
			if (!page) {
				continue;
			}
			const pageStart = pageIndex << DECODED_PAGE_SHIFT;
			const remainingWords = opcodeByWord.length - pageStart;
			const pageWords = remainingWords < DECODED_PAGE_WORDS ? remainingWords : DECODED_PAGE_WORDS;
			for (let offset = 0; offset < pageWords; offset += 1) {
				opcodeByWord[pageStart + offset] = page.ops[offset];
			}
		}
		return opcodeByWord;
	}

	public start(entryProtoIndex: number, args: ReadonlyArray<Value> = EMPTY_CALL_ARGS): void {
		this.lastReturnValues.length = 0;
		this.clearCallStack();
		this.haltedUntilIrq = false;
		this.maskableInterruptsEnabled = true;
		this.maskableInterruptsRestoreEnabled = true;
		this.nonMaskableInterruptPending = false;
		this.hostExternalCallDepth = 0;
		this.yieldRequested = false;
		this.pushFrame(this.rootClosure(entryProtoIndex), args, 0, 0, false, this.program.protos[entryProtoIndex].entryPC);
		enforceLuaHeapBudget();
	}

	public rootClosure(protoIndex: number): Closure {
		const closure = this.staticClosures[protoIndex];
		return closure;
	}

	public call(closure: Closure, args: ReadonlyArray<Value> = EMPTY_CALL_ARGS, returnCount: number = 0): void {
		this.requireRunnableForCall();
		this.lastReturnValues.length = 0;
		this.yieldRequested = false;
		this.pushFrame(closure, args, 0, returnCount, false, this.program.protos[closure.protoIndex].entryPC);
	}

	public enterHostExternalCall(): void {
		this.hostExternalCallDepth += 1;
	}

	public leaveHostExternalCall(): void {
		this.hostExternalCallDepth -= 1;
	}

	public isHostExternalCallActive(): boolean {
		return this.hostExternalCallDepth !== 0;
	}

	public callExternal(closure: Closure, args: ReadonlyArray<Value> = EMPTY_CALL_ARGS): void {
		this.requireRunnableForCall();
		this.lastReturnValues.length = 0;
		this.yieldRequested = false;
		this.pushFrame(closure, args, 0, 0, true, this.program.protos[closure.protoIndex].entryPC);
	}

	public requestYield(): void {
		this.yieldRequested = true;
	}

	public haltUntilIrq(): void {
		this.haltedUntilIrq = true;
		this.yieldRequested = false;
	}

	public clearHaltUntilIrq(): void {
		this.haltedUntilIrq = false;
		this.yieldRequested = false;
	}

	public isHaltedUntilIrq(): boolean {
		return this.haltedUntilIrq;
	}

	public enableMaskableInterrupts(): void {
		this.maskableInterruptsEnabled = true;
		this.maskableInterruptsRestoreEnabled = true;
	}

	public disableMaskableInterrupts(): void {
		this.maskableInterruptsEnabled = false;
		this.maskableInterruptsRestoreEnabled = false;
	}

	public requestNonMaskableInterrupt(): void {
		this.nonMaskableInterruptPending = true;
	}

	public restoreMaskableInterruptsAfterNonMaskableInterrupt(): void {
		this.maskableInterruptsEnabled = this.maskableInterruptsRestoreEnabled;
	}

	public canAcceptMaskableInterruptLine(irqController: IrqController): boolean {
		return this.maskableInterruptsEnabled
			&& irqController.hasAssertedMaskableInterruptLine();
	}

	public peekPendingInterrupt(irqController: IrqController): AcceptedInterruptKind {
		if (this.nonMaskableInterruptPending) {
			return AcceptedInterruptKind.NonMaskable;
		}
		if (this.canAcceptMaskableInterruptLine(irqController)) {
			return AcceptedInterruptKind.Maskable;
		}
		return AcceptedInterruptKind.None;
	}

	public enterPendingInterrupt(irqController: IrqController, irqProtoIndex: number): boolean {
		if (!this.canAcceptMaskableInterruptLine(irqController)) {
			return false;
		}
		this.maskableInterruptsEnabled = false;
		this.clearHaltAfterAcceptedInterrupt();
		const frame = this.pushFrame(this.rootClosure(irqProtoIndex), EMPTY_CALL_ARGS, 0, 0, false, this.program.protos[irqProtoIndex].entryPC);
		frame.isInterruptFrame = true;
		frame.savedMaskableEnabled = true;
		return true;
	}

	private requireRunnableForCall(): void {
		if (this.haltedUntilIrq) {
			throw new Error('Cannot enter CPU while halted until IRQ.');
		}
	}

	private clearHaltAfterAcceptedInterrupt(): void {
		this.haltedUntilIrq = false;
		this.yieldRequested = false;
	}

	public swapExternalReturnSink(sink: Value[] | null): Value[] | null {
		const previous = this.externalReturnSink;
		this.externalReturnSink = sink;
		return previous;
	}

	public getFrameDepth(): number {
		return this.frames.length;
	}

	public runUntilDepth(targetDepth: number, instructionBudget: number, irqController: IrqController | null = null, irqProtoIndex = 0): RunResult {
		this.instructionBudgetRemaining = instructionBudget;
		const frames = this.frames;
		const profiler = this.profilerEnabled ? this.profiler : null;
		const baseCycles = BASE_CYCLES;
		const decodedPages = this.decodedPages;
		while (frames.length > targetDepth) {
			if (this.haltedUntilIrq) {
				return RunResult.Halted;
			}
			if (this.yieldRequested) {
				this.yieldRequested = false;
				return RunResult.Yielded;
			}
			if (this.instructionBudgetRemaining <= 0) {
				return RunResult.Yielded;
			}
			if (irqController !== null
				&& this.hostExternalCallDepth === 0
				&& this.maskableInterruptsEnabled
				&& irqController.hasAssertedMaskableInterruptLine()
			) {
				this.enterPendingInterrupt(irqController, irqProtoIndex);
				continue;
			}
			const frame = frames[frames.length - 1];
			const pc = frame.pc;
			const wordIndex = pc / INSTRUCTION_BYTES;
			const page = decodedPages[wordIndex >>> DECODED_PAGE_SHIFT]!;
			const pageOffset = wordIndex & DECODED_PAGE_MASK;
			const width = page.widths[pageOffset];
			const op = page.ops[pageOffset];
			frame.pc = pc + (width * INSTRUCTION_BYTES);
			this.lastPc = pc + ((width - 1) * INSTRUCTION_BYTES);
			this.lastInstruction = page.words[pageOffset];
			if (profiler !== null) {
				profiler.record(wordIndex, op);
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
		return RunResult.Halted;
	}

	public unwindToDepth(targetDepth: number): void {
		while (this.frames.length > targetDepth) {
			const frame = this.frames.pop()!;
			this.closeUpvalues(frame);
			this.stackTop = frame.varargBase;
			this.releaseFrame(frame);
		}
	}

	private charge(cycles: number): void {
		this.instructionBudgetRemaining -= cycles;
	}

	private skipNextInstruction(frame: CallFrame): void {
		const wordIndex = frame.pc / INSTRUCTION_BYTES;
		const page = this.decodedPages[wordIndex >>> DECODED_PAGE_SHIFT]!;
		frame.pc += page.widths[wordIndex & DECODED_PAGE_MASK] * INSTRUCTION_BYTES;
	}

	private formatSourceLocation(range: SourceRange | null): string {
		return range ? `${range.path}:${range.start.line}:${range.start.column}` : 'unknown';
	}

	private formatLastSourceLocation(): string {
		return this.formatSourceLocation(this.metadata ? this.getDebugRange(this.lastPc) : null);
	}

	public step(): void {
		if (this.haltedUntilIrq) {
			return;
		}
		const frame = this.frames[this.frames.length - 1];
		const pc = frame.pc;
		const wordIndex = pc / INSTRUCTION_BYTES;
		const profiler = this.profilerEnabled ? this.profiler : null;
		const page = this.decodedPages[wordIndex >>> DECODED_PAGE_SHIFT]!;
		const pageOffset = wordIndex & DECODED_PAGE_MASK;
		const width = page.widths[pageOffset];
		const op = page.ops[pageOffset];
		frame.pc = pc + (width * INSTRUCTION_BYTES);
		this.lastPc = pc + ((width - 1) * INSTRUCTION_BYTES);
		this.lastInstruction = page.words[pageOffset];
		if (profiler !== null) {
			profiler.record(wordIndex, op);
		}
		this.charge(BASE_CYCLES[op]);
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

	public getDebugState(): { pc: number; instr: number; registers: Value[] } {
		const frame = this.frames[this.frames.length - 1];
		if (!frame) {
			return {
				pc: this.lastPc,
				instr: this.lastInstruction,
				registers: [],
			};
		}
		const registers = this.debugRegistersScratch;
		frame.registers.copyTo(registers, frame.top);
		return {
			pc: this.lastPc,
			instr: this.lastInstruction,
			registers,
		};
	}

	public setProfilerEnabled(enabled: boolean): void {
		this.profilerEnabled = enabled;
		if (enabled) {
			if (!this.profilerConfigured) {
				this.configureProfiler();
			} else {
				this.profiler.reset();
			}
		}
	}

	public isProfilerEnabled(): boolean {
		return this.profilerEnabled;
	}

	public formatProfilerReport(options: CpuProfilerReportOptions = {}): string {
		return formatCpuProfilerReport(this.profiler.snapshot(), options);
	}

	public getDebugRange(pc: number): SourceRange | null {
		if (!this.metadata) {
			return null;
		}
		const wordIndex = pc / INSTRUCTION_BYTES;
		return this.metadata.debugRanges[wordIndex];
	}

	public getCallStack(): ReadonlyArray<{ protoIndex: number; pc: number }> {
		const frames = this.frames;
		const stack: Array<{ protoIndex: number; pc: number }> = [];
		const topIndex = frames.length - 1;
		for (let index = 0; index < frames.length; index += 1) {
			const frame = frames[index];
			const pc = index === topIndex ? this.lastPc : frame.callSitePc;
			stack.push({ protoIndex: frame.protoIndex, pc });
		}
		return stack;
	}

	public snapshotCallStack(): CpuFrameSnapshot[] {
		const frames = this.frames;
		const topIndex = frames.length - 1;
		const result: CpuFrameSnapshot[] = [];
		for (let index = 0; index < frames.length; index += 1) {
			const frame = frames[index];
			const pc = index === topIndex ? this.lastPc : frame.callSitePc;
			const proto = this.program.protos[frame.protoIndex];
			const registers: Value[] = new Array(proto.maxStack);
			for (let r = 0; r < proto.maxStack; r += 1) {
				registers[r] = frame.registers.get(r);
			}
			result.push({ protoIndex: frame.protoIndex, pc, registers });
		}
		return result;
	}

	public readFrameRegister(frameIndex: number, registerIndex: number): Value {
		const frame = this.frames[frameIndex];
		return frame.registers.get(registerIndex);
	}

	public readFrameUpvalue(frameIndex: number, upvalueIndex: number): Value {
		const frame = this.frames[frameIndex];
		const upvalue = frame.closure.upvalues[upvalueIndex];
		if (upvalue.open) {
			return upvalue.frame.registers.get(upvalue.index);
		}
		return upvalue.value;
	}

	public hasFrameUpvalue(frameIndex: number, upvalueIndex: number): boolean {
		const frame = this.frames[frameIndex];
		return frame.closure.upvalues[upvalueIndex] !== undefined;
	}

	public setGlobalByKey(key: StringValue, value: Value): void {
		this.globals.set(key, value);
		const systemSlot = this.systemGlobalSlotByKey.get(key.id);
		if (systemSlot !== undefined) {
			this.systemGlobalValues[systemSlot] = value;
			return;
		}
		const globalSlot = this.globalSlotByKey.get(key.id);
		if (globalSlot !== undefined) {
			this.globalValues[globalSlot] = value;
		}
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
		for (let slot = 0; slot < this.systemGlobalNames.length; slot += 1) {
			this.globals.set(StringValue.get(this.systemGlobalNames[slot]), this.systemGlobalValues[slot]);
		}
		for (let slot = 0; slot < this.globalNames.length; slot += 1) {
			this.globals.set(StringValue.get(this.globalNames[slot]), this.globalValues[slot]);
		}
	}

	public getGlobalByKey(key: StringValue): Value {
		const systemSlot = this.systemGlobalSlotByKey.get(key.id);
		if (systemSlot !== undefined) {
			return this.systemGlobalValues[systemSlot];
		}
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
		switch (op) {
				case OpCode.WIDE:
					throw new Error('Unknown opcode.');
				case OpCode.MOV:
					this.copyRegisterFast(frame, registers, a, b);
					return;
				case OpCode.LOADK: {
					this.setRegisterFast(frame, registers, a, this.program.constPool[bx]);
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
					this.setRegisterFast(frame, registers, a, this.loadTableIntegerIndexCached(tableCacheIndex, registers.get(b), c));
					return;
				case OpCode.SETI:
					this.storeTableIntegerIndex(registers.get(a), b, this.readRK(frame, rkC));
					return;
				case OpCode.GETFIELD:
					this.setRegisterFast(frame, registers, a, this.loadTableFieldIndexCached(tableCacheIndex, registers.get(b), this.program.constPool[c] as StringValue));
					return;
				case OpCode.SETFIELD:
					this.storeTableFieldIndex(registers.get(a), this.program.constPool[b] as StringValue, this.readRK(frame, rkC));
					return;
				case OpCode.SELF: {
					const base = registers.get(b);
					const key = this.program.constPool[c] as StringValue;
					this.setRegisterFast(frame, registers, a + 1, base);
					this.setRegisterFast(frame, registers, a, this.loadTableFieldIndexCached(tableCacheIndex, base, key));
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
					this.setRegisterTableFast(frame, registers, a, new Table(b, c));
					enforceLuaHeapBudget();
					return;
				case OpCode.ADD: {
					const left = this.readRKNumber(frame, rkB);
					const right = this.readRKNumber(frame, rkC);
					this.setRegisterNumberFast(frame, registers, a, left + right);
					return;
				}
				case OpCode.SUB: {
					const left = this.readRKNumber(frame, rkB);
					const right = this.readRKNumber(frame, rkC);
					this.setRegisterNumberFast(frame, registers, a, left - right);
					return;
				}
				case OpCode.MUL: {
					const left = this.readRKNumber(frame, rkB);
					const right = this.readRKNumber(frame, rkC);
					this.setRegisterNumberFast(frame, registers, a, left * right);
					return;
				}
				case OpCode.DIV: {
					const left = this.readRKNumber(frame, rkB);
					const right = this.readRKNumber(frame, rkC);
					this.setRegisterNumberFast(frame, registers, a, left / right);
					return;
				}
				case OpCode.MOD: {
					const left = this.readRKNumber(frame, rkB);
					const right = this.readRKNumber(frame, rkC);
					this.setRegisterNumberFast(frame, registers, a, luaModulo(left, right));
					return;
				}
				case OpCode.FLOORDIV: {
					const left = this.readRKNumber(frame, rkB);
					const right = this.readRKNumber(frame, rkC);
					this.setRegisterNumberFast(frame, registers, a, Math.floor(left / right));
					return;
				}
				case OpCode.POW: {
					const left = this.readRKNumber(frame, rkB);
					const right = this.readRKNumber(frame, rkC);
					this.setRegisterNumberFast(frame, registers, a, Math.pow(left, right));
					return;
				}
				case OpCode.BAND: {
					const left = this.readRKNumber(frame, rkB);
					const right = this.readRKNumber(frame, rkC);
					this.setRegisterNumberFast(frame, registers, a, left & right);
					return;
				}
				case OpCode.BOR: {
					const left = this.readRKNumber(frame, rkB);
					const right = this.readRKNumber(frame, rkC);
					this.setRegisterNumberFast(frame, registers, a, left | right);
					return;
				}
				case OpCode.BXOR: {
					const left = this.readRKNumber(frame, rkB);
					const right = this.readRKNumber(frame, rkC);
					this.setRegisterNumberFast(frame, registers, a, left ^ right);
					return;
				}
				case OpCode.SHL: {
					const left = this.readRKNumber(frame, rkB);
					const right = this.readRKNumber(frame, rkC);
					this.setRegisterNumberFast(frame, registers, a, left << (right & 31));
					return;
				}
				case OpCode.SHR: {
					const left = this.readRKNumber(frame, rkB);
					const right = this.readRKNumber(frame, rkC);
					this.setRegisterNumberFast(frame, registers, a, left >> (right & 31));
					return;
				}
				case OpCode.CONCAT: {
					const left = this.readRK(frame, rkB);
					const right = this.readRK(frame, rkC);
					const text = this.valueToString(left) + this.valueToString(right);
					const handle = this.stringPool.intern(text);
					this.setRegisterStringFast(frame, registers, a, StringValue.get(handle));
					return;
				}
				case OpCode.CONCATN: {
					let text = '';
					for (let index = 0; index < c; index += 1) {
						text += this.valueToString(registers.get(b + index));
					}
					const handle = this.stringPool.intern(text);
					this.setRegisterStringFast(frame, registers, a, StringValue.get(handle));
					return;
				}
				case OpCode.UNM: {
					const value = this.readRegisterNumber(frame, b);
					this.setRegisterNumberFast(frame, registers, a, -value);
					return;
				}
				case OpCode.NOT:
					this.setRegisterBoolFast(frame, registers, a, !registers.isTruthy(b));
					return;
				case OpCode.LEN: {
					const value = registers.get(b);
					if (valueIsString(value)) {
						const cp = this.stringPool.codepointCount(asStringId(value));
						this.setRegisterNumberFast(frame, registers, a, cp);
						return;
					}
					if (value instanceof Table) {
						this.setRegisterNumberFast(frame, registers, a, value.arrayLength);
						return;
					}
					if (isNativeObject(value)) {
					if (!value.len) {
						const stack = this.getCallStack()
							.map(entry => {
								const range = this.getDebugRange(entry.pc);
								if (!range) return '<unknown>';
								return this.formatSourceLocation(range);
							})
							.reverse()
							.join(' <- ');
						throw new Error(`Length operator expects a native object with a length. stack=${stack}`);
					}
					this.setRegisterNumberFast(frame, registers, a, value.len());
					return;
				}
				const stack = this.getCallStack()
					.map(entry => {
						const range = this.getDebugRange(entry.pc);
						if (!range) return '<unknown>';
						return `${range.path}:${range.start.line}:${range.start.column}`;
					})
					.reverse()
					.join(' <- ');
				throw new Error(`Length operator expects a string or table. stack=${stack}`);
				}
				case OpCode.BNOT: {
					const value = this.readRegisterNumber(frame, b);
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
					let ok: boolean;
					if (typeof left === 'number' && typeof right === 'number') {
						ok = left < right;
					} else if (valueIsString(left) && valueIsString(right)) {
						ok = this.stringPool.toString(asStringId(left)) < this.stringPool.toString(asStringId(right));
					} else {
						throw new Error(`Attempted to compare ${valueTypeName(left)} with ${valueTypeName(right)}. at ${this.formatLastSourceLocation()}`);
					}
					if (ok !== (a !== 0)) {
						this.skipNextInstruction(frame);
					}
					return;
				}
				case OpCode.LE: {
					const left = this.readRK(frame, rkB);
					const right = this.readRK(frame, rkC);
					let ok: boolean;
					if (typeof left === 'number' && typeof right === 'number') {
						ok = left <= right;
					} else if (valueIsString(left) && valueIsString(right)) {
						ok = this.stringPool.toString(asStringId(left)) <= this.stringPool.toString(asStringId(right));
					} else {
						throw new Error(`Attempted to compare ${valueTypeName(left)} with ${valueTypeName(right)}. at ${this.formatLastSourceLocation()}`);
					}
					if (ok !== (a !== 0)) {
						this.skipNextInstruction(frame);
					}
					return;
				}
				case OpCode.JMP: {
					frame.pc += sbx * INSTRUCTION_BYTES;
					return;
				}
				case OpCode.JMPIF: {
					if (registers.isTruthy(a)) {
						frame.pc += sbx * INSTRUCTION_BYTES;
					}
					return;
				}
				case OpCode.JMPIFNOT: {
					if (!registers.isTruthy(a)) {
						frame.pc += sbx * INSTRUCTION_BYTES;
					}
					return;
				}
				case OpCode.CLOSURE: {
					this.setRegisterClosureFast(frame, registers, a, this.createClosure(frame, bx));
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
					if (callee === null) {
						throw new Error(`Attempted to call a nil value. at ${this.formatLastSourceLocation()}`);
					}
					if (isBuiltinFunction(callee)) {
						this.runBuiltinFunction(callee, frame, a, c, argCount);
						return;
					}
					if (isNativeFunction(callee)) {
						this.charge(callee.cost.base);
						const argsHandle = this.acquireNativeArgsProxy();
					const results = this.nativeReturnScratch.acquire();
						try {
							argsHandle.view.bindRegisters(registers, a + 1, argCount);
							callee.invoke(argsHandle.proxy, results);
							if (this.frames.length > 0 && this.frames[this.frames.length - 1] === frame) {
								this.writeReturnValues(frame, a, c, results);
							}
							enforceLuaHeapBudget();
						} finally {
							this.releaseNativeArgsProxy(argsHandle);
							this.nativeReturnScratch.release(results);
						}
						return;
					}
					if (!valueIsClosure(callee)) {
						throw new Error(this.formatNonFunctionCallError(callee));
					}
					this.pushFrameFromCaller(frame, callee as Closure, a + 1, argCount, a, c, false, frame.pc - INSTRUCTION_BYTES);
					return;
				}
				case OpCode.RET: {
					const total = b === 0 ? Math.max(frame.top - a, 0) : b;
					this.closeUpvalues(frame);
					const frameIndex = this.frames.length - 1;
					if (frame.isInterruptFrame) {
						this.maskableInterruptsEnabled = frame.savedMaskableEnabled;
						this.frames.pop();
						this.stackTop = frame.varargBase;
						this.releaseFrame(frame);
						return;
					}
					if (frame.captureReturns) {
						if (this.externalReturnSink !== null) {
							this.captureValuesIntoArrayFromRegisters(this.externalReturnSink, registers, a, total);
						} else {
							this.captureValuesIntoArrayFromRegisters(this.lastReturnValues, registers, a, total);
						}
						this.frames.pop();
						this.stackTop = frame.varargBase;
						this.releaseFrame(frame);
						return;
					}
					if (frameIndex === 0) {
						if (this.externalReturnSink !== null) {
							this.captureValuesIntoArrayFromRegisters(this.externalReturnSink, registers, a, total);
						} else {
							this.captureValuesIntoArrayFromRegisters(this.lastReturnValues, registers, a, total);
						}
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
				case OpCode.LOAD_MEM_D: {
					const addr = registers.getNumber(b) + (disp << 2);
					this.setRegisterFast(frame, registers, a, this.readMappedMemoryValue(addr, c));
					return;
				}
				case OpCode.STORE_MEM_D: {
					const addr = registers.getNumber(b) + (disp << 2);
					this.writeMappedMemoryValue(addr, c, registers.get(a));
					return;
				}
				case OpCode.STORE_MEM_WORDS_D: {
					const addr = registers.getNumber(b) + (disp << 2);
					this.charge(ceilDiv4(c));
					this.writeMappedWordSequence(frame, addr, a, c);
					return;
				}
				case OpCode.LOAD_MEM: {
					const addr = this.readRKNumber(frame, rkB);
					this.setRegisterFast(frame, registers, a, this.readMappedMemoryValue(addr, c));
					return;
				}
				case OpCode.STORE_MEM: {
					const addr = this.readRKNumber(frame, rkB);
					this.writeMappedMemoryValue(addr, c, registers.get(a));
					return;
				}
				case OpCode.STORE_MEM_WORDS: {
					const addr = this.readRKNumber(frame, rkB);
					this.charge(ceilDiv4(c));
					this.writeMappedWordSequence(frame, addr, a, c);
					return;
				}
			default:
				throw new Error('Unknown opcode.');
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

	private pushFrame(closure: Closure, args: ReadonlyArray<Value>, returnBase: number, returnCount: number, captureReturns: boolean, callSitePc: number): CallFrame {
		const proto = this.program.protos[closure.protoIndex];
		const frame = this.acquireFrame();
		frame.protoIndex = closure.protoIndex;
		frame.pc = proto.entryPC;
		frame.closure = closure;
		frame.returnBase = returnBase;
		frame.returnCount = returnCount;
		frame.top = proto.numParams;
		frame.captureReturns = captureReturns;
		frame.callSitePc = callSitePc;
		frame.varargBase = this.stackTop;
		frame.varargCount = proto.isVararg ? Math.max(args.length - proto.numParams, 0) : 0;
		const registers = this.prepareFrameRegisters(frame, proto.maxStack);

		let argIndex = 0;
		for (let index = 0; index < proto.numParams; index += 1) {
			registers.set(index, argIndex < args.length ? args[argIndex] : null);
			argIndex += 1;
		}
		if (proto.isVararg) {
			for (let index = 0; index < frame.varargCount; index += 1) {
				this.stackRegisters.set(frame.varargBase + index, args[argIndex + index]);
			}
		}
		this.frames.push(frame);
		return frame;
	}

	private pushFrameFromCaller(caller: CallFrame, closure: Closure, argBase: number, argCount: number, returnBase: number, returnCount: number, captureReturns: boolean, callSitePc: number): void {
		const proto = this.program.protos[closure.protoIndex];
		const frame = this.acquireFrame();
		frame.protoIndex = closure.protoIndex;
		frame.pc = proto.entryPC;
		frame.closure = closure;
		frame.returnBase = returnBase;
		frame.returnCount = returnCount;
		frame.top = proto.numParams;
		frame.captureReturns = captureReturns;
		frame.callSitePc = callSitePc;
		frame.varargBase = this.stackTop;
		frame.varargCount = proto.isVararg ? Math.max(argCount - proto.numParams, 0) : 0;

		const callerRegisters = caller.registers;
		const registers = this.prepareFrameRegisters(frame, proto.maxStack);
		const copiedCount = Math.min(proto.numParams, argCount);
		if (copiedCount > 0) {
			registers.copyRangeFrom(callerRegisters, 0, argBase, copiedCount);
		}
		for (let index = copiedCount; index < proto.numParams; index += 1) {
			registers.setNil(index);
		}
		if (proto.isVararg) {
			for (let index = 0; index < frame.varargCount; index += 1) {
				this.stackRegisters.set(frame.varargBase + index, callerRegisters.get(argBase + proto.numParams + index));
			}
		}
		this.frames.push(frame);
	}

	private createClosure(frame: CallFrame, protoIndex: number): Closure {
		const proto = this.program.protos[protoIndex];
		if (proto.staticClosure && proto.upvalueDescs.length === 0) {
			return this.rootClosure(protoIndex);
		}
		const upvalues = new Array<Upvalue>(proto.upvalueDescs.length);
		for (let index = 0; index < proto.upvalueDescs.length; index += 1) {
			const desc = proto.upvalueDescs[index];
			if (desc.inStack) {
				let upvalue = this.findOpenUpvalue(frame, desc.index);
				if (!upvalue) {
					upvalue = { open: true, index: desc.index, frame, value: null };
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
		return { protoIndex, upvalues, heapBytes };
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
				throw new Error('[CPU] Attempted to grow registers for a released frame.');
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

	private readRegisterNumber(frame: CallFrame, index: number): number {
		const registers = frame.registers;
		return registers.getNumber(index);
	}

	private readMappedMemoryValue(addr: number, accessKind: number): Value {
		switch (accessKind) {
			case MemoryAccessKind.Word:
				return this.memory.readMappedValue(addr);
			case MemoryAccessKind.U8:
				return this.memory.readMappedU8(addr);
			case MemoryAccessKind.U16LE:
				return this.memory.readMappedU16LE(addr);
			case MemoryAccessKind.U32LE:
				return this.memory.readMappedU32LE(addr);
			case MemoryAccessKind.F32LE:
				return this.memory.readMappedF32LE(addr);
			case MemoryAccessKind.F64LE:
				return this.memory.readMappedF64LE(addr);
			default:
				throw new Error(`[CPU] Unknown memory access kind: ${accessKind}.`);
		}
	}

	private writeMappedMemoryValue(addr: number, accessKind: number, value: Value): void {
		if (accessKind === MemoryAccessKind.Word) {
			this.memory.writeMappedValue(addr, value);
			return;
		}
		if (accessKind < MemoryAccessKind.U8 || accessKind > MemoryAccessKind.F64LE) {
			throw new Error(`[CPU] Unknown memory access kind: ${accessKind}.`);
		}
		if (typeof value !== 'number') {
			throw new Error(`[Memory] ${MEMORY_ACCESS_KIND_NAMES[accessKind]}[addr] expects a number. Got ${typeof value}.`);
		}
		switch (accessKind) {
			case MemoryAccessKind.U8:
				this.memory.writeMappedU8(addr, value);
				return;
			case MemoryAccessKind.U16LE:
				this.memory.writeMappedU16LE(addr, value);
				return;
			case MemoryAccessKind.U32LE:
				this.memory.writeMappedU32LE(addr, value);
				return;
			case MemoryAccessKind.F32LE:
				this.memory.writeMappedF32LE(addr, value);
				return;
			case MemoryAccessKind.F64LE:
				this.memory.writeMappedF64LE(addr, value);
				return;
			default:
				throw new Error(`[CPU] Unknown memory access kind: ${accessKind}.`);
		}
	}

	private writeMappedWordSequence(frame: CallFrame, addr: number, valueBase: number, valueCount: number): void {
		let writeAddr = addr;
		for (let offset = 0; offset < valueCount; offset += 1) {
			this.memory.writeMappedValue(writeAddr, frame.registers.get(valueBase + offset));
			writeAddr += 4;
		}
	}

	private readRKNumber(frame: CallFrame, rk: number): number {
		if (rk < 0) {
			const index = -1 - rk;
			const value = this.program.constPool[index];
			return value as number;
		}
		return this.readRegisterNumber(frame, rk);
	}

	private readRK(frame: CallFrame, rk: number): Value {
		if (rk < 0) {
			const index = -1 - rk;
			return this.program.constPool[index];
		}
		return frame.registers.get(rk);
	}

	public callBuiltinFunction(fn: BuiltinFunction, args: ReadonlyArray<Value>, out: Value[]): void {
		out.length = 0;
		switch (fn.id) {
			case BuiltinFunctionId.Next:
				this.runBuiltinNextValue(args.length > 0 ? args[0] : null, args.length > 1 ? args[1] : null, out);
				break;
			case BuiltinFunctionId.Type:
				this.runBuiltinType(args.length > 0 ? args[0] : null, out);
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
				this.runBuiltinPCall(args, out);
				break;
			case BuiltinFunctionId.XPCall:
				this.runBuiltinXPCall(args, out);
				break;
		}
	}

	private runBuiltinFunction(fn: BuiltinFunction, frame: CallFrame, callBase: number, returnCount: number, argCount: number): void {
		this.charge(fn.cost.base);
		const argsHandle = this.acquireNativeArgsProxy();
		const results = this.nativeReturnScratch.acquire();
		try {
			argsHandle.view.bindRegisters(frame.registers, callBase + 1, argCount);
			this.callBuiltinFunction(fn, argsHandle.proxy, results);
			if (this.frames.length > 0 && this.frames[this.frames.length - 1] === frame) {
				this.writeReturnValues(frame, callBase, returnCount, results);
			}
		} finally {
			this.releaseNativeArgsProxy(argsHandle);
			this.nativeReturnScratch.release(results);
		}
	}

	private runBuiltinNextValue(target: Value, keyValue: Value, out: Value[]): void {
		out.length = 0;
		if (target instanceof Table) {
			const entry = target.nextEntry(keyValue);
			if (entry === null) {
				out.push(null);
				return;
			}
			out.push(entry[0], entry[1]);
			return;
		}
		if (isNativeObject(target)) {
			if (target.nextEntry) {
				const entry = target.nextEntry(keyValue);
				if (entry === null) {
					out.push(null);
					return;
				}
				out.push(entry[0], entry[1]);
				return;
			}
			throw new Error('next expects a native object with iteration.');
		}
		throw new Error('next expects a table or native object.');
	}

	private runBuiltinType(value: Value, out: Value[]): void {
		out.push(StringValue.get(this.stringPool.intern(this.typeNameForLua(value))));
	}

	private typeNameForLua(value: Value): string {
		const rawName = valueTypeName(value);
		switch (rawName) {
			case 'builtin_function':
			case 'native_function':
			case 'closure':
				return 'function';
			case 'native_object':
				return 'native';
			default:
				return rawName;
		}
	}

	private runBuiltinSetMetatable(args: ReadonlyArray<Value>, out: Value[]): void {
		if (args.length === 0 || (!(args[0] instanceof Table) && !isNativeObject(args[0]))) {
			throw new Error('setmetatable expects a table or native value as the first argument.');
		}
		let metatable: Table | null = null;
		if (args.length > 1 && args[1] !== null) {
			if (!(args[1] instanceof Table)) {
				throw new Error('setmetatable expects a table or nil as the second argument.');
			}
			metatable = args[1];
		}
		const target = args[0];
		if (target instanceof Table) {
			target.metatable = metatable;
			out.push(target);
			return;
		}
		target.metatable = metatable;
		out.push(target);
	}

	private runBuiltinGetMetatable(args: ReadonlyArray<Value>, out: Value[]): void {
		if (args.length === 0 || (!(args[0] instanceof Table) && !isNativeObject(args[0]))) {
			throw new Error('getmetatable expects a table or native value as the first argument.');
		}
		out.push(args[0].metatable);
	}

	private runBuiltinRawGet(args: ReadonlyArray<Value>, out: Value[]): void {
		out.push((args[0] as Table).get(args.length > 1 ? args[1] : null));
	}

	private runBuiltinRawSet(args: ReadonlyArray<Value>, out: Value[]): void {
		const target = args[0] as Table;
		target.set(args[1], args.length > 2 ? args[2] : null);
		out.push(target);
	}

	private runBuiltinSelect(args: ReadonlyArray<Value>, out: Value[]): void {
		const index = args[0];
		const count = args.length - 1;
		if (valueIsString(index) && this.stringPool.toString(asStringId(index)) === '#') {
			out.push(count);
			return;
		}
		const start = (index as number) >= 0
			? (index as number)
			: count + (index as number) + 1;
		for (let index = start; index <= count; index += 1) {
			if (index >= 1 && index < args.length) {
				out.push(args[index]);
			}
		}
	}

	private runBuiltinStringByte(args: ReadonlyArray<Value>, out: Value[]): void {
		const source = this.stringPool.toString(asStringId(args[0] as StringValue));
		const position = args.length > 1 ? Math.trunc(args[1] as number) : 1;
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

	private runBuiltinStringChar(args: ReadonlyArray<Value>, out: Value[]): void {
		if (args.length === 0) {
			out.push(StringValue.get(this.stringPool.intern('')));
			return;
		}
		let result = '';
		for (let index = 0; index < args.length; index += 1) {
			result += String.fromCodePoint(Math.trunc(args[index] as number));
		}
		out.push(StringValue.get(this.stringPool.intern(result)));
	}

	private runBuiltinError(args: ReadonlyArray<Value>): never {
		const value = args.length > 0 ? args[0] : StringValue.get(this.stringPool.intern('nil'));
		throw new LuaThrownValueError(value, this.valueToString(value));
	}

	private callValueInto(callee: Value, args: ReadonlyArray<Value>, out: Value[]): void {
		out.length = 0;
		if (isBuiltinFunction(callee)) {
			this.callBuiltinFunction(callee, args, out);
			return;
		}
		if (isNativeFunction(callee)) {
			callee.invoke(args, out);
			return;
		}
		if (!valueIsClosure(callee)) {
			throw new Error(this.formatNonFunctionCallError(callee));
		}
		const closure = callee;
		const depth = this.frames.length;
		const previousBudget = this.instructionBudgetRemaining;
		const previousSink = this.swapExternalReturnSink(out);
		const budgetSentinel = Number.MAX_SAFE_INTEGER;
		let spentBudget = 0;
		let activeBudget = 0;
		try {
			this.pushFrame(closure, args, 0, 0, true, this.program.protos[closure.protoIndex].entryPC);
			while (this.frames.length > depth) {
				activeBudget = budgetSentinel;
				const result = this.runUntilDepth(depth, budgetSentinel);
				spentBudget += activeBudget - this.instructionBudgetRemaining;
				activeBudget = 0;
				if (this.frames.length > depth && result === RunResult.Halted) {
					throw new Error('Protected call halted before returning.');
				}
			}
		} catch (error) {
			if (activeBudget > 0) {
				spentBudget += activeBudget - this.instructionBudgetRemaining;
			}
			this.unwindToDepth(depth);
			throw error;
		} finally {
			this.swapExternalReturnSink(previousSink);
			this.instructionBudgetRemaining = previousBudget - spentBudget;
		}
	}

	private runBuiltinPCall(args: ReadonlyArray<Value>, out: Value[]): void {
		const callArgs = this.nativeReturnScratch.acquire();
		const results = this.nativeReturnScratch.acquire();
		try {
			callArgs.length = 0;
			for (let index = 1; index < args.length; index += 1) {
				callArgs.push(args[index]);
			}
			this.callValueInto(args.length > 0 ? args[0] : null, callArgs, results);
			out.length = 0;
			out.push(true);
			for (let index = 0; index < results.length; index += 1) {
				out.push(results[index]);
			}
		} catch (error) {
			out.length = 0;
			out.push(false, error instanceof LuaThrownValueError ? error.value : StringValue.get(this.stringPool.intern(error instanceof Error ? error.message : String(error))));
		} finally {
			this.nativeReturnScratch.release(results);
			this.nativeReturnScratch.release(callArgs);
		}
	}

	private runBuiltinXPCall(args: ReadonlyArray<Value>, out: Value[]): void {
		const callArgs = this.nativeReturnScratch.acquire();
		const handlerArgs = this.nativeReturnScratch.acquire();
		const results = this.nativeReturnScratch.acquire();
		try {
			callArgs.length = 0;
			for (let index = 2; index < args.length; index += 1) {
				callArgs.push(args[index]);
			}
			this.callValueInto(args.length > 0 ? args[0] : null, callArgs, results);
			out.length = 0;
			out.push(true);
			for (let index = 0; index < results.length; index += 1) {
				out.push(results[index]);
			}
		} catch (error) {
			handlerArgs.length = 0;
			handlerArgs.push(error instanceof LuaThrownValueError ? error.value : StringValue.get(this.stringPool.intern(error instanceof Error ? error.message : String(error))));
			this.callValueInto(args.length > 1 ? args[1] : null, handlerArgs, results);
			out.length = 0;
			out.push(false);
			for (let index = 0; index < results.length; index += 1) {
				out.push(results[index]);
			}
		} finally {
			this.nativeReturnScratch.release(results);
			this.nativeReturnScratch.release(handlerArgs);
			this.nativeReturnScratch.release(callArgs);
		}
	}

	public captureRuntimeState(moduleCache: ReadonlyMap<string, Value>): CpuRuntimeState {
		this.syncGlobalSlotsToTable();
		const frameIndexByRef = new WeakMap<CallFrame, number>();
		for (let index = 0; index < this.frames.length; index += 1) {
			frameIndexByRef.set(this.frames[index], index);
		}
		const stablePathByNative = new WeakMap<object, CpuRuntimeRefSegment[]>();
		const stableValueByPath = new Map<string, Value>();
		const stableTables = new WeakSet<Table>();
		const stableNativeObjects = new WeakSet<NativeObject>();

		const encodePathKey = (path: ReadonlyArray<CpuRuntimeRefSegment>): string => {
			let key = '';
			for (let index = 0; index < path.length; index += 1) {
				const segment = path[index];
				if (typeof segment === 'number') {
					key += `#${segment};`;
					continue;
				}
				key += `$${segment.length}:${segment};`;
			}
			return key;
		};

		const recordStableValue = (path: ReadonlyArray<CpuRuntimeRefSegment>, value: Value): void => {
			if (!isBuiltinFunction(value) && !isNativeFunction(value) && !isNativeObject(value)) {
				return;
			}
			stableValueByPath.set(encodePathKey(path), value);
			stablePathByNative.set(value, [...path]);
		};

		const traverseStableValue = (path: CpuRuntimeRefSegment[], value: Value): void => {
			recordStableValue(path, value);
			if (value instanceof Table) {
				if (stableTables.has(value)) {
					return;
				}
				stableTables.add(value);
				const metatable = value.metatable;
				if (metatable !== null) {
					traverseStableValue([...path, CPU_RUNTIME_METATABLE_SEGMENT], metatable);
				}
				for (let arrayIndex = 1; arrayIndex <= value.arrayLength; arrayIndex += 1) {
					const arrayValue = value.getInteger(arrayIndex);
					if (arrayValue !== null) {
						traverseStableValue([...path, arrayIndex], arrayValue);
					}
				}
				value.forEachEntry((key, entryValue) => {
					if (typeof key === 'number') {
						if (Number.isInteger(key)) {
							traverseStableValue([...path, key], entryValue);
						}
						return;
					}
					if (valueIsString(key)) {
						traverseStableValue([...path, this.stringPool.toString(asStringId(key))], entryValue);
					}
				});
				return;
			}
			if (!isNativeObject(value)) {
				return;
			}
			if (stableNativeObjects.has(value)) {
				return;
			}
			stableNativeObjects.add(value);
			if (value.metatable !== null) {
				traverseStableValue([...path, CPU_RUNTIME_METATABLE_SEGMENT], value.metatable);
			}
		};

		this.globals.forEachEntry((key, value) => {
			if (!valueIsString(key)) {
				return;
			}
			traverseStableValue(['globals', this.stringPool.toString(asStringId(key))], value);
		});
		for (const [name, value] of moduleCache) {
			traverseStableValue(['moduleCache', name], value);
		}

		const objectIds = new WeakMap<object, number>();
		const objects: CpuObjectState[] = [];

		const ensureObjectId = (object: Table | Closure | Upvalue): number => {
			const existing = objectIds.get(object);
			if (existing !== undefined) {
				return existing;
			}
			const id = objects.length;
			objectIds.set(object, id);
			objects.push(captureObjectState(object));
			return id;
		};

		const captureValueState = (value: Value): CpuValueState => {
			if (value === null) {
				return { tag: 'nil' };
			}
			if (typeof value === 'boolean') {
				return { tag: value ? 'true' : 'false' };
			}
			if (typeof value === 'number') {
				return { tag: 'number', value };
			}
			if (valueIsString(value)) {
				return { tag: 'string', id: value.id };
			}
			if (isBuiltinFunction(value) || isNativeFunction(value) || isNativeObject(value)) {
				const path = stablePathByNative.get(value);
				if (path === undefined) {
					throw new Error(`[CPU] Runtime snapshot cannot preserve native value '${valueTypeName(value)}' without a stable root path.`);
				}
				return { tag: 'stable_ref', path };
			}
			return { tag: 'ref', id: ensureObjectId(value as Table | Closure) };
		};

		const captureObjectState = (object: Table | Closure | Upvalue): CpuObjectState => {
			if (object instanceof Table) {
				const tableState = object.captureRuntimeState();
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
					array,
					arrayLength: tableState.arrayLength,
					hash,
					hashFree: tableState.hashFree,
					metatable: captureValueState(tableState.metatable),
				};
			}
			const upvalue = object as Upvalue;
			if ((upvalue as Upvalue).frame !== undefined && (upvalue as Upvalue).open !== undefined && (upvalue as Upvalue).index !== undefined) {
				const frameIndex = upvalue.open ? frameIndexByRef.get(upvalue.frame) ?? -1 : -1;
				if (upvalue.open && frameIndex < 0) {
					throw new Error('[CPU] Runtime snapshot found an open upvalue without a tracked frame.');
				}
				return {
					kind: 'upvalue',
					open: upvalue.open,
					index: upvalue.index,
					frameIndex,
					value: captureValueState(upvalue.open ? upvalue.frame.registers.get(upvalue.index) : upvalue.value),
				};
			}
			const closure = object as Closure;
			const upvalues = new Array(closure.upvalues.length);
			for (let index = 0; index < closure.upvalues.length; index += 1) {
				upvalues[index] = ensureObjectId(closure.upvalues[index]);
			}
			return {
				kind: 'closure',
				protoIndex: closure.protoIndex,
				upvalues,
			};
		};

		const globals: CpuRootValueState[] = [];
		this.globals.forEachEntry((key, value) => {
			if (!valueIsString(key)) {
				return;
			}
			globals.push({
				name: this.stringPool.toString(asStringId(key)),
				value: captureValueState(value),
			});
		});

		const moduleCacheState: CpuRootValueState[] = [];
		for (const [name, value] of moduleCache) {
			moduleCacheState.push({
				name,
				value: captureValueState(value),
			});
		}

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
				protoIndex: frame.protoIndex,
				pc: frame.pc,
				closureRef: ensureObjectId(frame.closure),
				registers,
				varargs,
				returnBase: frame.returnBase,
				returnCount: frame.returnCount,
				top: frame.top,
				captureReturns: frame.captureReturns,
				callSitePc: frame.callSitePc,
				isInterruptFrame: frame.isInterruptFrame,
				savedMaskableEnabled: frame.savedMaskableEnabled,
			};
		}

		const lastReturnValues = new Array<CpuValueState>(this.lastReturnValues.length);
		for (let index = 0; index < this.lastReturnValues.length; index += 1) {
			lastReturnValues[index] = captureValueState(this.lastReturnValues[index]);
		}

		const openUpvalues = new Array<number>(this.openUpvalues.length);
		for (let index = 0; index < this.openUpvalues.length; index += 1) {
			openUpvalues[index] = ensureObjectId(this.openUpvalues[index].upvalue);
		}

		return {
			globals,
			moduleCache: moduleCacheState,
			frames,
			lastReturnValues,
			objects,
			openUpvalues,
			lastPc: this.lastPc,
			lastInstruction: this.lastInstruction,
			instructionBudgetRemaining: this.instructionBudgetRemaining,
			haltedUntilIrq: this.haltedUntilIrq,
			maskableInterruptsEnabled: this.maskableInterruptsEnabled,
			maskableInterruptsRestoreEnabled: this.maskableInterruptsRestoreEnabled,
			nonMaskableInterruptPending: this.nonMaskableInterruptPending,
			yieldRequested: this.yieldRequested,
		};
	}

	public restoreRuntimeState(state: CpuRuntimeState, moduleCache: Map<string, Value>): void {
		const stableValueByPath = new Map<string, Value>();
		const stableTables = new WeakSet<Table>();
		const stableNativeObjects = new WeakSet<NativeObject>();

		const encodePathKey = (path: ReadonlyArray<CpuRuntimeRefSegment>): string => {
			let key = '';
			for (let index = 0; index < path.length; index += 1) {
				const segment = path[index];
				if (typeof segment === 'number') {
					key += `#${segment};`;
					continue;
				}
				key += `$${segment.length}:${segment};`;
			}
			return key;
		};

		const recordStableValue = (path: ReadonlyArray<CpuRuntimeRefSegment>, value: Value): void => {
			if (!isBuiltinFunction(value) && !isNativeFunction(value) && !isNativeObject(value)) {
				return;
			}
			stableValueByPath.set(encodePathKey(path), value);
		};

		const traverseStableValue = (path: CpuRuntimeRefSegment[], value: Value): void => {
			recordStableValue(path, value);
			if (value instanceof Table) {
				if (stableTables.has(value)) {
					return;
				}
				stableTables.add(value);
				const metatable = value.metatable;
				if (metatable !== null) {
					traverseStableValue([...path, CPU_RUNTIME_METATABLE_SEGMENT], metatable);
				}
				for (let arrayIndex = 1; arrayIndex <= value.arrayLength; arrayIndex += 1) {
					const arrayValue = value.getInteger(arrayIndex);
					if (arrayValue !== null) {
						traverseStableValue([...path, arrayIndex], arrayValue);
					}
				}
				value.forEachEntry((key, entryValue) => {
					if (typeof key === 'number') {
						if (Number.isInteger(key)) {
							traverseStableValue([...path, key], entryValue);
						}
						return;
					}
					if (valueIsString(key)) {
						traverseStableValue([...path, this.stringPool.toString(asStringId(key))], entryValue);
					}
				});
				return;
			}
			if (!isNativeObject(value)) {
				return;
			}
			if (stableNativeObjects.has(value)) {
				return;
			}
			stableNativeObjects.add(value);
			if (value.metatable !== null) {
				traverseStableValue([...path, CPU_RUNTIME_METATABLE_SEGMENT], value.metatable);
			}
		};

		this.syncGlobalSlotsToTable();
		this.globals.forEachEntry((key, value) => {
			if (!valueIsString(key)) {
				return;
			}
			traverseStableValue(['globals', this.stringPool.toString(asStringId(key))], value);
		});
		for (const [name, value] of moduleCache) {
			traverseStableValue(['moduleCache', name], value);
		}

		type RestoredObject = Table | Closure | Upvalue;
		const restoredObjects = new Array<RestoredObject>(state.objects.length);

		for (let index = 0; index < state.objects.length; index += 1) {
			const objectState = state.objects[index];
			switch (objectState.kind) {
				case 'table':
					restoredObjects[index] = new Table(0, 0);
					break;
				case 'closure': {
					const upvalues = new Array<Upvalue>(objectState.upvalues.length);
					const proto = this.program.protos[objectState.protoIndex];
					if (proto.staticClosure && upvalues.length === 0) {
						restoredObjects[index] = this.rootClosure(objectState.protoIndex);
					} else {
						const heapBytes = CLOSURE_HEAP_BYTES + (upvalues.length * CLOSURE_UPVALUE_SLOT_HEAP_BYTES);
						addTrackedLuaHeapBytes(heapBytes);
						restoredObjects[index] = { protoIndex: objectState.protoIndex, upvalues, heapBytes };
					}
					break;
				}
				case 'upvalue':
					addTrackedLuaHeapBytes(UPVALUE_HEAP_BYTES);
					restoredObjects[index] = { open: false, index: objectState.index, frame: null, value: null };
					break;
			}
		}

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
				case 'ref':
					return restoredObjects[valueState.id] as Table | Closure;
				case 'stable_ref': {
					const value = stableValueByPath.get(encodePathKey(valueState.path));
					if (value === undefined) {
						throw new Error('[CPU] Runtime snapshot stable reference is not available in the current runtime environment.');
					}
					return value;
				}
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
					closure.protoIndex = objectState.protoIndex;
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

		this.lastReturnValues.length = 0;
		this.clearCallStack();
		this.externalReturnSink = null;
		this.globals.clear();
		for (let slot = 0; slot < this.systemGlobalValues.length; slot += 1) {
			this.systemGlobalValues[slot] = null;
		}
		for (let slot = 0; slot < this.globalValues.length; slot += 1) {
			this.globalValues[slot] = null;
		}
		moduleCache.clear();

		for (let frameIndex = 0; frameIndex < state.frames.length; frameIndex += 1) {
			const frameState = state.frames[frameIndex];
			const proto = this.program.protos[frameState.protoIndex];
			const frame = this.acquireFrame();
			frame.protoIndex = frameState.protoIndex;
			frame.pc = frameState.pc;
			frame.closure = restoredObjects[frameState.closureRef] as Closure;
			frame.returnBase = frameState.returnBase;
			frame.returnCount = frameState.returnCount;
			frame.captureReturns = frameState.captureReturns;
			frame.callSitePc = frameState.callSitePc;
			frame.isInterruptFrame = frameState.isInterruptFrame;
			frame.savedMaskableEnabled = frameState.savedMaskableEnabled;
			frame.varargBase = this.stackTop;
			frame.varargCount = frameState.varargs.length;
			const registers = this.prepareFrameRegisters(frame, proto.maxStack);
			for (let registerIndex = 0; registerIndex < frameState.registers.length; registerIndex += 1) {
				registers.set(registerIndex, restoreValue(frameState.registers[registerIndex]));
			}
			for (let varargIndex = 0; varargIndex < frameState.varargs.length; varargIndex += 1) {
				this.stackRegisters.set(frame.varargBase + varargIndex, restoreValue(frameState.varargs[varargIndex]));
			}
			frame.top = frameState.top;
			this.frames.push(frame);
		}

		for (let index = 0; index < state.openUpvalues.length; index += 1) {
			const upvalueState = state.objects[state.openUpvalues[index]];
			if (upvalueState.kind !== 'upvalue' || !upvalueState.open) {
				throw new Error('[CPU] Runtime snapshot contains an invalid open upvalue reference.');
			}
			const upvalue = restoredObjects[state.openUpvalues[index]] as Upvalue;
			const frame = this.frames[upvalueState.frameIndex];
			if (!frame) {
				throw new Error('[CPU] Runtime snapshot open upvalue refers to a missing frame.');
			}
			upvalue.open = true;
			upvalue.index = upvalueState.index;
			upvalue.frame = frame;
			upvalue.value = null;
			this.openUpvalues.push({ frame, index: upvalue.index, upvalue });
		}

		for (let index = 0; index < state.globals.length; index += 1) {
			const entry = state.globals[index];
			this.setGlobalByKey(StringValue.get(this.stringPool.intern(entry.name)), restoreValue(entry.value));
		}
		for (let index = 0; index < state.moduleCache.length; index += 1) {
			const entry = state.moduleCache[index];
			moduleCache.set(entry.name, restoreValue(entry.value));
		}

		for (let index = 0; index < state.lastReturnValues.length; index += 1) {
			this.lastReturnValues[index] = restoreValue(state.lastReturnValues[index]);
		}
		this.lastPc = state.lastPc;
		this.lastInstruction = state.lastInstruction;
		this.instructionBudgetRemaining = state.instructionBudgetRemaining;
		this.haltedUntilIrq = state.haltedUntilIrq;
		this.maskableInterruptsEnabled = state.maskableInterruptsEnabled;
		this.maskableInterruptsRestoreEnabled = state.maskableInterruptsRestoreEnabled;
		this.nonMaskableInterruptPending = state.nonMaskableInterruptPending;
		this.yieldRequested = state.yieldRequested;
		refreshTrackedLuaHeapBytes();
	}

	public collectTrackedHeapBytes(extraRoots: ReadonlyArray<Value> = []): number {
		const seen = new WeakSet<object>();
		let total = 0;
		const valueStack: Value[] = [];
		const upvalueStack: Upvalue[] = [];
		this.stringPool.beginReachabilityEpoch();
		if (this.indexKey !== null) {
			this.stringPool.markReachable(asStringId(this.indexKey));
		}

		const pushValue = (value: Value): void => {
			if (value === null || typeof value === 'boolean' || typeof value === 'number') {
				return;
			}
			if (valueIsString(value)) {
				this.stringPool.markReachable(asStringId(value));
				return;
			}
			valueStack.push(value);
		};

		pushValue(this.globals);
		for (let slot = 0; slot < this.systemGlobalValues.length; slot += 1) {
			pushValue(this.systemGlobalValues[slot]);
		}
		for (let slot = 0; slot < this.globalValues.length; slot += 1) {
			pushValue(this.globalValues[slot]);
		}
		if (this.stringIndexTable !== null) {
			pushValue(this.stringIndexTable);
		}
		this.memory.collectRootValues(pushValue);
		for (let index = 0; index < this.lastReturnValues.length; index += 1) {
			pushValue(this.lastReturnValues[index]);
		}
		if (this.externalReturnSink !== null) {
			for (let index = 0; index < this.externalReturnSink.length; index += 1) {
				pushValue(this.externalReturnSink[index]);
			}
		}
		if (this.program !== null) {
			for (let index = 0; index < this.program.constPool.length; index += 1) {
				pushValue(this.program.constPool[index]);
			}
		}
		for (let frameIndex = 0; frameIndex < this.frames.length; frameIndex += 1) {
			const frame = this.frames[frameIndex];
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
			if (value instanceof Table) {
				if (seen.has(value)) {
					continue;
				}
				seen.add(value);
				total += value.getTrackedHeapBytes();
				value.walkTrackedValues(pushValue);
				continue;
			}
			if (isBuiltinFunction(value)) {
				if (seen.has(value)) {
					continue;
				}
				seen.add(value);
				total += BUILTIN_FUNCTION_HEAP_BYTES;
				continue;
			}
			if (isNativeFunction(value)) {
				if (seen.has(value)) {
					continue;
				}
				seen.add(value);
				total += NATIVE_FUNCTION_HEAP_BYTES;
				continue;
			}
			if (isNativeObject(value)) {
				if (seen.has(value)) {
					continue;
				}
				seen.add(value);
				total += NATIVE_OBJECT_HEAP_BYTES;
				if (value.metatable !== null) {
					pushValue(value.metatable);
				}
				continue;
			}
			const closure = value as Closure;
			if (seen.has(closure)) {
				continue;
			}
			seen.add(closure);
			total += closure.heapBytes ?? 0;
			for (let index = 0; index < closure.upvalues.length; index += 1) {
				upvalueStack.push(closure.upvalues[index]);
			}
		}
		this.stringPool.reclaimUnreachableTracked();
		total += this.stringPool.trackedLuaHeapBytes();
		return total;
	}

	private formatNonFunctionCallError(callee: Value): string {
		return `Attempted to call a non-function value. callee=${valueTypeName(callee)}(${this.valueToString(callee)}). at ${this.formatLastSourceLocation()}`;
	}

	private valueToString(value: Value): string {
		if (value === null) {
			return 'nil';
		}
		if (typeof value === 'boolean') {
			return value ? 'true' : 'false';
		}
		if (typeof value === 'number') {
			if (!Number.isFinite(value)) {
				return Number.isNaN(value) ? 'nan' : (value < 0 ? '-inf' : 'inf');
			}
			// Parity with C++ runtime string output (Lua tostring semantics).
			// Slower than V8's native formatting; avoid tight-loop conversions.
			return formatNumber(value);
		}
		if (valueIsString(value)) {
			return this.stringPool.toString(asStringId(value));
		}
		if (value instanceof Table) {
			return 'table';
		}
		if (isBuiltinFunction(value)) {
			return 'function';
		}
		if (isNativeFunction(value)) {
			return 'function';
		}
		if (isNativeObject(value)) {
			return 'native';
		}
		return 'function';
	}

}

// end normalized-body-acceptable
// end repeated-sequence-acceptable
