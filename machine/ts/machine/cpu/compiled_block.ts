import { INSTRUCTION_BYTES } from '../../spec/blua32/instruction_format';
import { BASE_CYCLES, OPCODE_COUNT, OpCode } from '../../spec/blua32/opcode';
import { DECODED_PAGE_WORDS, DecodedDispatchOp, type Blua32ExecutionImage, type DecodedInstructionPage } from './execution_image';
import { ValueTag, valueFromNumber } from './value';
import type { ValueSlots } from './value_slots';
import type { Memory } from '../memory/memory';
import { emitMemoryAccess, emitWordStores } from './compiled_block_memory';
import { ceilDiv4 } from '../common/numeric';
import { JavaScriptRegisterCache } from './compiled_block_registers';
import { emitComparison } from './compiled_block_compare';
import type { StringPool } from './string_pool';
import type { CallFrame } from './call_state';
import { compiledContextSupports, emitContext } from './compiled_block_context';
import { compiledTableSupports, emitTableOperation } from './compiled_block_table';
import { luaFloorDivide, luaModulo } from '../../spec/blua32/numeric';
import { luaPow } from '../../spec/blua32/pow';
import { COP0_EXEC, COP0_STATUS, cop0FieldImplemented } from '../../spec/blua32/cop0';
import { compiledControlSupports, emitControl } from './compiled_block_control';

export const enum CpuExecutionBackend {
	Interpreter,
	JavaScript,
}

export const COMPILED_BLOCK_THRESHOLD = 8;
export const COMPILED_BLOCK_MAX_INSTRUCTIONS = 64;
export const COMPILED_BLOCK_SOURCE_BUDGET = 1024 * 1024;

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
	readonly execute: (registers: ValueSlots, constants: Float64Array, page: DecodedInstructionPage, frame: CallFrame) => number;
	/** Budget through the start of the final instruction, not its full charge. */
	readonly entryCycles: number;
	readonly terminal: CompiledBlockExitSite;
	readonly exits: readonly CompiledBlockExitSite[];
	readonly sourceUnits: number;
	readonly sourceWords: number;
	incoming: CompiledBlockExitSite | null;
};

function unlinkCompiledExit(exit: CompiledBlockExitSite): void {
	const target = exit.linkedBlock;
	if (target === null) return;
	if (exit.previousIncoming === null) target.incoming = exit.nextIncoming;
	else exit.previousIncoming.nextIncoming = exit.nextIncoming;
	if (exit.nextIncoming !== null) exit.nextIncoming.previousIncoming = exit.previousIncoming;
	exit.linkedBlock = exit.previousIncoming = exit.nextIncoming = null;
}

export function linkCompiledBlock(source: CompiledBlockExitSite, target: CompiledBlock): void {
	unlinkCompiledExit(source);
	source.linkedBlock = target;
	source.nextIncoming = target.incoming;
	if (target.incoming !== null) target.incoming.previousIncoming = source;
	target.incoming = source;
}

export class CompiledBlockPage {
	public readonly entries = new Array<CompiledBlock | null>(DECODED_PAGE_WORDS).fill(null);
	public readonly visits = new Uint8Array(DECODED_PAGE_WORDS);
	public sourceUnits = 0;

	public retire(page: DecodedInstructionPage, firstWord: number, endWord: number): number {
		let released = 0;
		const firstEntry = Math.max(0, firstWord - 2 * (COMPILED_BLOCK_MAX_INSTRUCTIONS + 1));
		const endEntry = Math.min(DECODED_PAGE_WORDS, endWord);
		for (let word = firstEntry; word < endEntry; ++word) {
			const block = this.entries[word];
			if (block === null || word + block.sourceWords <= firstWord) continue;
			for (const exit of block.exits) unlinkCompiledExit(exit);
			while (block.incoming !== null) unlinkCompiledExit(block.incoming);
			released += block.sourceUnits;
			page.dispatchOps[word] = DecodedDispatchOp.CompiledWarm;
			this.entries[word] = null;
			this.visits[word] = 0;
		}
		this.sourceUnits -= released;
		return released;
	}
}

