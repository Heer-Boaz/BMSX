import { INSTRUCTION_BYTES } from '../../spec/blua32/instruction_format';
import { COP0_EXEC, COP0_STATUS, cop0FieldImplemented } from '../../spec/blua32/cop0';
import { OpCode, OPCODE_SCALAR_REGISTER_READS, OPCODE_WRITES_REGISTER_A,
	REGISTER_OPERAND_A, REGISTER_OPERAND_B, REGISTER_OPERAND_C } from '../../spec/blua32/opcode';
import { compiledBlockEndsBlock, type CompiledBlockSource } from './compiled_block';
import { DECODED_PAGE_WORDS, DecodedDispatchOp } from './execution_image';

/** Logical live-in Values, not a simulation of the JavaScript engine's registers. */
export type JavaScriptRegisterPlan = {
	readonly entry: Map<number, boolean>;
	readonly outputs: ReadonlySet<number>;
};

// Semantic-only exits consume their own operands after generated code leaves.
function generatedRegisterReads(op: OpCode, b: number): number {
	switch (op) {
		case OpCode.CALL: case OpCode.CONCAT: return 0;
		case OpCode.MTC0: return b === COP0_EXEC ? 0 : REGISTER_OPERAND_A;
		default: return OPCODE_SCALAR_REGISTER_READS[op];
	}
}

function fixedRegisterWrites(op: OpCode, b: number): number {
	switch (op) {
		case OpCode.LOADNIL: return b;
		case OpCode.VARARG: return b === 0 ? 0 : b - 1;
		case OpCode.SELF: return 2;
		case OpCode.MFC0: return cop0FieldImplemented(b) ? 1 : 0;
		default: return OPCODE_WRITES_REGISTER_A[op] === 0 || compiledBlockEndsBlock(op, b) ? 0 : 1;
	}
}

