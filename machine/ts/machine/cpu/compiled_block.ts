import { INSTRUCTION_BYTES } from '../../spec/blua32/instruction_format';
import { BASE_CYCLES, OPCODE_COUNT, OpCode } from '../../spec/blua32/opcode';
import { DECODED_PAGE_WORDS, DecodedDispatchOp, type Blua32ExecutionImage, type DecodedInstructionPage } from './execution_image';
import { ValueTag } from './value';
import type { ValueSlots } from './value_slots';
import type { Memory } from '../memory/memory';
import { emitMemoryAccess } from './compiled_block_memory';

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
}

export type CompiledBlockExitSite = {
	readonly exit: CompiledBlockExit;
	readonly exitA: number;
	readonly exitB: number;
	readonly exitC: number;
	readonly exitWord: number;
	readonly displaced: boolean;
	readonly displacement: number;
	readonly cycles: number;
	readonly registerTop: number;
	readonly nextPc: number;
	readonly currentPc: number;
	readonly lastPc: number;
};

export type CompiledBlock = {
	readonly execute: (registers: ValueSlots, constants: Float64Array, page: DecodedInstructionPage) => number;
	readonly terminal: CompiledBlockExitSite;
	readonly exits: readonly CompiledBlockExitSite[];
	readonly sourceUnits: number;
	readonly sourceWords: number;
};

export class CompiledBlockPage {
	public readonly entries = new Array<CompiledBlock | null>(DECODED_PAGE_WORDS).fill(null);
	public readonly visits = new Uint8Array(DECODED_PAGE_WORDS);
	public sourceUnits = 0;

