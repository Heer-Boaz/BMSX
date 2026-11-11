import { INSTRUCTION_BYTES } from '../../spec/blua32/instruction_format';
import { BASE_CYCLES, OPCODE_COUNT, OpCode } from '../../spec/blua32/opcode';
import { DecodedDispatchOp, type Blua32ExecutionImage, type DecodedInstructionPage } from './execution_image';
import { ValueTag } from './value';
import type { Memory } from '../memory/memory';
import { emitMemoryAccess, emitWordStores } from './compiled_block_memory';
import { ceilDiv4 } from '../common/numeric';
import { JavaScriptRegisterCache } from './compiled_block_registers';
import { emitComparison } from './compiled_block_compare';
import type { CompiledRegion } from './compiled_region';
import { compiledContextSupports, emitContext } from './compiled_block_context';
import { compiledTableSupports, emitTableOperation } from './compiled_block_table';
import { COP0_EXEC, COP0_STATUS, cop0FieldImplemented } from '../../spec/blua32/cop0';
import { compiledControlSupports, emitControl } from './compiled_block_control';

export const enum CpuExecutionBackend {
	Interpreter,
	JavaScript,
}

export const COMPILED_BLOCK_THRESHOLD = 8;
export const COMPILED_BLOCK_MAX_INSTRUCTIONS = 64;

export const enum CompiledBlockExit {
	Continue,
	Halt,
	Call,
	Return,
	ReadField,
	WriteField,
	ReadMemory,
	WriteMemory,
	SkipInstruction,
	WriteUpvalue,
	Vararg,
	InvalidConstant,
	ReadIndex,
	WriteIndex,
	ReadInteger,
	WriteInteger,
	InvalidLength,
	AllocateTable,
	ControlFault,
	ControlBoundary,
	ExecuteFunction,
	ExceptionReturn,
	Concat,
	ConcatRange,
	CreateClosure,
	WriteWords,
}

const sideExitKinds: (CompiledBlockExit | undefined)[] = [];
for (const [op, exit] of [
	[OpCode.MFC0, CompiledBlockExit.ControlFault], [OpCode.MTC0, CompiledBlockExit.ControlFault],
	[OpCode.GETFIELD, CompiledBlockExit.ReadField], [OpCode.SELF, CompiledBlockExit.ReadField],
	[OpCode.SETFIELD, CompiledBlockExit.WriteField], [OpCode.GETT, CompiledBlockExit.ReadIndex],
	[OpCode.SETT, CompiledBlockExit.WriteIndex], [OpCode.GETI, CompiledBlockExit.ReadInteger],
	[OpCode.SETI, CompiledBlockExit.WriteInteger], [OpCode.LEN, CompiledBlockExit.InvalidLength],
	[OpCode.LOAD_MEM, CompiledBlockExit.ReadMemory], [OpCode.LOAD_MEM_D, CompiledBlockExit.ReadMemory],
	[OpCode.STORE_MEM, CompiledBlockExit.WriteMemory], [OpCode.STORE_MEM_D, CompiledBlockExit.WriteMemory],
	[OpCode.STORE_MEM_WORDS, CompiledBlockExit.WriteWords], [OpCode.STORE_MEM_WORDS_D, CompiledBlockExit.WriteWords],
	[OpCode.VARARG, CompiledBlockExit.Vararg], [OpCode.SETUP, CompiledBlockExit.WriteUpvalue],
	[OpCode.LOADKR, CompiledBlockExit.InvalidConstant],
] as const) sideExitKinds[op] = exit;

export type CompiledBlockExitSite = {
	readonly exit: CompiledBlockExit;
	readonly exitA: number;
	readonly exitB: number;
	readonly exitC: number;
	readonly exitBx: number;
	readonly exitWord: number;
	readonly displaced: boolean;
	readonly displacement: number;
	readonly cycles: number;
	readonly registerTop: number;
	readonly resetsRegisterTop: boolean;
	readonly nextPc: number;
	readonly currentPc: number;
	readonly lastPc: number;
	linkedBlock: CompiledBlock | null;
	previousIncoming: CompiledBlockExitSite | null;
	nextIncoming: CompiledBlockExitSite | null;
};