/** Owns executable-cache lifetime even when an execution image is replaced. */
export class CompiledCodeCache {
	private readonly pages = new Set<DecodedInstructionPage>();
	private sourceUnits = 0;

	public atCapacity(): boolean { return this.sourceUnits >= COMPILED_BLOCK_SOURCE_BUDGET; }

	public install(page: DecodedInstructionPage, word: number, block: CompiledBlock): void {
		const cache = page.compiledBlocks!;
		cache.entries[word] = block;
		cache.sourceUnits += block.sourceUnits;
		this.sourceUnits += block.sourceUnits;
		this.pages.add(page);
		page.dispatchOps[word] = DecodedDispatchOp.Compiled;
	}

	public retirePage(page: DecodedInstructionPage, firstWord = 0, endWord = DECODED_PAGE_WORDS + 1): void {
		if (page.compiledBlocks === null || page.compiledBlocks.sourceUnits === 0) return;
		this.sourceUnits -= page.compiledBlocks.retire(page, firstWord, endWord);
		if (page.compiledBlocks.sourceUnits === 0) this.pages.delete(page);
	}

	public retireAll(): void {
		for (const page of this.pages) this.retirePage(page);
	}
}

type StatementEmitter = (page: DecodedInstructionPage, word: number, image: Blua32ExecutionImage,
	registers: JavaScriptRegisterCache, exitIndex: number) => string;
type NumberEmitter = (page: DecodedInstructionPage, word: number, registers: JavaScriptRegisterCache) => string;

