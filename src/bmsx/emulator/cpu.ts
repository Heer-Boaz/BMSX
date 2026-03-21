import { RuntimeStringPool, StringValue, isStringValue, stringValueHash32, stringValueToString, stringValuesEqual, type StringPool } from './string_pool';
import type { Memory } from './memory';
import { formatNumber } from './number_format';
import { EXT_A_BITS, EXT_B_BITS, EXT_BX_BITS, EXT_C_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_OPERAND_BITS, readInstructionWord } from './instruction_format';
import {
	ARRAY_STORE_OBJECT_CAPACITY_OFFSET,
	ARRAY_STORE_OBJECT_DATA_OFFSET,
	CLOSURE_OBJECT_PROTO_INDEX_OFFSET,
	CLOSURE_OBJECT_UPVALUE_COUNT_OFFSET,
	CLOSURE_OBJECT_UPVALUE_IDS_OFFSET,
	HASH_STORE_OBJECT_CAPACITY_OFFSET,
	HASH_STORE_OBJECT_DATA_OFFSET,
	HASH_STORE_OBJECT_FREE_OFFSET,
	HASH_NODE_KEY_OFFSET,
	HASH_NODE_NEXT_OFFSET,
	HASH_NODE_SIZE,
	HASH_NODE_VALUE_OFFSET,
	HEAP_OBJECT_HEADER_SIZE,
	HeapObjectType,
	NATIVE_OBJECT_HEADER_SIZE,
	NATIVE_OBJECT_METATABLE_ID_OFFSET,
	TAGGED_VALUE_SLOT_TAG_OFFSET,
	TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET,
	TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET,
	TAGGED_VALUE_SLOT_SIZE,
	TaggedValueTag,
	type ObjectHandleTable,
	type ObjectHandleTableState,
	TABLE_OBJECT_ARRAY_LENGTH_OFFSET,
	TABLE_OBJECT_ARRAY_STORE_ID_OFFSET,
	TABLE_OBJECT_HEADER_SIZE,
	TABLE_OBJECT_HASH_STORE_ID_OFFSET,
	TABLE_OBJECT_METATABLE_ID_OFFSET,
	UPVALUE_OBJECT_CLOSED_VALUE_OFFSET,
	UPVALUE_OBJECT_FRAME_DEPTH_OFFSET,
	UPVALUE_OBJECT_HEADER_SIZE,
	UPVALUE_OBJECT_REGISTER_INDEX_OFFSET,
	UPVALUE_OBJECT_STATE_CLOSED,
	UPVALUE_OBJECT_STATE_OFFSET,
	UPVALUE_OBJECT_STATE_OPEN,
} from './object_memory';

export type Value = null | boolean | number | StringValue | Table | Closure | NativeFunction | NativeObject;

type RuntimeObjectHandle = {
	objectId: number;
	objectAddr: number;
};

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

export type NativeFunction = RuntimeObjectHandle & {
	readonly kind: typeof NATIVE_FUNCTION_KIND;
	readonly name: string;
	invoke(args: ReadonlyArray<Value>, out: Value[]): void;
	cost?: NativeFnCost;
};

