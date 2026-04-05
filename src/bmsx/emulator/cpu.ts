import { StringPool, StringValue, isStringValue, stringValueToString } from './string_pool';
import type { RuntimeStringPoolState } from './string_pool';
import type { Memory } from './memory';
import { addTrackedLuaHeapBytes, replaceTrackedLuaHeapBytes } from './lua_heap_usage';
import { formatNumber } from './number_format';
import { EXT_A_BITS, EXT_B_BITS, EXT_BX_BITS, EXT_C_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_OPERAND_BITS, readInstructionWord } from './instruction_format';
import { findVdpPacketSchema, getVdpPacketArgKind, VdpPacketWordKind } from './vdp_packet_schema';
import {
	VDP_STREAM_BUFFER_BASE,
	VDP_STREAM_BUFFER_SIZE,
} from './memory_map';

export type Value = null | boolean | number | StringValue | Table | Closure | NativeFunction | NativeObject;

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
	invoke(args: ReadonlyArray<Value>, out: Value[]): void;
	cost?: NativeFnCost;
};

export type NativeObject = {
	readonly kind: typeof NATIVE_OBJECT_KIND;
	readonly raw: object;
	get(key: Value): Value;
	set(key: Value, value: Value): void;
	len?: () => number;
	nextEntry?: (after: Value) => [Value, Value] | null;
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

const NATIVE_COST_TIER0: NativeFnCost = { base: 0, perArg: 0, perRet: 0 };
const NATIVE_COST_TIER1: NativeFnCost = { base: 1, perArg: 0, perRet: 0 };
const NATIVE_COST_TIER2: NativeFnCost = { base: 2, perArg: 0, perRet: 0 };
const NATIVE_COST_TIER4: NativeFnCost = { base: 4, perArg: 0, perRet: 0 };
const DEFAULT_NATIVE_COST = NATIVE_COST_TIER1;
const VDP_PACKET_F32_BUFFER = new ArrayBuffer(4);
const VDP_PACKET_F32_VIEW = new DataView(VDP_PACKET_F32_BUFFER);

function resolveApiNativeCost(name: string): NativeFnCost {
	switch (name) {
		case 'display_width':
		case 'display_height':
		case 'get_cpu_freq_hz':
		case 'get_default_font':
		case 'get_lua_entry_path':
		case 'keyboard':
		case 'rungate':
		case 'runtime':
			return NATIVE_COST_TIER0;
		case 'mousebtn':
		case 'mousebtnp':
		case 'mousebtnr':
		case 'stat':
		case 'put_mesh':
		case 'put_particle':
		case 'skybox':
		case 'put_ambient_light':
		case 'put_directional_light':
		case 'put_point_light':
		case 'action_triggered':
		case 'resolveFontId':
		case 'dget':
		case 'sfx':
		case 'stop_sfx':
		case 'music':
		case 'stop_music':
		case 'reboot':
			return NATIVE_COST_TIER1;
		case 'pointer_screen_position':
		case 'pointer_delta':
		case 'pointer_viewport_position':
		case 'mousepos':
		case 'mousewheel':
		case 'consume_action':
		case 'set_cpu_freq_hz':
		case 'dset':
		case 'set_master_volume':
		case 'pause_audio':
		case 'resume_audio':
			return NATIVE_COST_TIER2;
		case 'set_camera':
		case 'cartdata':
		case 'list_lua_resources':
		case 'get_lua_resource_source':
		case 'list_lua_builtins':
		case 'create_font':
		case 'set_sprite_parallax_rig':
		case 'taskgate':
			return NATIVE_COST_TIER4;
		default:
			return DEFAULT_NATIVE_COST;
	}
}

function resolveNativeFunctionCost(name: string): NativeFnCost {
	switch (name) {
		case 'sys_cpu_cycles_used':
		case 'sys_cpu_cycles_granted':
		case 'sys_cpu_active_cycles_used':
		case 'sys_cpu_active_cycles_granted':
		case 'sys_ram_used':
		case 'sys_vram_used':
		case 'sys_vdp_work_units_per_sec':
		case 'sys_vdp_work_units_last':
		case 'sys_vdp_frame_held':
		case 'clock_now':
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
		case 'sys_palette_color':
		case 'resolve_cart_rom_asset_range':
		case 'resolve_sys_rom_asset_range':
		case 'resolve_rom_asset_range':
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
		case 'wait_vblank':
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
			return NATIVE_COST_TIER4;
		default:
			if (name.startsWith('api.')) {
				return resolveApiNativeCost(name.slice(4));
			}
			return DEFAULT_NATIVE_COST;
	}
}

function isVdpPacketSequenceWrite(baseAddr: number, wordCount: number): boolean {
	const byteLength = wordCount * 4;
	return baseAddr >= VDP_STREAM_BUFFER_BASE && (baseAddr + byteLength) <= (VDP_STREAM_BUFFER_BASE + VDP_STREAM_BUFFER_SIZE);
}

function encodeVdpPacketU32Word(value: Value, label: string): number {
	if (typeof value === 'number') {
		return value >>> 0;
	}
	if (typeof value === 'boolean') {
		return value ? 1 : 0;
	}
	if (value === null) {
		return 0;
	}
	if (isStringValue(value)) {
		return value.id >>> 0;
	}
	throw new Error(`[VDP] ${label} expects a numeric or string word.`);
}

function encodeVdpPacketF32Word(value: Value, label: string): number {
	if (typeof value !== 'number') {
		throw new Error(`[VDP] ${label} expects a numeric word.`);
	}
	VDP_PACKET_F32_VIEW.setFloat32(0, value, true);
	return VDP_PACKET_F32_VIEW.getUint32(0, true) >>> 0;
}

function encodeVdpPacketArgWord(cmd: number, index: number, value: Value): number {
	return getVdpPacketArgKind(cmd, index) === VdpPacketWordKind.F32
		? encodeVdpPacketF32Word(value, `packet arg ${index}`)
		: encodeVdpPacketU32Word(value, `packet arg ${index}`);
}

function tryGetVdpPacketPrefixWordCounts(registers: { get(index: number): Value; }, valueBase: number): { cmd: number; argWords: number; payloadWords: number; } | null {
	const cmd = encodeVdpPacketU32Word(registers.get(valueBase), 'packet cmd');
	const schema = findVdpPacketSchema(cmd);
	if (schema === null) {
		return null;
	}
	const argWords = encodeVdpPacketU32Word(registers.get(valueBase + 1), 'packet arg_words');
	if (argWords !== schema.argWords) {
		return null;
	}
	const payloadWords = encodeVdpPacketU32Word(registers.get(valueBase + 2), 'packet payload_words');
	return { cmd, argWords, payloadWords };
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
	}
	| {
		kind: 'native_array';
		values: CpuValueState[];
		props: Array<{ key: CpuValueState; value: CpuValueState }>;
		metatable: CpuValueState;
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
	stringPoolState: RuntimeStringPoolState;
	globals: CpuRootValueState[];
	ioMemory: CpuValueState[];
	moduleCache: CpuRootValueState[];
	frames: CpuFrameState[];
	lastReturnValues: CpuValueState[];
	objects: CpuObjectState[];
	lastPc: number;
	lastInstruction: number;
	instructionBudgetRemaining: number;
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

export const enum OpCode {
	WIDE,
	MOV,
	LOADK,
	LOADNIL,
	LOADBOOL,
	KNIL,
	KFALSE,
	KTRUE,
	K0,
	K1,
	KM1,
	KSMI,
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
	STORE_MEM_WORDS,
	BR_TRUE,
	BR_FALSE,
	GETSYS,
	SETSYS,
	GETGL,
	SETGL,
	GETI,
	SETI,
	GETFIELD,
	SETFIELD,
	SELF,
}

export const enum MemoryAccessKind {
	Word,
	U8,
	U16LE,
	U32LE,
	F32LE,
	F64LE,
}

export const enum RunResult {
	Halted,
	Yielded,
}

const CEIL_DIV4 = (value: number) => (value + 3) >> 2;

const BASE_CYCLES: Uint8Array = (() => {
	const table = new Uint8Array(64);
	table.fill(1);

	const set = (op: OpCode, cost: number) => {
		table[op] = cost;
	};

	set(OpCode.WIDE, 0);

	set(OpCode.MOV, 1);
	set(OpCode.LOADK, 1);
	set(OpCode.LOADBOOL, 1);
	set(OpCode.LOADNIL, 1);
	set(OpCode.KNIL, 1);
	set(OpCode.KFALSE, 1);
	set(OpCode.KTRUE, 1);
	set(OpCode.K0, 1);
	set(OpCode.K1, 1);
	set(OpCode.KM1, 1);
	set(OpCode.KSMI, 1);

	set(OpCode.GETG, 1);
	set(OpCode.SETG, 2);
	set(OpCode.GETT, 1);
	set(OpCode.SETT, 2);
	set(OpCode.NEWT, 1);

	set(OpCode.CONCATN, 2);

	set(OpCode.TESTSET, 2);

	set(OpCode.CLOSURE, 1);
	set(OpCode.GETUP, 1);
	set(OpCode.SETUP, 2);
	set(OpCode.VARARG, 2);

	set(OpCode.CALL, 2);
	set(OpCode.RET, 2);

	set(OpCode.LOAD_MEM, 1);
	set(OpCode.STORE_MEM, 2);
	set(OpCode.STORE_MEM_WORDS, 2);
	set(OpCode.GETSYS, 1);
	set(OpCode.SETSYS, 2);
	set(OpCode.GETGL, 1);
	set(OpCode.SETGL, 2);
	set(OpCode.GETI, 1);
	set(OpCode.SETI, 2);
	set(OpCode.GETFIELD, 1);
	set(OpCode.SETFIELD, 2);
	set(OpCode.SELF, 1);

	return table;
})();

type Upvalue = {
	open: boolean;
	index: number;
	frame: CallFrame;
	value: Value;
};

type CallFrame = {
	protoIndex: number;
	pc: number;
	registers: RegisterFile;
	varargs: Value[];
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
					return;
				}
				this.array[index] = value;
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
				this.hash[nodeIndex].value = value;
				return;
			}
			if (this.hash.length === 0 || this.hashFree < 0) {
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
			this.hash[nodeIndex].value = value;
			return;
		}
		if (this.hash.length === 0 || this.hashFree < 0) {
			this.rehash(key);
		}
		this.rawSet(key, value);
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
				return;
			}
			this.array[index] = value;
			if (index === this.arrayLength) {
				this.updateArrayLengthFrom(this.arrayLength);
			}
			return;
		}
		if (value === null) {
			this.removeFromHash(indexValue);
			if (index >= 0 && index < this.arrayLength) {
				this.arrayLength = index;
			}
			return;
		}
		const nodeIndex = this.findNodeIndex(indexValue);
		if (nodeIndex >= 0) {
			this.hash[nodeIndex].value = value;
			return;
		}
		if (this.hash.length === 0 || this.hashFree < 0) {
			this.rehash(indexValue);
		}
		this.rawSet(indexValue, value);
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
			return;
		}
		const nodeIndex = this.findNodeIndex(key);
		if (nodeIndex >= 0) {
			this.hash[nodeIndex].value = value;
			return;
		}
		if (this.hash.length === 0 || this.hashFree < 0) {
			this.rehash(key);
		}
		this.rawSet(key, value);
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
		replaceTrackedLuaHeapBytes(previousBytes, this.getTrackedHeapBytes());
	}

	public entriesArray(): ReadonlyArray<[Value, Value]> {
		const entries: Array<[Value, Value]> = [];
		for (let index = 0; index < this.array.length; index += 1) {
			const value = this.array[index];
			if (value === null || value === undefined) {
				continue;
			}
			entries.push([index + 1, value]);
		}
		for (let index = 0; index < this.hash.length; index += 1) {
			const node = this.hash[index];
			if (node.key !== null) {
				entries.push([node.key, node.value]);
			}
		}
		return entries;
	}

	public getMetatable(): Table | null {
		return this.metatable;
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
			power <<= 1;
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
	private readonly tags: Uint8Array;
	private readonly numbers: Float64Array;
	private readonly refs: Value[];

	constructor(size: number) {
		this.tags = new Uint8Array(size);
		this.numbers = new Float64Array(size);
		this.refs = new Array<Value>(size);
		for (let index = 0; index < size; index += 1) {
			this.refs[index] = null;
		}
	}

	public capacity(): number {
		return this.tags.length;
	}

	public clear(count: number): void {
		this.tags.fill(RegisterTag.Nil, 0, count);
		for (let index = 0; index < count; index += 1) {
			this.refs[index] = null;
		}
	}

	public copyFrom(source: RegisterFile, count: number): void {
		for (let index = 0; index < count; index += 1) {
			this.tags[index] = source.tags[index];
			this.numbers[index] = source.numbers[index];
			this.refs[index] = source.refs[index];
		}
	}

	public copyTo(target: Value[], count: number): void {
		target.length = count;
		for (let index = 0; index < count; index += 1) {
			target[index] = this.get(index);
		}
	}

	public copySlot(dst: number, src: number): void {
		this.tags[dst] = this.tags[src];
		this.numbers[dst] = this.numbers[src];
		this.refs[dst] = this.refs[src];
	}

	public isNumber(index: number): boolean {
		return this.tags[index] === RegisterTag.Number;
	}

	public getNumber(index: number): number {
		return this.numbers[index];
	}

	public isTruthy(index: number): boolean {
		const tag = this.tags[index];
		return tag !== RegisterTag.Nil && tag !== RegisterTag.False;
	}

	public get(index: number): Value {
		switch (this.tags[index]) {
			case RegisterTag.Nil:
				return null;
			case RegisterTag.False:
				return false;
			case RegisterTag.True:
				return true;
			case RegisterTag.Number:
				return this.numbers[index];
			case RegisterTag.String:
			case RegisterTag.Table:
			case RegisterTag.Closure:
			case RegisterTag.NativeFunction:
			case RegisterTag.NativeObject:
				return this.refs[index];
			default:
				throw new Error('Invalid register tag.');
		}
	}

	public setNil(index: number): void {
		this.tags[index] = RegisterTag.Nil;
		this.refs[index] = null;
	}

	public setBool(index: number, value: boolean): void {
		this.tags[index] = value ? RegisterTag.True : RegisterTag.False;
		this.refs[index] = null;
	}

	public setNumber(index: number, value: number): void {
		this.tags[index] = RegisterTag.Number;
		this.numbers[index] = value;
		this.refs[index] = null;
	}

	public setString(index: number, value: StringValue): void {
		this.tags[index] = RegisterTag.String;
		this.refs[index] = value;
	}

	public setTable(index: number, value: Table): void {
		this.tags[index] = RegisterTag.Table;
		this.refs[index] = value;
	}

	public setClosure(index: number, value: Closure): void {
		this.tags[index] = RegisterTag.Closure;
		this.refs[index] = value;
	}

	public setNativeFunction(index: number, value: NativeFunction): void {
		this.tags[index] = RegisterTag.NativeFunction;
		this.refs[index] = value;
	}

	public setNativeObject(index: number, value: NativeObject): void {
		this.tags[index] = RegisterTag.NativeObject;
		this.refs[index] = value;
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
	public lastReturnValues: Value[] = [];
	public lastPc: number = 0;
	public lastInstruction: number = 0;
	public readonly globals: Table;
	public readonly memory: Memory;

	private program: Program = null;
	private metadata: ProgramMetadata | null = null;
	private readonly stringPool: StringPool;
	private indexKey: StringValue = null;
	private yieldRequested = false;
	private readonly frames: CallFrame[] = [];
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
	private systemGlobalNames: StringValue[] = [];
	private systemGlobalValues: Value[] = [];
	private systemGlobalSlotByKey: Map<StringValue, number> = new Map();
	private globalNames: StringValue[] = [];
	private globalValues: Value[] = [];
	private globalSlotByKey: Map<StringValue, number> = new Map();

	// Frame pooling: avoid allocating new CallFrame objects per call
	private readonly framePool: CallFrame[] = [];

	// Register array pooling: keyed by size bucket (power of 2)
	private readonly registerPool: Map<number, RegisterFile[]> = new Map();

	constructor(memory: Memory, stringPool: StringPool | null = null) {
		this.memory = memory;
		this.stringPool = stringPool ?? new StringPool();
		this.globals = new Table(0, 0);
		this.indexKey = this.stringPool.intern('__index');
	}

	// Acquire a register array of at least `size` slots, reusing pooled arrays when possible
	private acquireRegisters(size: number): RegisterFile {
		if (size > MAX_REGISTER_ARRAY_SIZE) {
			const regs = new RegisterFile(size);
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
		const regs = new RegisterFile(bucket);
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
			const indexer = metatable.getStringKey(this.indexKey);
			if (!(indexer instanceof Table)) {
				return null;
			}
			current = indexer;
		}
		throw new Error('Metatable __index loop detected.');
	}

	private resolveTableIntegerIndex(table: Table, index: number): Value {
		let current = table;
		for (let depth = 0; depth < 32; depth += 1) {
			const value = current.getInteger(index);
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

	private resolveTableFieldIndex(table: Table, key: StringValue): Value {
		let current = table;
		for (let depth = 0; depth < 32; depth += 1) {
			const value = current.getStringKey(key);
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

	private loadTableIndex(base: Value, key: Value): Value {
		if (base instanceof Table) {
			return this.resolveTableIndex(base, key);
		}
		if (isStringValue(base)) {
			const indexTable = this.stringIndexTable;
			return indexTable === null ? null : this.resolveTableIndex(indexTable, key);
		}
		if (isNativeObject(base)) {
			const directValue = base.get(key);
			if (directValue !== null) {
				return directValue;
			}
			const metatable = base.metatable ?? null;
			if (metatable !== null) {
				const indexer = metatable.getStringKey(this.indexKey);
				if (indexer instanceof Table) {
					return this.resolveTableIndex(indexer, key);
				}
			}
			return null;
		}
		throw new Error('Attempted to index field on a non-table value.');
	}

	private loadTableIntegerIndex(base: Value, index: number): Value {
		if (base instanceof Table) {
			return this.resolveTableIntegerIndex(base, index);
		}
		if (isStringValue(base)) {
			const indexTable = this.stringIndexTable;
			return indexTable === null ? null : this.resolveTableIntegerIndex(indexTable, index);
		}
		if (isNativeObject(base)) {
			const directValue = base.get(index);
			if (directValue !== null) {
				return directValue;
			}
			const metatable = base.metatable ?? null;
			if (metatable !== null) {
				const indexer = metatable.getStringKey(this.indexKey);
				if (indexer instanceof Table) {
					return this.resolveTableIntegerIndex(indexer, index);
				}
			}
			return null;
		}
		throw new Error('Attempted to index field on a non-table value.');
	}

	private loadTableFieldIndex(base: Value, key: StringValue): Value {
		if (base instanceof Table) {
			return this.resolveTableFieldIndex(base, key);
		}
		if (isStringValue(base)) {
			const indexTable = this.stringIndexTable;
			return indexTable === null ? null : this.resolveTableFieldIndex(indexTable, key);
		}
		if (isNativeObject(base)) {
			const directValue = base.get(key);
			if (directValue !== null) {
				return directValue;
			}
			const metatable = base.metatable ?? null;
			if (metatable !== null) {
				const indexer = metatable.getStringKey(this.indexKey);
				if (indexer instanceof Table) {
					return this.resolveTableFieldIndex(indexer, key);
				}
			}
			return null;
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
			registers: null!,
			varargs: [],
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
		// Clear varargs (reuse array)
		frame.varargs.length = 0;
		// Clear upvalues map (reuse map)
		frame.openUpvalues.clear();
		// Pool the frame if not at capacity
		if (this.framePool.length < MAX_POOLED_FRAMES) {
			this.framePool.push(frame);
		}
	}

	public setProgram(program: Program, metadata: ProgramMetadata | null = null): void {
		// Keep slot-backed globals materialized in the globals table before swapping programs.
		// SETGL/SETSYS mutate the slot arrays directly, and append/reload paths rebuild the next
		// slot layout from `globals`, so without this sync flattened module exports can fall back to nil.
		this.syncGlobalSlotsToTable();
		this.program = program;
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

	public getProgram(): Program | null {
		return this.program;
	}

	public start(entryProtoIndex: number, args: Value[] = []): void {
		this.frames.length = 0;
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
		this.yieldRequested = false;
		this.pushFrame(closure, args, 0, 0, true, this.program.protos[closure.protoIndex].entryPC);
	}

	public requestYield(): void {
		this.yieldRequested = true;
	}

	public clearYieldRequest(): void {
		this.yieldRequested = false;
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
			if (this.yieldRequested) {
				this.yieldRequested = false;
				return RunResult.Yielded;
			}
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
		this.charge(BASE_CYCLES[op]);
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
			|| op === OpCode.KSMI
			|| op === OpCode.GETG
			|| op === OpCode.SETG
			|| op === OpCode.GETSYS
			|| op === OpCode.SETSYS
			|| op === OpCode.GETGL
			|| op === OpCode.SETGL
			|| op === OpCode.CLOSURE
			|| op === OpCode.JMP
			|| op === OpCode.JMPIF
			|| op === OpCode.JMPIFNOT
			|| op === OpCode.BR_TRUE
			|| op === OpCode.BR_FALSE;
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
				this.setRegister(frame, a, this.program.constPool[bx]);
				return;
			}
			case OpCode.KNIL:
				this.setRegisterNil(frame, a);
				return;
			case OpCode.KFALSE:
				this.setRegisterBool(frame, a, false);
				return;
			case OpCode.KTRUE:
				this.setRegisterBool(frame, a, true);
				return;
			case OpCode.K0:
				this.setRegisterNumber(frame, a, 0);
				return;
			case OpCode.K1:
				this.setRegisterNumber(frame, a, 1);
				return;
			case OpCode.KM1:
				this.setRegisterNumber(frame, a, -1);
				return;
			case OpCode.KSMI:
				this.setRegisterNumber(frame, a, sbx);
				return;
			case OpCode.LOADNIL:
				for (let index = 0; index < b; index += 1) {
					this.setRegisterNil(frame, a + index);
				}
				return;
			case OpCode.LOADBOOL:
				this.setRegisterBool(frame, a, b !== 0);
				if (c !== 0) {
					this.skipNextInstruction(frame);
				}
				return;
			case OpCode.GETG: {
				const key = this.program.constPool[bx];
				this.setRegister(frame, a, this.globals.get(key));
				return;
			}
			case OpCode.SETG: {
				const key = this.program.constPool[bx];
				this.globals.set(key, frame.registers.get(a));
				return;
			}
			case OpCode.GETSYS:
				this.setRegister(frame, a, this.getSystemGlobalBySlot(bx));
				return;
			case OpCode.SETSYS:
				this.setSystemGlobalBySlot(bx, frame.registers.get(a));
				return;
			case OpCode.GETGL:
				this.setRegister(frame, a, this.getGlobalBySlot(bx));
				return;
			case OpCode.SETGL:
				this.setGlobalBySlot(bx, frame.registers.get(a));
				return;
			case OpCode.GETI:
				this.setRegister(frame, a, this.loadTableIntegerIndex(frame.registers.get(b), c));
				return;
			case OpCode.SETI:
				this.storeTableIntegerIndex(frame.registers.get(a), b, this.readRK(frame, rkRawC, rkBitsC));
				return;
			case OpCode.GETFIELD:
				this.setRegister(frame, a, this.loadTableFieldIndex(frame.registers.get(b), this.program.constPool[c] as StringValue));
				return;
			case OpCode.SETFIELD:
				this.storeTableFieldIndex(frame.registers.get(a), this.program.constPool[b] as StringValue, this.readRK(frame, rkRawC, rkBitsC));
				return;
			case OpCode.SELF: {
				const base = frame.registers.get(b);
				const key = this.program.constPool[c] as StringValue;
				this.setRegister(frame, a + 1, base);
				this.setRegister(frame, a, this.loadTableFieldIndex(base, key));
				return;
			}
			case OpCode.GETT: {
				this.setRegister(frame, a, this.loadTableIndex(frame.registers.get(b), this.readRK(frame, rkRawC, rkBitsC)));
				return;
			}
			case OpCode.SETT:
				this.storeTableIndex(frame.registers.get(a), this.readRK(frame, rkRawB, rkBitsB), this.readRK(frame, rkRawC, rkBitsC));
				return;
			case OpCode.NEWT:
				this.setRegisterTable(frame, a, new Table(b, c));
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
				this.setRegisterString(frame, a, handle);
				return;
			}
			case OpCode.CONCATN: {
				let text = '';
				for (let index = 0; index < c; index += 1) {
					text += this.valueToString(frame.registers.get(b + index));
				}
				const handle = this.stringPool.intern(text);
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
				const eq = left === right;
				if (eq !== (a !== 0)) {
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
					this.skipNextInstruction(frame);
				}
				return;
			}
			case OpCode.TEST: {
				const ok = frame.registers.isTruthy(a);
				if (ok !== (c !== 0)) {
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
			case OpCode.BR_TRUE: {
				if (frame.registers.isTruthy(a)) {
					frame.pc += sbx * INSTRUCTION_BYTES;
				}
				return;
			}
			case OpCode.BR_FALSE: {
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
				for (let index = 0; index < count; index += 1) {
					const value = index < frame.varargs.length ? frame.varargs[index] : null;
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
					this.charge(cost.base);
					const results = this.acquireNativeReturnScratch();
					try {
						callee.invoke(args, results);
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
				this.pushFrame(callee as Closure, args, a, c, false, frame.pc - INSTRUCTION_BYTES);
				return;
			}
			case OpCode.RET: {
				const scratch = this.returnScratch;
				scratch.length = 0;
				const total = b === 0 ? Math.max(frame.top - a, 0) : b;
				for (let index = 0; index < total; index += 1) {
					scratch.push(frame.registers.get(a + index));
				}
				this.lastReturnValues.length = scratch.length;
				for (let i = 0; i < scratch.length; i++) {
					this.lastReturnValues[i] = scratch[i];
				}
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
				const addr = this.readRKNumber(frame, rkRawB, rkBitsB);
				this.setRegister(frame, a, this.readMappedMemoryValue(addr, c));
				return;
			}
			case OpCode.STORE_MEM: {
				const addr = this.readRKNumber(frame, rkRawB, rkBitsB);
				this.writeMappedMemoryValue(addr, c, frame.registers.get(a));
				return;
			}
			case OpCode.STORE_MEM_WORDS: {
				const addr = this.readRKNumber(frame, rkRawB, rkBitsB);
				this.charge(CEIL_DIV4(c));
				this.writeMappedWordSequence(frame, addr, a, c);
				return;
			}
			default:
				throw new Error('Unknown opcode.');
		}
	}

	private pushFrame(closure: Closure, args: Value[], returnBase: number, returnCount: number, captureReturns: boolean, callSitePc: number): void {
		const proto = this.program.protos[closure.protoIndex];
		const frame = this.acquireFrame();
		frame.protoIndex = closure.protoIndex;
		frame.pc = proto.entryPC;
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

	private createClosure(frame: CallFrame, protoIndex: number): Closure {
		const proto = this.program.protos[protoIndex];
		const upvalues = new Array<Upvalue>(proto.upvalueDescs.length);
		for (let index = 0; index < proto.upvalueDescs.length; index += 1) {
			const desc = proto.upvalueDescs[index];
			if (desc.inStack) {
				let upvalue = frame.openUpvalues.get(desc.index);
				if (!upvalue) {
					upvalue = { open: true, index: desc.index, frame, value: null };
					frame.openUpvalues.set(desc.index, upvalue);
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
		for (const upvalue of frame.openUpvalues.values()) {
			upvalue.value = frame.registers.get(upvalue.index);
			upvalue.open = false;
			upvalue.frame = null;
		}
		frame.openUpvalues.clear();
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
			const next = target > MAX_REGISTER_ARRAY_SIZE ? new RegisterFile(target) : this.acquireRegisters(target);
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
		switch (accessKind) {
			case MemoryAccessKind.Word:
				this.memory.writeMappedValue(addr, value);
				return;
			case MemoryAccessKind.U8:
				if (typeof value !== 'number') {
					throw new Error(`[Memory] mem8[addr] expects a number. Got ${typeof value}.`);
				}
				this.memory.writeMappedU8(addr, value);
				return;
			case MemoryAccessKind.U16LE:
				if (typeof value !== 'number') {
					throw new Error(`[Memory] mem16le[addr] expects a number. Got ${typeof value}.`);
				}
				this.memory.writeMappedU16LE(addr, value);
				return;
			case MemoryAccessKind.U32LE:
				if (typeof value !== 'number') {
					throw new Error(`[Memory] mem32le[addr] expects a number. Got ${typeof value}.`);
				}
				this.memory.writeMappedU32LE(addr, value);
				return;
			case MemoryAccessKind.F32LE:
				if (typeof value !== 'number') {
					throw new Error(`[Memory] memf32le[addr] expects a number. Got ${typeof value}.`);
				}
				this.memory.writeMappedF32LE(addr, value);
				return;
			case MemoryAccessKind.F64LE:
				if (typeof value !== 'number') {
					throw new Error(`[Memory] memf64le[addr] expects a number. Got ${typeof value}.`);
				}
				this.memory.writeMappedF64LE(addr, value);
				return;
			default:
				throw new Error(`[CPU] Unknown memory access kind: ${accessKind}.`);
		}
	}

	private writeMappedWordSequence(frame: CallFrame, addr: number, valueBase: number, valueCount: number): void {
		if (valueCount >= 3 && isVdpPacketSequenceWrite(addr, valueCount)) {
			const counts = tryGetVdpPacketPrefixWordCounts(frame.registers, valueBase);
			if (counts !== null) {
				const { cmd, argWords, payloadWords } = counts;
				const packetWordCount = 3 + argWords + payloadWords;
				if (valueCount > packetWordCount) {
					throw new Error(`[VDP] Packet prefix overflow (${valueCount} > ${packetWordCount}).`);
				}
				this.memory.writeMappedU32LE(addr, cmd);
				this.memory.writeMappedU32LE(addr + 4, argWords);
				this.memory.writeMappedU32LE(addr + 8, payloadWords);
				let writeAddr = addr + 12;
				const encodedArgWords = Math.min(argWords, valueCount - 3);
				for (let index = 0; index < encodedArgWords; index += 1) {
					const raw = encodeVdpPacketArgWord(cmd, index, frame.registers.get(valueBase + 3 + index));
					this.memory.writeMappedU32LE(writeAddr, raw);
					writeAddr += 4;
				}
				const encodedPayloadWords = valueCount - 3 - encodedArgWords;
				for (let index = 0; index < encodedPayloadWords; index += 1) {
					const raw = encodeVdpPacketU32Word(frame.registers.get(valueBase + 3 + argWords + index), `packet payload ${index}`);
					this.memory.writeMappedU32LE(writeAddr, raw);
					writeAddr += 4;
				}
				return;
			}
		}
		let writeAddr = addr;
		for (let offset = 0; offset < valueCount; offset += 1) {
			this.memory.writeMappedValue(writeAddr, frame.registers.get(valueBase + offset));
			writeAddr += 4;
		}
	}

	private readRKNumber(frame: CallFrame, raw: number, bits: number): number {
		const rk = signExtend(raw, bits);
		if (rk < 0) {
			const index = -1 - rk;
			return this.program.constPool[index] as number;
		}
		return this.readRegisterNumber(frame, rk);
	}

	private readRK(frame: CallFrame, raw: number, bits: number): Value {
		const rk = signExtend(raw, bits);
		if (rk < 0) {
			const index = -1 - rk;
			return this.program.constPool[index];
		}
		return frame.registers.get(rk);
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
		for (let index = 0; index < this.returnScratch.length; index += 1) {
			pushValue(this.returnScratch[index]);
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
			for (let index = 0; index < frame.varargs.length; index += 1) {
				pushValue(frame.varargs[index]);
			}
			for (const upvalue of frame.openUpvalues.values()) {
				upvalueStack.push(upvalue);
			}
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