export type CompiledBlock = {
	readonly page: DecodedInstructionPage;
	readonly region: CompiledRegion;
	readonly entry: number;
	readonly firstWord: number;
	readonly terminal: CompiledBlockExitSite;
	readonly exits: readonly CompiledBlockExitSite[];
	/** Source dependencies through the linear successors admitted by this entry. */
	readonly sourceWords: number;
	incoming: CompiledBlockExitSite | null;
};

type StatementEmitter = (page: DecodedInstructionPage, word: number, image: Blua32ExecutionImage,
	registers: JavaScriptRegisterCache, exitIndex: number) => string;
type NumberEmitter = (page: DecodedInstructionPage, word: number, registers: JavaScriptRegisterCache) => string;

const emitters: (StatementEmitter | undefined)[] = new Array(OPCODE_COUNT);
emitters[OpCode.MOV] = (p, w, _image, r) => r.copy(p.a[w], p.b[w]);
emitters[OpCode.LOADK] = (p, w, image, r) => {
	if (image.constTags[p.bx[w]] === ValueTag.Number) return r.writeNumber(p.a[w], `k[${p.bx[w]}]`);
	return r.writeEncoded(p.a[w], `${image.constTags[p.bx[w]]}`, `k[${p.bx[w]}]`, 'null');
};
emitters[OpCode.KNIL] = (p, w, _image, r) => {
	return r.writeEncoded(p.a[w], `${ValueTag.Nil}`, 'NaN', 'null');
};
emitters[OpCode.KFALSE] = (p, w, _image, r) => {
	return r.writeEncoded(p.a[w], `${ValueTag.False}`, 'NaN', 'null');
};
emitters[OpCode.KTRUE] = (p, w, _image, r) => {
	return r.writeEncoded(p.a[w], `${ValueTag.True}`, 'NaN', 'null');
};
emitters[OpCode.NOT] = (p, w, _image, r) => {
	const truth = r.truthy(p.b[w]);
	return r.writeEncoded(p.a[w], `${truth}?${ValueTag.False}:${ValueTag.True}`, 'NaN', 'null');
};
const numberEmitters: (NumberEmitter | undefined)[] = new Array(OPCODE_COUNT);
numberEmitters[OpCode.K0] = () => '0';
numberEmitters[OpCode.K1] = () => '1';
numberEmitters[OpCode.KM1] = () => '-1';
numberEmitters[OpCode.KSMI] = (p, w) => `${p.sbx[w]}`;
numberEmitters[OpCode.UNM] = (p, w, r) => `-(${r.numberOperand(p.b[w])})`;
numberEmitters[OpCode.BNOT] = (p, w, r) => `~(${r.numberOperand(p.b[w])})`;
for (const [op, operator] of [
	[OpCode.ADD, '+'], [OpCode.SUB, '-'], [OpCode.MUL, '*'], [OpCode.DIV, '/'],
	[OpCode.BAND, '&'], [OpCode.BOR, '|'], [OpCode.BXOR, '^'],
	[OpCode.SHL, '<<'], [OpCode.SHR, '>>'],
] as const) {
	numberEmitters[op] = (p, w, r) => `(${r.numberOperand(p.b[w])})${operator}(${r.numberOperand(p.c[w])})`;
}
for (const [op, functionName] of [
	[OpCode.MOD, 'mod'], [OpCode.FLOORDIV, 'floorDiv'], [OpCode.POW, 'pow'],
] as const) {
	numberEmitters[op] = (p, w, r) => `${functionName}(${r.numberOperand(p.b[w])},${r.numberOperand(p.c[w])})`;
}
emitters[OpCode.JMP] = () => '';
emitters[OpCode.JMPIF] = emitters[OpCode.JMP];
emitters[OpCode.JMPIFNOT] = emitters[OpCode.JMP];
emitters[OpCode.EQ] = emitters[OpCode.JMP];
emitters[OpCode.LT] = emitters[OpCode.JMP];
emitters[OpCode.LE] = emitters[OpCode.JMP];
emitters[OpCode.HALT] = emitters[OpCode.JMP];
emitters[OpCode.CALL] = emitters[OpCode.JMP];
emitters[OpCode.RET] = emitters[OpCode.JMP];
emitters[OpCode.NEWT] = emitters[OpCode.JMP];
emitters[OpCode.CONCAT] = emitters[OpCode.JMP];
emitters[OpCode.CONCATN] = emitters[OpCode.JMP];
emitters[OpCode.CLOSURE] = emitters[OpCode.JMP];
emitters[OpCode.RFE] = emitters[OpCode.JMP];