export type NativeObject = RuntimeObjectHandle & {
	readonly kind: typeof NATIVE_OBJECT_KIND;
	readonly raw: object;
	get(key: Value): Value;
	set(key: Value, value: Value): void;
	len?: () => number;
	metatable?: Table | null;
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

const DEFAULT_NATIVE_COST: NativeFnCost = { base: 20, perArg: 2, perRet: 1 };

export function createNativeFunction(
	name: string,
	invoke: (args: ReadonlyArray<Value>, out: Value[]) => void,
	cost: NativeFnCost = DEFAULT_NATIVE_COST,
): NativeFunction {
	return {
		objectId: 0,
		objectAddr: 0,
		kind: NATIVE_FUNCTION_KIND,
		name,
		cost,
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

export function createNativeObject(raw: object, handlers: { get: (key: Value) => Value; set: (key: Value, value: Value) => void; len?: () => number }): NativeObject {
	return { objectId: 0, objectAddr: 0, kind: NATIVE_OBJECT_KIND, raw, get: handlers.get, set: handlers.set, len: handlers.len, metatable: null };
}

export function isNativeFunction(value: Value): value is NativeFunction {
	return (value as NativeFunction).kind === NATIVE_FUNCTION_KIND;
}

export function isNativeObject(value: Value): value is NativeObject {
	return (value as NativeObject).kind === NATIVE_OBJECT_KIND;
}

export type ProgramMetadata = {
	debugRanges: ReadonlyArray<SourceRange | null>;
	protoIds: string[];
	localSlotsByProto?: ReadonlyArray<ReadonlyArray<LocalSlotDebug>>;
	upvalueNamesByProto?: ReadonlyArray<ReadonlyArray<string>>;
};

export type CpuFrameSnapshot = {
	protoIndex: number;
	pc: number;
	registers: Value[];
};

export const TAGGED_VALUE_STATE_STRIDE = 3;
export type TaggedValueSlotBuffer = Uint32Array;

export type CpuRuntimeFrameState = {
	protoIndex: number;
	pc: number;
	depth: number;
	registers: TaggedValueSlotBuffer;
	varargs: TaggedValueSlotBuffer;
	closureObjectId: number;
	openUpvalueRegisters: Int32Array;
	openUpvalueObjectIds: Uint32Array;
	returnBase: number;
	returnCount: number;
	top: number;
	captureReturns: boolean;
	callSitePc: number;
};

export type CpuRuntimeState = {
	frames: CpuRuntimeFrameState[];
	lastReturnValues: TaggedValueSlotBuffer;
	lastPc: number;
	lastInstruction: number;
	stringIndexTableObjectId: number;
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

export function valuesEqual(left: Value, right: Value): boolean {
	if (typeof left === 'number' && typeof right === 'number') {
		if (Number.isNaN(left) && Number.isNaN(right)) {
			return true;
		}
		return left === right;
	}
	if (isStringValue(left) && isStringValue(right)) {
		return stringValuesEqual(left, right);
	}
	return left === right;
}

export type Closure = RuntimeObjectHandle & {
	protoIndex: number;
	upvalues: Upvalue[];
};

export const enum OpCode {
	WIDE,
	MOV,
	LOADK,
	LOADNIL,
	LOADBOOL,
	GETG,
	SETG,
	GETT,
	SETT,
	NEWT,
	ADD,
	SUB,
	MUL,
	DIV,
	MOD,
	FLOORDIV,
	POW,
	BAND,
	BOR,
	BXOR,
	SHL,
	SHR,
	CONCAT,
	CONCATN,
	UNM,
	NOT,
	LEN,
	BNOT,
	EQ,
	LT,
	LE,
	TEST,
	TESTSET,
	JMP,
	JMPIF,
	JMPIFNOT,
	CLOSURE,
	GETUP,
	SETUP,
	VARARG,
	CALL,
	RET,
	LOAD_MEM,
	STORE_MEM,
}

export const enum RunResult {
	Halted,
	Yielded,
}

const CEIL_DIV4 = (value: number) => (value + 3) >> 2;
const CEIL_DIV8 = (value: number) => (value + 7) >> 3;
const CEIL_DIV16 = (value: number) => (value + 15) >> 4;

const BASE_CYCLES: Uint8Array = (() => {
	const table = new Uint8Array(64);
	table.fill(2);

	const set = (op: OpCode, cost: number) => {
		table[op] = cost;
	};

	set(OpCode.WIDE, 0);

	set(OpCode.MOV, 1);
	set(OpCode.LOADK, 1);
	set(OpCode.LOADBOOL, 1);
	set(OpCode.LOADNIL, 1);

	set(OpCode.GETG, 6);
	set(OpCode.SETG, 7);
	set(OpCode.GETT, 8);
	set(OpCode.SETT, 10);
	set(OpCode.NEWT, 10);

	set(OpCode.ADD, 2);
	set(OpCode.SUB, 2);
	set(OpCode.MUL, 3);
	set(OpCode.DIV, 4);
	set(OpCode.MOD, 6);
	set(OpCode.FLOORDIV, 6);
	set(OpCode.POW, 12);

	set(OpCode.BAND, 2);
	set(OpCode.BOR, 2);
	set(OpCode.BXOR, 2);
	set(OpCode.SHL, 2);
	set(OpCode.SHR, 2);
	set(OpCode.BNOT, 2);

	set(OpCode.CONCAT, 12);
	set(OpCode.CONCATN, 14);

	set(OpCode.UNM, 1);
	set(OpCode.NOT, 1);
	set(OpCode.LEN, 4);

	set(OpCode.EQ, 3);
	set(OpCode.LT, 6);
	set(OpCode.LE, 6);
	set(OpCode.TEST, 2);
	set(OpCode.TESTSET, 3);

	set(OpCode.JMP, 1);
	set(OpCode.JMPIF, 2);
	set(OpCode.JMPIFNOT, 2);

	set(OpCode.CLOSURE, 20);
	set(OpCode.GETUP, 3);
	set(OpCode.SETUP, 3);
	set(OpCode.VARARG, 2);

	set(OpCode.CALL, 18);
	set(OpCode.RET, 18);

	set(OpCode.LOAD_MEM, 5);
	set(OpCode.STORE_MEM, 6);

	return table;
})();

type Upvalue = {
	objectId: number;
	objectAddr: number;
	open: boolean;
	index: number;
	frameDepth: number;
	value: Value;
};

type CallFrame = {
	protoIndex: number;
	pc: number;
	depth: number;
	registers: RegisterFile;
	varargs: TaggedValueList;
	closure: Closure;
	openUpvalues: Map<number, Upvalue>;
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

class ArrayStoreView {
	private values: Value[];

	constructor(size: number) {
		this.values = new Array<Value>(size);
		this.values.fill(null);
	}

	public get capacity(): number {
		return this.values.length;
	}

	public read(index: number): Value {
		const value = this.values[index];
		return value === undefined ? null : value;
	}

	public write(index: number, value: Value): void {
		this.values[index] = value;
	}

	public has(index: number): boolean {
		const value = this.values[index];
		return value !== null && value !== undefined;
	}

	public resize(size: number): void {
		this.values = new Array<Value>(size);
		this.values.fill(null);
	}

	public clear(): void {
		this.values.length = 0;
	}

	public forEachPresent(fn: (index: number, value: Value) => void): void {
		for (let index = 0; index < this.values.length; index += 1) {
			const value = this.values[index];
			if (value === null || value === undefined) {
				continue;
			}
			fn(index, value);
		}
	}
}

class HashStoreView {
	private nodes: HashNode[];
	private free = -1;

	constructor(size: number) {
		this.nodes = new Array<HashNode>(size);
		for (let index = 0; index < size; index += 1) {
			this.nodes[index] = { key: null, value: null, next: -1 };
		}
		this.free = size > 0 ? size - 1 : -1;
	}

	public get capacity(): number {
		return this.nodes.length;
	}

	public get freeIndex(): number {
		return this.free;
	}

	public set freeIndex(value: number) {
		this.free = value;
	}

	public node(index: number): HashNode {
		return this.nodes[index];
	}

	public resize(size: number): void {
		this.nodes = new Array<HashNode>(size);
		for (let index = 0; index < size; index += 1) {
			this.nodes[index] = { key: null, value: null, next: -1 };
		}
		this.free = size > 0 ? size - 1 : -1;
	}

	public clear(): void {
		this.nodes.length = 0;
		this.free = -1;
	}

	public forEachPresent(fn: (index: number, node: HashNode) => void): void {
		for (let index = 0; index < this.nodes.length; index += 1) {
			const node = this.nodes[index];
			if (node.key === null) {
				continue;
			}
			fn(index, node);
		}
	}
}

export class Table {
	private arrayStore: ArrayStoreView;
	private arrayLength = 0;
	private hashStore: HashStoreView;
	private metatable: Table | null = null;
	public readonly objectId: number;
	private readonly objectAddr: number;
	private readonly objectHandles: ObjectHandleTable;
	private arrayStoreId = 0;
	private arrayStoreAddr = 0;
	private hashStoreId = 0;
	private hashStoreAddr = 0;

	private static readonly numberBuffer = new ArrayBuffer(8);
	private static readonly float64View = new Float64Array(Table.numberBuffer);
	private static readonly uint32View = new Uint32Array(Table.numberBuffer);
	private static readonly objectIds = new WeakMap<object, number>();
	private static readonly objectsById = new Map<number, object>();
	private static nextObjectId = 1;
	private static readonly numberEncoder = new DataView(new ArrayBuffer(8));

	constructor(arraySize: number, hashSize: number, objectHandles: ObjectHandleTable) {
		this.objectHandles = objectHandles;
		const size = hashSize > 0 ? Table.nextPowerOfTwo(hashSize) : 0;
		this.arrayStore = new ArrayStoreView(arraySize);
		this.hashStore = new HashStoreView(size);
		const tableAllocation = this.objectHandles.allocateObject(HeapObjectType.Table, TABLE_OBJECT_HEADER_SIZE);
		this.objectId = tableAllocation.id;
		this.objectAddr = tableAllocation.addr;
		Table.registerObjectId(this, this.objectId);
		this.allocateStoreObjects(arraySize, size);
		this.syncObjectState();
	}

	public get(key: Value): Value {
		if (key === null) {
			throw new Error('Table index is nil.');
		}
		const index = this.tryGetArrayIndex(key);
		if (index !== null && index < this.arrayStore.capacity) {
			return this.arrayStore.read(index);
		}
		const nodeIndex = this.findNodeIndex(key);
		if (nodeIndex >= 0) {
			return this.hashStore.node(nodeIndex).value;
		}
		return null;
	}

	public set(key: Value, value: Value): void {
		if (key === null) {
			throw new Error('Table index is nil.');
		}
		try {
			const index = this.tryGetArrayIndex(key);
			if (index !== null) {
				if (index < this.arrayStore.capacity) {
					if (value === null) {
						this.arrayStore.write(index, value);
						if (index < this.arrayLength) {
							this.arrayLength = index;
						}
						return;
					}
					this.arrayStore.write(index, value);
					if (index === this.arrayLength) {
						this.updateArrayLengthFrom(this.arrayLength);
					}
					return;
				}
				if (value === null) {
					this.removeFromHash(key);
					if (index < this.arrayLength) {
						this.arrayLength = index;
					}
					return;
				}
				const nodeIndex = this.findNodeIndex(key);
				if (nodeIndex >= 0) {
					this.hashStore.node(nodeIndex).value = value;
					return;
				}
				if (this.hashStore.capacity === 0 || this.hashStore.freeIndex < 0) {
					this.rehash(key);
				}
				this.rawSet(key, value);
				return;
			}
			if (value === null) {
				this.removeFromHash(key);
				return;
			}
			const nodeIndex = this.findNodeIndex(key);
			if (nodeIndex >= 0) {
				this.hashStore.node(nodeIndex).value = value;
				return;
			}
			if (this.hashStore.capacity === 0 || this.hashStore.freeIndex < 0) {
				this.rehash(key);
			}
			this.rawSet(key, value);
		} finally {
			this.syncObjectState();
		}
	}

	public length(): number {
		return this.arrayLength;
	}

	public clear(): void {
		this.arrayStore.clear();
		this.arrayLength = 0;
		this.hashStore.clear();
		this.syncObjectState();
	}

	public entriesArray(): ReadonlyArray<[Value, Value]> {
		const entries: Array<[Value, Value]> = [];
		this.arrayStore.forEachPresent((index, value) => {
			entries.push([index + 1, value]);
		});
		this.hashStore.forEachPresent((_index, node) => {
			entries.push([node.key, node.value]);
		});
		return entries;
	}

	public getMetatable(): Table | null {
		return this.metatable;
	}

	public setMetatable(metatable: Table | null): void {
		if (metatable !== null && !(metatable instanceof Table)) {
			throw new Error('setmetatable expects a table or nil as the second argument.');
		}
		this.metatable = metatable;
		this.syncTableMetadata();
	}

	public nextEntry(after: Value): [Value, Value] | null {
		if (after === null) {
			for (let index = 0; index < this.arrayStore.capacity; index += 1) {
				const value = this.arrayStore.read(index);
				if (value !== null) {
					return [index + 1, value];
				}
			}
			for (let index = 0; index < this.hashStore.capacity; index += 1) {
				const node = this.hashStore.node(index);
				if (node.key !== null) {
					return [node.key, node.value];
				}
			}
			return null;
		}
		const index = this.tryGetArrayIndex(after);
		if (index !== null && index < this.arrayStore.capacity) {
			if (this.arrayStore.read(index) === null) {
				return null;
			}
			for (let cursor = index + 1; cursor < this.arrayStore.capacity; cursor += 1) {
				const value = this.arrayStore.read(cursor);
				if (value !== null) {
					return [cursor + 1, value];
				}
			}
			for (let i = 0; i < this.hashStore.capacity; i += 1) {
				const node = this.hashStore.node(i);
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
		for (let i = nodeIndex + 1; i < this.hashStore.capacity; i += 1) {
			const node = this.hashStore.node(i);
			if (node.key !== null) {
				return [node.key, node.value];
			}
		}
		return null;
	}

	public rehydrateStoreViews(stringPool: StringPool): void {
		this.arrayStoreId = this.objectHandles.readU32(this.objectAddr + TABLE_OBJECT_ARRAY_STORE_ID_OFFSET);
		this.hashStoreId = this.objectHandles.readU32(this.objectAddr + TABLE_OBJECT_HASH_STORE_ID_OFFSET);
		this.arrayLength = this.objectHandles.readU32(this.objectAddr + TABLE_OBJECT_ARRAY_LENGTH_OFFSET);
		const metatableId = this.objectHandles.readU32(this.objectAddr + TABLE_OBJECT_METATABLE_ID_OFFSET);
		this.metatable = metatableId === 0 ? null : Table.resolveObjectId<Table>(metatableId);
		const arrayStoreEntry = this.objectHandles.readEntry(this.arrayStoreId);
		const hashStoreEntry = this.objectHandles.readEntry(this.hashStoreId);
		this.arrayStoreAddr = arrayStoreEntry.addr;
		this.hashStoreAddr = hashStoreEntry.addr;
		const arrayCapacity = this.objectHandles.readU32(this.arrayStoreAddr + ARRAY_STORE_OBJECT_CAPACITY_OFFSET);
		const hashCapacity = this.objectHandles.readU32(this.hashStoreAddr + HASH_STORE_OBJECT_CAPACITY_OFFSET);
		this.arrayStore = new ArrayStoreView(arrayCapacity);
		this.hashStore = new HashStoreView(hashCapacity);
		this.hashStore.freeIndex = this.objectHandles.readU32(this.hashStoreAddr + HASH_STORE_OBJECT_FREE_OFFSET) | 0;
		for (let index = 0; index < arrayCapacity; index += 1) {
			const slotAddr = this.arrayStoreAddr + ARRAY_STORE_OBJECT_DATA_OFFSET + (index * TAGGED_VALUE_SLOT_SIZE);
			this.arrayStore.write(index, this.readTaggedValue(slotAddr, stringPool));
		}
		for (let index = 0; index < hashCapacity; index += 1) {
			const node = this.hashStore.node(index);
			const nodeAddr = this.hashStoreAddr + HASH_STORE_OBJECT_DATA_OFFSET + (index * HASH_NODE_SIZE);
			node.key = this.readTaggedValue(nodeAddr + HASH_NODE_KEY_OFFSET, stringPool);
			node.value = this.readTaggedValue(nodeAddr + HASH_NODE_VALUE_OFFSET, stringPool);
			node.next = this.objectHandles.readU32(nodeAddr + HASH_NODE_NEXT_OFFSET) | 0;
		}
	}

	public static rehydrateRuntimeObjects(objectHandles: ObjectHandleTable, stringPool: RuntimeStringPool): void {
		for (const [id, value] of Table.objectsById.entries()) {
			const entry = objectHandles.readEntry(id);
			if (entry.type === 0) {
				const runtimeObject = value as RuntimeObjectHandle;
				runtimeObject.objectId = 0;
				runtimeObject.objectAddr = 0;
				Table.objectIds.delete(value);
				Table.objectsById.delete(id);
				continue;
			}
			const runtimeObject = value as RuntimeObjectHandle;
			runtimeObject.objectId = id;
			runtimeObject.objectAddr = entry.addr;
			switch (entry.type) {
				case HeapObjectType.Table:
					(value as Table).rehydrateStoreViews(stringPool);
					break;
				case HeapObjectType.NativeFunction:
					break;
				case HeapObjectType.NativeObject: {
					const native = value as NativeObject;
					const metatableId = objectHandles.readU32(entry.addr + NATIVE_OBJECT_METATABLE_ID_OFFSET);
					native.metatable = metatableId === 0 ? null : Table.resolveObjectId<Table>(metatableId);
					break;
				}
				case HeapObjectType.Closure: {
					const closure = value as Closure;
					const upvalueCount = objectHandles.readU32(entry.addr + CLOSURE_OBJECT_UPVALUE_COUNT_OFFSET);
					closure.protoIndex = objectHandles.readU32(entry.addr + CLOSURE_OBJECT_PROTO_INDEX_OFFSET);
					closure.upvalues = new Array<Upvalue>(upvalueCount);
					for (let index = 0; index < upvalueCount; index += 1) {
						const upvalueId = objectHandles.readU32(entry.addr + CLOSURE_OBJECT_UPVALUE_IDS_OFFSET + (index * 4));
						closure.upvalues[index] = Table.resolveObjectId<Upvalue>(upvalueId);
					}
					break;
				}
				case HeapObjectType.Upvalue: {
					const upvalue = value as Upvalue;
					upvalue.open = objectHandles.readU32(entry.addr + UPVALUE_OBJECT_STATE_OFFSET) === UPVALUE_OBJECT_STATE_OPEN;
					upvalue.frameDepth = upvalue.open
						? (objectHandles.readU32(entry.addr + UPVALUE_OBJECT_FRAME_DEPTH_OFFSET) | 0)
						: -1;
					upvalue.index = objectHandles.readU32(entry.addr + UPVALUE_OBJECT_REGISTER_INDEX_OFFSET) | 0;
					upvalue.value = Table.readTaggedValueFromHandles(objectHandles, entry.addr + UPVALUE_OBJECT_CLOSED_VALUE_OFFSET, stringPool);
					break;
				}
				default:
					throw new Error(`[Table] Unsupported runtime heap object type ${entry.type} for ${id}.`);
			}
		}
	}

	private static nextPowerOfTwo(value: number): number {
		if (value <= 0) {
			return 0;
		}
		let power = 1;
		while (power < value) {
			power <<= 1;
		}
		return power;
	}

	private static ceilLog2(value: number): number {
		let log = 0;
		let power = 1;
		while (power < value) {
			power <<= 1;
			log += 1;
		}
		return log;
	}

	public static ensureValueObjectId(value: Table | Closure | NativeFunction | NativeObject, objectHandles: ObjectHandleTable): number {
		if (value instanceof Table) {
			return Table.ensureObjectId(value, objectHandles, HeapObjectType.Table, TABLE_OBJECT_HEADER_SIZE);
		}
		if (isNativeFunction(value)) {
			return Table.ensureObjectId(value, objectHandles, HeapObjectType.NativeFunction, HEAP_OBJECT_HEADER_SIZE);
		}
		if (isNativeObject(value)) {
			const id = Table.ensureObjectId(value, objectHandles, HeapObjectType.NativeObject, NATIVE_OBJECT_HEADER_SIZE);
			Table.syncNativeObjectState(value, objectHandles);
			return id;
		}
		const id = Table.ensureObjectId(
			value,
			objectHandles,
			HeapObjectType.Closure,
			CLOSURE_OBJECT_UPVALUE_IDS_OFFSET + (value.upvalues.length * 4),
		);
		Table.syncClosureState(value, objectHandles);
		return id;
	}

	public static ensureUpvalueObjectId(value: Upvalue, objectHandles: ObjectHandleTable): number {
		const id = Table.ensureObjectId(value, objectHandles, HeapObjectType.Upvalue, UPVALUE_OBJECT_HEADER_SIZE);
		Table.syncUpvalueState(value, objectHandles);
		return id;
	}

	public static ensureObjectId(value: object, objectHandles: ObjectHandleTable, type: HeapObjectType, sizeBytes: number): number {
		const runtimeObject = value as RuntimeObjectHandle;
		if (runtimeObject.objectId !== 0 && runtimeObject.objectAddr !== 0) {
			Table.registerObjectId(value, runtimeObject.objectId);
			return runtimeObject.objectId;
		}
		const existing = Table.objectIds.get(value);
		if (existing !== undefined) {
			if (runtimeObject.objectAddr !== 0) {
				return existing;
			}
			Table.objectsById.delete(existing);
		}
		const allocation = objectHandles.allocateObject(type, sizeBytes);
		runtimeObject.objectId = allocation.id;
		runtimeObject.objectAddr = allocation.addr;
		Table.registerObjectId(value, allocation.id);
		return allocation.id;
	}

	public static syncNativeObjectState(native: NativeObject, objectHandles: ObjectHandleTable): void {
		const entry = objectHandles.readEntry(native.objectId);
		const metatableId = native.metatable ? Table.ensureValueObjectId(native.metatable, objectHandles) : 0;
		objectHandles.writeU32(entry.addr + NATIVE_OBJECT_METATABLE_ID_OFFSET, metatableId >>> 0);
	}

	public static syncClosureState(closure: Closure, objectHandles: ObjectHandleTable): void {
		const entry = objectHandles.readEntry(closure.objectId);
		objectHandles.writeU32(entry.addr + CLOSURE_OBJECT_PROTO_INDEX_OFFSET, closure.protoIndex >>> 0);
		objectHandles.writeU32(entry.addr + CLOSURE_OBJECT_UPVALUE_COUNT_OFFSET, closure.upvalues.length >>> 0);
		for (let index = 0; index < closure.upvalues.length; index += 1) {
			const upvalueId = Table.ensureUpvalueObjectId(closure.upvalues[index], objectHandles);
			objectHandles.writeU32(
				entry.addr + CLOSURE_OBJECT_UPVALUE_IDS_OFFSET + (index * 4),
				upvalueId >>> 0,
			);
		}
	}

	public static syncUpvalueState(upvalue: Upvalue, objectHandles: ObjectHandleTable): void {
		const entry = objectHandles.readEntry(upvalue.objectId);
		objectHandles.writeU32(
			entry.addr + UPVALUE_OBJECT_STATE_OFFSET,
			(upvalue.open ? UPVALUE_OBJECT_STATE_OPEN : UPVALUE_OBJECT_STATE_CLOSED) >>> 0,
		);
		objectHandles.writeU32(entry.addr + UPVALUE_OBJECT_FRAME_DEPTH_OFFSET, upvalue.frameDepth >>> 0);
		objectHandles.writeU32(entry.addr + UPVALUE_OBJECT_REGISTER_INDEX_OFFSET, upvalue.index >>> 0);
		Table.writeTaggedValueToHandles(objectHandles, entry.addr + UPVALUE_OBJECT_CLOSED_VALUE_OFFSET, upvalue.value);
	}

	private static registerObjectId(value: object, id: number): void {
		Table.objectIds.set(value, id);
		Table.objectsById.set(id, value);
		if (id >= Table.nextObjectId) {
			Table.nextObjectId = id + 1;
		}
	}

	private static resolveObjectId<T extends object>(id: number): T {
		const value = Table.objectsById.get(id);
		if (!value) {
			throw new Error(`[Table] Unknown object id ${id}.`);
		}
		return value as T;
	}

	public static resolveRuntimeObjectId<T extends object>(id: number): T {
		return Table.resolveObjectId<T>(id);
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
			return stringValueHash32(key);
		}
		return (Table.ensureValueObjectId(key as Table | Closure | NativeFunction | NativeObject, this.objectHandles) * 2654435761) >>> 0;
	}

	private keyEquals(a: Value, b: Value): boolean {
		return valuesEqual(a, b);
	}

	private findNodeIndex(key: Value): number {
		if (this.hashStore.capacity === 0) {
			return -1;
		}
		const mask = this.hashStore.capacity - 1;
		let index = (this.hashValue(key) & mask) >>> 0;
		while (index >= 0) {
			const node = this.hashStore.node(index);
			if (node.key !== null && this.keyEquals(node.key, key)) {
				return index;
			}
			index = node.next;
		}
		return -1;
	}

	private getFreeIndex(): number {
		const start = this.hashStore.freeIndex >= 0 ? this.hashStore.freeIndex : this.hashStore.capacity - 1;
		for (let i = start; i >= 0; i -= 1) {
			if (this.hashStore.node(i).key === null) {
				this.hashStore.freeIndex = i - 1;
				return i;
			}
		}
		this.hashStore.freeIndex = -1;
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

		for (let i = 0; i < this.arrayStore.capacity; i += 1) {
			if (this.arrayStore.has(i)) {
				totalKeys += 1;
				countIntegerKey(i + 1);
			}
		}
		for (let i = 0; i < this.hashStore.capacity; i += 1) {
			const node = this.hashStore.node(i);
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
			power <<= 1;
		}

		const hashKeys = totalKeys - arrayKeys;
		const hashSize = hashKeys > 0 ? Table.nextPowerOfTwo(hashKeys) : 0;
		this.resize(arraySize, hashSize);
	}

	private resize(newArraySize: number, newHashSize: number): void {
		const oldArray = this.arrayStore;
		const oldHash = this.hashStore;

		this.arrayStore = new ArrayStoreView(newArraySize);
		this.arrayLength = 0;
		this.hashStore = new HashStoreView(newHashSize);
		this.allocateStoreObjects(newArraySize, newHashSize);

		oldArray.forEachPresent((index, value) => {
			this.rawSet(index + 1, value);
		});
		oldHash.forEachPresent((_index, node) => {
			this.rawSet(node.key, node.value);
		});
		this.syncObjectState();
	}

	private allocateStoreObjects(arraySize: number, hashSize: number): void {
		const arrayStoreAllocation = this.objectHandles.allocateObject(
			HeapObjectType.ArrayStore,
			ARRAY_STORE_OBJECT_DATA_OFFSET + (arraySize * TAGGED_VALUE_SLOT_SIZE));
		const hashStoreAllocation = this.objectHandles.allocateObject(
			HeapObjectType.HashStore,
			HASH_STORE_OBJECT_DATA_OFFSET + (hashSize * HASH_NODE_SIZE));
		this.arrayStoreId = arrayStoreAllocation.id;
		this.arrayStoreAddr = arrayStoreAllocation.addr;
		this.hashStoreId = hashStoreAllocation.id;
		this.hashStoreAddr = hashStoreAllocation.addr;
	}

	private rawSet(key: Value, value: Value): void {
		const index = this.tryGetArrayIndex(key);
		if (index !== null && index < this.arrayStore.capacity) {
			this.arrayStore.write(index, value);
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
		if (this.hashStore.capacity === 0) {
			this.rehash(key);
			this.rawSet(key, value);
			return;
		}
		const mask = this.hashStore.capacity - 1;
		const mainIndex = (this.hashValue(key) & mask) >>> 0;
		const mainNode = this.hashStore.node(mainIndex);
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
		const freeNode = this.hashStore.node(freeIndex);
		const mainIndexOfOccupied = (this.hashValue(mainNode.key) & mask) >>> 0;
		if (mainIndexOfOccupied !== mainIndex) {
			freeNode.key = mainNode.key;
			freeNode.value = mainNode.value;
			freeNode.next = mainNode.next;
			let prev = mainIndexOfOccupied;
			while (this.hashStore.node(prev).next !== mainIndex) {
				prev = this.hashStore.node(prev).next;
			}
			this.hashStore.node(prev).next = freeIndex;
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
		if (this.hashStore.capacity === 0) {
			return;
		}
		const mask = this.hashStore.capacity - 1;
		const mainIndex = (this.hashValue(key) & mask) >>> 0;
		let prev = -1;
		let index = mainIndex;
		while (index >= 0) {
			const node = this.hashStore.node(index);
			if (node.key !== null && this.keyEquals(node.key, key)) {
				const next = node.next;
				if (prev >= 0) {
					this.hashStore.node(prev).next = next;
					node.key = null;
					node.value = null;
					node.next = -1;
					if (index > this.hashStore.freeIndex) {
						this.hashStore.freeIndex = index;
					}
					return;
				}
				if (next >= 0) {
					const nextNode = this.hashStore.node(next);
					node.key = nextNode.key;
					node.value = nextNode.value;
					node.next = nextNode.next;
					nextNode.key = null;
					nextNode.value = null;
					nextNode.next = -1;
					if (next > this.hashStore.freeIndex) {
						this.hashStore.freeIndex = next;
					}
					return;
				}
				node.key = null;
				node.value = null;
				node.next = -1;
				if (index > this.hashStore.freeIndex) {
					this.hashStore.freeIndex = index;
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
		if (index < this.arrayStore.capacity) {
			return this.arrayStore.has(index);
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

	private syncObjectState(): void {
		this.syncTableMetadata();
		this.syncStoreMetadata();
	}

	private syncTableMetadata(): void {
		const metatableId = this.metatable ? this.metatable.objectId : 0;
		this.objectHandles.writeU32(this.objectAddr + TABLE_OBJECT_METATABLE_ID_OFFSET, metatableId >>> 0);
		this.objectHandles.writeU32(this.objectAddr + TABLE_OBJECT_ARRAY_STORE_ID_OFFSET, this.arrayStoreId >>> 0);
		this.objectHandles.writeU32(this.objectAddr + TABLE_OBJECT_HASH_STORE_ID_OFFSET, this.hashStoreId >>> 0);
		this.objectHandles.writeU32(this.objectAddr + TABLE_OBJECT_ARRAY_LENGTH_OFFSET, this.arrayLength >>> 0);
	}

	private syncStoreMetadata(): void {
		this.objectHandles.writeU32(this.arrayStoreAddr + ARRAY_STORE_OBJECT_CAPACITY_OFFSET, this.arrayStore.capacity >>> 0);
		this.objectHandles.writeU32(this.hashStoreAddr + HASH_STORE_OBJECT_CAPACITY_OFFSET, this.hashStore.capacity >>> 0);
		this.objectHandles.writeU32(this.hashStoreAddr + HASH_STORE_OBJECT_FREE_OFFSET, this.hashStore.freeIndex >>> 0);
		for (let index = 0; index < this.arrayStore.capacity; index += 1) {
			this.writeArraySlot(index);
		}
		for (let index = 0; index < this.hashStore.capacity; index += 1) {
			this.writeHashNode(index);
		}
	}

	private writeArraySlot(index: number): void {
		const slotAddr = this.arrayStoreAddr + ARRAY_STORE_OBJECT_DATA_OFFSET + (index * TAGGED_VALUE_SLOT_SIZE);
		this.writeTaggedValue(slotAddr, this.arrayStore.read(index));
	}

	private writeHashNode(index: number): void {
		const node = this.hashStore.node(index);
		const nodeAddr = this.hashStoreAddr + HASH_STORE_OBJECT_DATA_OFFSET + (index * HASH_NODE_SIZE);
		this.writeTaggedValue(nodeAddr + HASH_NODE_KEY_OFFSET, node.key);
		this.writeTaggedValue(nodeAddr + HASH_NODE_VALUE_OFFSET, node.value);
		this.objectHandles.writeU32(nodeAddr + HASH_NODE_NEXT_OFFSET, node.next >>> 0);
	}

	private writeTaggedValue(addr: number, value: Value | undefined): void {
		Table.writeTaggedValueToHandles(this.objectHandles, addr, value);
	}

	private readTaggedValue(addr: number, stringPool: StringPool): Value {
		return Table.readTaggedValueFromHandles(this.objectHandles, addr, stringPool);
	}

	public static encodeTaggedValueToBuffer(buffer: Uint32Array, slotIndex: number, value: Value | undefined, objectHandles: ObjectHandleTable): void {
		const offset = slotIndex * TAGGED_VALUE_STATE_STRIDE;
		if (value === undefined || value === null) {
			buffer[offset] = TaggedValueTag.Nil;
			buffer[offset + 1] = 0;
			buffer[offset + 2] = 0;
			return;
		}
		if (value === false) {
			buffer[offset] = TaggedValueTag.False;
			buffer[offset + 1] = 0;
			buffer[offset + 2] = 0;
			return;
		}
		if (value === true) {
			buffer[offset] = TaggedValueTag.True;
			buffer[offset + 1] = 0;
			buffer[offset + 2] = 0;
			return;
		}
		if (typeof value === 'number') {
			Table.numberEncoder.setFloat64(0, value, true);
			buffer[offset] = TaggedValueTag.Number;
			buffer[offset + 1] = Table.numberEncoder.getUint32(0, true);
			buffer[offset + 2] = Table.numberEncoder.getUint32(4, true);
			return;
		}
		if (isStringValue(value)) {
			buffer[offset] = TaggedValueTag.String;
			buffer[offset + 1] = value.id >>> 0;
			buffer[offset + 2] = 0;
			return;
		}
		if (value instanceof Table) {
			buffer[offset] = TaggedValueTag.Table;
			buffer[offset + 1] = Table.ensureValueObjectId(value, objectHandles) >>> 0;
			buffer[offset + 2] = 0;
			return;
		}
		if (isNativeFunction(value)) {
			buffer[offset] = TaggedValueTag.NativeFunction;
			buffer[offset + 1] = Table.ensureValueObjectId(value, objectHandles) >>> 0;
			buffer[offset + 2] = 0;
			return;
		}
		if (isNativeObject(value)) {
			buffer[offset] = TaggedValueTag.NativeObject;
			buffer[offset + 1] = Table.ensureValueObjectId(value, objectHandles) >>> 0;
			buffer[offset + 2] = 0;
			return;
		}
		buffer[offset] = TaggedValueTag.Closure;
		buffer[offset + 1] = Table.ensureValueObjectId(value, objectHandles) >>> 0;
		buffer[offset + 2] = 0;
	}

	public static decodeTaggedValueFromBuffer(buffer: ArrayLike<number>, slotIndex: number, stringPool: StringPool): Value {
		const offset = slotIndex * TAGGED_VALUE_STATE_STRIDE;
		const tag = buffer[offset];
		const payloadLo = buffer[offset + 1];
		const payloadHi = buffer[offset + 2];
		switch (tag) {
			case TaggedValueTag.Nil:
				return null;
			case TaggedValueTag.False:
				return false;
			case TaggedValueTag.True:
				return true;
			case TaggedValueTag.Number:
				Table.numberEncoder.setUint32(0, payloadLo, true);
				Table.numberEncoder.setUint32(4, payloadHi, true);
				return Table.numberEncoder.getFloat64(0, true);
			case TaggedValueTag.String:
				return stringPool.getById(payloadLo);
			case TaggedValueTag.Table:
			case TaggedValueTag.Closure:
			case TaggedValueTag.NativeFunction:
			case TaggedValueTag.NativeObject:
				return Table.resolveObjectId<Value & object>(payloadLo) as Value;
			default:
				throw new Error(`[Table] Unsupported tagged value tag ${tag}.`);
		}
	}

	public static writeTaggedValueToHandles(objectHandles: ObjectHandleTable, addr: number, value: Value | undefined): void {
		if (value === undefined || value === null) {
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, TaggedValueTag.Nil);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, 0);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
			return;
		}
		if (value === false) {
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, TaggedValueTag.False);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, 0);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
			return;
		}
		if (value === true) {
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, TaggedValueTag.True);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, 0);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
			return;
		}
		if (typeof value === 'number') {
			Table.numberEncoder.setFloat64(0, value, true);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, TaggedValueTag.Number);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, Table.numberEncoder.getUint32(0, true));
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, Table.numberEncoder.getUint32(4, true));
			return;
		}
		if (isStringValue(value)) {
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, TaggedValueTag.String);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, value.id >>> 0);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
			return;
		}
		if (value instanceof Table) {
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, TaggedValueTag.Table);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, Table.ensureValueObjectId(value, objectHandles) >>> 0);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
			return;
		}
		if (isNativeFunction(value)) {
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, TaggedValueTag.NativeFunction);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, Table.ensureValueObjectId(value, objectHandles) >>> 0);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
			return;
		}
		if (isNativeObject(value)) {
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, TaggedValueTag.NativeObject);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, Table.ensureValueObjectId(value, objectHandles) >>> 0);
			objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
			return;
		}
		objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, TaggedValueTag.Closure);
		objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, Table.ensureValueObjectId(value, objectHandles) >>> 0);
		objectHandles.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
	}

	public static readTaggedValueFromHandles(objectHandles: ObjectHandleTable, addr: number, stringPool: StringPool): Value {
		const tag = objectHandles.readU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET);
		switch (tag) {
			case TaggedValueTag.Nil:
				return null;
			case TaggedValueTag.False:
				return false;
			case TaggedValueTag.True:
				return true;
			case TaggedValueTag.Number:
				Table.numberEncoder.setUint32(0, objectHandles.readU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET), true);
				Table.numberEncoder.setUint32(4, objectHandles.readU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET), true);
				return Table.numberEncoder.getFloat64(0, true);
			case TaggedValueTag.String:
				return stringPool.getById(objectHandles.readU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET));
			case TaggedValueTag.Table:
			case TaggedValueTag.Closure:
			case TaggedValueTag.NativeFunction:
			case TaggedValueTag.NativeObject:
				return Table.resolveObjectId<Value & object>(objectHandles.readU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET)) as Value;
			default:
				throw new Error(`[Table] Unsupported tagged value tag ${tag}.`);
		}
	}
}

