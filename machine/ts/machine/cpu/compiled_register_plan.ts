import { INSTRUCTION_BYTES } from '../../spec/blua32/instruction_format';
import { COP0_EXEC, COP0_STATUS } from '../../spec/blua32/cop0';
import { OpCode, OPCODE_SCALAR_REGISTER_READS, OPCODE_WRITES_REGISTER_A,
	REGISTER_OPERAND_A, REGISTER_OPERAND_B, REGISTER_OPERAND_C } from '../../spec/blua32/opcode';
import { compiledBlockEndsBlock, type CompiledBlockSource } from './compiled_block';
import { DecodedDispatchOp, type DecodedInstructionPage } from './execution_image';

/** Logical live-in Values, not a simulation of the JavaScript engine's registers. */
export type JavaScriptRegisterPlan = {
	readonly entry: Map<number, boolean>;
	readonly outputs: ReadonlySet<number>;
};

export function planRegionRegisters(page: DecodedInstructionPage, plans: readonly CompiledBlockSource[]): JavaScriptRegisterPlan[] {
	const candidates = new Set<number>();
	for (const plan of plans) for (let word = plan.firstWord; word < plan.endWord; word += page.widths[word]) {
		const op = page.ops[word];
		if ((op === OpCode.STORE_MEM_WORDS || op === OpCode.STORE_MEM_WORDS_D) && page.c[word] === 0) continue;
		const flags = OPCODE_SCALAR_REGISTER_READS[op];
		if (flags & REGISTER_OPERAND_A) candidates.add(page.a[word]);
		if ((flags & REGISTER_OPERAND_B) && page.b[word] >= 0) candidates.add(page.b[word]);
		if ((flags & REGISTER_OPERAND_C) && page.c[word] >= 0) candidates.add(page.c[word]);
	}
	const entries = new Map(plans.map((plan, index) => [plan.pc, index]));
	const uses = plans.map(() => new Set<number>()), defs = plans.map(() => new Set<number>());
	const successors = plans.map(() => new Set<number>());
	for (let index = 0; index < plans.length; ++index) {
		const plan = plans[index], use = uses[index], def = defs[index];
		const read = (register: number) => { if (register >= 0 && !def.has(register)) use.add(register); };
		const define = (register: number) => { if (candidates.has(register)) def.add(register); };
		let finalWord = plan.firstWord;
		for (let word = plan.firstWord; word < plan.endWord; word += page.widths[word]) {
			finalWord = word;
			const op = page.ops[word];
			const words = op === OpCode.STORE_MEM_WORDS || op === OpCode.STORE_MEM_WORDS_D;
			if (words && page.c[word] === 0) continue;
			const flags = OPCODE_SCALAR_REGISTER_READS[op];
			if (flags & REGISTER_OPERAND_A) read(page.a[word]);
			if (flags & REGISTER_OPERAND_B) read(page.b[word]);
			if (flags & REGISTER_OPERAND_C) read(page.c[word]);
			if (words) for (const register of candidates)
				if (register >= page.a[word] && register < page.a[word] + page.c[word]) read(register);
			if (OPCODE_WRITES_REGISTER_A[op] !== 0 && !compiledBlockEndsBlock(op, page.b[word])) define(page.a[word]);
			if (op === OpCode.SELF) define(page.a[word] + 1);
			if (op === OpCode.LOADNIL || (op === OpCode.VARARG && page.b[word] !== 0)) {
				for (const register of candidates)
					if (register >= page.a[word] && register < page.a[word] + page.b[word]) define(register);
			}
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
					if (page.ops[plan.endWord] === OpCode.JMP && page.dispatchOps[plan.endWord] !== DecodedDispatchOp.Observe) {
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
	return live.map((registers, index) => {
		const outputs = new Set<number>();
		for (const target of successors[index]) for (const register of live[target])
			if (defs[index].has(register)) outputs.add(register);
		// Dirty is a conservative entry contract, not permission to discard dead
		// raw state. Output locals become valid only at their actual definitions.
		return { entry: new Map([...registers].map(register => [register, written[index].has(register)])), outputs };
	});
}