export function compiledBlockSupports(op: number): boolean {
	return emitters[op] !== undefined || numberEmitters[op] !== undefined
		|| compiledContextSupports(op)
		|| compiledTableSupports(op)
		|| compiledControlSupports(op)
		|| op === OpCode.LOAD_MEM || op === OpCode.LOAD_MEM_D || op === OpCode.STORE_MEM || op === OpCode.STORE_MEM_D
		|| op === OpCode.STORE_MEM_WORDS || op === OpCode.STORE_MEM_WORDS_D;
}

const blockBoundaryOps = new Uint8Array(256);
for (const op of [OpCode.JMP, OpCode.JMPIF, OpCode.JMPIFNOT, OpCode.HALT,
	OpCode.CALL, OpCode.RET, OpCode.NEWT, OpCode.CLOSURE, OpCode.CONCAT, OpCode.CONCATN,
	OpCode.STORE_MEM_WORDS, OpCode.STORE_MEM_WORDS_D, OpCode.RFE, OpCode.EQ, OpCode.LT, OpCode.LE]) {
	blockBoundaryOps[op] = 1;
}

export function compiledBlockEndsBlock(op: number, field: number): boolean {
	return blockBoundaryOps[op] !== 0
		|| (op === OpCode.MTC0 && (field === COP0_STATUS || field === COP0_EXEC || !cop0FieldImplemented(field)));
}

const continuationOps = new Uint8Array(256);
for (const op of [OpCode.GETFIELD, OpCode.SETFIELD, OpCode.SELF, OpCode.GETT, OpCode.SETT, OpCode.GETI, OpCode.SETI,
	OpCode.SETUP, OpCode.VARARG, OpCode.LOAD_MEM, OpCode.LOAD_MEM_D, OpCode.STORE_MEM, OpCode.STORE_MEM_D,
	OpCode.STORE_MEM_WORDS, OpCode.STORE_MEM_WORDS_D, OpCode.NEWT, OpCode.CONCAT, OpCode.CONCATN,
	OpCode.CLOSURE, OpCode.CALL]) continuationOps[op] = 1;

/** Returning semantic operations have a statically known continuation PC. */
export function compiledBlockHasContinuation(op: number, field: number): boolean {
	return continuationOps[op] !== 0 || (op === OpCode.MTC0 && field === COP0_STATUS);
}

export function compiledBlockComparison(op: number): boolean {
	return op === OpCode.EQ || op === OpCode.LT || op === OpCode.LE;
}

export type CompiledBlockSource = {
	readonly firstWord: number;
	readonly endWord: number;
	readonly pc: number;
	readonly skippedInstructionWidth: number;
	readonly fallthrough: boolean;
};

export type EmittedJavaScriptBlock = {
	readonly firstWord: number;
	readonly terminal: CompiledBlockExitSite;
	readonly exits: readonly CompiledBlockExitSite[];
	sourceWords: number;
	readonly body: string;
	readonly registers: JavaScriptRegisterCache;
	readonly finalWord: number;
	readonly terminalIndex: number;
	readonly takenIndex: number;
};

