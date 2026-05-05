import { StringPool, StringValue, isStringValue, stringValueToString } from '../memory/string/pool';
import type { Memory } from '../memory/memory';
import type { StringHandleTableState } from '../memory/string/memory';
import {
	addTrackedLuaHeapBytes,
	collectTrackedLuaHeapBytes as refreshTrackedLuaHeapBytes,
	replaceTrackedLuaHeapBytes
} from '../memory/lua_heap_usage';
import { formatNumber } from '../common/number_format';
import { BASE_CYCLES, OpCode } from './opcode_info';
import { CpuExecutionProfiler, formatCpuProfilerReport, type CpuProfilerReportOptions, type CpuProfilerSnapshot } from './profiler';
import { EXT_A_BITS, EXT_B_BITS, EXT_BX_BITS, EXT_C_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_OPERAND_BITS, readInstructionWord, signExtend } from './instruction_format';
import { MEMORY_ACCESS_KIND_NAMES, MemoryAccessKind } from '../memory/access_kind';
import { ScratchBuffer } from '../../common/scratchbuffer';
import { ScratchArrayStack } from '../../common/scratchstack';
import { luaModulo } from '../../lua/numeric';

export { OpCode } from './opcode_info';

// start repeated-sequence-acceptable -- Lua VM/table/register hot paths deliberately keep short copy/update sequences inline.
// start normalized-body-acceptable -- Specialized Lua VM accessors stay split so the fast paths avoid dispatch helpers.

export type Value = null | boolean | number | StringValue | Table | Closure | NativeFunction | NativeObject;

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

const NATIVE_FUNCTION_KIND = 'native_function';
const NATIVE_OBJECT_KIND = 'native_object';

export type NativeFnCost = {
	base: number;
	perArg: number;
	perRet: number;
};

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
	if (isStringValue(value)) return 'string';
	if (value instanceof Table) return 'table';
	if (isNativeFunction(value)) return 'native_function';
	if (isNativeObject(value)) return 'native_object';
	return 'closure';
}

const NATIVE_COST_TIER0: NativeFnCost = { base: 0, perArg: 0, perRet: 0 };
const NATIVE_COST_TIER1: NativeFnCost = { base: 1, perArg: 0, perRet: 0 };
const NATIVE_COST_TIER2: NativeFnCost = { base: 2, perArg: 0, perRet: 0 };
const NATIVE_COST_TIER4: NativeFnCost = { base: 4, perArg: 0, perRet: 0 };
const DEFAULT_NATIVE_COST = NATIVE_COST_TIER1;

function resolveNativeFunctionCost(name: string): NativeFnCost {
	switch (name) {
		case 'clock_now':
		case 'devtools.get_lua_entry_path':
			return NATIVE_COST_TIER0;
		case 'math.abs':
		case 'math.acos':
		case 'math.asin':
		case 'math.atan':
		case 'math.ceil':
		case 'math.cos':
		case 'math.deg':
		case 'math.exp':
		case 'math.floor':
		case 'math.fmod':
		case 'math.log':
		case 'math.max':
		case 'math.min':
		case 'math.rad':
		case 'math.sin':
		case 'math.sign':
		case 'math.sqrt':
		case 'math.tan':
		case 'math.tointeger':
		case 'math.type':
		case 'math.ult':
		case 'math.random':
		case 'easing.linear':
		case 'easing.ease_in_quad':
		case 'easing.ease_out_quad':
		case 'easing.ease_in_out_quad':
		case 'easing.ease_out_back':
		case 'easing.smoothstep':
		case 'easing.pingpong01':
		case 'easing.arc01':
		case 'type':
		case 'tonumber':
		case 'tostring':
		case 'rawequal':
		case 'rawget':
		case 'rawset':
		case 'select':
		case 'next':
		case 'u32_to_f32':
		case 'u64_to_f64':
		case 'os.clock':
		case 'os.difftime':
			return NATIVE_COST_TIER1;
		case 'pairs':
		case 'ipairs':
		case 'pairs.iterator':
		case 'ipairs.iterator':
		case 'string.gmatch.iterator':
		case 'getmetatable':
		case 'setmetatable':
		case 'table.insert':
		case 'table.remove':
		case 'table.pack':
		case 'table.unpack':
		case 'string.len':
		case 'string.byte':
		case 'string.char':
		case 'string.sub':
		case 'string.upper':
		case 'string.lower':
		case 'string.rep':
		case 'array':
		case 'assert':
		case 'error':
		case 'math.modf':
		case 'math.randomseed':
		case 'os.time':
			return NATIVE_COST_TIER2;
		case 'string.find':
		case 'string.match':
		case 'string.gsub':
		case 'string.gmatch':
		case 'string.format':
		case 'table.concat':
		case 'table.sort':
		case 'wrap_text_lines':
		case 'pcall':
		case 'xpcall':
		case 'loadstring':
		case 'load':
		case 'require':
		case 'print':
		case 'os.date':
		case 'devtools.list_lua_resources':
		case 'devtools.get_lua_resource_source':
			return NATIVE_COST_TIER4;
		default:
			return DEFAULT_NATIVE_COST;
	}
}

export function createNativeFunction(
	name: string,
	invoke: (args: ReadonlyArray<Value>, out: Value[]) => void,
	cost?: NativeFnCost,
): NativeFunction {
	const resolvedCost = cost ?? resolveNativeFunctionCost(name);
	addTrackedLuaHeapBytes(16);
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
	addTrackedLuaHeapBytes(24);
	return { kind: NATIVE_OBJECT_KIND, raw, get: handlers.get, set: handlers.set, len: handlers.len, nextEntry: handlers.nextEntry, metatable: null };
}

export function isNativeFunction(value: Value): value is NativeFunction {
	return (value as NativeFunction)?.kind === NATIVE_FUNCTION_KIND;
}

export function isNativeObject(value: Value): value is NativeObject {
	return (value as NativeObject)?.kind === NATIVE_OBJECT_KIND;
}

export type ProgramMetadata = {
	debugRanges: ReadonlyArray<SourceRange | null>;
	protoIds: string[];
	localSlotsByProto?: ReadonlyArray<ReadonlyArray<LocalSlotDebug>>;
	upvalueNamesByProto?: ReadonlyArray<ReadonlyArray<string>>;
	globalNames: string[];
	systemGlobalNames: string[];
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
};

export type CpuRootValueState = {
	name: string;
	value: CpuValueState;
};

export type CpuRuntimeState = {
	globals: CpuRootValueState[];
	ioMemory: CpuValueState[];
	moduleCache: CpuRootValueState[];
	frames: CpuFrameState[];
	lastReturnValues: CpuValueState[];
	objects: CpuObjectState[];
	openUpvalues: number[];
	lastPc: number;
	lastInstruction: number;
	instructionBudgetRemaining: number;
	haltedUntilIrq: boolean;
	yieldRequested: boolean;
};