class TaggedValueList {
	private slots: Uint32Array;
	private valueCount = 0;

	constructor(
		private readonly stringPool: StringPool,
		private readonly objectHandles: ObjectHandleTable,
		initialCapacity: number = 0,
	) {
		this.slots = new Uint32Array(initialCapacity * TAGGED_VALUE_STATE_STRIDE);
	}

	public get length(): number {
		return this.valueCount;
	}

	public clear(): void {
		this.valueCount = 0;
	}

	public get(index: number): Value {
		return Table.decodeTaggedValueFromBuffer(this.slots, index, this.stringPool);
	}

	public push(value: Value): void {
		this.ensureCapacity(this.valueCount + 1);
		Table.encodeTaggedValueToBuffer(this.slots, this.valueCount, value, this.objectHandles);
		this.valueCount += 1;
	}

	public assignFromValues(values: ReadonlyArray<Value>): void {
		this.ensureCapacity(values.length);
		this.valueCount = values.length;
		for (let index = 0; index < values.length; index += 1) {
			Table.encodeTaggedValueToBuffer(this.slots, index, values[index], this.objectHandles);
		}
	}

	public copyTo(target: Value[]): Value[] {
		target.length = this.valueCount;
		for (let index = 0; index < this.valueCount; index += 1) {
			target[index] = Table.decodeTaggedValueFromBuffer(this.slots, index, this.stringPool);
		}
		return target;
	}