	public retire(page: DecodedInstructionPage, firstWord: number, endWord: number): number {
		let released = 0;
		const firstEntry = Math.max(0, firstWord - 2 * COMPILED_BLOCK_MAX_INSTRUCTIONS);
		const endEntry = Math.min(DECODED_PAGE_WORDS, endWord);
		for (let word = firstEntry; word < endEntry; ++word) {
			const block = this.entries[word];
			if (block === null || word + block.sourceWords <= firstWord) continue;
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

type StatementEmitter = (page: DecodedInstructionPage, word: number, image: Blua32ExecutionImage, exitIndex: number) => string;
type NumberEmitter = (page: DecodedInstructionPage, word: number, image: Blua32ExecutionImage, pendingRegister: number) => string;

function numberOperand(selector: number, image: Blua32ExecutionImage, pendingRegister: number): string {
	if (selector >= 0 && selector === pendingRegister) return 'v';
	if (selector >= 0) return `r.getNumber(${selector})`;
	const index = -selector - 1;
	return image.constTags[index] === ValueTag.Number ? `k[${index}]` : 'NaN';
}

const emitters: (StatementEmitter | undefined)[] = new Array(OPCODE_COUNT);
emitters[OpCode.MOV] = (p, w) => `r.copySlot(${p.a[w]},${p.b[w]});`;
emitters[OpCode.LOADK] = (p, w, image) => `r.setEncoded(${p.a[w]},${image.constTags[p.bx[w]]},k[${p.bx[w]}],null);`;
emitters[OpCode.KNIL] = (p, w) => `r.setNil(${p.a[w]});`;
emitters[OpCode.KFALSE] = (p, w) => `r.setBool(${p.a[w]},false);`;
emitters[OpCode.KTRUE] = (p, w) => `r.setBool(${p.a[w]},true);`;
emitters[OpCode.NOT] = (p, w) => `r.setBool(${p.a[w]},!r.isTruthy(${p.b[w]}));`;
emitters[OpCode.GETFIELD] = (p, w, _image, exit) => `if(r.getTag(${p.b[w]})!==${ValueTag.Table}) return ${exit};
{ const t=r.getTable(${p.b[w]});
if(!t.loadPredictedStringKey(k[${p.c[w]}],p.tableCacheSlots[${w}],r,${p.a[w]})) return ${exit}; }`;
emitters[OpCode.SETFIELD] = (p, w, image, exit) => {
	const selector = p.c[w];
	const constant = -selector - 1;
	const tag = selector < 0 ? `${image.constTags[constant]}` : `r.getTag(${selector})`;
	const scalar = selector < 0 ? `k[${constant}]` : `r.getScalar(${selector})`;
	const reference = selector < 0 ? 'null' : `r.getReference(${selector})`;
	return `if(r.getTag(${p.a[w]})!==${ValueTag.Table} || !r.getTable(${p.a[w]}).storePredictedStringKey(k[${p.b[w]}],p.tableCacheSlots[${w}],${tag},${scalar},${reference})) return ${exit};`;
};

const numberEmitters: (NumberEmitter | undefined)[] = new Array(OPCODE_COUNT);
numberEmitters[OpCode.K0] = () => '0';
numberEmitters[OpCode.K1] = () => '1';
numberEmitters[OpCode.KM1] = () => '-1';
numberEmitters[OpCode.KSMI] = (p, w) => `${p.sbx[w]}`;
numberEmitters[OpCode.UNM] = (p, w, image, pending) => `-(${numberOperand(p.b[w], image, pending)})`;
numberEmitters[OpCode.BNOT] = (p, w, image, pending) => `~(${numberOperand(p.b[w], image, pending)})`;
for (const [op, operator] of [
	[OpCode.ADD, '+'], [OpCode.SUB, '-'], [OpCode.MUL, '*'], [OpCode.DIV, '/'],
	[OpCode.BAND, '&'], [OpCode.BOR, '|'], [OpCode.BXOR, '^'],
	[OpCode.SHL, '<<'], [OpCode.SHR, '>>'],
] as const) {
	numberEmitters[op] = (p, w, image, pending) => `(${numberOperand(p.b[w], image, pending)})${operator}(${numberOperand(p.c[w], image, pending)})`;
}
emitters[OpCode.JMP] = () => '';
emitters[OpCode.JMPIF] = emitters[OpCode.JMP];
emitters[OpCode.JMPIFNOT] = emitters[OpCode.JMP];
emitters[OpCode.HALT] = emitters[OpCode.JMP];
emitters[OpCode.CALL] = emitters[OpCode.JMP];
emitters[OpCode.RET] = emitters[OpCode.JMP];

export function compiledBlockSupports(op: number): boolean {
	return emitters[op] !== undefined || numberEmitters[op] !== undefined
		|| op === OpCode.LOAD_MEM || op === OpCode.LOAD_MEM_D || op === OpCode.STORE_MEM || op === OpCode.STORE_MEM_D;
}

export function compiledBlockEndsBlock(op: number): boolean {
	return op === OpCode.JMP || op === OpCode.JMPIF || op === OpCode.JMPIFNOT || op === OpCode.HALT
		|| op === OpCode.CALL || op === OpCode.RET;
}

/** Fields and RAM stay in the block; side exits publish only the executed prefix. */
export function compileJavaScriptBlock(
	page: DecodedInstructionPage,
	firstWord: number,
	endWord: number,
	pc: number,
	image: Blua32ExecutionImage,
	memory: Memory,
): CompiledBlock {
	const source = ['"use strict";'];
	const exits: CompiledBlockExitSite[] = [];
	let cycles = 0;
	let sourceWords = 0;
	let registerTop = 0;
	let currentPc = pc;
	let lastPc = pc;
	let nextPc = pc;
	let finalWord = firstWord;
	let pendingRegister = -1;
	let numberLocal = false;
	let memoryAccess = false;
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
		const displaced = op === OpCode.LOAD_MEM_D || op === OpCode.STORE_MEM_D;
		if (op === OpCode.GETFIELD || op === OpCode.SETFIELD || load || store) {
			exits.push({ exit: load ? CompiledBlockExit.ReadMemory : store ? CompiledBlockExit.WriteMemory
				: op === OpCode.GETFIELD ? CompiledBlockExit.ReadField : CompiledBlockExit.WriteField,
				exitA: page.a[word], exitB: page.b[word], exitC: page.c[word], exitWord: word,
				displaced, displacement: page.disp[word],
				cycles, registerTop, nextPc, currentPc, lastPc });
		}
		const numberEmitter = numberEmitters[op];
		if (load || store) {
			memoryAccess = true;
			if (pendingRegister >= 0) source.push(`r.setNumber(${pendingRegister},v);`);
			pendingRegister = -1;
			if (load && !numberLocal) {
				source.push('let v;');
				numberLocal = true;
			}
			const base = numberOperand(page.b[word], image, -1);
			const address = displaced ? `(((${base})>>>0)+${page.disp[word] * 4})>>>0` : `((${base})>>>0)`;
			source.push(emitMemoryAccess(page, word, address, exitIndex));
			if (load) pendingRegister = page.a[word];
		} else if (numberEmitter !== undefined) {
			if (!numberLocal) {
				source.push('let v;');
				numberLocal = true;
			}
			if (pendingRegister >= 0 && pendingRegister !== page.a[word]) {
				source.push(`r.setNumber(${pendingRegister},v);`);
			}
			source.push(`v=${numberEmitter(page, word, image, pendingRegister)};`);
			pendingRegister = page.a[word];
		} else {
			// Raw copies and execution exits consume the complete ValueSlots state.
			if (pendingRegister >= 0) source.push(`r.setNumber(${pendingRegister},v);`);
			pendingRegister = -1;
			source.push(emitters[op]!(page, word, image, exitIndex));
		}
		if (!compiledBlockEndsBlock(op) && op !== OpCode.SETFIELD && !store) registerTop = Math.max(registerTop, page.a[word] + 1);
	}
	if (pendingRegister >= 0) source.push(`r.setNumber(${pendingRegister},v);`);
	const finalOp = page.ops[finalWord];
	const terminal: CompiledBlockExitSite = {
		exit: finalOp === OpCode.HALT ? CompiledBlockExit.Halt : finalOp === OpCode.CALL ? CompiledBlockExit.Call
			: finalOp === OpCode.RET ? CompiledBlockExit.Return : CompiledBlockExit.Continue,
		exitA: page.a[finalWord], exitB: page.b[finalWord], exitC: page.c[finalWord], exitWord: finalWord,
		displaced: false, displacement: 0,
		cycles, registerTop, nextPc, currentPc, lastPc,
	};
	const terminalIndex = exits.length;
	exits.push(terminal);
	if (finalOp === OpCode.JMPIF || finalOp === OpCode.JMPIFNOT) {
		const takenIndex = exits.length;
		exits.push({ ...terminal, nextPc: page.bx[finalWord] });
		const truth = `${finalOp === OpCode.JMPIFNOT ? '!' : ''}r.isTruthy(${page.a[finalWord]})`;
		source.push(`return ${truth}?${takenIndex}:${terminalIndex};`);
	} else source.push(`return ${terminalIndex};`);
	const body = source.join('\n');
	const functionSource = memoryAccess ? `return function(r,k,p){${body}}` : body;
	return {
		execute: memoryAccess ? new Function('m', 'g', functionSource)(
			memory.ramView, memory.ramWriteWatches().groupData()) as CompiledBlock['execute']
			: new Function('r', 'k', 'p', body) as CompiledBlock['execute'],
		terminal, exits, sourceWords, sourceUnits: functionSource.length,
	};
}