export type Program = {
	code: Uint8Array;
	constPool: Value[];
	protos: Proto[];
	stringPool: StringPool;
	constPoolStringPool: StringPool;
};

export type Proto = {
	entryPC: number;
	codeLen: number;
	numParams: number;
	isVararg: boolean;
	maxStack: number;
	upvalueDescs: UpvalueDesc[];
};

export type UpvalueDesc = {
	inStack: boolean;
	index: number;
};

export type Closure = {
	protoIndex: number;
	upvalues: Upvalue[];
};

export const enum RunResult {
	Halted,
	Yielded,
}

const CEIL_DIV4 = (value: number) => (value + 3) >> 2;

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
	private array: Value[];
	private arrayLength = 0;
	private hash: HashNode[];
	private hashFree = -1;
	private metatable: Table | null = null;
	private version = 1;

	private static readonly numberBuffer = new ArrayBuffer(8);
	private static readonly float64View = new Float64Array(Table.numberBuffer);
	private static readonly uint32View = new Uint32Array(Table.numberBuffer);
	private static readonly objectIds = new WeakMap<object, number>();
	private static nextObjectId = 1;

	constructor(arraySize: number, hashSize: number) {
		this.array = new Array<Value>(arraySize);
		this.array.fill(null);
		const size = hashSize > 0 ? Table.nextPowerOfTwo(hashSize) : 0;
		this.hash = new Array<HashNode>(size);
		for (let i = 0; i < size; i += 1) {
			this.hash[i] = { key: null, value: null, next: -1 };
		}
		this.hashFree = size > 0 ? size - 1 : -1;
		addTrackedLuaHeapBytes(this.getTrackedHeapBytes());
	}

	public get(key: Value): Value {
		if (key === null) {
			throw new Error('Table index is nil.');
		}
		const index = this.tryGetArrayIndex(key);
		if (index !== null && index < this.array.length) {
			const value = this.array[index];
			return value === undefined ? null : value;
		}
		const nodeIndex = this.findNodeIndex(key);
		if (nodeIndex >= 0) {
			return this.hash[nodeIndex].value;
		}
		return null;
	}

	public set(key: Value, value: Value): void {
		if (key === null) {
			throw new Error('Table index is nil.');
		}
		const index = this.tryGetArrayIndex(key);
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
				this.hash[nodeIndex].value = value;
				this.bumpVersion();
				return;
			}
			if (this.hash.length === 0 || this.hashFree < 0) {
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
			this.hash[nodeIndex].value = value;
			this.bumpVersion();
			return;
		}
		if (this.hash.length === 0 || this.hashFree < 0) {
			this.rehash(key);
		}
		this.rawSet(key, value);
		this.bumpVersion();
	}

	public getInteger(indexValue: number): Value {
		const index = indexValue - 1;
		if (index >= 0 && index < this.array.length) {
			const value = this.array[index];
			return value === undefined ? null : value;
		}
		const nodeIndex = this.findNodeIndex(indexValue);
		if (nodeIndex >= 0) {
			return this.hash[nodeIndex].value;
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
			this.hash[nodeIndex].value = value;
			this.bumpVersion();
			return;
		}
		if (this.hash.length === 0 || this.hashFree < 0) {
			this.rehash(indexValue);
		}
		this.rawSet(indexValue, value);
		this.bumpVersion();
	}

	public getStringKey(key: StringValue): Value {
		const nodeIndex = this.findNodeIndex(key);
		if (nodeIndex >= 0) {
			return this.hash[nodeIndex].value;
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
			this.hash[nodeIndex].value = value;
			this.bumpVersion();
			return;
		}
		if (this.hash.length === 0 || this.hashFree < 0) {
			this.rehash(key);
		}
		this.rawSet(key, value);
		this.bumpVersion();
	}

	public length(): number {
		return this.arrayLength;
	}

	public clear(): void {
		const previousBytes = this.getTrackedHeapBytes();
		this.array.length = 0;
		this.arrayLength = 0;
		this.hash.length = 0;
		this.hashFree = -1;
		this.bumpVersion();
		replaceTrackedLuaHeapBytes(previousBytes, this.getTrackedHeapBytes());
	}

	public entriesArray(): ReadonlyArray<[Value, Value]> {
		const entries: Array<[Value, Value]> = [];
		this.forEachEntry((key, value) => {
			entries.push([key, value]);
		});
		return entries;
	}

	public forEachEntry(visitor: (key: Value, value: Value) => void): void {
		for (let index = 0; index < this.array.length; index += 1) {
			const value = this.array[index];
			if (value === null || value === undefined) {
				continue;
			}
			visitor(index + 1, value);
		}
		for (let index = 0; index < this.hash.length; index += 1) {
			const node = this.hash[index];
			if (node.key !== null) {
				visitor(node.key, node.value);
			}
		}
	}

	public getMetatable(): Table | null {
		return this.metatable;
	}

	public getVersion(): number {
		return this.version;
	}

	public captureRuntimeState(): TableRuntimeState {
		const array = this.array.slice();
		const hash: HashNode[] = new Array(this.hash.length);
		for (let index = 0; index < this.hash.length; index += 1) {
			const node = this.hash[index];
			hash[index] = { key: node.key, value: node.value, next: node.next };
		}
		return {
			array,
			arrayLength: this.arrayLength,
			hash,
			hashFree: this.hashFree,
			metatable: this.metatable,
		};
	}

	public restoreRuntimeState(state: TableRuntimeState): void {
		const previousBytes = this.getTrackedHeapBytes();
		this.array = state.array.slice();
		this.arrayLength = state.arrayLength;
		this.hash = new Array<HashNode>(state.hash.length);
		for (let index = 0; index < state.hash.length; index += 1) {
			const node = state.hash[index];
			this.hash[index] = { key: node.key, value: node.value, next: node.next };
		}
		this.hashFree = state.hashFree;
		this.metatable = state.metatable;
		this.bumpVersion();
		replaceTrackedLuaHeapBytes(previousBytes, this.getTrackedHeapBytes());
	}

	public walkTrackedValues(visitor: (value: Value) => void): void {
		visitor(this.metatable);
		for (let index = 0; index < this.array.length; index += 1) {
			visitor(this.array[index]);
		}
		for (let index = 0; index < this.hash.length; index += 1) {
			const node = this.hash[index];
			visitor(node.key);
			visitor(node.value);
		}
	}

	public getTrackedHeapBytes(): number {
		return 32
			+ (this.array.length * 8)
			+ (this.hash.length * 24);
	}

	public setMetatable(metatable: Table | null): void {
		if (metatable !== null && !(metatable instanceof Table)) {
			throw new Error('setmetatable expects a table or nil as the second argument.');
		}
		this.metatable = metatable;
		this.bumpVersion();
	}

	public nextEntry(after: Value): [Value, Value] | null {
		if (after === null) {
			for (let index = 0; index < this.array.length; index += 1) {
				const value = this.array[index];
				if (value !== null && value !== undefined) {
					return [index + 1, value];
				}
			}
			for (let index = 0; index < this.hash.length; index += 1) {
				const node = this.hash[index];
				if (node.key !== null) {
					return [node.key, node.value];
				}
			}
			return null;
		}
		const index = this.tryGetArrayIndex(after);
		if (index !== null && index < this.array.length) {
			if (this.array[index] === null) {
				return null;
			}
			for (let cursor = index + 1; cursor < this.array.length; cursor += 1) {
				const value = this.array[cursor];
				if (value !== null && value !== undefined) {
					return [cursor + 1, value];
				}
			}
			for (let i = 0; i < this.hash.length; i += 1) {
				const node = this.hash[i];
				if (node.key !== null) {
					return [node.key, node.value];
				}
			}
			return null;
		}
		const nodeIndex = this.findNodeIndex(after);
		if (nodeIndex < 0) {
			return null;
		}
		for (let i = nodeIndex + 1; i < this.hash.length; i += 1) {
			const node = this.hash[i];
			if (node.key !== null) {
				return [node.key, node.value];
			}
		}
		return null;
	}

	public nextEntryFromCursor(arrayCursor: number, hashCursor: number, previousHashKey: Value = null): [number, number, Value, Value] | null {
		for (let index = arrayCursor; index < this.array.length; index += 1) {
			const value = this.array[index];
			if (value !== null && value !== undefined) {
				return [index + 1, 0, index + 1, value];
			}
		}
		const hashStart = hashCursor > 0 ? hashCursor - 1 : 0;
		for (let index = hashStart; index < this.hash.length; index += 1) {
			const node = this.hash[index];
			if (node.key !== null) {
				if (hashCursor > 0 && index === hashCursor - 1 && previousHashKey !== null && this.keyEquals(node.key, previousHashKey)) {
					continue;
				}
				return [this.array.length, index + 1, node.key, node.value];
			}
		}
		return null;
	}

	private static nextPowerOfTwo(value: number): number {
		if (value <= 0) {
			return 0;
		}
		let power = 1;
		while (power < value) {
			power *= 2;
		}
		return power;
	}

	private static ceilLog2(value: number): number {
		let log = 0;
		let power = 1;
		while (power < value) {
			power *= 2;
			log += 1;
		}
		return log;
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
		if (isStringValue(key)) {
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
		if (isStringValue(a) && isStringValue(b)) {
			return a.id === b.id;
		}
		return a === b;
	}

	private findNodeIndex(key: Value): number {
		if (this.hash.length === 0) {
			return -1;
		}
		const mask = this.hash.length - 1;
		let index = (this.hashValue(key) & mask) >>> 0;
		while (index >= 0) {
			const node = this.hash[index];
			if (node.key !== null && this.keyEquals(node.key, key)) {
				return index;
			}
			index = node.next;
		}
		return -1;
	}

	private getFreeIndex(): number {
		const start = this.hashFree >= 0 ? this.hashFree : this.hash.length - 1;
		for (let i = start; i >= 0; i -= 1) {
			if (this.hash[i].key === null) {
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
			const log = Table.ceilLog2(index);
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
		for (let i = 0; i < this.hash.length; i += 1) {
			const node = this.hash[i];
			if (node.key !== null) {
				totalKeys += 1;
				const index = this.tryGetArrayIndex(node.key);
				if (index !== null) {
					countIntegerKey(index + 1);
				}
			}
		}
		if (key !== null) {
			totalKeys += 1;
			const index = this.tryGetArrayIndex(key);
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
		const hashSize = hashKeys > 0 ? Table.nextPowerOfTwo(hashKeys) : 0;
		this.resize(arraySize, hashSize);
	}

	private resize(newArraySize: number, newHashSize: number): void {
		const previousBytes = this.getTrackedHeapBytes();
		const oldArray = this.array;
		const oldHash = this.hash;

		this.array = new Array<Value>(newArraySize);
		this.array.fill(null);
		this.arrayLength = 0;
		this.hash = new Array<HashNode>(newHashSize);
		for (let i = 0; i < newHashSize; i += 1) {
			this.hash[i] = { key: null, value: null, next: -1 };
		}
		this.hashFree = newHashSize > 0 ? newHashSize - 1 : -1;

		for (let i = 0; i < oldArray.length; i += 1) {
			if (oldArray[i] !== null) {
				this.rawSet(i + 1, oldArray[i]);
			}
		}
		for (let i = 0; i < oldHash.length; i += 1) {
			const node = oldHash[i];
			if (node.key !== null) {
				this.rawSet(node.key, node.value);
			}
		}
		replaceTrackedLuaHeapBytes(previousBytes, this.getTrackedHeapBytes());
	}

	private rawSet(key: Value, value: Value): void {
		const index = this.tryGetArrayIndex(key);
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
		if (this.hash.length === 0) {
			this.rehash(key);
			this.rawSet(key, value);
			return;
		}
		const mask = this.hash.length - 1;
		const mainIndex = (this.hashValue(key) & mask) >>> 0;
		const mainNode = this.hash[mainIndex];
		if (mainNode.key === null) {
			mainNode.key = key;
			mainNode.value = value;
			mainNode.next = -1;
			return;
		}
		const freeIndex = this.getFreeIndex();
		if (freeIndex < 0) {
			this.rehash(key);
			this.rawSet(key, value);
			return;
		}
		const freeNode = this.hash[freeIndex];
		const mainIndexOfOccupied = (this.hashValue(mainNode.key) & mask) >>> 0;
		if (mainIndexOfOccupied !== mainIndex) {
			freeNode.key = mainNode.key;
			freeNode.value = mainNode.value;
			freeNode.next = mainNode.next;
			let prev = mainIndexOfOccupied;
			while (this.hash[prev].next !== mainIndex) {
				prev = this.hash[prev].next;
			}
			this.hash[prev].next = freeIndex;
			mainNode.key = key;
			mainNode.value = value;
			mainNode.next = -1;
			return;
		}
		freeNode.key = key;
		freeNode.value = value;
		freeNode.next = mainNode.next;
		mainNode.next = freeIndex;
	}

	private removeFromHash(key: Value): void {
		if (this.hash.length === 0) {
			return;
		}
		const mask = this.hash.length - 1;
		const mainIndex = (this.hashValue(key) & mask) >>> 0;
		let prev = -1;
		let index = mainIndex;
		while (index >= 0) {
			const node = this.hash[index];
			if (node.key !== null && this.keyEquals(node.key, key)) {
				const next = node.next;
				if (prev >= 0) {
					this.hash[prev].next = next;
					node.key = null;
					node.value = null;
					node.next = -1;
					if (index > this.hashFree) {
						this.hashFree = index;
					}
					return;
				}
				if (next >= 0) {
					const nextNode = this.hash[next];
					node.key = nextNode.key;
					node.value = nextNode.value;
					node.next = nextNode.next;
					nextNode.key = null;
					nextNode.value = null;
					nextNode.next = -1;
					if (next > this.hashFree) {
						this.hashFree = next;
					}
					return;
				}
				node.key = null;
				node.value = null;
				node.next = -1;
				if (index > this.hashFree) {
					this.hashFree = index;
				}
				return;
			}
			prev = index;
			index = node.next;
		}
	}

	private tryGetArrayIndex(key: Value): number | null {
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
			return value !== null && value !== undefined;
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
		if (isStringValue(value)) {
			this.setString(index, value);
			return;
		}
		if (value instanceof Table) {
			this.setTable(index, value);
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

// Pool constant for frame reuse
const MAX_POOLED_FRAMES = 32;
const USES_BX = new Uint8Array(64);
USES_BX[OpCode.LOADK] = 1;
USES_BX[OpCode.KSMI] = 1;
USES_BX[OpCode.GETG] = 1;
USES_BX[OpCode.SETG] = 1;
USES_BX[OpCode.GETSYS] = 1;
USES_BX[OpCode.SETSYS] = 1;
USES_BX[OpCode.GETGL] = 1;
USES_BX[OpCode.SETGL] = 1;
USES_BX[OpCode.CLOSURE] = 1;
USES_BX[OpCode.JMP] = 1;
USES_BX[OpCode.JMPIF] = 1;
USES_BX[OpCode.JMPIFNOT] = 1;
USES_BX[OpCode.BR_TRUE] = 1;
USES_BX[OpCode.BR_FALSE] = 1;

export class CPU {
	public instructionBudgetRemaining: number = 0;
	public lastReturnValues: Value[] = [];
	public lastPc: number = 0;
	public lastInstruction: number = 0;
	public readonly globals: Table;
	public readonly memory: Memory;

	private program: Program = null;
	private metadata: ProgramMetadata | null = null;
	private readonly stringPool: StringPool;
	private indexKey: StringValue = null;
	private haltedUntilIrq = false;
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
	private readonly profiler = new CpuExecutionProfiler();
	private profilerEnabled = false;
	private externalReturnSink: Value[] | null = null;
	private decodedWidths: Uint8Array | null = null;
	private decodedOps: Uint8Array | null = null;
	private decodedA: Uint16Array | null = null;
	private decodedB: Uint16Array | null = null;
	private decodedC: Uint16Array | null = null;
	private decodedBx: Uint32Array | null = null;
	private decodedSbx: Int32Array | null = null;
	private decodedRkB: Int32Array | null = null;
	private decodedRkC: Int32Array | null = null;
	private decodedWords: Uint32Array | null = null;
	private tableLoadCaches: TableLoadInlineCache[] = [];
	private stringIndexTable: Table | null = null;
	private systemGlobalNames: StringValue[] = [];
	private systemGlobalValues: Value[] = [];
	private systemGlobalSlotByKey: Map<StringValue, number> = new Map();
	private globalNames: StringValue[] = [];
	private globalValues: Value[] = [];
	private globalSlotByKey: Map<StringValue, number> = new Map();
	private readonly framePool: CallFrame[] = [];
	private stackRegisters = new RegisterFile(8);
	private stackTop = 0;

	constructor(memory: Memory, stringPool: StringPool | null = null) {
		this.memory = memory;
		this.stringPool = stringPool ?? new StringPool();
		this.globals = new Table(0, 0);
		this.indexKey = this.stringPool.intern('__index');
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

	private acquireNativeReturnScratch(): Value[] {
		return this.nativeReturnScratch.acquire();
	}

	private releaseNativeReturnScratch(out: Value[]): void {
		this.nativeReturnScratch.release(out);
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
			const metatable = current.getMetatable();
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

	private resolveTableIndex(table: Table, key: Value): Value {
		return this.resolveTableIndexChain(table, key, TableIndexKeyKind.Value);
	}

	private resolveTableIntegerIndex(table: Table, index: number): Value {
		return this.resolveTableIndexChain(table, index, TableIndexKeyKind.Integer);
	}

	private resolveTableFieldIndex(table: Table, key: StringValue): Value {
		return this.resolveTableIndexChain(table, key, TableIndexKeyKind.Field);
	}

	private loadTableIndex(base: Value, key: Value): Value {
		if (base instanceof Table) {
			if (base.getMetatable() === null) {
				return base.get(key);
			}
			return this.resolveTableIndex(base, key);
		}
		if (isStringValue(base)) {
			const indexTable = this.stringIndexTable;
			if (indexTable === null) {
				return null;
			}
			if (indexTable.getMetatable() === null) {
				return indexTable.get(key);
			}
			return this.resolveTableIndex(indexTable, key);
		}
		if (isNativeObject(base)) {
			const directValue = base.get(key);
			const metatable = base.metatable;
			if (directValue !== null || metatable === null) {
				return directValue;
			}
			const indexer = metatable.getStringKey(this.indexKey);
			if (indexer instanceof Table) {
				return this.resolveTableIndex(indexer, key);
			}
			return null;
		}
		throw new Error('Attempted to index field on a non-table value.');
	}

	private loadTableIntegerIndexCached(cacheIndex: number, base: Value, index: number): Value {
		if (base instanceof Table) {
			if (base.getMetatable() === null) {
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
			return this.resolveTableIntegerIndex(base, index);
		}
		if (isStringValue(base)) {
			const table = this.stringIndexTable;
			if (table === null) {
				return null;
			}
			if (table.getMetatable() === null) {
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
			return this.resolveTableIntegerIndex(table, index);
		}
		if (isNativeObject(base)) {
			const directValue = base.get(index);
			if (directValue !== null || base.metatable === null) {
				return directValue;
			}
			const indexer = base.metatable.getStringKey(this.indexKey);
			if (indexer instanceof Table) {
				return this.resolveTableIntegerIndex(indexer, index);
			}
			return directValue;
		}
		throw new Error('Attempted to index field on a non-table value.');
	}

	private loadTableFieldIndexCached(cacheIndex: number, base: Value, key: StringValue): Value {
		if (base instanceof Table) {
			if (base.getMetatable() === null) {
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
			return this.resolveTableFieldIndex(base, key);
		}
		if (isStringValue(base)) {
			const table = this.stringIndexTable;
			if (table === null) {
				return null;
			}
			if (table.getMetatable() === null) {
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
			return this.resolveTableFieldIndex(table, key);
		}
		if (isNativeObject(base)) {
			const directValue = base.get(key);
			if (directValue !== null || base.metatable === null) {
				return directValue;
			}
			const indexer = base.metatable.getStringKey(this.indexKey);
			if (indexer instanceof Table) {
				return this.resolveTableFieldIndex(indexer, key);
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
		};
	}

	private releaseFrame(frame: CallFrame): void {
		frame.varargBase = 0;
		frame.varargCount = 0;
		frame.stackBase = 0;
		frame.stackCapacity = 0;
		frame.registers.rebind(this.stackRegisters, 0, 0);
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

	public setProgram(program: Program, metadata: ProgramMetadata | null = null): void {
		// Keep slot-backed globals materialized in the globals table before swapping programs.
		// SETGL/SETSYS mutate the slot arrays directly, and append/reload paths rebuild the next
		// slot layout from `globals`, so without this sync flattened module exports can fall back to nil.
		this.syncGlobalSlotsToTable();
		this.program = program;
		this.memory.setProgramCode(program.code);
		this.metadata = metadata;
		const constPool = program.constPool;
		for (let index = 0; index < constPool.length; index += 1) {
			const value = constPool[index];
			if (isStringValue(value)) {
				constPool[index] = this.stringPool.intern(stringValueToString(value));
			}
		}
		program.constPoolStringPool = this.stringPool;
		this.indexKey = this.stringPool.intern('__index');
		this.initializeGlobalSlots(metadata);
		this.decodeProgram(program);
		this.profiler.configureProgram(program, metadata, this.decodedOps!);
	}

	private initializeGlobalSlots(metadata: ProgramMetadata | null): void {
		const systemNames = metadata ? metadata.systemGlobalNames : [];
		const globalNames = metadata ? metadata.globalNames : [];
		this.systemGlobalNames = new Array(systemNames.length);
		this.systemGlobalValues = new Array(systemNames.length);
		this.systemGlobalSlotByKey = new Map();
		for (let index = 0; index < systemNames.length; index += 1) {
			const key = this.stringPool.intern(systemNames[index]);
			this.systemGlobalNames[index] = key;
			this.systemGlobalSlotByKey.set(key, index);
			this.systemGlobalValues[index] = this.globals.get(key);
		}
		this.globalNames = new Array(globalNames.length);
		this.globalValues = new Array(globalNames.length);
		this.globalSlotByKey = new Map();
		for (let index = 0; index < globalNames.length; index += 1) {
			const key = this.stringPool.intern(globalNames[index]);
			this.globalNames[index] = key;
			this.globalSlotByKey.set(key, index);
			this.globalValues[index] = this.globals.get(key);
		}
	}

	private decodeProgram(program: Program): void {
		const code = program.code;
		const instructionCount = Math.floor(code.length / INSTRUCTION_BYTES);
		const decodedWidths = new Uint8Array(instructionCount);
		const decodedOps = new Uint8Array(instructionCount);
		const decodedA = new Uint16Array(instructionCount);
		const decodedB = new Uint16Array(instructionCount);
		const decodedC = new Uint16Array(instructionCount);
		const decodedBx = new Uint32Array(instructionCount);
		const decodedSbx = new Int32Array(instructionCount);
		const decodedRkB = new Int32Array(instructionCount);
		const decodedRkC = new Int32Array(instructionCount);
		const decodedWords = new Uint32Array(instructionCount);
		for (let wordIndex = 0; wordIndex < instructionCount; wordIndex += 1) {
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
			const usesBx = USES_BX[op] !== 0;
			const extA = usesBx ? 0 : (ext >>> 6) & 0x3;
			const extB = usesBx ? 0 : (ext >>> 3) & 0x7;
			const extC = usesBx ? 0 : (ext & 0x7);
			const aShift = MAX_OPERAND_BITS + (usesBx ? 0 : EXT_A_BITS);
			const bShift = MAX_OPERAND_BITS + EXT_B_BITS;
			const cShift = MAX_OPERAND_BITS + EXT_C_BITS;
			const bxLow = (bLow << MAX_OPERAND_BITS) | cLow;
			const rawB = (wideB << bShift) | (extB << MAX_OPERAND_BITS) | bLow;
			const rawC = (wideC << cShift) | (extC << MAX_OPERAND_BITS) | cLow;
			decodedWidths[wordIndex] = width;
			decodedWords[wordIndex] = instr;
			decodedOps[wordIndex] = op;
			decodedA[wordIndex] = (wideA << aShift) | (extA << MAX_OPERAND_BITS) | aLow;
			decodedB[wordIndex] = rawB;
			decodedC[wordIndex] = rawC;
			decodedBx[wordIndex] = (wideB << (MAX_BX_BITS + EXT_BX_BITS)) | ((usesBx ? ext : 0) << MAX_BX_BITS) | bxLow;
			decodedSbx[wordIndex] = signExtend(decodedBx[wordIndex], MAX_BX_BITS + EXT_BX_BITS + ((width - 1) * MAX_OPERAND_BITS));
			decodedRkB[wordIndex] = signExtend(rawB, MAX_OPERAND_BITS + EXT_B_BITS + ((width - 1) * MAX_OPERAND_BITS));
			decodedRkC[wordIndex] = signExtend(rawC, MAX_OPERAND_BITS + EXT_C_BITS + ((width - 1) * MAX_OPERAND_BITS));
		}
		this.decodedWidths = decodedWidths;
		this.decodedOps = decodedOps;
		this.decodedA = decodedA;
		this.decodedB = decodedB;
		this.decodedC = decodedC;
		this.decodedBx = decodedBx;
		this.decodedSbx = decodedSbx;
		this.decodedRkB = decodedRkB;
		this.decodedRkC = decodedRkC;
		this.decodedWords = decodedWords;
		this.tableLoadCaches = new Array<TableLoadInlineCache>(instructionCount);
		for (let index = 0; index < instructionCount; index += 1) {
			this.tableLoadCaches[index] = { table: null, version: 0, value: null };
		}
	}

	public getStringPool(): StringPool {
		return this.stringPool;
	}

	public rehydrateStringPoolFromHandleTable(state: StringHandleTableState): void {
		this.stringPool.rehydrateFromHandleTable(state);
	}

	public setStringIndexTable(table: Table | null): void {
		this.stringIndexTable = table;
	}

	public getProgram(): Program | null {
		return this.program;
	}

	public start(entryProtoIndex: number, args: Value[] = []): void {
		this.lastReturnValues.length = 0;
		this.clearCallStack();
		this.haltedUntilIrq = false;
		this.yieldRequested = false;
		const closure: Closure = { protoIndex: entryProtoIndex, upvalues: [] };
		addTrackedLuaHeapBytes(16);
		this.pushFrame(closure, args, 0, 0, false, this.program.protos[entryProtoIndex].entryPC);
	}

	public call(closure: Closure, args: Value[] = [], returnCount: number = 0): void {
		if (closure === null) {
			throw new Error('Attempted to call a nil value.');
		}
		if (typeof closure.protoIndex !== 'number') {
			throw new Error('Attempted to call a non-function value.');
		}
		this.lastReturnValues.length = 0;
		this.haltedUntilIrq = false;
		this.yieldRequested = false;
		this.pushFrame(closure, args, 0, returnCount, false, this.program.protos[closure.protoIndex].entryPC);
	}

	public callExternal(closure: Closure, args: Value[] = []): void {
		if (closure === null) {
			throw new Error('Attempted to call a nil value.');
		}
		if (typeof closure.protoIndex !== 'number') {
			throw new Error('Attempted to call a non-function value.');
		}
		this.lastReturnValues.length = 0;
		this.haltedUntilIrq = false;
		this.yieldRequested = false;
		this.pushFrame(closure, args, 0, 0, true, this.program.protos[closure.protoIndex].entryPC);
	}

	public requestYield(): void {
		this.yieldRequested = true;
	}

	public clearYieldRequest(): void {
		this.yieldRequested = false;
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

	public swapExternalReturnSink(sink: Value[] | null): Value[] | null {
		const previous = this.externalReturnSink;
		this.externalReturnSink = sink;
		return previous;
	}

	public getFrameDepth(): number {
		return this.frames.length;
	}

	public hasFrames(): boolean {
		return this.frames.length > 0;
	}

	public run(instructionBudget: number): RunResult {
		return this.runUntilDepth(0, instructionBudget);
	}

	public runUntilDepth(targetDepth: number, instructionBudget: number): RunResult {
		this.instructionBudgetRemaining = instructionBudget;
		const frames = this.frames;
		const profiler = this.profilerEnabled ? this.profiler : null;
		const baseCycles = BASE_CYCLES;
		const decodedWidths = this.decodedWidths!;
		const decodedOps = this.decodedOps!;
		const decodedA = this.decodedA!;
		const decodedB = this.decodedB!;
		const decodedC = this.decodedC!;
		const decodedBx = this.decodedBx!;
		const decodedSbx = this.decodedSbx!;
		const decodedRkB = this.decodedRkB!;
		const decodedRkC = this.decodedRkC!;
		const decodedWords = this.decodedWords!;
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
			const frame = frames[frames.length - 1];
			const pc = frame.pc;
			const wordIndex = pc / INSTRUCTION_BYTES;
			const width = decodedWidths[wordIndex];
			const op = decodedOps[wordIndex];
			frame.pc = pc + (width * INSTRUCTION_BYTES);
			this.lastPc = pc + ((width - 1) * INSTRUCTION_BYTES);
			this.lastInstruction = decodedWords[wordIndex];
			if (profiler !== null) {
				profiler.record(wordIndex, op);
			}
			this.instructionBudgetRemaining -= baseCycles[op];
			this.executeInstruction(
				frame,
				wordIndex,
				op,
				decodedA[wordIndex],
				decodedB[wordIndex],
				decodedC[wordIndex],
				decodedBx[wordIndex],
				decodedSbx[wordIndex],
				decodedRkB[wordIndex],
				decodedRkC[wordIndex],
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
		const decodedWidths = this.decodedWidths!;
		const wordIndex = frame.pc / INSTRUCTION_BYTES;
		// if (wordIndex >= decodedWidths.length) {
		// 	throw new Error('Attempted to skip beyond end of program.');
		// }
		frame.pc += decodedWidths[wordIndex] * INSTRUCTION_BYTES;
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
		let wordIndex = pc / INSTRUCTION_BYTES;
		const profiler = this.profilerEnabled ? this.profiler : null;
		const decodedWidths = this.decodedWidths!;
		const decodedOps = this.decodedOps!;
		const decodedA = this.decodedA!;
		const decodedB = this.decodedB!;
		const decodedC = this.decodedC!;
		const decodedBx = this.decodedBx!;
		const decodedSbx = this.decodedSbx!;
		const decodedRkB = this.decodedRkB!;
		const decodedRkC = this.decodedRkC!;
		const decodedWords = this.decodedWords!;
		const width = decodedWidths[wordIndex];
		const op = decodedOps[wordIndex];
		frame.pc = pc + (width * INSTRUCTION_BYTES);
		this.lastPc = pc + ((width - 1) * INSTRUCTION_BYTES);
		this.lastInstruction = decodedWords[wordIndex];
		if (profiler !== null) {
			profiler.record(wordIndex, op);
		}
		this.charge(BASE_CYCLES[op]);
		this.executeInstruction(
			frame,
			wordIndex,
			op,
			decodedA[wordIndex],
			decodedB[wordIndex],
			decodedC[wordIndex],
			decodedBx[wordIndex],
			decodedSbx[wordIndex],
			decodedRkB[wordIndex],
			decodedRkC[wordIndex],
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
			this.profiler.reset();
		}
	}

	public isProfilerEnabled(): boolean {
		return this.profilerEnabled;
	}

	public resetProfiler(): void {
		this.profiler.reset();
	}

	public getProfilerSnapshot(): CpuProfilerSnapshot {
		return this.profiler.snapshot();
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
		if (!frame) {
			throw new Error(`[CPU] Frame index out of range: ${frameIndex}.`);
		}
		return frame.registers.get(registerIndex);
	}

	public readFrameUpvalue(frameIndex: number, upvalueIndex: number): Value {
		const frame = this.frames[frameIndex];
		if (!frame) {
			throw new Error(`[CPU] Frame index out of range: ${frameIndex}.`);
		}
		const upvalue = frame.closure.upvalues[upvalueIndex];
		if (upvalue.open) {
			return upvalue.frame.registers.get(upvalue.index);
		}
		return upvalue.value;
	}

	public hasFrameUpvalue(frameIndex: number, upvalueIndex: number): boolean {
		const frame = this.frames[frameIndex];
		if (!frame) {
			throw new Error(`[CPU] Frame index out of range: ${frameIndex}.`);
		}
		return frame.closure.upvalues[upvalueIndex] !== undefined;
	}

	public getConst(index: number): Value {
		return this.program.constPool[index];
	}

	public setGlobalByKey(key: StringValue, value: Value): void {
		this.globals.set(key, value);
		const systemSlot = this.systemGlobalSlotByKey.get(key);
		if (systemSlot !== undefined) {
			this.systemGlobalValues[systemSlot] = value;
			return;
		}
		const globalSlot = this.globalSlotByKey.get(key);
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
			this.globals.set(this.systemGlobalNames[slot], this.systemGlobalValues[slot]);
		}
		for (let slot = 0; slot < this.globalNames.length; slot += 1) {
			this.globals.set(this.globalNames[slot], this.globalValues[slot]);
		}
	}

	public getGlobalByKey(key: StringValue): Value {
		const systemSlot = this.systemGlobalSlotByKey.get(key);
		if (systemSlot !== undefined) {
			return this.systemGlobalValues[systemSlot];
		}
		const globalSlot = this.globalSlotByKey.get(key);
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
		wordIndex: number,
		op: number,
		a: number,
		b: number,
		c: number,
		bx: number,
		sbx: number,
		rkB: number,
		rkC: number,
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
				case OpCode.LOADBOOL:
					this.setRegisterBoolFast(frame, registers, a, b !== 0);
					if (c !== 0) {
						this.skipNextInstruction(frame);
					}
					return;
				case OpCode.GETG: {
					const key = this.program.constPool[bx];
					this.setRegisterFast(frame, registers, a, this.globals.get(key));
					return;
				}
				case OpCode.SETG: {
					const key = this.program.constPool[bx];
					this.globals.set(key, registers.get(a));
					return;
				}
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
					this.setRegisterFast(frame, registers, a, this.loadTableIntegerIndexCached(wordIndex, registers.get(b), c));
					return;
				case OpCode.SETI:
					this.storeTableIntegerIndex(registers.get(a), b, this.readRK(frame, rkC));
					return;
				case OpCode.GETFIELD:
					this.setRegisterFast(frame, registers, a, this.loadTableFieldIndexCached(wordIndex, registers.get(b), this.program.constPool[c] as StringValue));
					return;
				case OpCode.SETFIELD:
					this.storeTableFieldIndex(registers.get(a), this.program.constPool[b] as StringValue, this.readRK(frame, rkC));
					return;
				case OpCode.SELF: {
					const base = registers.get(b);
					const key = this.program.constPool[c] as StringValue;
					this.setRegisterFast(frame, registers, a + 1, base);
					this.setRegisterFast(frame, registers, a, this.loadTableFieldIndexCached(wordIndex, base, key));
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
					this.setRegisterStringFast(frame, registers, a, handle);
					return;
				}
				case OpCode.CONCATN: {
					let text = '';
					for (let index = 0; index < c; index += 1) {
						text += this.valueToString(registers.get(b + index));
					}
					const handle = this.stringPool.intern(text);
					this.setRegisterStringFast(frame, registers, a, handle);
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
					if (isStringValue(value)) {
						const cp = this.stringPool.codepointCount(value);
						this.setRegisterNumberFast(frame, registers, a, cp);
						return;
					}
					if (value instanceof Table) {
						this.setRegisterNumberFast(frame, registers, a, value.length());
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
					const ok = (isStringValue(left) && isStringValue(right))
						? stringValueToString(left) < stringValueToString(right)
						: (left as number) < (right as number);
					if (ok !== (a !== 0)) {
						this.skipNextInstruction(frame);
					}
					return;
				}
				case OpCode.LE: {
					const left = this.readRK(frame, rkB);
					const right = this.readRK(frame, rkC);
					const ok = (isStringValue(left) && isStringValue(right))
						? stringValueToString(left) <= stringValueToString(right)
						: (left as number) <= (right as number);
					if (ok !== (a !== 0)) {
						this.skipNextInstruction(frame);
					}
					return;
				}
				case OpCode.TEST: {
					const ok = registers.isTruthy(a);
					if (ok !== (c !== 0)) {
						this.skipNextInstruction(frame);
					}
					return;
				}
				case OpCode.TESTSET: {
					const ok = registers.isTruthy(b);
					if (ok === (c !== 0)) {
						this.copyRegisterFast(frame, registers, a, b);
						return;
					}
					this.skipNextInstruction(frame);
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
				case OpCode.BR_TRUE: {
					if (registers.isTruthy(a)) {
						frame.pc += sbx * INSTRUCTION_BYTES;
					}
					return;
				}
				case OpCode.BR_FALSE: {
					if (!registers.isTruthy(a)) {
						frame.pc += sbx * INSTRUCTION_BYTES;
					}
					return;
				}
				case OpCode.CLOSURE: {
					this.setRegisterClosureFast(frame, registers, a, this.createClosure(frame, bx));
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
					return;
				}
				case OpCode.CALL: {
					const callee = registers.get(a);
					const argCount = b === 0 ? Math.max(frame.top - a - 1, 0) : b;
					if (callee === null) {
						throw new Error(`Attempted to call a nil value. at ${this.formatLastSourceLocation()}`);
					}
					if (isNativeFunction(callee)) {
						this.charge(callee.cost.base);
						const argsHandle = this.acquireNativeArgsProxy();
						const results = this.acquireNativeReturnScratch();
						try {
							argsHandle.view.bindRegisters(registers, a + 1, argCount);
							callee.invoke(argsHandle.proxy, results);
							if (this.frames.length > 0 && this.frames[this.frames.length - 1] === frame) {
								this.writeReturnValues(frame, a, c, results);
							}
						} finally {
							this.releaseNativeArgsProxy(argsHandle);
							this.releaseNativeReturnScratch(results);
						}
						return;
					}
					if (typeof (callee as Closure).protoIndex !== 'number') {
						const calleeType = valueTypeName(callee as Value);
						const calleeValue = isStringValue(callee)
							? ` value=${stringValueToString(callee)}`
							: (typeof callee === 'number' || typeof callee === 'boolean')
								? ` value=${String(callee)}`
								: '';
						throw new Error(`Attempted to call a non-function value (${calleeType}${calleeValue}). at ${this.formatLastSourceLocation()}`);
					}
					this.pushFrameFromCaller(frame, callee as Closure, a + 1, argCount, a, c, false, frame.pc - INSTRUCTION_BYTES);
					return;
				}
				case OpCode.RET: {
					const total = b === 0 ? Math.max(frame.top - a, 0) : b;
					this.closeUpvalues(frame);
					const frameIndex = this.frames.length - 1;
					if (frame.captureReturns) {
						if (this.externalReturnSink !== null) {
							this.captureValuesIntoArrayFromRegisters(this.externalReturnSink, registers, a, total);
						} else {
							this.captureLastReturnValuesFromRegisters(registers, a, total);
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
							this.captureLastReturnValuesFromRegisters(registers, a, total);
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
					this.charge(CEIL_DIV4(c));
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

	private pushFrame(closure: Closure, args: Value[], returnBase: number, returnCount: number, captureReturns: boolean, callSitePc: number): void {
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
		const upvalues = new Array<Upvalue>(proto.upvalueDescs.length);
		for (let index = 0; index < proto.upvalueDescs.length; index += 1) {
			const desc = proto.upvalueDescs[index];
			if (desc.inStack) {
				let upvalue = this.findOpenUpvalue(frame, desc.index);
				if (!upvalue) {
					upvalue = { open: true, index: desc.index, frame, value: null };
					this.openUpvalues.push({ frame, index: desc.index, upvalue });
					addTrackedLuaHeapBytes(24);
				}
				upvalues[index] = upvalue;
				continue;
			}
			upvalues[index] = frame.closure.upvalues[desc.index];
		}
		addTrackedLuaHeapBytes(16 + (upvalues.length * 8));
		return { protoIndex, upvalues };
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

	private captureLastReturnValuesFromRegisters(source: RegisterFile, sourceBase: number, sourceCount: number): void {
		this.captureValuesIntoArrayFromRegisters(this.lastReturnValues, source, sourceBase, sourceCount);
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
		if (registers.isNumber(index)) {
			return registers.getNumber(index);
		}
		const value = registers.get(index);
		if (typeof value !== 'number') {
			throw new Error(`Register ${index} expected a number, got ${valueTypeName(value)}.`);
		}
		return value;
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
			if (typeof value !== 'number') {
				throw new Error(`RK constant ${index} expected a number, got ${valueTypeName(value)}.`);
			}
			return value;
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
			if (!isNativeFunction(value) && !isNativeObject(value)) {
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
				const metatable = value.getMetatable();
				if (metatable !== null) {
					traverseStableValue([...path, CPU_RUNTIME_METATABLE_SEGMENT], metatable);
				}
				for (let arrayIndex = 1; arrayIndex <= value.length(); arrayIndex += 1) {
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
					if (isStringValue(key)) {
						traverseStableValue([...path, stringValueToString(key)], entryValue);
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
			if (!isStringValue(key)) {
				return;
			}
			traverseStableValue(['globals', stringValueToString(key)], value);
		});
		const ioSlots = this.memory.getIoSlots();
		for (let index = 0; index < ioSlots.length; index += 1) {
			traverseStableValue(['ioMemory', index], ioSlots[index]);
		}
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
			if (isStringValue(value)) {
				return { tag: 'string', id: value.id };
			}
			if (isNativeFunction(value) || isNativeObject(value)) {
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
			if (!isStringValue(key)) {
				return;
			}
			globals.push({
				name: stringValueToString(key),
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
			};
		}

		const lastReturnValues = new Array<CpuValueState>(this.lastReturnValues.length);
		for (let index = 0; index < this.lastReturnValues.length; index += 1) {
			lastReturnValues[index] = captureValueState(this.lastReturnValues[index]);
		}

		const ioMemory = new Array<CpuValueState>(ioSlots.length);
		for (let index = 0; index < ioSlots.length; index += 1) {
			ioMemory[index] = captureValueState(ioSlots[index]);
		}

		const openUpvalues = new Array<number>(this.openUpvalues.length);
		for (let index = 0; index < this.openUpvalues.length; index += 1) {
			openUpvalues[index] = ensureObjectId(this.openUpvalues[index].upvalue);
		}

		return {
			globals,
			ioMemory,
			moduleCache: moduleCacheState,
			frames,
			lastReturnValues,
			objects,
			openUpvalues,
			lastPc: this.lastPc,
			lastInstruction: this.lastInstruction,
			instructionBudgetRemaining: this.instructionBudgetRemaining,
			haltedUntilIrq: this.haltedUntilIrq,
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
			if (!isNativeFunction(value) && !isNativeObject(value)) {
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
				const metatable = value.getMetatable();
				if (metatable !== null) {
					traverseStableValue([...path, CPU_RUNTIME_METATABLE_SEGMENT], metatable);
				}
				for (let arrayIndex = 1; arrayIndex <= value.length(); arrayIndex += 1) {
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
					if (isStringValue(key)) {
						traverseStableValue([...path, stringValueToString(key)], entryValue);
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
			if (!isStringValue(key)) {
				return;
			}
			traverseStableValue(['globals', stringValueToString(key)], value);
		});
		const currentIoSlots = this.memory.getIoSlots();
		for (let index = 0; index < currentIoSlots.length; index += 1) {
			traverseStableValue(['ioMemory', index], currentIoSlots[index]);
		}
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
					addTrackedLuaHeapBytes(16 + (upvalues.length * 8));
					restoredObjects[index] = { protoIndex: objectState.protoIndex, upvalues };
					break;
				}
				case 'upvalue':
					addTrackedLuaHeapBytes(24);
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
					return this.stringPool.getById(valueState.id);
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
			this.setGlobalByKey(this.stringPool.intern(entry.name), restoreValue(entry.value));
		}
		for (let index = 0; index < state.moduleCache.length; index += 1) {
			const entry = state.moduleCache[index];
			moduleCache.set(entry.name, restoreValue(entry.value));
		}
		this.memory.loadIoSlots(state.ioMemory.map(restoreValue));

		for (let index = 0; index < state.lastReturnValues.length; index += 1) {
			this.lastReturnValues[index] = restoreValue(state.lastReturnValues[index]);
		}
		this.lastPc = state.lastPc;
		this.lastInstruction = state.lastInstruction;
		this.instructionBudgetRemaining = state.instructionBudgetRemaining;
		this.haltedUntilIrq = state.haltedUntilIrq;
		this.yieldRequested = state.yieldRequested;
		refreshTrackedLuaHeapBytes();
	}

	public collectTrackedHeapBytes(extraRoots: ReadonlyArray<Value> = []): number {
		const seen = new WeakSet<object>();
		let total = 0;
		const valueStack: Value[] = [];
		const upvalueStack: Upvalue[] = [];

		const pushValue = (value: Value): void => {
			if (value === null || typeof value === 'boolean' || typeof value === 'number' || isStringValue(value)) {
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
		const ioSlots = this.memory.getIoSlots();
		for (let index = 0; index < ioSlots.length; index += 1) {
			pushValue(ioSlots[index]);
		}
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
				total += 24;
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
			if (isNativeFunction(value)) {
				if (seen.has(value)) {
					continue;
				}
				seen.add(value);
				total += 16;
				continue;
			}
			if (isNativeObject(value)) {
				if (seen.has(value)) {
					continue;
				}
				seen.add(value);
				total += 24;
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
			total += 16 + (closure.upvalues.length * 8);
			for (let index = 0; index < closure.upvalues.length; index += 1) {
				upvalueStack.push(closure.upvalues[index]);
			}
		}
		return total;
	}

	public getTrackedHeapBytes(extraRoots: ReadonlyArray<Value> = []): number {
		return this.collectTrackedHeapBytes(extraRoots);
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
		if (isStringValue(value)) {
			return stringValueToString(value);
		}
		if (value instanceof Table) {
			return 'table';
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