	public snapshot(): Uint32Array {
		return this.slots.slice(0, this.valueCount * TAGGED_VALUE_STATE_STRIDE);
	}

	public restore(snapshot: Uint32Array): void {
		this.slots = snapshot.slice();
		this.valueCount = Math.floor(snapshot.length / TAGGED_VALUE_STATE_STRIDE);
	}

	private ensureCapacity(count: number): void {
		const currentCapacity = Math.floor(this.slots.length / TAGGED_VALUE_STATE_STRIDE);
		if (count <= currentCapacity) {
			return;
		}
		let nextCapacity = currentCapacity === 0 ? 4 : currentCapacity;
		while (nextCapacity < count) {
			nextCapacity <<= 1;
		}
		const next = new Uint32Array(nextCapacity * TAGGED_VALUE_STATE_STRIDE);
		next.set(this.slots.subarray(0, this.valueCount * TAGGED_VALUE_STATE_STRIDE), 0);
		this.slots = next;
	}
}

class RegisterFile {
	private slots: Uint32Array;
	private static readonly numberEncoder = new DataView(new ArrayBuffer(8));

	constructor(
		size: number,
		private readonly stringPool: StringPool,
		private readonly objectHandles: ObjectHandleTable,
	) {
		this.slots = new Uint32Array(size * TAGGED_VALUE_STATE_STRIDE);
	}