const emitters: (StatementEmitter | undefined)[] = new Array(OPCODE_COUNT);
emitters[OpCode.MOV] = (p, w, _image, r) => r.copy(p.a[w], p.b[w]);
emitters[OpCode.LOADK] = (p, w, image, r) => {
	if (image.constTags[p.bx[w]] === ValueTag.Number) return r.writeNumber(p.a[w], `k[${p.bx[w]}]`);
	r.discard(p.a[w]);
	return `r.setEncoded(${p.a[w]},${image.constTags[p.bx[w]]},k[${p.bx[w]}],null);`;
};
emitters[OpCode.KNIL] = (p, w, _image, r) => {
	r.discard(p.a[w]); return `r.setNil(${p.a[w]});`;
};
emitters[OpCode.KFALSE] = (p, w, _image, r) => {
	r.discard(p.a[w]); return `r.setBool(${p.a[w]},false);`;
};
emitters[OpCode.KTRUE] = (p, w, _image, r) => {
	r.discard(p.a[w]); return `r.setBool(${p.a[w]},true);`;
};
emitters[OpCode.NOT] = (p, w, _image, r) => {
	const truth = r.truthy(p.b[w]);
	r.discard(p.a[w]);
	return `r.setBool(${p.a[w]},!${truth});`;
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

export function compiledBlockComparison(op: number): boolean {
	return op === OpCode.EQ || op === OpCode.LT || op === OpCode.LE;
}

/** Fields and RAM stay in the block; side exits publish only the executed prefix. */
export function compileJavaScriptBlock(
	page: DecodedInstructionPage,
	firstWord: number,
	endWord: number,
	pc: number,
	image: Blua32ExecutionImage,
	memory: Memory,
	strings: StringPool,
	globalSlots: ValueSlots,
	systemGlobalSlots: ValueSlots,
	cop0Words: Uint32Array,
	skippedInstructionWidth = 0,
): CompiledBlock {
	const source = ['"use strict";'];
	const registers = new JavaScriptRegisterCache(image);
	const exits: CompiledBlockExitSite[] = [];
	let cycles = 0;
	let entryCycles = 0;
	let sourceWords = 0;
	let registerTop = 0;
	let resetsRegisterTop = false;
	let currentPc = pc;
	let lastPc = pc;
	let nextPc = pc;
	let finalWord = firstWord;
	let numberLocal = false;
	let memoryAccess = false;
	let memoryReads = false;
	let controlAccess = false;
	let contextCapture = false;
	for (let word = firstWord; word < endWord; word += page.widths[word]) {
		finalWord = word;
		const op = page.ops[word];
		entryCycles = cycles + 1;
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
			contextCapture ||= op === OpCode.GETGL || op === OpCode.SETGL || op === OpCode.GETSYS || op === OpCode.SETSYS || op === OpCode.LOADKR;
			source.push(emitContext(op, page, word, registers, exitIndex));
		} else if (compiledTableSupports(op)) {
			source.push(emitTableOperation(op, page, word, registers, exitIndex));
		} else if (load || store || words) {
			memoryAccess = true;
			memoryReads ||= load;
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
		if (op === OpCode.VARARG && page.b[word] === 0) { registerTop = 0; resetsRegisterTop = true; }
		else if (op === OpCode.VARARG || op === OpCode.LOADNIL) {
			if (page.b[word] !== 0) registerTop = Math.max(registerTop, page.a[word] + page.b[word]);
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
	const comparison = compiledBlockComparison(finalOp);
	const ordering = finalOp === OpCode.LT || finalOp === OpCode.LE;
	if (comparison) {
		const skippedIndex = exits.length;
		exits.push({ ...terminal, exit: skippedInstructionWidth === 0 ? CompiledBlockExit.SkipInstruction : CompiledBlockExit.Continue,
			nextPc: (terminal.nextPc + skippedInstructionWidth * INSTRUCTION_BYTES) >>> 0 });
		sourceWords += skippedInstructionWidth;
		const expected = page.a[finalWord] !== 0;
		source.push(emitComparison(page, finalWord, registers,
			expected ? terminalIndex : skippedIndex, expected ? skippedIndex : terminalIndex));
	} else if (finalOp === OpCode.JMPIF || finalOp === OpCode.JMPIFNOT) {
		const takenIndex = exits.length;
		exits.push({ ...terminal, nextPc: page.bx[finalWord] });
		const truth = `${finalOp === OpCode.JMPIFNOT ? '!' : ''}${registers.truthy(page.a[finalWord])}`;
		source.push(`return ${truth}?${takenIndex}:${terminalIndex};`);
	} else source.push(`return ${terminalIndex};`);
	const body = source.join('\n');
	const functionSource = memoryAccess || registers.localCount !== 0 || ordering || contextCapture || controlAccess ? `return function(r,k,p,frame){${body}}` : body;
	let execute: CompiledBlock['execute'];
	if (memoryReads) {
		const cartridges = memory.cartridgeController;
		execute = new Function('m', 'g', 's', 'c', 'c0', 'c1', 'f', 'q', 'kt', 'gl', 'sy', 'mod', 'floorDiv', 'pow', 'cp', functionSource)(
			memory.ramView, memory.ramWriteWatches().groupData(), memory.systemRomStorage(),
			cartridges, cartridges.romStorage(0), cartridges.romStorage(1), valueFromNumber, strings, image.constTags, globalSlots, systemGlobalSlots,
			luaModulo, luaFloorDivide, luaPow, cop0Words) as CompiledBlock['execute'];
	} else if (memoryAccess) {
		execute = new Function('m', 'g', 'f', 'q', 'kt', 'gl', 'sy', 'mod', 'floorDiv', 'pow', 'cp', functionSource)(memory.ramView, memory.ramWriteWatches().groupData(), valueFromNumber, strings, image.constTags, globalSlots, systemGlobalSlots,
			luaModulo, luaFloorDivide, luaPow, cop0Words) as CompiledBlock['execute'];
	} else if (registers.localCount !== 0 || ordering || contextCapture || controlAccess) {
		execute = new Function('f', 'q', 'kt', 'gl', 'sy', 'mod', 'floorDiv', 'pow', 'cp', functionSource)(valueFromNumber, strings, image.constTags, globalSlots, systemGlobalSlots,
			luaModulo, luaFloorDivide, luaPow, cop0Words) as CompiledBlock['execute'];
	} else execute = new Function('r', 'k', 'p', 'frame', functionSource) as CompiledBlock['execute'];
	return {
		page,
		execute,
		entryCycles, terminal, exits, sourceWords, sourceUnits: functionSource.length,
		incoming: null,
	};
}
