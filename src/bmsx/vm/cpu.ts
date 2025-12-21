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
	invoke(args: ReadonlyArray<Value>): Value[];
};

export type NativeObject = {
	readonly kind: typeof NATIVE_OBJECT_KIND;
	readonly raw: object;
	get(key: Value): Value;
	set(key: Value, value: Value): void;
	len?: () => number;
};

export function createNativeFunction(name: string, invoke: (args: ReadonlyArray<Value>) => Value[]): NativeFunction {
	return { kind: NATIVE_FUNCTION_KIND, name, invoke };
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
	private readonly array: Value[];
	private readonly map: Map<Value, Value>;

	constructor(arraySize: number, _hashSize: number) {
		this.array = new Array(arraySize);
		this.map = new Map<Value, Value>();
	}

	public get(key: Value): Value {
		if (this.isArrayIndex(key)) {
			const index = key as number;
			const value = this.array[index - 1];
			return value === undefined ? null : value;
		}
		const value = this.map.get(key);
		return value === undefined ? null : value;
	}

	public set(key: Value, value: Value): void {
		if (this.isArrayIndex(key)) {
			const index = key as number;
			this.array[index - 1] = value;
			return;
		}
		if (value === null) {
			this.map.delete(key);
			return;
		}
		this.map.set(key, value);
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
		this.map.clear();
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
		for (const entry of this.map.entries()) {
			entries.push(entry);
		}
		return entries;
	}

	private isArrayIndex(key: Value): boolean {
		return typeof key === 'number' && Number.isInteger(key) && key >= 1;
	}
}

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

	constructor(memory: Value[]) {
		this.memory = memory;
		this.globals = new Table(0, 0);
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
		this.pushFrame(closure, args, 0, returnCount, false, this.program.protos[closure.protoIndex].entryPC);
	}

	public callExternal(closure: Closure, args: Value[] = []): void {
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
					this.setRegister(frame, a, table.get(key));
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
						throw new Error('Length operator expects a native object with a length.');
					}
					this.setRegister(frame, a, value.len());
					return;
				}
				throw new Error('Length operator expects a string or table.');
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
				if (isNativeFunction(callee)) {
					const results = callee.invoke(args);
					this.writeReturnValues(frame, a, c, results);
					return;
				}
				this.pushFrame(callee as Closure, args, a, c, false, frame.pc - 1);
				return;
			}
			case OpCode.RET: {
				const results = this.collectReturnValues(frame, a, b);
				this.lastReturnValues = results;
				this.closeUpvalues(frame);
				this.frames.pop();
				if (this.frames.length === 0) {
					return;
				}
				if (frame.captureReturns) {
					return;
				}
				const caller = this.frames[this.frames.length - 1];
				this.writeReturnValues(caller, frame.returnBase, frame.returnCount, results);
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
		const registers = new Array<Value>(proto.maxStack);
		for (let index = 0; index < registers.length; index += 1) {
			registers[index] = null;
		}
		const varargs: Value[] = [];
		let argIndex = 0;
		for (let index = 0; index < proto.numParams; index += 1) {
			registers[index] = argIndex < args.length ? args[argIndex] : null;
			argIndex += 1;
		}
		if (proto.isVararg) {
			for (let index = argIndex; index < args.length; index += 1) {
				varargs.push(args[index]);
			}
		}
		const frame: CallFrame = {
			protoIndex: closure.protoIndex,
			pc: proto.entryPC,
			registers,
			varargs,
			closure,
			openUpvalues: new Map<number, Upvalue>(),
			returnBase,
			returnCount,
			top: proto.numParams,
			captureReturns,
			callSitePc,
		};
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

	private collectReturnValues(frame: CallFrame, start: number, count: number): Value[] {
		const result: Value[] = [];
		const total = count === 0 ? Math.max(frame.top - start, 0) : count;
		for (let index = 0; index < total; index += 1) {
			result.push(frame.registers[start + index]);
		}
		return result;
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
		frame.registers[index] = value;
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