	public capacity(): number {
		return Math.floor(this.slots.length / TAGGED_VALUE_STATE_STRIDE);
	}

	public clear(count: number): void {
		this.slots.fill(0, 0, count * TAGGED_VALUE_STATE_STRIDE);
	}

	public copyFrom(source: RegisterFile, count: number): void {
		this.slots.set(source.slots.subarray(0, count * TAGGED_VALUE_STATE_STRIDE), 0);
	}

	public copyTo(target: Value[], count: number): void {
		target.length = count;
		for (let index = 0; index < count; index += 1) {
			target[index] = Table.decodeTaggedValueFromBuffer(this.slots, index, this.stringPool);
		}
	}

	public copySlot(dst: number, src: number): void {
		const dstOffset = dst * TAGGED_VALUE_STATE_STRIDE;
		const srcOffset = src * TAGGED_VALUE_STATE_STRIDE;
		this.slots[dstOffset] = this.slots[srcOffset];
		this.slots[dstOffset + 1] = this.slots[srcOffset + 1];
		this.slots[dstOffset + 2] = this.slots[srcOffset + 2];
	}

	public isNumber(index: number): boolean {
		return this.slots[index * TAGGED_VALUE_STATE_STRIDE] === TaggedValueTag.Number;
	}

	public getNumber(index: number): number {
		const offset = index * TAGGED_VALUE_STATE_STRIDE;
		RegisterFile.numberEncoder.setUint32(0, this.slots[offset + 1], true);
		RegisterFile.numberEncoder.setUint32(4, this.slots[offset + 2], true);
		return RegisterFile.numberEncoder.getFloat64(0, true);
	}

	public isTruthy(index: number): boolean {
		const tag = this.slots[index * TAGGED_VALUE_STATE_STRIDE];
		return tag !== TaggedValueTag.Nil && tag !== TaggedValueTag.False;
	}

	public get(index: number): Value {
		return Table.decodeTaggedValueFromBuffer(this.slots, index, this.stringPool);
	}

	public setNil(index: number): void {
		const offset = index * TAGGED_VALUE_STATE_STRIDE;
		this.slots[offset] = TaggedValueTag.Nil;
		this.slots[offset + 1] = 0;
		this.slots[offset + 2] = 0;
	}

	public setBool(index: number, value: boolean): void {
		const offset = index * TAGGED_VALUE_STATE_STRIDE;
		this.slots[offset] = value ? TaggedValueTag.True : TaggedValueTag.False;
		this.slots[offset + 1] = 0;
		this.slots[offset + 2] = 0;
	}

	public setNumber(index: number, value: number): void {
		const offset = index * TAGGED_VALUE_STATE_STRIDE;
		RegisterFile.numberEncoder.setFloat64(0, value, true);
		this.slots[offset] = TaggedValueTag.Number;
		this.slots[offset + 1] = RegisterFile.numberEncoder.getUint32(0, true);
		this.slots[offset + 2] = RegisterFile.numberEncoder.getUint32(4, true);
	}

	public setString(index: number, value: StringValue): void {
		const offset = index * TAGGED_VALUE_STATE_STRIDE;
		this.slots[offset] = TaggedValueTag.String;
		this.slots[offset + 1] = value.id >>> 0;
		this.slots[offset + 2] = 0;
	}

	public setTable(index: number, value: Table): void {
		const offset = index * TAGGED_VALUE_STATE_STRIDE;
		this.slots[offset] = TaggedValueTag.Table;
		this.slots[offset + 1] = Table.ensureValueObjectId(value, this.objectHandles) >>> 0;
		this.slots[offset + 2] = 0;
	}

	public setClosure(index: number, value: Closure): void {
		const offset = index * TAGGED_VALUE_STATE_STRIDE;
		this.slots[offset] = TaggedValueTag.Closure;
		this.slots[offset + 1] = Table.ensureValueObjectId(value, this.objectHandles) >>> 0;
		this.slots[offset + 2] = 0;
	}

	public setNativeFunction(index: number, value: NativeFunction): void {
		const offset = index * TAGGED_VALUE_STATE_STRIDE;
		this.slots[offset] = TaggedValueTag.NativeFunction;
		this.slots[offset + 1] = Table.ensureValueObjectId(value, this.objectHandles) >>> 0;
		this.slots[offset + 2] = 0;
	}

	public setNativeObject(index: number, value: NativeObject): void {
		const offset = index * TAGGED_VALUE_STATE_STRIDE;
		this.slots[offset] = TaggedValueTag.NativeObject;
		this.slots[offset + 1] = Table.ensureValueObjectId(value, this.objectHandles) >>> 0;
		this.slots[offset + 2] = 0;
	}

	public set(index: number, value: Value): void {
		Table.encodeTaggedValueToBuffer(this.slots, index, value, this.objectHandles);
	}

	public snapshot(count: number): Uint32Array {
		return this.slots.slice(0, count * TAGGED_VALUE_STATE_STRIDE);
	}

	public restore(snapshot: Uint32Array): void {
		this.slots.fill(0);
		this.slots.set(snapshot, 0);
	}
}

// Pool constants for frame/register reuse
const MAX_POOLED_FRAMES = 32;
const MAX_POOLED_REGISTER_ARRAYS = 64;
const MAX_REGISTER_ARRAY_SIZE = 256;
const MAX_POOLED_NATIVE_RETURN_ARRAYS = 32;
const signExtend = (value: number, bits: number): number => {
	const shift = 32 - bits;
	return (value << shift) >> shift;
};

export class CPU {
	public instructionBudgetRemaining: number = 0;
	public lastPc: number = 0;
	public lastInstruction: number = 0;
	public readonly globals: Table;
	public readonly memory: Memory;

	private program: Program = null;
	private metadata: ProgramMetadata | null = null;
	private readonly runtimeConstPool: Value[] = [];
	private readonly stringPool: RuntimeStringPool;
	private indexKey: StringValue = null;
	private readonly frames: CallFrame[] = [];
	private readonly lastReturnValuesBuffer: TaggedValueList;
	private readonly lastReturnValuesScratch: Value[] = [];
	private readonly valueScratch: Value[] = [];
	private readonly returnScratch: Value[] = [];
	private readonly debugRegistersScratch: Value[] = [];
	private readonly nativeReturnPool: Value[][] = [];
	private decodedOps: Uint8Array | null = null;
	private decodedA: Uint8Array | null = null;
	private decodedB: Uint8Array | null = null;
	private decodedC: Uint8Array | null = null;
	private decodedExt: Uint8Array | null = null;
	private decodedWords: Uint32Array | null = null;
	private stringIndexTable: Table | null = null;

	// Frame pooling: avoid allocating new CallFrame objects per call
	private readonly framePool: CallFrame[] = [];

	// Register array pooling: keyed by size bucket (power of 2)
	private readonly registerPool: Map<number, RegisterFile[]> = new Map();
	private readonly objectHandles: ObjectHandleTable;

	constructor(memory: Memory, stringPool: RuntimeStringPool, objectHandles: ObjectHandleTable) {
		this.memory = memory;
		this.stringPool = stringPool;
		this.objectHandles = objectHandles;
		this.lastReturnValuesBuffer = new TaggedValueList(this.stringPool, this.objectHandles);
		this.globals = this.createTable(0, 0);
		this.indexKey = this.stringPool.intern('__index');
	}

	public get lastReturnValues(): Value[] {
		return this.lastReturnValuesBuffer.copyTo(this.lastReturnValuesScratch);
	}

	public createTable(arraySize: number = 0, hashSize: number = 0): Table {
		return new Table(arraySize, hashSize, this.objectHandles);
	}

	public setNativeObjectMetatable(native: NativeObject, metatable: Table | null): void {
		native.metatable = metatable;
		Table.ensureValueObjectId(native, this.objectHandles);
	}

	public captureObjectMemoryState(): ObjectHandleTableState {
		return this.objectHandles.captureState();
	}

	public captureRuntimeState(): CpuRuntimeState {
		const frames = new Array<CpuRuntimeFrameState>(this.frames.length);
		for (let index = 0; index < this.frames.length; index += 1) {
			const frame = this.frames[index];
			const openUpvalueRegisters = new Int32Array(frame.openUpvalues.size);
			const openUpvalueObjectIds = new Uint32Array(frame.openUpvalues.size);
			let upvalueIndex = 0;
			for (const [registerIndex, upvalue] of frame.openUpvalues.entries()) {
				openUpvalueRegisters[upvalueIndex] = registerIndex;
				openUpvalueObjectIds[upvalueIndex] = upvalue.objectId >>> 0;
				upvalueIndex += 1;
			}
			frames[index] = {
				protoIndex: frame.protoIndex,
				pc: frame.pc,
				depth: frame.depth,
				registers: frame.registers.snapshot(frame.top),
				varargs: frame.varargs.snapshot(),
				closureObjectId: frame.closure.objectId,
				openUpvalueRegisters,
				openUpvalueObjectIds,
				returnBase: frame.returnBase,
				returnCount: frame.returnCount,
				top: frame.top,
				captureReturns: frame.captureReturns,
				callSitePc: frame.callSitePc,
			};
		}
		return {
			frames,
			lastReturnValues: this.lastReturnValuesBuffer.snapshot(),
			lastPc: this.lastPc,
			lastInstruction: this.lastInstruction,
			stringIndexTableObjectId: this.stringIndexTable ? this.stringIndexTable.objectId : 0,
		};
	}

	public restoreObjectMemoryState(state: ObjectHandleTableState): void {
		this.objectHandles.restoreState(state);
		this.stringPool.clearRuntimeCache();
		Table.rehydrateRuntimeObjects(this.objectHandles, this.stringPool);
		this.indexKey = this.stringPool.getById(this.indexKey.id);
		this.rehydrateValueArray(this.runtimeConstPool);
		this.valueScratch.length = 0;
		this.returnScratch.length = 0;
		this.debugRegistersScratch.length = 0;
		this.lastReturnValuesScratch.length = 0;
	}

	private rehydrateValue(value: Value): Value {
		if (isStringValue(value)) {
			return this.stringPool.getById(value.id);
		}
		return value;
	}

	public encodeTaggedValueBufferEntry(buffer: Uint32Array, slotIndex: number, value: Value): void {
		Table.encodeTaggedValueToBuffer(buffer, slotIndex, value, this.objectHandles);
	}

	public decodeTaggedValueBufferEntry(buffer: ArrayLike<number>, slotIndex: number): Value {
		return Table.decodeTaggedValueFromBuffer(buffer, slotIndex, this.stringPool);
	}

	private rehydrateValueArray(values: Value[]): void {
		for (let index = 0; index < values.length; index += 1) {
			values[index] = this.rehydrateValue(values[index]);
		}
	}