export function planRegionRegisters(plans: readonly CompiledBlockSource[]):
	{ requiredSlots: number; requiredCaptures: number; blocks: JavaScriptRegisterPlan[] } {
	const candidates = new Set<number>();
	let requiredSlots = 0;
	let requiredCaptures = 0;
	for (const { page, firstWord, endWord } of plans) for (let word = firstWord; word < endWord; word += page.widths[word]) {
		const op = page.ops[word], a = page.a[word], b = page.b[word], c = page.c[word];
		const flags = generatedRegisterReads(op, b);
		if (flags & REGISTER_OPERAND_A) candidates.add(a);
		if ((flags & REGISTER_OPERAND_B) && b >= 0) candidates.add(b);
		if ((flags & REGISTER_OPERAND_C) && c >= 0) candidates.add(c);
		requiredSlots = Math.max(requiredSlots, page.requiredSlots[word]);
		// Native word stores complete the full range; the bus replay can
		// instead commit its valid prefix before a source-window fault.
		if ((op === OpCode.STORE_MEM_WORDS || op === OpCode.STORE_MEM_WORDS_D) && c !== 0)
			requiredSlots = Math.max(requiredSlots, a + c);
		// Fixed VARARG can grow on the scalar route; generated copies require
		// the destination window to already exist.
		if (op === OpCode.VARARG && b > 1) requiredSlots = Math.max(requiredSlots, a + b - 1);
		if (op === OpCode.GETUP || op === OpCode.SETUP) requiredCaptures = Math.max(requiredCaptures, b + 1);
	}
	for (const slot of candidates) requiredSlots = Math.max(requiredSlots, slot + 1);
	const entries = new Map(plans.map((plan, index) => [plan.pc, index]));
	const uses = plans.map(() => new Set<number>()), defs = plans.map(() => new Set<number>());
	const successors = plans.map(() => new Set<number>());
	for (let index = 0; index < plans.length; ++index) {
		const plan = plans[index], use = uses[index], def = defs[index];
		const page = plan.page;
		const read = (register: number) => { if (register >= 0 && !def.has(register)) use.add(register); };
		const define = (register: number) => { if (candidates.has(register)) def.add(register); };
		let finalWord = plan.firstWord;
		for (let word = plan.firstWord; word < plan.endWord; word += page.widths[word]) {
			finalWord = word;
			const op = page.ops[word], a = page.a[word], b = page.b[word], c = page.c[word];
			const flags = generatedRegisterReads(op, b);
			if (flags & REGISTER_OPERAND_A) read(a);
			if (flags & REGISTER_OPERAND_B) read(b);
			if (flags & REGISTER_OPERAND_C) read(c);
			if ((op === OpCode.STORE_MEM_WORDS || op === OpCode.STORE_MEM_WORDS_D) && c !== 0)
				for (const register of candidates) if (register >= a && register < a + c) read(register);
			const writes = fixedRegisterWrites(op, b);
			if (writes === 1) define(a);
			else if (writes !== 0) for (const register of candidates)
				if (register >= a && register < a + writes) define(register);
			// Open VARARG can copy zero values: its suffix remains live-in.
		}
		const addSuccessor = (pc: number) => {
			const target = entries.get(pc);
			if (target !== undefined) successors[index].add(target);
		};
		const nextPc = (plan.pc + (plan.endWord - plan.firstWord) * INSTRUCTION_BYTES) >>> 0;
		if (plan.fallthrough) successors[index].add(index + 1);
		else switch (page.ops[finalWord]) {
			case OpCode.HALT: case OpCode.CALL: case OpCode.RET: case OpCode.NEWT:
			case OpCode.CLOSURE: case OpCode.CONCAT: case OpCode.CONCATN: case OpCode.RFE: break;
			case OpCode.MTC0:
				if (page.b[finalWord] !== COP0_EXEC && page.b[finalWord] !== COP0_STATUS) addSuccessor(nextPc);
				break;
			case OpCode.JMP: addSuccessor(page.bx[finalWord]); break;
			case OpCode.JMPIF: case OpCode.JMPIFNOT:
				addSuccessor(page.bx[finalWord]); addSuccessor(nextPc); break;
			case OpCode.EQ: case OpCode.LT: case OpCode.LE:
				if (plan.skippedInstructionWidth !== 0) {
					addSuccessor((nextPc + plan.skippedInstructionWidth * INSTRUCTION_BYTES) >>> 0);
					if (plan.endWord < DECODED_PAGE_WORDS && page.ops[plan.endWord] === OpCode.JMP && page.a[plan.endWord] === 0
						&& page.dispatchOps[plan.endWord] !== DecodedDispatchOp.Observe) {
						addSuccessor(page.bx[plan.endWord]); break;
					}
				}
				addSuccessor(nextPc); break;
			default: addSuccessor(nextPc); break;
		}
	}
	const live = uses.map(use => new Set(use));
	let changed: boolean;
	do {
		changed = false;
		for (let index = plans.length - 1; index >= 0; --index) for (const target of successors[index]) {
			for (const register of live[target]) if (!defs[index].has(register) && !live[index].has(register)) {
				live[index].add(register); changed = true;
			}
		}
	} while (changed);
	const written = plans.map(() => new Set<number>());
	const writes = written.map((entry, index) => [entry, defs[index]]);
	do {
		changed = false;
		for (let index = 0; index < plans.length; ++index) for (const target of successors[index]) {
			for (const set of writes[index]) for (const register of set) if (!written[target].has(register)) {
				written[target].add(register); changed = true;
			}
		}
	} while (changed);
	const blocks = live.map((registers, index) => {
		const outputs = new Set<number>();
		for (const target of successors[index]) for (const register of live[target])
			if (defs[index].has(register)) outputs.add(register);
		// Dirty is a conservative entry contract, not permission to discard dead
		// raw state. Output locals become valid only at their actual definitions.
		return { entry: new Map([...registers].map(register => [register, written[index].has(register)])), outputs };
	});
	return { requiredSlots, requiredCaptures, blocks };
}
