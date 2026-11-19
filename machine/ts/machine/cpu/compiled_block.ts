import { ValueMoveKind, INSTRUCTION_BYTES } from '../../spec/blua32/instruction_format';
import { BASE_CYCLES, OPCODE_COUNT, OpCode } from '../../spec/blua32/opcode';
import { DecodedDispatchOp, type Blua32ExecutionImage, type DecodedInstructionPage } from './execution_image';
import { ValueTag } from './value';
import type { Memory } from '../memory/memory';
import { compiledArithmeticSupports, emitArithmetic } from './compiled_block_arithmetic';
import { MemoryAccessKind } from '../../spec/blua32/memory_access_kind';
import { emitMemoryAccess, emitWordStores } from './compiled_block_memory';
import { JavaScriptRegisterCache, type CompiledExitWriteBacks } from './compiled_block_registers';
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
	InvalidOperand,
	WriteGlobal,
	WriteSystemGlobal,
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
	[OpCode.SETGL, CompiledBlockExit.WriteGlobal], [OpCode.SETSYS, CompiledBlockExit.WriteSystemGlobal],
] as const) sideExitKinds[op] = exit;

function compiledBlockExitResumesFrame(exit: CompiledBlockExit): boolean {
	switch (exit) {
		case CompiledBlockExit.ReadField: case CompiledBlockExit.WriteField:
		case CompiledBlockExit.ReadIndex: case CompiledBlockExit.WriteIndex:
		case CompiledBlockExit.ReadInteger: case CompiledBlockExit.WriteInteger:
		case CompiledBlockExit.WriteUpvalue: case CompiledBlockExit.Vararg:
		case CompiledBlockExit.AllocateTable: case CompiledBlockExit.Concat: case CompiledBlockExit.ConcatRange:
			return true;
		default:
			return false;
	}
}

export type CompiledBlockExitSite = {
	readonly exit: CompiledBlockExit;
	/** Semantic helper with a fixed successor and no frame, image or device change. */
	readonly resumesFrame: boolean;
	readonly exitA: number;
	readonly exitB: number;
	readonly exitC: number;
	readonly exitBx: number;
	readonly exitWord: number;
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
	/** Cost before the last instruction of this entry's linear continuation. */
	readonly admissionCycles: number;
	readonly admissionVarargs: number;
	/** Source dependencies through the linear successors admitted by this entry. */
	readonly sourceWords: number;
	incoming: CompiledBlockExitSite | null;
};

type StatementEmitter = (page: DecodedInstructionPage, word: number, image: Blua32ExecutionImage,
	registers: JavaScriptRegisterCache, exitIndex: number) => string;
const emitters: (StatementEmitter | undefined)[] = new Array(OPCODE_COUNT);
emitters[OpCode.MOV] = (p, w, _image, r) => r.copy(p.a[w], p.b[w]);
emitters[OpCode.LOADK] = (p, w, image, r) => r.writeEncoded(p.a[w], `${image.constTags[p.bx[w]]}`, `k[${p.bx[w]}]`);
emitters[OpCode.KNIL] = (p, w, _image, r) => r.writeEncoded(p.a[w], `${ValueTag.Nil}`, '0');
emitters[OpCode.KFALSE] = (p, w, _image, r) => r.writeEncoded(p.a[w], `${ValueTag.False}`, '0');
emitters[OpCode.KTRUE] = (p, w, _image, r) => r.writeEncoded(p.a[w], `${ValueTag.True}`, '0');
emitters[OpCode.NOT] = (p, w, _image, r) => r.writeEncoded(p.a[w], `${r.truthy(p.b[w])}?${ValueTag.False}:${ValueTag.True}`, '0');
emitters[OpCode.K0] = (p, w, _image, r) => r.writeInteger(p.a[w], '0');
emitters[OpCode.K1] = (p, w, _image, r) => r.writeInteger(p.a[w], '1');
emitters[OpCode.KM1] = (p, w, _image, r) => r.writeInteger(p.a[w], '-1');
emitters[OpCode.KSMI] = (p, w, _image, r) => r.writeInteger(p.a[w], `${p.sbx[w]}`);
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