	public restoreRuntimeState(state: CpuRuntimeState): void {
		this.unwindToDepth(0);
		this.frames.length = 0;
		this.lastReturnValuesBuffer.restore(state.lastReturnValues);
		this.lastReturnValuesScratch.length = 0;
		this.lastPc = state.lastPc;
		this.lastInstruction = state.lastInstruction;
		this.stringIndexTable = state.stringIndexTableObjectId === 0
			? null
			: Table.resolveRuntimeObjectId<Table>(state.stringIndexTableObjectId);
		for (let index = 0; index < state.frames.length; index += 1) {
			const frameState = state.frames[index];
			const proto = this.program.protos[frameState.protoIndex];
			const frame = this.acquireFrame();
			frame.protoIndex = frameState.protoIndex;
			frame.pc = frameState.pc;
			frame.depth = frameState.depth;
			const registerCount = Math.floor(frameState.registers.length / TAGGED_VALUE_STATE_STRIDE);
			frame.registers = this.acquireRegisters(Math.max(proto.maxStack, frameState.top, registerCount));
			frame.registers.restore(frameState.registers);
			frame.varargs.restore(frameState.varargs);
			frame.closure = Table.resolveRuntimeObjectId<Closure>(frameState.closureObjectId);
			frame.openUpvalues.clear();
			for (let upvalueIndex = 0; upvalueIndex < frameState.openUpvalueRegisters.length; upvalueIndex += 1) {
				frame.openUpvalues.set(
					frameState.openUpvalueRegisters[upvalueIndex],
					Table.resolveRuntimeObjectId<Upvalue>(frameState.openUpvalueObjectIds[upvalueIndex]),
				);
			}
			frame.returnBase = frameState.returnBase;
			frame.returnCount = frameState.returnCount;
			frame.top = frameState.top;
			frame.captureReturns = frameState.captureReturns;
			frame.callSitePc = frameState.callSitePc;
			this.frames.push(frame);
		}
	}

	// Acquire a register array of at least `size` slots, reusing pooled arrays when possible
	private acquireRegisters(size: number): RegisterFile {
		if (size > MAX_REGISTER_ARRAY_SIZE) {
			const regs = new RegisterFile(size, this.stringPool, this.objectHandles);
			regs.clear(size);
			return regs;
		}
		// Round up to next power of 2 for bucketing (min 8)
		const bucket = Math.max(8, 1 << (32 - Math.clz32(size - 1)));
		let pool = this.registerPool.get(bucket);
		if (pool && pool.length > 0) {
			const regs = pool.pop()!;
			regs.clear(size);
			return regs;
		}
		const regs = new RegisterFile(bucket, this.stringPool, this.objectHandles);
		regs.clear(size);
		return regs;
	}

	private acquireNativeReturnScratch(): Value[] {
		const pool = this.nativeReturnPool;
		if (pool.length > 0) {
			const out = pool.pop()!;
			out.length = 0;
			return out;
		}
		return [];
	}

	private releaseNativeReturnScratch(out: Value[]): void {
		if (this.nativeReturnPool.length < MAX_POOLED_NATIVE_RETURN_ARRAYS) {
			this.nativeReturnPool.push(out);
		}
	}

	private resolveTableIndex(table: Table, key: Value): Value {
		let current = table;
		for (let depth = 0; depth < 32; depth += 1) {
			const value = current.get(key);
			if (value !== null) {
				return value;
			}
			const metatable = current.getMetatable();
			if (metatable === null) {
				return null;
			}
			if (!(metatable instanceof Table)) {
				throw new Error('Metatable must be a table value.');
			}
			const indexer = metatable.get(this.indexKey);
			if (!(indexer instanceof Table)) {
				return null;
			}
			current = indexer;
		}
		throw new Error('Metatable __index loop detected.');
	}

	// Release a register array back to the pool
	private releaseRegisters(regs: RegisterFile): void {
		const bucket = regs.capacity();
		if (bucket > MAX_REGISTER_ARRAY_SIZE) return; // Don't pool oversized arrays
		regs.clear(bucket);
		let pool = this.registerPool.get(bucket);
		if (!pool) {
			pool = [];
			this.registerPool.set(bucket, pool);
		}
		if (pool.length < MAX_POOLED_REGISTER_ARRAYS) {
			pool.push(regs);
		}
	}

	// Acquire a CallFrame from pool or create new
	private acquireFrame(): CallFrame {
		if (this.framePool.length > 0) {
			return this.framePool.pop()!;
		}
		return {
			protoIndex: 0,
			pc: 0,
			depth: 0,
			registers: null!,
			varargs: new TaggedValueList(this.stringPool, this.objectHandles),
			closure: null!,
			openUpvalues: new Map<number, Upvalue>(),
			returnBase: 0,
			returnCount: 0,
			top: 0,
			captureReturns: false,
			callSitePc: 0,
		};
	}

	// Release a CallFrame back to pool
	private releaseFrame(frame: CallFrame): void {
		// Release register array
		this.releaseRegisters(frame.registers);
		frame.varargs.clear();
		// Clear upvalues map (reuse map)
		frame.openUpvalues.clear();
		// Pool the frame if not at capacity
		if (this.framePool.length < MAX_POOLED_FRAMES) {
			this.framePool.push(frame);
		}
	}

	public setProgram(program: Program, metadata: ProgramMetadata | null = null): void {
		this.program = program;
		this.metadata = metadata;
		const constPool = program.constPool;
		this.runtimeConstPool.length = constPool.length;
		for (let index = 0; index < constPool.length; index += 1) {
			const value = constPool[index];
			this.runtimeConstPool[index] = isStringValue(value)
				? this.stringPool.intern(stringValueToString(value))
				: value;
		}
		this.decodeProgram(program);
	}

	private decodeProgram(program: Program): void {
		const code = program.code;
		const instructionCount = Math.floor(code.length / INSTRUCTION_BYTES);
		const decodedOps = new Uint8Array(instructionCount);
		const decodedA = new Uint8Array(instructionCount);
		const decodedB = new Uint8Array(instructionCount);
		const decodedC = new Uint8Array(instructionCount);
		const decodedExt = new Uint8Array(instructionCount);
		const decodedWords = new Uint32Array(instructionCount);
		for (let pc = 0; pc < instructionCount; pc += 1) {
			const instr = readInstructionWord(code, pc);
			decodedWords[pc] = instr;
			decodedExt[pc] = instr >>> 24;
			decodedOps[pc] = (instr >>> 18) & 0x3f;
			decodedA[pc] = (instr >>> 12) & 0x3f;
			decodedB[pc] = (instr >>> 6) & 0x3f;
			decodedC[pc] = instr & 0x3f;
		}
		this.decodedOps = decodedOps;
		this.decodedA = decodedA;
		this.decodedB = decodedB;
		this.decodedC = decodedC;
		this.decodedExt = decodedExt;
		this.decodedWords = decodedWords;
	}

	public getStringPool(): StringPool {
		return this.stringPool;
	}

	public setStringIndexTable(table: Table | null): void {
		this.stringIndexTable = table;
	}

	public getProgram(): Program {
		return this.program;
	}

	public start(entryProtoIndex: number, args: Value[] = []): void {
		this.frames.length = 0;
		const closure = this.createRootClosure(entryProtoIndex);
		this.pushFrame(closure, args, 0, 0, false, this.program.protos[entryProtoIndex].entryPC);
	}

	public call(closure: Closure, args: Value[] = [], returnCount: number = 0): void {
		if (closure === null) {
			throw new Error('Attempted to call a nil value.');
		}
		if (typeof closure.protoIndex !== 'number') {
			throw new Error('Attempted to call a non-function value.');
		}
		this.pushFrame(closure, args, 0, returnCount, false, this.program.protos[closure.protoIndex].entryPC);
	}

	public callExternal(closure: Closure, args: Value[] = []): void {
		if (closure === null) {
			throw new Error('Attempted to call a nil value.');
		}
		if (typeof closure.protoIndex !== 'number') {
			throw new Error('Attempted to call a non-function value.');
		}
		this.pushFrame(closure, args, 0, 0, true, this.program.protos[closure.protoIndex].entryPC);
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
		while (this.frames.length > targetDepth) {
			if (this.instructionBudgetRemaining <= 0) {
				return RunResult.Yielded;
			}
			this.step();
		}
		return RunResult.Halted;
	}

	public unwindToDepth(targetDepth: number): void {
		while (this.frames.length > targetDepth) {
			const frame = this.frames.pop()!;
			this.closeUpvalues(frame);
			this.releaseFrame(frame);
		}
	}

	private charge(cycles: number): void {
		this.instructionBudgetRemaining -= cycles;
	}

