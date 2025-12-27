export type Value = null | boolean | number | string | Table | Closure | NativeFunction | NativeObject;

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
	if (typeof value === 'string') return 'string';
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

export type Program = {
	code: Uint32Array;
	constPool: Value[];
	protos: Proto[];
	debugRanges: ReadonlyArray<SourceRange | null>;
	protoIds: string[];
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
	registers: Value[];
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
	private static caseInsensitiveKeys = false;

	private readonly array: Value[];
	private readonly stringMap: Map<string, Value>;
	private readonly otherMap: Map<Value, Value>;
	private readonly uppercaseIndex: Map<string, string>;
	private uppercaseIndexValid = false;
	private metatable: Table | null = null;

	public static setCaseInsensitiveKeys(enabled: boolean): void {
		Table.caseInsensitiveKeys = enabled;
	}

	constructor(arraySize: number, _hashSize: number) {
		this.array = new Array<Value>(arraySize);
		this.array.fill(null);
		this.stringMap = new Map<string, Value>();
		this.otherMap = new Map<Value, Value>();
		this.uppercaseIndex = new Map<string, string>();
	}

	public get(key: Value): Value {
		if (this.isArrayIndex(key)) {
			const index = key as number;
			const value = this.array[index - 1];
			return value === undefined ? null : value;
		}
		if (typeof key === 'string') {
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
		if (typeof key === 'string') {
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
		this.uppercaseIndex.clear();
		this.uppercaseIndexValid = false;
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
		if (typeof after === 'string') {
			const match = this.resolveStringKey(after);
			if (match === null) {
				return null;
			}
			let seen = false;
			for (const entry of this.stringMap.entries()) {
				if (!seen) {
					if (entry[0] === match) {
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

	private getStringKey(key: string): Value {
		if (Table.caseInsensitiveKeys) {
			this.ensureUppercaseIndex();
			const mapped = this.uppercaseIndex.get(Table.toUpperAscii(key));
			if (mapped !== undefined) {
				const value = this.stringMap.get(mapped);
				return value === undefined ? null : value;
			}
			return null;
		}
		const value = this.stringMap.get(key);
		return value === undefined ? null : value;
	}

	private setStringKey(key: string, value: Value): void {
		if (Table.caseInsensitiveKeys) {
			this.ensureUppercaseIndex();
			const upper = Table.toUpperAscii(key);
			const existing = this.uppercaseIndex.get(upper);
			if (value === null) {
				if (existing !== undefined) {
					this.stringMap.delete(existing);
					this.uppercaseIndex.delete(upper);
				}
				return;
			}
			if (existing !== undefined) {
				this.stringMap.set(existing, value);
				return;
			}
			this.stringMap.set(key, value);
			this.uppercaseIndex.set(upper, key);
			return;
		}
		if (value === null) {
			this.stringMap.delete(key);
			this.uppercaseIndexValid = false;
			return;
		}
		this.stringMap.set(key, value);
		this.uppercaseIndexValid = false;
	}

	private resolveStringKey(key: string): string | null {
		if (!Table.caseInsensitiveKeys) {
			return this.stringMap.has(key) ? key : null;
		}
		this.ensureUppercaseIndex();
		const mapped = this.uppercaseIndex.get(Table.toUpperAscii(key));
		return mapped === undefined ? null : mapped;
	}

	private ensureUppercaseIndex(): void {
		if (!Table.caseInsensitiveKeys || this.uppercaseIndexValid) {
			return;
		}
		this.uppercaseIndex.clear();
		for (const entry of this.stringMap.keys()) {
			this.uppercaseIndex.set(Table.toUpperAscii(entry), entry);
		}
		this.uppercaseIndexValid = true;
	}

	private static toUpperAscii(value: string): string {
		let out = '';
		for (let index = 0; index < value.length; index += 1) {
			const code = value.charCodeAt(index);
			if (code >= 97 && code <= 122) {
				out += String.fromCharCode(code - 32);
			} else {
				out += value[index];
			}
		}
		return out;
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
	private readonly frames: CallFrame[] = [];
	private readonly valueScratch: Value[] = [];
	private readonly returnScratch: Value[] = [];
	private readonly nativeReturnPool: Value[][] = [];

	// Frame pooling: avoid allocating new CallFrame objects per call
	private readonly framePool: CallFrame[] = [];

	// Register array pooling: keyed by size bucket (power of 2)
	private readonly registerPool: Map<number, Value[][]> = new Map();

	constructor(memory: Value[]) {
		this.memory = memory;
		this.globals = new Table(0, 0);
	}

	// Acquire a register array of at least `size` slots, reusing pooled arrays when possible
	private acquireRegisters(size: number): Value[] {
		// Round up to next power of 2 for bucketing (min 8)
		const bucket = Math.max(8, 1 << (32 - Math.clz32(size - 1)));
		let pool = this.registerPool.get(bucket);
		if (pool && pool.length > 0) {
			const regs = pool.pop()!;
			// Clear only the portion we need
			for (let i = 0; i < size; i++) regs[i] = null;
			return regs;
		}
		// Allocate new array at bucket size
		const regs = new Array<Value>(bucket);
		for (let i = 0; i < bucket; i++) regs[i] = null;
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
			const indexer = metatable.get('__index');
			if (!(indexer instanceof Table)) {
				return null;
			}
			current = indexer;
		}
		throw new Error('Metatable __index loop detected.');
	}

	// Release a register array back to the pool
	private releaseRegisters(regs: Value[]): void {
		const bucket = regs.length;
		if (bucket > MAX_REGISTER_ARRAY_SIZE) return; // Don't pool oversized arrays
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
			registers: [],
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

	public setProgram(program: Program): void {
		this.program = program;
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
		const pc = frame.pc;
		const instr = this.program.code[pc];
		frame.pc = pc + 1;
		this.lastPc = pc;
		this.lastInstruction = instr;
		if (this.instructionBudgetRemaining !== null) {
			this.instructionBudgetRemaining -= 1;
		}
		this.executeInstruction(frame, instr);
	}

	public getDebugState(): { pc: number; instr: number; registers: Value[] } {
		const frame = this.frames[this.frames.length - 1];
		return {
			pc: this.lastPc,
			instr: this.lastInstruction,
			registers: frame ? frame.registers : [],
		};
	}

	public getDebugRange(pc: number): SourceRange | null {
		return this.program.debugRanges[pc];
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

	private executeInstruction(frame: CallFrame, instr: number): void {
		const op = (instr >>> 24) & 0xff;
		const a = (instr >>> 16) & 0xff;
		const b = (instr >>> 8) & 0xff;
		const c = instr & 0xff;
		const bx = instr & 0xffff;
		const sbx = (bx << 16) >> 16;

		switch (op) {
			case OpCode.MOV:
				this.setRegister(frame, a, frame.registers[b]);
				return;
			case OpCode.LOADK:
				this.setRegister(frame, a, this.program.constPool[bx]);
				return;
			case OpCode.LOADNIL:
				for (let index = 0; index < b; index += 1) {
					this.setRegister(frame, a + index, null);
				}
				return;
			case OpCode.LOADBOOL:
				this.setRegister(frame, a, b !== 0);
				if (c !== 0) {
					frame.pc += 1;
				}
				return;
			case OpCode.GETG: {
				const key = this.program.constPool[bx];
				this.setRegister(frame, a, this.globals.get(key));
				return;
			}
			case OpCode.SETG: {
				const key = this.program.constPool[bx];
				this.globals.set(key, frame.registers[a]);
				return;
			}
			case OpCode.GETT: {
				const table = frame.registers[b];
				const key = this.readRK(frame, c);
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
				const table = frame.registers[a];
				const key = this.readRK(frame, b);
				const value = this.readRK(frame, c);
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
				this.setRegister(frame, a, new Table(b, c));
				return;
			case OpCode.ADD: {
				const left = this.readRK(frame, b) as number;
				const right = this.readRK(frame, c) as number;
				this.setRegister(frame, a, left + right);
				return;
			}
			case OpCode.SUB: {
				const left = this.readRK(frame, b) as number;
				const right = this.readRK(frame, c) as number;
				this.setRegister(frame, a, left - right);
				return;
			}
			case OpCode.MUL: {
				const left = this.readRK(frame, b) as number;
				const right = this.readRK(frame, c) as number;
				this.setRegister(frame, a, left * right);
				return;
			}
			case OpCode.DIV: {
				const left = this.readRK(frame, b) as number;
				const right = this.readRK(frame, c) as number;
				this.setRegister(frame, a, left / right);
				return;
			}
			case OpCode.MOD: {
				const left = this.readRK(frame, b) as number;
				const right = this.readRK(frame, c) as number;
				this.setRegister(frame, a, left % right);
				return;
			}
			case OpCode.FLOORDIV: {
				const left = this.readRK(frame, b) as number;
				const right = this.readRK(frame, c) as number;
				this.setRegister(frame, a, Math.floor(left / right));
				return;
			}
			case OpCode.POW: {
				const left = this.readRK(frame, b) as number;
				const right = this.readRK(frame, c) as number;
				this.setRegister(frame, a, Math.pow(left, right));
				return;
			}
			case OpCode.BAND: {
				const left = this.readRK(frame, b) as number;
				const right = this.readRK(frame, c) as number;
				this.setRegister(frame, a, left & right);
				return;
			}
			case OpCode.BOR: {
				const left = this.readRK(frame, b) as number;
				const right = this.readRK(frame, c) as number;
				this.setRegister(frame, a, left | right);
				return;
			}
			case OpCode.BXOR: {
				const left = this.readRK(frame, b) as number;
				const right = this.readRK(frame, c) as number;
				this.setRegister(frame, a, left ^ right);
				return;
			}
			case OpCode.SHL: {
				const left = this.readRK(frame, b) as number;
				const right = this.readRK(frame, c) as number;
				this.setRegister(frame, a, left << (right & 31));
				return;
			}
			case OpCode.SHR: {
				const left = this.readRK(frame, b) as number;
				const right = this.readRK(frame, c) as number;
				this.setRegister(frame, a, left >> (right & 31));
				return;
			}
			case OpCode.CONCAT: {
				const left = this.readRK(frame, b);
				const right = this.readRK(frame, c);
				this.setRegister(frame, a, String(left) + String(right));
				return;
			}
			case OpCode.UNM: {
				const value = frame.registers[b] as number;
				this.setRegister(frame, a, -value);
				return;
			}
			case OpCode.NOT:
				this.setRegister(frame, a, !this.isTruthy(frame.registers[b]));
				return;
				case OpCode.LEN: {
					const value = frame.registers[b];
					if (typeof value === 'string') {
						this.setRegister(frame, a, value.length);
						return;
					}
					if (value instanceof Table) {
						this.setRegister(frame, a, value.length());
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
						this.setRegister(frame, a, value.len());
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
				const value = frame.registers[b] as number;
				this.setRegister(frame, a, ~value);
				return;
			}
			case OpCode.EQ: {
				const left = this.readRK(frame, b);
				const right = this.readRK(frame, c);
				const eq = left === right;
				if (eq !== (a !== 0)) {
					frame.pc += 1;
				}
				return;
			}
			case OpCode.LT: {
				const left = this.readRK(frame, b) as number | string;
				const right = this.readRK(frame, c) as number | string;
				const ok = left < right;
				if (ok !== (a !== 0)) {
					frame.pc += 1;
				}
				return;
			}
			case OpCode.LE: {
				const left = this.readRK(frame, b) as number | string;
				const right = this.readRK(frame, c) as number | string;
				const ok = left <= right;
				if (ok !== (a !== 0)) {
					frame.pc += 1;
				}
				return;
			}
			case OpCode.TEST: {
				const ok = this.isTruthy(frame.registers[a]);
				if (ok !== (c !== 0)) {
					frame.pc += 1;
				}
				return;
			}
			case OpCode.TESTSET: {
				const ok = this.isTruthy(frame.registers[b]);
				if (ok === (c !== 0)) {
					this.setRegister(frame, a, frame.registers[b]);
				} else {
					frame.pc += 1;
				}
				return;
			}
			case OpCode.JMP:
				frame.pc += sbx;
				return;
			case OpCode.CLOSURE:
				this.setRegister(frame, a, this.createClosure(frame, bx));
				return;
			case OpCode.GETUP: {
				const upvalue = frame.closure.upvalues[b];
				this.setRegister(frame, a, this.readUpvalue(upvalue));
				return;
			}
			case OpCode.SETUP: {
				const upvalue = frame.closure.upvalues[b];
				this.writeUpvalue(upvalue, frame.registers[a]);
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
				const callee = frame.registers[a];
				const argCount = b === 0 ? Math.max(frame.top - a - 1, 0) : b;
				const args = this.valueScratch;
				args.length = 0;
				for (let index = 0; index < argCount; index += 1) {
					args.push(frame.registers[a + 1 + index]);
				}
				if (callee === null) {
					throw new Error('Attempted to call a nil value.');
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
					throw new Error('Attempted to call a non-function value.');
				}
				this.pushFrame(callee as Closure, args, a, c, false, frame.pc - 1);
				return;
			}
			case OpCode.RET: {
				// Collect return values into scratch buffer (avoids allocation)
				const scratch = this.returnScratch;
				scratch.length = 0;
				const total = b === 0 ? Math.max(frame.top - a, 0) : b;
				for (let index = 0; index < total; index += 1) {
					scratch.push(frame.registers[a + index]);
				}
				// Copy to lastReturnValues (public API expects persistent array)
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
			case OpCode.LOAD_MEM:
				this.setRegister(frame, a, this.memory[frame.registers[b] as number]);
				return;
			case OpCode.STORE_MEM:
				this.memory[frame.registers[b] as number] = frame.registers[a];
				return;
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
			registers[index] = argIndex < args.length ? args[argIndex] : null;
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
			upvalue.value = frame.registers[upvalue.index];
			upvalue.open = false;
			upvalue.frame = null;
		}
		frame.openUpvalues.clear();
	}

	private readUpvalue(upvalue: Upvalue): Value {
		if (upvalue.open) {
			return upvalue.frame.registers[upvalue.index];
		}
		return upvalue.value;
	}

	private writeUpvalue(upvalue: Upvalue, value: Value): void {
		if (upvalue.open) {
			upvalue.frame.registers[upvalue.index] = value;
			return;
		}
		upvalue.value = value;
	}

	private writeReturnValues(frame: CallFrame, base: number, count: number, values: Value[]): void {
		if (count === 0) {
			for (let index = 0; index < values.length; index += 1) {
				this.setRegister(frame, base + index, values[index]);
			}
			frame.top = Math.max(frame.top, base + values.length);
			return;
		}
		for (let index = 0; index < count; index += 1) {
			const value = index < values.length ? values[index] : null;
			this.setRegister(frame, base + index, value);
		}
	}

	private setRegister(frame: CallFrame, index: number, value: Value): void {
		const registers = frame.registers;
		if (index >= registers.length) {
			const needed = index + 1;
			const bucket = Math.max(8, 1 << (32 - Math.clz32(needed - 1)));
			const target = bucket > MAX_REGISTER_ARRAY_SIZE ? needed : bucket;
			for (let i = registers.length; i < target; i += 1) registers[i] = null;
		}
		registers[index] = value;
		const nextTop = index + 1;
		if (nextTop > frame.top) {
			frame.top = nextTop;
		}
	}

	private readRK(frame: CallFrame, operand: number): Value {
		if ((operand & 0x80) !== 0) {
			const index = operand & 0x7f;
			return this.program.constPool[index];
		}
		return frame.registers[operand];
	}

	private isTruthy(value: Value): boolean {
		return value !== null && value !== false;
	}
}