export function compiledBlockSupports(op: number, c: number): boolean {
	if (op === OpCode.MOV && c > ValueMoveKind.FloatFromBits) return false;
	return emitters[op] !== undefined || compiledArithmeticSupports(op)
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
	OpCode.CLOSURE, OpCode.CALL, OpCode.LEN]) continuationOps[op] = 1;

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
	readonly deferredJumpIndex: number;
	readonly admissionCycles: number;
	readonly admissionVarargs: number;
	readonly openVarargs: number;
	readonly formatCycles: number;
};

/** Emit a segment and its precise side exits; the region owns control flow. */
export function emitJavaScriptBlock(
	page: DecodedInstructionPage, plan: CompiledBlockSource,
	image: Blua32ExecutionImage, memory: Memory, exits: CompiledBlockExitSite[], residents: ReadonlyMap<number, boolean>, outputs: ReadonlySet<number>,
	writeBacks: CompiledExitWriteBacks,
): EmittedJavaScriptBlock {
	const { firstWord, endWord, skippedInstructionWidth } = plan;
	let pc = plan.pc;
	const firstExit = exits.length;
	const source: string[] = [];
	const registers = new JavaScriptRegisterCache(image, residents, outputs, writeBacks);
	let cycles = 0;
	let openVarargs = 0;
	let admissionCycles = 0;
	let admissionVarargs = 0;
	let sourceWords = 0;
	let registerTop = 0;
	let resetsRegisterTop = false;
	let currentPc = pc;
	let lastPc = pc;
	let nextPc = pc;
	let finalWord = firstWord;
	let formatCycles = 0;
	let controlAccess = false;
	for (let word = firstWord; word < endWord; word += page.widths[word]) {
		finalWord = word;
		const op = page.ops[word];
		admissionCycles = cycles + formatCycles;
		admissionVarargs = openVarargs;
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
			exits.push({ exit: sideExit, resumesFrame: compiledBlockExitResumesFrame(sideExit),
				exitA: page.a[word], exitB: page.b[word], exitC: page.c[word], exitBx: page.bx[word], exitWord: word,
				cycles, registerTop, resetsRegisterTop, nextPc, currentPc, lastPc,
				linkedBlock: null, previousIncoming: null, nextIncoming: null });
		}
		const arithmetic = compiledArithmeticSupports(op);
		const bitMove = op === OpCode.MOV && page.c[word] !== ValueMoveKind.Copy;
		const needsOperandFault = bitMove || arithmetic || load || store || words || (control && op === OpCode.MTC0);
		let numericFault = '';
		if (needsOperandFault) {
			const faultIndex = exits.length;
			exits.push({ exit: CompiledBlockExit.InvalidOperand, resumesFrame: false,
				exitA: page.a[word], exitB: page.b[word], exitC: page.c[word], exitBx: page.bx[word], exitWord: word,
				cycles, registerTop, resetsRegisterTop, nextPc, currentPc, lastPc,
				linkedBlock: null, previousIncoming: null, nextIncoming: null });
			numericFault = registers.exit(faultIndex);
		}
		if (bitMove) {
			const b = page.b[word], kind = page.c[word];
			const from = kind === ValueMoveKind.FloatBits ? ValueTag.Float : ValueTag.Integer;
			const to = kind === ValueMoveKind.FloatBits ? ValueTag.Integer : ValueTag.Float;
			source.push(`if(${registers.tagOperand(b)}!==${from}) ${numericFault}${registers.writeEncoded(page.a[word], `${to}`, registers.wordOperand(b))}`);
		} else if (control) {
			source.push(emitControl(op, page, word, registers, sideExit === undefined ? null : exitIndex, !controlAccess, numericFault));
			controlAccess = true;
		} else if (compiledContextSupports(op)) {
			source.push(emitContext(op, page, word, registers, exitIndex));
		} else if (compiledTableSupports(op)) {
			source.push(emitTableOperation(op, page, word, registers, exitIndex));
		} else if (load || store || words) {
			if (!words && page.c[word] === MemoryAccessKind.F64LE) source.push('B-=2;');
			const selector = page.b[word], tag = registers.tagOperand(selector), payload = registers.wordOperand(selector);
			const base = `ma${word}`;
			source.push(`const ${base}=${tag}===${ValueTag.Integer}?${payload}:(${tag}===${ValueTag.Float}?fw(${payload}):null);if(${base}===null) ${numericFault}`);
			const address = displaced ? `(${base}+${page.disp[word] * 4})>>>0` : base;
			const memoryExit = `{S.memoryAddress=a;${registers.exit(exitIndex)}}`;
			if (words) source.push(emitWordStores(page, word, address, memoryExit, numericFault, memory, registers));
			else source.push(emitMemoryAccess(page, word, address, memoryExit, numericFault, memory, registers));
		} else if (arithmetic) {
			source.push(emitArithmetic(page, word, registers, numericFault));
		} else {
			source.push(emitters[op]!(page, word, image, registers, exitIndex));
		}
		// The checked exit precedes this instruction's readiness surcharge.
		if (words) formatCycles += page.c[word];
		if ((load || store) && page.c[word] === MemoryAccessKind.F64LE) formatCycles += 2;
		if (op === OpCode.LOADNIL) cycles += page.b[word];
		if (op === OpCode.VARARG && page.b[word] !== 0) cycles += page.b[word] - 1;
		if (op === OpCode.VARARG && page.b[word] === 0) ++openVarargs;
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
		resumesFrame: compiledBlockExitResumesFrame(terminalExit),
		exitA: page.a[finalWord], exitB: page.b[finalWord], exitC: page.c[finalWord], exitBx: page.bx[finalWord], exitWord: finalWord,
		cycles, registerTop, resetsRegisterTop, nextPc, currentPc, lastPc,
		linkedBlock: null, previousIncoming: null, nextIncoming: null,
	};
	const terminalIndex = exits.length;
	exits.push(terminal);
	let takenIndex = -1;
	let deferredJumpIndex = -1;
	if (compiledBlockComparison(finalOp)) {
		takenIndex = exits.length;
		exits.push({ ...terminal, exit: skippedInstructionWidth === 0 ? CompiledBlockExit.SkipInstruction : CompiledBlockExit.Continue,
			nextPc: (terminal.nextPc + skippedInstructionWidth * INSTRUCTION_BYTES) >>> 0 });
		sourceWords += skippedInstructionWidth;
		if (skippedInstructionWidth !== 0 && page.ops[endWord] === OpCode.JMP
			&& page.dispatchOps[endWord] !== DecodedDispatchOp.Observe) {
			// A comparison can exhaust its grant, including a string surcharge.
			// Preserve the boundary before executing the fused JMP.
			deferredJumpIndex = exits.length;
			exits.push({ ...terminal });
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
		body: source.join('\n'), registers, finalWord, terminalIndex, takenIndex, deferredJumpIndex,
		admissionCycles, admissionVarargs, openVarargs, formatCycles };
}

export function finishJavaScriptBlock(page: DecodedInstructionPage, block: EmittedJavaScriptBlock,
	transfer: (index: number) => string): string {
	const finalOp = page.ops[block.finalWord];
	if (compiledBlockComparison(finalOp)) {
		const expected = page.a[block.finalWord] !== 0;
		const continuation = block.deferredJumpIndex < 0 ? transfer(block.terminalIndex)
			: `if(B>${block.terminal.cycles - BASE_CYCLES[OpCode.JMP]}){${transfer(block.terminalIndex)}}else{${transfer(block.deferredJumpIndex)}}`;
		return emitComparison(page, block.finalWord, block.registers,
			expected ? continuation : transfer(block.takenIndex), expected ? transfer(block.takenIndex) : continuation);
	}
	if (finalOp === OpCode.JMPIF || finalOp === OpCode.JMPIFNOT) {
		const truth = `${finalOp === OpCode.JMPIFNOT ? '!' : ''}${block.registers.truthy(page.a[block.finalWord])}`;
		return `if(${truth}){${transfer(block.takenIndex)}}else{${transfer(block.terminalIndex)}}`;
	}
	return transfer(block.terminalIndex);
}