	public step(): void {
		const frame = this.frames[this.frames.length - 1];
		let pc = frame.pc;
		let wordIndex = pc / INSTRUCTION_BYTES;
		const decodedOps = this.decodedOps!;
		const decodedA = this.decodedA!;
		const decodedB = this.decodedB!;
		const decodedC = this.decodedC!;
		const decodedExt = this.decodedExt!;
		const decodedWords = this.decodedWords!;
		let instr = decodedWords[wordIndex];
		let op = decodedOps[wordIndex];
		let ext = decodedExt[wordIndex];
		let wideA = 0;
		let wideB = 0;
		let wideC = 0;
		let hasWide = false;
		if (op === OpCode.WIDE) {
			hasWide = true;
			wideA = decodedA[wordIndex];
			wideB = decodedB[wordIndex];
			wideC = decodedC[wordIndex];
			pc += INSTRUCTION_BYTES;
			wordIndex += 1;
			instr = decodedWords[wordIndex];
			op = decodedOps[wordIndex];
			ext = decodedExt[wordIndex];
		}
		frame.pc = pc + INSTRUCTION_BYTES;
		this.lastPc = pc;
		this.lastInstruction = instr;
		this.charge(BASE_CYCLES[op] + (hasWide ? 1 : 0));
		this.executeInstruction(frame, op, decodedA[wordIndex], decodedB[wordIndex], decodedC[wordIndex], ext, wideA, wideB, wideC, hasWide);
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
			return this.frames[upvalue.frameDepth].registers.get(upvalue.index);
		}
		return upvalue.value;
	}

	public getConst(index: number): Value {
		return this.runtimeConstPool[index];
	}

	private skipNextInstruction(frame: CallFrame): void {
		const pc = frame.pc;
		const wordIndex = pc / INSTRUCTION_BYTES;
		const decodedOps = this.decodedOps!;
		if (wordIndex >= decodedOps.length) {
			throw new Error('Attempted to skip beyond end of program.');
		}
		if (decodedOps[wordIndex] === OpCode.WIDE) {
			if (wordIndex + 1 >= decodedOps.length) {
				throw new Error('Malformed program: WIDE instruction at end of program.');
			}
			frame.pc += INSTRUCTION_BYTES * 2;
			return;
		}
		frame.pc += INSTRUCTION_BYTES;
	}

	private executeInstruction(
		frame: CallFrame,
		op: number,
		aLow: number,
		bLow: number,
		cLow: number,
		ext: number,
		wideA: number,
		wideB: number,
		wideC: number,
		hasWide: boolean,
	): void {
		const usesBx = op === OpCode.LOADK
			|| op === OpCode.GETG
			|| op === OpCode.SETG
			|| op === OpCode.CLOSURE
			|| op === OpCode.JMP
			|| op === OpCode.JMPIF
			|| op === OpCode.JMPIFNOT;
		const extA = usesBx ? 0 : (ext >>> 6) & 0x3;
		const extB = usesBx ? 0 : (ext >>> 3) & 0x7;
		const extC = usesBx ? 0 : (ext & 0x7);
		const aShift = MAX_OPERAND_BITS + (usesBx ? 0 : EXT_A_BITS);
		const a = (wideA << aShift) | (extA << MAX_OPERAND_BITS) | aLow;
		const b = (wideB << (MAX_OPERAND_BITS + EXT_B_BITS)) | (extB << MAX_OPERAND_BITS) | bLow;
		const c = (wideC << (MAX_OPERAND_BITS + EXT_C_BITS)) | (extC << MAX_OPERAND_BITS) | cLow;
		const bxLow = (bLow << MAX_OPERAND_BITS) | cLow;
		const bx = (wideB << (MAX_BX_BITS + EXT_BX_BITS)) | ((usesBx ? ext : 0) << MAX_BX_BITS) | bxLow;
		const sbxBits = MAX_BX_BITS + EXT_BX_BITS + (hasWide ? MAX_OPERAND_BITS : 0);
		const sbx = signExtend(bx, sbxBits);
		const rkBitsB = MAX_OPERAND_BITS + EXT_B_BITS + (hasWide ? MAX_OPERAND_BITS : 0);
		const rkBitsC = MAX_OPERAND_BITS + EXT_C_BITS + (hasWide ? MAX_OPERAND_BITS : 0);
		const rkRawB = (wideB << (MAX_OPERAND_BITS + EXT_B_BITS)) | (extB << MAX_OPERAND_BITS) | bLow;
		const rkRawC = (wideC << (MAX_OPERAND_BITS + EXT_C_BITS)) | (extC << MAX_OPERAND_BITS) | cLow;
		switch (op) {
			case OpCode.WIDE:
				throw new Error('Unknown opcode.');
			case OpCode.MOV:
				this.copyRegister(frame, a, b);
				return;
			case OpCode.LOADK: {
				this.setRegister(frame, a, this.runtimeConstPool[bx]);
				return;
			}
			case OpCode.LOADNIL:
				this.charge(CEIL_DIV4(b));
				for (let index = 0; index < b; index += 1) {
					this.setRegisterNil(frame, a + index);
				}
				return;
			case OpCode.LOADBOOL:
				this.setRegisterBool(frame, a, b !== 0);
				if (c !== 0) {
					this.charge(1);
					this.skipNextInstruction(frame);
				}
				return;
			case OpCode.GETG: {
				const key = this.runtimeConstPool[bx];
				this.setRegister(frame, a, this.globals.get(key));
				return;
			}
			case OpCode.SETG: {
				const key = this.runtimeConstPool[bx];
				this.globals.set(key, frame.registers.get(a));
				return;
			}
			case OpCode.GETT: {
				const table = frame.registers.get(b);
				const key = this.readRK(frame, rkRawC, rkBitsC);
				if (table instanceof Table) {
					this.setRegister(frame, a, this.resolveTableIndex(table, key));
					return;
				}
				if (isStringValue(table)) {
					const indexTable = this.stringIndexTable;
					if (indexTable !== null) {
						this.setRegister(frame, a, this.resolveTableIndex(indexTable, key));
					} else {
						this.setRegisterNil(frame, a);
					}
					return;
				}
				if (isNativeObject(table)) {
					const directValue = table.get(key);
					if (directValue !== null) {
						this.setRegister(frame, a, directValue);
						return;
					}
					const metatable = table.metatable ?? null;
					if (metatable !== null) {
						const indexer = metatable.get(this.indexKey);
						if (indexer instanceof Table) {
							this.setRegister(frame, a, this.resolveTableIndex(indexer, key));
							return;
						}
					}
					this.setRegisterNil(frame, a);
					return;
				}
				throw new Error('Attempted to index field on a non-table value.');
			}
			case OpCode.SETT: {
				const table = frame.registers.get(a);
				const key = this.readRK(frame, rkRawB, rkBitsB);
				const value = this.readRK(frame, rkRawC, rkBitsC);
				if (table instanceof Table) {
					table.set(key, value);
					return;
				}
				if (isNativeObject(table)) {
					table.set(key, value);
					return;
				}
				throw new Error('Attempted to assign to a non-table value.');
			}
			case OpCode.NEWT:
				this.charge(CEIL_DIV4(b) + CEIL_DIV4(c));
				this.setRegisterTable(frame, a, this.createTable(b, c));
				return;
			case OpCode.ADD: {
				const left = this.readRKNumber(frame, rkRawB, rkBitsB);
				const right = this.readRKNumber(frame, rkRawC, rkBitsC);
				this.setRegisterNumber(frame, a, left + right);
				return;
			}
			case OpCode.SUB: {
				const left = this.readRKNumber(frame, rkRawB, rkBitsB);
				const right = this.readRKNumber(frame, rkRawC, rkBitsC);
				this.setRegisterNumber(frame, a, left - right);
				return;
			}
			case OpCode.MUL: {
				const left = this.readRKNumber(frame, rkRawB, rkBitsB);
				const right = this.readRKNumber(frame, rkRawC, rkBitsC);
				this.setRegisterNumber(frame, a, left * right);
				return;
			}
			case OpCode.DIV: {
				const left = this.readRKNumber(frame, rkRawB, rkBitsB);
				const right = this.readRKNumber(frame, rkRawC, rkBitsC);
				this.setRegisterNumber(frame, a, left / right);
				return;
			}
			case OpCode.MOD: {
				const left = this.readRKNumber(frame, rkRawB, rkBitsB);
				const right = this.readRKNumber(frame, rkRawC, rkBitsC);
				this.setRegisterNumber(frame, a, left % right);
				return;
			}
			case OpCode.FLOORDIV: {
				const left = this.readRKNumber(frame, rkRawB, rkBitsB);
				const right = this.readRKNumber(frame, rkRawC, rkBitsC);
				this.setRegisterNumber(frame, a, Math.floor(left / right));
				return;
			}
			case OpCode.POW: {
				const left = this.readRKNumber(frame, rkRawB, rkBitsB);
				const right = this.readRKNumber(frame, rkRawC, rkBitsC);
				this.setRegisterNumber(frame, a, Math.pow(left, right));
				return;
			}
			case OpCode.BAND: {
				const left = this.readRKNumber(frame, rkRawB, rkBitsB);
				const right = this.readRKNumber(frame, rkRawC, rkBitsC);
				this.setRegisterNumber(frame, a, left & right);
				return;
			}
			case OpCode.BOR: {
				const left = this.readRKNumber(frame, rkRawB, rkBitsB);
				const right = this.readRKNumber(frame, rkRawC, rkBitsC);
				this.setRegisterNumber(frame, a, left | right);
				return;
			}
			case OpCode.BXOR: {
				const left = this.readRKNumber(frame, rkRawB, rkBitsB);
				const right = this.readRKNumber(frame, rkRawC, rkBitsC);
				this.setRegisterNumber(frame, a, left ^ right);
				return;
			}
			case OpCode.SHL: {
				const left = this.readRKNumber(frame, rkRawB, rkBitsB);
				const right = this.readRKNumber(frame, rkRawC, rkBitsC);
				this.setRegisterNumber(frame, a, left << (right & 31));
				return;
			}
			case OpCode.SHR: {
				const left = this.readRKNumber(frame, rkRawB, rkBitsB);
				const right = this.readRKNumber(frame, rkRawC, rkBitsC);
				this.setRegisterNumber(frame, a, left >> (right & 31));
				return;
			}
			case OpCode.CONCAT: {
				const left = this.readRK(frame, rkRawB, rkBitsB);
				const right = this.readRK(frame, rkRawC, rkBitsC);
				const text = this.valueToString(left) + this.valueToString(right);
				const handle = this.stringPool.intern(text);
				const cp = this.stringPool.codepointCount(handle);
				this.charge(CEIL_DIV8(cp));
				this.setRegisterString(frame, a, handle);
				return;
			}
			case OpCode.CONCATN: {
				let text = '';
				this.charge(c << 1);
				for (let index = 0; index < c; index += 1) {
					text += this.valueToString(frame.registers.get(b + index));
				}
				const handle = this.stringPool.intern(text);
				const cp = this.stringPool.codepointCount(handle);
				this.charge(CEIL_DIV8(cp));
				this.setRegisterString(frame, a, handle);
				return;
			}
			case OpCode.UNM: {
				const value = this.readRegisterNumber(frame, b);
				this.setRegisterNumber(frame, a, -value);
				return;
			}
			case OpCode.NOT:
				this.setRegisterBool(frame, a, !frame.registers.isTruthy(b));
				return;
			case OpCode.LEN: {
				const value = frame.registers.get(b);
			if (isStringValue(value)) {
				const cp = this.stringPool.codepointCount(value);
				this.charge(CEIL_DIV16(cp));
				this.setRegisterNumber(frame, a, cp);
				return;
			}
				if (value instanceof Table) {
					this.setRegisterNumber(frame, a, value.length());
					return;
				}
				if (isNativeObject(value)) {
					if (!value.len) {
						const stack = this.getCallStack()
							.map(entry => {
								const range = this.getDebugRange(entry.pc);
								if (!range) return '<unknown>';
								return `${range.path}:${range.start.line}:${range.start.column}`;
							})
						.reverse()
						.join(' <- ');
					throw new Error(`Length operator expects a native object with a length. stack=${stack}`);
				}
				this.charge(12);
				this.setRegisterNumber(frame, a, value.len());
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
				this.setRegisterNumber(frame, a, ~value);
				return;
			}
			case OpCode.EQ: {
				const left = this.readRK(frame, rkRawB, rkBitsB);
				const right = this.readRK(frame, rkRawC, rkBitsC);
				const eq = valuesEqual(left, right);
				if (eq !== (a !== 0)) {
					this.charge(1);
					this.skipNextInstruction(frame);
				}
				return;
			}
			case OpCode.LT: {
				const left = this.readRK(frame, rkRawB, rkBitsB);
				const right = this.readRK(frame, rkRawC, rkBitsC);
				const ok = (isStringValue(left) && isStringValue(right))
					? stringValueToString(left) < stringValueToString(right)
					: (left as number) < (right as number);
				if (ok !== (a !== 0)) {
					this.charge(1);
					this.skipNextInstruction(frame);
				}
				return;
			}
			case OpCode.LE: {
				const left = this.readRK(frame, rkRawB, rkBitsB);
				const right = this.readRK(frame, rkRawC, rkBitsC);
				const ok = (isStringValue(left) && isStringValue(right))
					? stringValueToString(left) <= stringValueToString(right)
					: (left as number) <= (right as number);
				if (ok !== (a !== 0)) {
					this.charge(1);
					this.skipNextInstruction(frame);
				}
				return;
			}
			case OpCode.TEST: {
				const ok = frame.registers.isTruthy(a);
				if (ok !== (c !== 0)) {
					this.charge(1);
					this.skipNextInstruction(frame);
				}
				return;
			}
			case OpCode.TESTSET: {
				const ok = frame.registers.isTruthy(b);
				if (ok === (c !== 0)) {
					this.copyRegister(frame, a, b);
					return;
				}
				this.charge(1);
				this.skipNextInstruction(frame);
				return;
			}
			case OpCode.JMP: {
				frame.pc += sbx * INSTRUCTION_BYTES;
				return;
			}
			case OpCode.JMPIF: {
				if (frame.registers.isTruthy(a)) {
					frame.pc += sbx * INSTRUCTION_BYTES;
				}
				return;
			}
			case OpCode.JMPIFNOT: {
				if (!frame.registers.isTruthy(a)) {
					frame.pc += sbx * INSTRUCTION_BYTES;
				}
				return;
			}
			case OpCode.CLOSURE: {
				this.setRegisterClosure(frame, a, this.createClosure(frame, bx));
				return;
			}
			case OpCode.GETUP: {
				const upvalue = frame.closure.upvalues[b];
				this.setRegister(frame, a, this.readUpvalue(upvalue));
				return;
			}
			case OpCode.SETUP: {
				const upvalue = frame.closure.upvalues[b];
				this.writeUpvalue(upvalue, frame.registers.get(a));
				return;
			}
			case OpCode.VARARG: {
				const count = b === 0 ? frame.varargs.length : b;
				this.charge(CEIL_DIV4(count));
				for (let index = 0; index < count; index += 1) {
					const value = index < frame.varargs.length ? frame.varargs.get(index) : null;
					this.setRegister(frame, a + index, value);
				}
				return;
			}
			case OpCode.CALL: {
				const callee = frame.registers.get(a);
				const argCount = b === 0 ? Math.max(frame.top - a - 1, 0) : b;
				const args = this.valueScratch;
				args.length = 0;
				for (let index = 0; index < argCount; index += 1) {
					args.push(frame.registers.get(a + 1 + index));
				}
				if (callee === null) {
					const range = this.metadata ? this.getDebugRange(this.lastPc) : null;
					const location = range ? `${range.path}:${range.start.line}:${range.start.column}` : 'unknown';
					throw new Error(`Attempted to call a nil value. at ${location}`);
				}
				if (isNativeFunction(callee)) {
					const cost = callee.cost ?? DEFAULT_NATIVE_COST;
					this.charge(cost.base + cost.perArg * argCount);
					const results = this.acquireNativeReturnScratch();
					try {
						callee.invoke(args, results);
						const returnSlotCount = c === 0 ? results.length : c;
						this.charge(cost.perRet * returnSlotCount);
						this.writeReturnValues(frame, a, c, results);
					} finally {
						this.releaseNativeReturnScratch(results);
					}
					return;
				}
				if (typeof (callee as Closure).protoIndex !== 'number') {
					const range = this.metadata ? this.getDebugRange(this.lastPc) : null;
					const location = range ? `${range.path}:${range.start.line}:${range.start.column}` : 'unknown';
					const calleeType = valueTypeName(callee as Value);
					const calleeValue = isStringValue(callee)
						? ` value=${stringValueToString(callee)}`
						: (typeof callee === 'number' || typeof callee === 'boolean')
							? ` value=${String(callee)}`
							: '';
					throw new Error(`Attempted to call a non-function value (${calleeType}${calleeValue}). at ${location}`);
				}
				const proto = this.program.protos[(callee as Closure).protoIndex];
				this.charge(argCount + CEIL_DIV4(proto.maxStack));
				if (proto.isVararg && argCount > proto.numParams) {
					this.charge(CEIL_DIV4(argCount - proto.numParams));
				}
				this.pushFrame(callee as Closure, args, a, c, false, frame.pc - INSTRUCTION_BYTES);
				return;
			}
			case OpCode.RET: {
				const scratch = this.returnScratch;
				scratch.length = 0;
				const total = b === 0 ? Math.max(frame.top - a, 0) : b;
				this.charge(total + frame.openUpvalues.size * 3);
				for (let index = 0; index < total; index += 1) {
					scratch.push(frame.registers.get(a + index));
				}
				this.lastReturnValuesBuffer.assignFromValues(scratch);
				this.lastReturnValuesScratch.length = 0;
				this.closeUpvalues(frame);
				this.frames.pop();
				this.releaseFrame(frame);
				if (this.frames.length === 0) {
					return;
				}
				if (frame.captureReturns) {
					return;
				}
				const caller = this.frames[this.frames.length - 1];
				this.writeReturnValues(caller, frame.returnBase, frame.returnCount, scratch);
				return;
			}
			case OpCode.LOAD_MEM: {
				const addr = this.readRegisterNumber(frame, b);
				this.setRegister(frame, a, this.memory.readValue(addr));
				return;
			}
			case OpCode.STORE_MEM: {
				const addr = this.readRegisterNumber(frame, b);
				this.memory.writeValue(addr, frame.registers.get(a));
				return;
			}
			default:
				throw new Error('Unknown opcode.');
		}
	}

	private pushFrame(closure: Closure, args: Value[], returnBase: number, returnCount: number, captureReturns: boolean, callSitePc: number): void {
		Table.ensureValueObjectId(closure, this.objectHandles);
		const proto = this.program.protos[closure.protoIndex];
		const frame = this.acquireFrame();
		frame.protoIndex = closure.protoIndex;
		frame.pc = proto.entryPC;
		frame.depth = this.frames.length;
		frame.registers = this.acquireRegisters(proto.maxStack);
		frame.closure = closure;
		frame.returnBase = returnBase;
		frame.returnCount = returnCount;
		frame.top = proto.numParams;
		frame.captureReturns = captureReturns;
		frame.callSitePc = callSitePc;

		// Copy args into registers
		const registers = frame.registers;
		let argIndex = 0;
		for (let index = 0; index < proto.numParams; index += 1) {
			registers.set(index, argIndex < args.length ? args[argIndex] : null);
			argIndex += 1;
		}
		// Handle varargs
		if (proto.isVararg) {
			const varargs = frame.varargs;
			for (let index = argIndex; index < args.length; index += 1) {
				varargs.push(args[index]);
			}
		}
		this.frames.push(frame);
	}

	private createRootClosure(protoIndex: number): Closure {
		const closure: Closure = {
			objectId: 0,
			objectAddr: 0,
			protoIndex,
			upvalues: [],
		};
		Table.ensureValueObjectId(closure, this.objectHandles);
		return closure;
	}

	private createClosure(frame: CallFrame, protoIndex: number): Closure {
		const proto = this.program.protos[protoIndex];
		const upvalues = new Array<Upvalue>(proto.upvalueDescs.length);
		for (let index = 0; index < proto.upvalueDescs.length; index += 1) {
			const desc = proto.upvalueDescs[index];
			if (desc.inStack) {
				let upvalue = frame.openUpvalues.get(desc.index);
				if (!upvalue) {
					upvalue = {
						objectId: 0,
						objectAddr: 0,
						open: true,
						index: desc.index,
						frameDepth: frame.depth,
						value: null,
					};
					Table.ensureUpvalueObjectId(upvalue, this.objectHandles);
					frame.openUpvalues.set(desc.index, upvalue);
				}
				upvalues[index] = upvalue;
				continue;
			}
			upvalues[index] = frame.closure.upvalues[desc.index];
		}
		const closure: Closure = {
			objectId: 0,
			objectAddr: 0,
			protoIndex,
			upvalues,
		};
		Table.ensureValueObjectId(closure, this.objectHandles);
		return closure;
	}

	private closeUpvalues(frame: CallFrame): void {
		for (const upvalue of frame.openUpvalues.values()) {
			upvalue.value = frame.registers.get(upvalue.index);
			upvalue.open = false;
			upvalue.frameDepth = -1;
			Table.syncUpvalueState(upvalue, this.objectHandles);
		}
		frame.openUpvalues.clear();
	}

	private readUpvalue(upvalue: Upvalue): Value {
		if (upvalue.open) {
			return this.frames[upvalue.frameDepth].registers.get(upvalue.index);
		}
		return upvalue.value;
	}

	private writeUpvalue(upvalue: Upvalue, value: Value): void {
		if (upvalue.open) {
			this.frames[upvalue.frameDepth].registers.set(upvalue.index, value);
			return;
		}
		upvalue.value = value;
		Table.syncUpvalueState(upvalue, this.objectHandles);
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
		let registers = frame.registers;
		if (index >= registers.capacity()) {
			const needed = index + 1;
			const bucket = Math.max(8, 1 << (32 - Math.clz32(needed - 1)));
			const target = bucket > MAX_REGISTER_ARRAY_SIZE ? needed : bucket;
			const next = target > MAX_REGISTER_ARRAY_SIZE
				? new RegisterFile(target, this.stringPool, this.objectHandles)
				: this.acquireRegisters(target);
			next.copyFrom(registers, frame.top);
			this.releaseRegisters(registers);
			registers = next;
			frame.registers = next;
		}
		return registers;
	}

	private bumpRegisterTop(frame: CallFrame, index: number): void {
		const nextTop = index + 1;
		if (nextTop > frame.top) {
			frame.top = nextTop;
		}
	}

	private copyRegister(frame: CallFrame, dst: number, src: number): void {
		const registers = this.ensureRegisterCapacity(frame, dst);
		registers.copySlot(dst, src);
		this.bumpRegisterTop(frame, dst);
	}

	private setRegisterNil(frame: CallFrame, index: number): void {
		const registers = this.ensureRegisterCapacity(frame, index);
		registers.setNil(index);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterBool(frame: CallFrame, index: number, value: boolean): void {
		const registers = this.ensureRegisterCapacity(frame, index);
		registers.setBool(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterNumber(frame: CallFrame, index: number, value: number): void {
		const registers = this.ensureRegisterCapacity(frame, index);
		registers.setNumber(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterString(frame: CallFrame, index: number, value: StringValue): void {
		const registers = this.ensureRegisterCapacity(frame, index);
		registers.setString(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterTable(frame: CallFrame, index: number, value: Table): void {
		const registers = this.ensureRegisterCapacity(frame, index);
		registers.setTable(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegisterClosure(frame: CallFrame, index: number, value: Closure): void {
		const registers = this.ensureRegisterCapacity(frame, index);
		registers.setClosure(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private setRegister(frame: CallFrame, index: number, value: Value): void {
		const registers = this.ensureRegisterCapacity(frame, index);
		registers.set(index, value);
		this.bumpRegisterTop(frame, index);
	}

	private readRegisterNumber(frame: CallFrame, index: number): number {
		const registers = frame.registers;
		if (registers.isNumber(index)) {
			return registers.getNumber(index);
		}
		return registers.get(index) as number;
	}

	private readRKNumber(frame: CallFrame, raw: number, bits: number): number {
		const rk = signExtend(raw, bits);
		if (rk < 0) {
			const index = -1 - rk;
			return this.runtimeConstPool[index] as number;
		}
		return this.readRegisterNumber(frame, rk);
	}

	private readRK(frame: CallFrame, raw: number, bits: number): Value {
		const rk = signExtend(raw, bits);
		if (rk < 0) {
			const index = -1 - rk;
			return this.runtimeConstPool[index];
		}
		return frame.registers.get(rk);
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