/** Emit a segment and its precise side exits; the region owns control flow. */
export function emitJavaScriptBlock(
	page: DecodedInstructionPage, plan: CompiledBlockSource,
	image: Blua32ExecutionImage, memory: Memory, exits: CompiledBlockExitSite[], residents: ReadonlyMap<number, boolean>, outputs: ReadonlySet<number>,
): EmittedJavaScriptBlock {
	const { firstWord, endWord, skippedInstructionWidth } = plan;
	let pc = plan.pc;
	const firstExit = exits.length;
	const source: string[] = [];
	const registers = new JavaScriptRegisterCache(image, residents, outputs);
	let cycles = 0;
	let sourceWords = 0;
	let registerTop = 0;
	let resetsRegisterTop = false;
	let currentPc = pc;
	let lastPc = pc;
	let nextPc = pc;
	let finalWord = firstWord;
	let numberLocal = false;
	let controlAccess = false;
	for (let word = firstWord; word < endWord; word += page.widths[word]) {
		finalWord = word;
		const op = page.ops[word];
		cycles += BASE_CYCLES[op];
		sourceWords += page.widths[word];
		currentPc = pc;
		lastPc = (pc + (page.widths[word] - 1) * INSTRUCTION_BYTES) >>> 0;
		pc = (pc + page.widths[word] * INSTRUCTION_BYTES) >>> 0;
		nextPc = op === OpCode.JMP ? page.bx[word] : pc;
		const exitIndex = exits.length;
		const load = op === OpCode.LOAD_MEM || op === OpCode.LOAD_MEM_D;
		const store = op === OpCode.STORE_MEM || op === OpCode.STORE_MEM_D;
		const words = op === OpCode.STORE_MEM_WORDS || op === OpCode.STORE_MEM_WORDS_D;
		const displaced = op === OpCode.LOAD_MEM_D || op === OpCode.STORE_MEM_D || op === OpCode.STORE_MEM_WORDS_D;
		if (op === OpCode.SELF) registerTop = Math.max(registerTop, page.a[word] + 2);
		const control = compiledControlSupports(op);
		const sideExit = control && controlAccess && cop0FieldImplemented(page.b[word]) ? undefined : sideExitKinds[op];
		if (sideExit !== undefined) {
			exits.push({ exit: sideExit,
				exitA: page.a[word], exitB: page.b[word], exitC: page.c[word], exitBx: page.bx[word], exitWord: word,
				displaced, displacement: page.disp[word],
				cycles, registerTop, resetsRegisterTop, nextPc, currentPc, lastPc,
				linkedBlock: null, previousIncoming: null, nextIncoming: null });
		}
		const numberEmitter = numberEmitters[op];
		if (control) {
			source.push(emitControl(op, page, word, registers, sideExit === undefined ? null : exitIndex, !controlAccess));
			controlAccess = true;
		} else if (compiledContextSupports(op)) {
			source.push(emitContext(op, page, word, registers, exitIndex));
		} else if (compiledTableSupports(op)) {
			source.push(emitTableOperation(op, page, word, registers, exitIndex));
		} else if (load || store || words) {
			if (load && !numberLocal) {
				source.push('let v;');
				numberLocal = true;
			}
			const base = registers.numberOperand(page.b[word]);
			const address = displaced ? `(((${base})>>>0)+${page.disp[word] * 4})>>>0` : `((${base})>>>0)`;
			if (words) source.push(emitWordStores(page, word, address, registers.exit(exitIndex), memory, registers));
			else source.push(emitMemoryAccess(page, word, address, registers.exit(exitIndex), memory,
				registers.numberOperand(page.a[word])));
			if (load) source.push(registers.writeNumber(page.a[word], 'v'));
		} else if (numberEmitter !== undefined) {
			source.push(registers.writeNumber(page.a[word], numberEmitter(page, word, registers)));
		} else {
			source.push(emitters[op]!(page, word, image, registers, exitIndex));
		}
		// The checked exit precedes this instruction's readiness surcharge.
		if (words) cycles += ceilDiv4(page.c[word]);
		if (op === OpCode.LOADNIL) cycles += page.b[word];
		if (op === OpCode.VARARG && page.b[word] !== 0) cycles += page.b[word] - 1;
		if (op === OpCode.VARARG && page.b[word] === 0) { registerTop = 0; resetsRegisterTop = true; }
		else if (op === OpCode.VARARG || op === OpCode.LOADNIL) {
			const count = page.b[word] - (op === OpCode.VARARG ? 1 : 0);
			if (count > 0) registerTop = Math.max(registerTop, page.a[word] + count);
		} else if (!compiledBlockEndsBlock(op, page.b[word]) && op !== OpCode.SETFIELD && op !== OpCode.SETT && op !== OpCode.SETI && !store && !words
			&& op !== OpCode.MTC0 && op !== OpCode.SETUP && op !== OpCode.SETGL && op !== OpCode.SETSYS) registerTop = Math.max(registerTop, page.a[word] + 1);
	}
	source.push(registers.writeBack());
	const finalOp = page.ops[finalWord];
	let terminalExit = CompiledBlockExit.Continue;
	switch (finalOp) {
		case OpCode.HALT: terminalExit = CompiledBlockExit.Halt; break;
		case OpCode.CALL: terminalExit = CompiledBlockExit.Call; break;
		case OpCode.RET: terminalExit = CompiledBlockExit.Return; break;
		case OpCode.NEWT: terminalExit = CompiledBlockExit.AllocateTable; break;
		case OpCode.CONCAT: terminalExit = CompiledBlockExit.Concat; break;
		case OpCode.CONCATN: terminalExit = CompiledBlockExit.ConcatRange; break;
		case OpCode.CLOSURE: terminalExit = CompiledBlockExit.CreateClosure; break;
		case OpCode.MTC0: terminalExit = page.b[finalWord] === COP0_EXEC
			? CompiledBlockExit.ExecuteFunction : page.b[finalWord] === COP0_STATUS
			? CompiledBlockExit.ControlBoundary : CompiledBlockExit.Continue; break;
		case OpCode.RFE: terminalExit = CompiledBlockExit.ExceptionReturn; break;
	}
	const terminal: CompiledBlockExitSite = {
		exit: terminalExit,
		exitA: page.a[finalWord], exitB: page.b[finalWord], exitC: page.c[finalWord], exitBx: page.bx[finalWord], exitWord: finalWord,
		displaced: false, displacement: 0,
		cycles, registerTop, resetsRegisterTop, nextPc, currentPc, lastPc,
		linkedBlock: null, previousIncoming: null, nextIncoming: null,
	};
	const terminalIndex = exits.length;
	exits.push(terminal);
	let takenIndex = -1;
	if (compiledBlockComparison(finalOp)) {
		takenIndex = exits.length;
		exits.push({ ...terminal, exit: skippedInstructionWidth === 0 ? CompiledBlockExit.SkipInstruction : CompiledBlockExit.Continue,
			nextPc: (terminal.nextPc + skippedInstructionWidth * INSTRUCTION_BYTES) >>> 0 });
		sourceWords += skippedInstructionWidth;
		if (skippedInstructionWidth !== 0 && page.ops[endWord] === OpCode.JMP
			&& page.dispatchOps[endWord] !== DecodedDispatchOp.Observe) {
			// Both paths are one admitted segment. Only the matching path
			// executes and charges the JMP; its complete source is a dependency.
			exits[terminalIndex] = { ...terminal, cycles: terminal.cycles + BASE_CYCLES[OpCode.JMP],
				currentPc: terminal.nextPc, lastPc: (terminal.nextPc + (skippedInstructionWidth - 1) * INSTRUCTION_BYTES) >>> 0,
				nextPc: page.bx[endWord], exitWord: endWord,
				exitA: page.a[endWord], exitB: page.b[endWord], exitC: page.c[endWord], exitBx: page.bx[endWord] };
		}
	} else if (finalOp === OpCode.JMPIF || finalOp === OpCode.JMPIFNOT) {
		takenIndex = exits.length;
		exits.push({ ...terminal, nextPc: page.bx[finalWord] });
	}
	return { firstWord, terminal: exits[terminalIndex], exits: exits.slice(firstExit), sourceWords,
		body: source.join('\n'), registers, finalWord, terminalIndex, takenIndex };
}

export function finishJavaScriptBlock(page: DecodedInstructionPage, block: EmittedJavaScriptBlock,
	transfer: (index: number) => string): string {
	const finalOp = page.ops[block.finalWord];
	if (compiledBlockComparison(finalOp)) {
		const expected = page.a[block.finalWord] !== 0;
		return emitComparison(page, block.finalWord, block.registers,
			transfer(expected ? block.terminalIndex : block.takenIndex), transfer(expected ? block.takenIndex : block.terminalIndex));
	}
	if (finalOp === OpCode.JMPIF || finalOp === OpCode.JMPIFNOT) {
		const truth = `${finalOp === OpCode.JMPIFNOT ? '!' : ''}${block.registers.truthy(page.a[block.finalWord])}`;
		return `if(${truth}){${transfer(block.takenIndex)}}else{${transfer(block.terminalIndex)}}`;
	}
	return transfer(block.terminalIndex);
}
