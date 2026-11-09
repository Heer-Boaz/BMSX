import { INSTRUCTION_BYTES } from '../../spec/blua32/instruction_format';
import { BASE_CYCLES, OPCODE_COUNT, OpCode } from '../../spec/blua32/opcode';
import { DECODED_PAGE_WORDS, DecodedDispatchOp, type Blua32ExecutionImage, type DecodedInstructionPage } from './execution_image';
import { ValueTag } from './value';
import type { ValueSlots } from './value_slots';

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
}

export type CompiledBlock = {
	readonly execute: (registers: ValueSlots, constants: Float64Array) => number;
	readonly exit: CompiledBlockExit;
	readonly exitA: number;
	readonly exitB: number;
	readonly exitC: number;
	readonly cycles: number;
	readonly registerTop: number;
	readonly nextPc: number;
	readonly currentPc: number;
	readonly lastPc: number;
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

type StatementEmitter = (page: DecodedInstructionPage, word: number, image: Blua32ExecutionImage) => string;

function numberOperand(selector: number, image: Blua32ExecutionImage): string {
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
emitters[OpCode.K0] = (p, w) => `r.setNumber(${p.a[w]},0);`;
emitters[OpCode.K1] = (p, w) => `r.setNumber(${p.a[w]},1);`;
emitters[OpCode.KM1] = (p, w) => `r.setNumber(${p.a[w]},-1);`;
emitters[OpCode.KSMI] = (p, w) => `r.setNumber(${p.a[w]},${p.sbx[w]});`;
emitters[OpCode.UNM] = (p, w) => `r.setNumber(${p.a[w]},-r.getNumber(${p.b[w]}));`;
emitters[OpCode.NOT] = (p, w) => `r.setBool(${p.a[w]},!r.isTruthy(${p.b[w]}));`;
emitters[OpCode.BNOT] = (p, w) => `r.setNumber(${p.a[w]},~r.getNumber(${p.b[w]}));`;
for (const [op, operator] of [
	[OpCode.ADD, '+'], [OpCode.SUB, '-'], [OpCode.MUL, '*'], [OpCode.DIV, '/'],
	[OpCode.BAND, '&'], [OpCode.BOR, '|'], [OpCode.BXOR, '^'],
	[OpCode.SHL, '<<'], [OpCode.SHR, '>>'],
] as const) {
	emitters[op] = (p, w, image) => `r.setNumber(${p.a[w]},(${numberOperand(p.b[w], image)})${operator}(${numberOperand(p.c[w], image)}));`;
}
emitters[OpCode.JMP] = () => '';
emitters[OpCode.JMPIF] = emitters[OpCode.JMP];
emitters[OpCode.JMPIFNOT] = emitters[OpCode.JMP];
emitters[OpCode.HALT] = emitters[OpCode.JMP];
emitters[OpCode.CALL] = emitters[OpCode.JMP];
emitters[OpCode.RET] = emitters[OpCode.JMP];

export function compiledBlockSupports(op: number): boolean {
	return emitters[op] !== undefined;
}

export function compiledBlockEndsBlock(op: number): boolean {
	return op === OpCode.JMP || op === OpCode.JMPIF || op === OpCode.JMPIFNOT || op === OpCode.HALT
		|| op === OpCode.CALL || op === OpCode.RET;
}

/** The caller admits a pure prefix and at most one terminal execution boundary. */
export function compileJavaScriptBlock(
	page: DecodedInstructionPage,
	firstWord: number,
	endWord: number,
	pc: number,
	image: Blua32ExecutionImage,
): CompiledBlock {
	const source = ['"use strict";'];
	let cycles = 0;
	let sourceWords = 0;
	let registerTop = 0;
	let currentPc = pc;
	let lastPc = pc;
	let nextPc = pc;
	let finalWord = firstWord;
	for (let word = firstWord; word < endWord; word += page.widths[word]) {
		finalWord = word;
		const op = page.ops[word];
		source.push(emitters[op]!(page, word, image));
		cycles += BASE_CYCLES[op];
		sourceWords += page.widths[word];
		currentPc = pc;
		lastPc = (pc + (page.widths[word] - 1) * INSTRUCTION_BYTES) >>> 0;
		pc = (pc + page.widths[word] * INSTRUCTION_BYTES) >>> 0;
		nextPc = op === OpCode.JMP ? page.bx[word] : pc;
		if (!compiledBlockEndsBlock(op)) registerTop = Math.max(registerTop, page.a[word] + 1);
	}
	const finalOp = page.ops[finalWord];
	if (finalOp === OpCode.JMPIF || finalOp === OpCode.JMPIFNOT) {
		const truth = `${finalOp === OpCode.JMPIFNOT ? '!' : ''}r.isTruthy(${page.a[finalWord]})`;
		source.push(`return ${truth}?${page.bx[finalWord]}:${nextPc};`);
	} else source.push(`return ${nextPc};`);
	const body = source.join('\n');
	return {
		execute: new Function('r', 'k', body) as CompiledBlock['execute'],
		exit: finalOp === OpCode.HALT ? CompiledBlockExit.Halt : finalOp === OpCode.CALL ? CompiledBlockExit.Call
			: finalOp === OpCode.RET ? CompiledBlockExit.Return : CompiledBlockExit.Continue,
		exitA: page.a[finalWord], exitB: page.b[finalWord], exitC: page.c[finalWord],
		cycles, sourceWords, registerTop, nextPc, currentPc, lastPc,
		sourceUnits: body.length,
	};
}
