import { StringPool, StringValue, isStringValue, stringValueToString } from './string_pool';
import { readInstructionWord } from './instruction_format';

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

const NATIVE_FUNCTION_KIND = 'native_function';
const NATIVE_OBJECT_KIND = 'native_object';

export type NativeFunction = {
	readonly kind: typeof NATIVE_FUNCTION_KIND;
	readonly name: string;
	invoke(args: ReadonlyArray<Value>, out: Value[]): void;
};

export type NativeObject = {
	readonly kind: typeof NATIVE_OBJECT_KIND;
	readonly raw: object;
	get(key: Value): Value;
	set(key: Value, value: Value): void;
	len?: () => number;
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

export function createNativeFunction(name: string, invoke: (args: ReadonlyArray<Value>, out: Value[]) => void): NativeFunction {
	return {
		kind: NATIVE_FUNCTION_KIND,
		name,
		// Keep diagnostics aligned with the C++ VM when native calls receive wrong arg types.
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
	return { kind: NATIVE_OBJECT_KIND, raw, get: handlers.get, set: handlers.set, len: handlers.len };
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
};

export type Program = {
	code: Uint8Array;
	constPool: Value[];
	protos: Proto[];
	stringPool: StringPool;
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

export class Table {
	private readonly array: Value[];
	private readonly stringMap: Map<StringValue, Value>;
	private readonly otherMap: Map<Value, Value>;
	private metatable: Table | null = null;

	constructor(arraySize: number, _hashSize: number) {
		this.array = new Array<Value>(arraySize);
		this.array.fill(null);
		this.stringMap = new Map<StringValue, Value>();
		this.otherMap = new Map<Value, Value>();
	}

	public get(key: Value): Value {
		if (this.isArrayIndex(key)) {
			const index = key as number;
			const value = this.array[index - 1];
			return value === undefined ? null : value;
		}
		if (isStringValue(key)) {
			return this.getStringKey(key);
		}
		const value = this.otherMap.get(key);
		return value === undefined ? null : value;
	}

	public set(key: Value, value: Value): void {
		if (this.isArrayIndex(key)) {
			const index = key as number;
			this.array[index - 1] = value;
			return;
		}
		if (isStringValue(key)) {
			this.setStringKey(key, value);
			return;
		}
		if (value === null) {
			this.otherMap.delete(key);
			return;
		}
		this.otherMap.set(key, value);
	}

	public length(): number {
		let count = 0;
		for (let index = 0; index < this.array.length; index += 1) {
			const value = this.array[index];
			if (value === null || value === undefined) {
				break;
			}
			count = index + 1;
		}
		return count;
	}

	public clear(): void {
		this.array.length = 0;
		this.stringMap.clear();
		this.otherMap.clear();
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
		for (const entry of this.stringMap.entries()) {
			entries.push(entry);
		}
		for (const entry of this.otherMap.entries()) {
			entries.push(entry);
		}
		return entries;
	}

	public getMetatable(): Table | null {
		return this.metatable;
	}

	public setMetatable(metatable: Table | null): void {
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
			for (const entry of this.stringMap.entries()) {
				return entry;
			}
			for (const entry of this.otherMap.entries()) {
				return entry;
			}
			return null;
		}
		if (this.isArrayIndex(after)) {
			const startIndex = (after as number);
			for (let index = startIndex; index < this.array.length; index += 1) {
				const value = this.array[index];
				if (value !== null && value !== undefined) {
					return [index + 1, value];
				}
			}
			for (const entry of this.stringMap.entries()) {
				return entry;
			}
			for (const entry of this.otherMap.entries()) {
				return entry;
			}
			return null;
		}
		if (isStringValue(after)) {
			if (!this.stringMap.has(after)) {
				return null;
			}
			let seen = false;
			for (const entry of this.stringMap.entries()) {
				if (!seen) {
					if (entry[0] === after) {
						seen = true;
					}
					continue;
				}
				return entry;
			}
			if (seen) {
				for (const entry of this.otherMap.entries()) {
					return entry;
				}
			}
			return null;
		}
		let seen = false;
		for (const entry of this.otherMap.entries()) {
			if (!seen) {
				if (entry[0] === after) {
					seen = true;
				}
				continue;
			}
			return entry;
		}
		return null;
	}

	private isArrayIndex(key: Value): boolean {
		return typeof key === 'number' && Number.isInteger(key) && key >= 1;
	}

	private getStringKey(key: StringValue): Value {
		const value = this.stringMap.get(key);
		return value === undefined ? null : value;
	}

	private setStringKey(key: StringValue, value: Value): void {
		if (value === null) {
			this.stringMap.delete(key);
			return;
		}
		this.stringMap.set(key, value);
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

export class VMCPU {
	public instructionBudgetRemaining: number | null = null;
	public lastReturnValues: Value[] = [];
	public lastPc: number = 0;
	public lastInstruction: number = 0;
	public readonly globals: Table;
	public readonly memory: Value[];

	private program: Program = null;
	private metadata: ProgramMetadata | null = null;
	private readonly stringPool: StringPool = new StringPool();
	private indexKey: StringValue = null;
	private readonly frames: CallFrame[] = [];
	private readonly valueScratch: Value[] = [];
	private readonly returnScratch: Value[] = [];
	private readonly debugRegistersScratch: Value[] = [];
	private readonly nativeReturnPool: Value[][] = [];
	private decodedOps: Uint8Array | null = null;
	private decodedA: Uint8Array | null = null;
	private decodedB: Uint8Array | null = null;
	private decodedC: Uint8Array | null = null;
	private decodedWords: Uint32Array | null = null;

	// Frame pooling: avoid allocating new CallFrame objects per call
	private readonly framePool: CallFrame[] = [];

	// Register array pooling: keyed by size bucket (power of 2)
	private readonly registerPool: Map<number, RegisterFile[]> = new Map();

	constructor(memory: Value[]) {
		this.memory = memory;
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
		this.program = program;
		this.metadata = metadata;
		const constPool = program.constPool;
		for (let index = 0; index < constPool.length; index += 1) {
			const value = constPool[index];
			if (isStringValue(value)) {
				constPool[index] = this.stringPool.intern(stringValueToString(value));
			}
		}
		program.stringPool = this.stringPool;
		this.indexKey = this.stringPool.intern('__index');
		this.decodeProgram(program);
	}

	private decodeProgram(program: Program): void {
		const code = program.code;
		const instructionCount = Math.floor(code.length / 3);
		const decodedOps = new Uint8Array(instructionCount);
		const decodedA = new Uint8Array(instructionCount);
		const decodedB = new Uint8Array(instructionCount);
		const decodedC = new Uint8Array(instructionCount);
		const decodedWords = new Uint32Array(instructionCount);
		for (let pc = 0; pc < instructionCount; pc += 1) {
			const instr = readInstructionWord(code, pc);
			decodedWords[pc] = instr;
			decodedOps[pc] = (instr >>> 18) & 0x3f;
			decodedA[pc] = (instr >>> 12) & 0x3f;
			decodedB[pc] = (instr >>> 6) & 0x3f;
			decodedC[pc] = instr & 0x3f;
		}
		this.decodedOps = decodedOps;
		this.decodedA = decodedA;
		this.decodedB = decodedB;
		this.decodedC = decodedC;
		this.decodedWords = decodedWords;
	}

	public getStringPool(): StringPool {
		return this.stringPool;
	}

	public getProgram(): Program {
		return this.program;
	}

	public start(entryProtoIndex: number, args: Value[] = []): void {
		this.frames.length = 0;
		const closure: Closure = { protoIndex: entryProtoIndex, upvalues: [] };
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

	public run(instructionBudget: number | null = null): RunResult {
		return this.runUntilDepth(0, instructionBudget);
	}

	public runUntilDepth(targetDepth: number, instructionBudget: number | null = null): RunResult {
		const ownsBudget = instructionBudget !== null;
		const previousBudget = this.instructionBudgetRemaining;
		if (ownsBudget) {
			this.instructionBudgetRemaining = instructionBudget;
		}
		try {
			while (this.frames.length > targetDepth) {
				if (this.instructionBudgetRemaining !== null && this.instructionBudgetRemaining <= 0) {
					return RunResult.Yielded;
				}
				this.step();
			}
			return RunResult.Halted;
		} finally {
			if (ownsBudget) {
				this.instructionBudgetRemaining = previousBudget;
			}
		}
	}

	public step(): void {
		const frame = this.frames[this.frames.length - 1];
		let pc = frame.pc;
		const decodedOps = this.decodedOps!;
		const decodedA = this.decodedA!;
		const decodedB = this.decodedB!;
		const decodedC = this.decodedC!;
		const decodedWords = this.decodedWords!;
		let instr = decodedWords[pc];
		let op = decodedOps[pc];
		let wideA = 0;
		let wideB = 0;
		let wideC = 0;
		if (op === OpCode.WIDE) {
			wideA = decodedA[pc];
			wideB = decodedB[pc];
			wideC = decodedC[pc];
			pc += 1;
			instr = decodedWords[pc];
			op = decodedOps[pc];
		}
		frame.pc = pc + 1;
		this.lastPc = pc;
		this.lastInstruction = instr;
		if (this.instructionBudgetRemaining !== null) {
			this.instructionBudgetRemaining -= 1;
		}
		this.executeInstruction(frame, op, decodedA[pc], decodedB[pc], decodedC[pc], wideA, wideB, wideC);
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
		return this.metadata.debugRanges[pc];
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

	public getConst(index: number): Value {
		return this.program.constPool[index];
	}

	private executeInstruction(frame: CallFrame, op: number, aLow: number, bLow: number, cLow: number, wideA: number, wideB: number, wideC: number): void {
		const a = (wideA << 6) | aLow;
		const b = (wideB << 6) | bLow;
		const c = (wideC << 6) | cLow;
		switch (op) {
			case OpCode.WIDE:
				throw new Error('Unknown opcode.');
			case OpCode.MOV:
				this.copyRegister(frame, a, b);
				return;
			case OpCode.LOADK: {
				const bx = (wideB << 12) | (bLow << 6) | cLow;
				this.setRegister(frame, a, this.program.constPool[bx]);
				return;
			}
			case OpCode.LOADNIL:
				for (let index = 0; index < b; index += 1) {
					this.setRegisterNil(frame, a + index);
				}
				return;
			case OpCode.LOADBOOL:
				this.setRegisterBool(frame, a, b !== 0);
				if (c !== 0) {
					frame.pc += 1;
				}
				return;
			case OpCode.GETG: {
				const bx = (wideB << 12) | (bLow << 6) | cLow;
				const key = this.program.constPool[bx];
				this.setRegister(frame, a, this.globals.get(key));
				return;
			}
			case OpCode.SETG: {
				const bx = (wideB << 12) | (bLow << 6) | cLow;
				const key = this.program.constPool[bx];
				this.globals.set(key, frame.registers.get(a));
				return;
			}
			case OpCode.GETT: {
				const table = frame.registers.get(b);
				const key = this.readRK(frame, cLow, wideC);
				if (table instanceof Table) {
					this.setRegister(frame, a, this.resolveTableIndex(table, key));
					return;
				}
				if (isNativeObject(table)) {
					this.setRegister(frame, a, table.get(key));
					return;
				}
				throw new Error('Attempted to index field on a non-table value.');
			}
			case OpCode.SETT: {
				const table = frame.registers.get(a);
				const key = this.readRK(frame, bLow, wideB);
				const value = this.readRK(frame, cLow, wideC);
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
				this.setRegisterTable(frame, a, new Table(b, c));
				return;
			case OpCode.ADD: {
				const left = this.readRKNumber(frame, bLow, wideB);
				const right = this.readRKNumber(frame, cLow, wideC);
				this.setRegisterNumber(frame, a, left + right);
				return;
			}
			case OpCode.SUB: {
				const left = this.readRKNumber(frame, bLow, wideB);
				const right = this.readRKNumber(frame, cLow, wideC);
				this.setRegisterNumber(frame, a, left - right);
				return;
			}
			case OpCode.MUL: {
				const left = this.readRKNumber(frame, bLow, wideB);
				const right = this.readRKNumber(frame, cLow, wideC);
				this.setRegisterNumber(frame, a, left * right);
				return;
			}
			case OpCode.DIV: {
				const left = this.readRKNumber(frame, bLow, wideB);
				const right = this.readRKNumber(frame, cLow, wideC);
				this.setRegisterNumber(frame, a, left / right);
				return;
			}
			case OpCode.MOD: {
				const left = this.readRKNumber(frame, bLow, wideB);
				const right = this.readRKNumber(frame, cLow, wideC);
				this.setRegisterNumber(frame, a, left % right);
				return;
			}
			case OpCode.FLOORDIV: {
				const left = this.readRKNumber(frame, bLow, wideB);
				const right = this.readRKNumber(frame, cLow, wideC);
				this.setRegisterNumber(frame, a, Math.floor(left / right));
				return;
			}
			case OpCode.POW: {
				const left = this.readRKNumber(frame, bLow, wideB);
				const right = this.readRKNumber(frame, cLow, wideC);
				this.setRegisterNumber(frame, a, Math.pow(left, right));
				return;
			}
			case OpCode.BAND: {
				const left = this.readRKNumber(frame, bLow, wideB);
				const right = this.readRKNumber(frame, cLow, wideC);
				this.setRegisterNumber(frame, a, left & right);
				return;
			}
			case OpCode.BOR: {
				const left = this.readRKNumber(frame, bLow, wideB);
				const right = this.readRKNumber(frame, cLow, wideC);
				this.setRegisterNumber(frame, a, left | right);
				return;
			}
			case OpCode.BXOR: {
				const left = this.readRKNumber(frame, bLow, wideB);
				const right = this.readRKNumber(frame, cLow, wideC);
				this.setRegisterNumber(frame, a, left ^ right);
				return;
			}
			case OpCode.SHL: {
				const left = this.readRKNumber(frame, bLow, wideB);
				const right = this.readRKNumber(frame, cLow, wideC);
				this.setRegisterNumber(frame, a, left << (right & 31));
				return;
			}
			case OpCode.SHR: {
				const left = this.readRKNumber(frame, bLow, wideB);
				const right = this.readRKNumber(frame, cLow, wideC);
				this.setRegisterNumber(frame, a, left >> (right & 31));
				return;
			}
			case OpCode.CONCAT: {
				const left = this.readRK(frame, bLow, wideB);
				const right = this.readRK(frame, cLow, wideC);
				const text = this.valueToString(left) + this.valueToString(right);
				this.setRegisterString(frame, a, this.stringPool.intern(text));
				return;
			}
			case OpCode.CONCATN: {
				let text = '';
				for (let index = 0; index < c; index += 1) {
					text += this.valueToString(frame.registers.get(b + index));
				}
				this.setRegisterString(frame, a, this.stringPool.intern(text));
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
					this.setRegisterNumber(frame, a, stringValueToString(value).length);
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
				const left = this.readRK(frame, bLow, wideB);
				const right = this.readRK(frame, cLow, wideC);
				const eq = left === right;
				if (eq !== (a !== 0)) {
					frame.pc += 1;
				}
				return;
			}
			case OpCode.LT: {
				const left = this.readRK(frame, bLow, wideB);
				const right = this.readRK(frame, cLow, wideC);
				const ok = (isStringValue(left) && isStringValue(right))
					? stringValueToString(left) < stringValueToString(right)
					: (left as number) < (right as number);
				if (ok !== (a !== 0)) {
					frame.pc += 1;
				}
				return;
			}
			case OpCode.LE: {
				const left = this.readRK(frame, bLow, wideB);
				const right = this.readRK(frame, cLow, wideC);
				const ok = (isStringValue(left) && isStringValue(right))
					? stringValueToString(left) <= stringValueToString(right)
					: (left as number) <= (right as number);
				if (ok !== (a !== 0)) {
					frame.pc += 1;
				}
				return;
			}
			case OpCode.TEST: {
				const ok = frame.registers.isTruthy(a);
				if (ok !== (c !== 0)) {
					frame.pc += 1;
				}
				return;
			}
			case OpCode.TESTSET: {
				const ok = frame.registers.isTruthy(b);
				if (ok === (c !== 0)) {
					this.copyRegister(frame, a, b);
					return;
				}
				frame.pc += 1;
				return;
			}
			case OpCode.JMP: {
				const sbx = (((wideB << 12) | (bLow << 6) | cLow) << 14) >> 14;
				frame.pc += sbx;
				return;
			}
			case OpCode.JMPIF: {
				if (frame.registers.isTruthy(a)) {
					const sbx = (((wideB << 12) | (bLow << 6) | cLow) << 14) >> 14;
					frame.pc += sbx;
				}
				return;
			}
			case OpCode.JMPIFNOT: {
				if (!frame.registers.isTruthy(a)) {
					const sbx = (((wideB << 12) | (bLow << 6) | cLow) << 14) >> 14;
					frame.pc += sbx;
				}
				return;
			}
			case OpCode.CLOSURE: {
				const bx = (wideB << 12) | (bLow << 6) | cLow;
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
					const range = this.metadata ? this.metadata.debugRanges[this.lastPc] : null;
					const location = range ? `${range.path}:${range.start.line}:${range.start.column}` : 'unknown';
					throw new Error(`Attempted to call a nil value. at ${location}`);
				}
				if (isNativeFunction(callee)) {
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
					const range = this.metadata ? this.metadata.debugRanges[this.lastPc] : null;
					const location = range ? `${range.path}:${range.start.line}:${range.start.column}` : 'unknown';
					const calleeType = valueTypeName(callee as Value);
					const calleeValue = isStringValue(callee)
						? ` value=${stringValueToString(callee)}`
						: (typeof callee === 'number' || typeof callee === 'boolean')
							? ` value=${String(callee)}`
							: '';
					throw new Error(`Attempted to call a non-function value (${calleeType}${calleeValue}). at ${location}`);
				}
				this.pushFrame(callee as Closure, args, a, c, false, frame.pc - 1);
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
				const addr = this.readRegisterNumber(frame, b);
				this.setRegister(frame, a, this.memory[addr]);
				return;
			}
			case OpCode.STORE_MEM: {
				const addr = this.readRegisterNumber(frame, b);
				this.memory[addr] = frame.registers.get(a);
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
				}
				upvalues[index] = upvalue;
				continue;
			}
			upvalues[index] = frame.closure.upvalues[desc.index];
		}
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

	private readRKNumber(frame: CallFrame, low: number, wide: number): number {
		const raw = (wide << 6) | low;
		const rk = (raw << 20) >> 20;
		if (rk < 0) {
			const index = -1 - rk;
			return this.program.constPool[index] as number;
		}
		return this.readRegisterNumber(frame, rk);
	}

	private readRK(frame: CallFrame, low: number, wide: number): Value {
		const raw = (wide << 6) | low;
		const rk = (raw << 20) >> 20;
		if (rk < 0) {
			const index = -1 - rk;
			return this.program.constPool[index];
		}
		return frame.registers.get(rk);
	}

	private valueToString(value: Value): string {
		if (isStringValue(value)) {
			return stringValueToString(value);
		}
		return String(value);
	}

}
