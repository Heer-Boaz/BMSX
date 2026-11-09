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

export type CompiledBlock = {
	readonly execute: (registers: ValueSlots, constants: Float64Array) => void;
	readonly cycles: number;
	readonly registerTop: number;
	readonly nextPc: number;
	readonly currentPc: number;
	readonly lastPc: number;
	readonly sourceUnits: number;
};

export class CompiledBlockPage {
	public readonly entries = new Array<CompiledBlock | null>(DECODED_PAGE_WORDS).fill(null);
	public readonly visits = new Uint8Array(DECODED_PAGE_WORDS);
	public sourceUnits = 0;

	public retire(page: DecodedInstructionPage): number {
		for (let word = 0; word < this.entries.length; ++word) {
			if (this.entries[word] === null) continue;
			page.dispatchOps[word] = DecodedDispatchOp.CompiledWarm;
			this.entries[word] = null;
		}
		this.visits.fill(0);
		const released = this.sourceUnits;
		this.sourceUnits = 0;
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

	public retirePage(page: DecodedInstructionPage): void {
		if (page.compiledBlocks === null) return;
		this.sourceUnits -= page.compiledBlocks.retire(page);
		this.pages.delete(page);
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
emitters[OpCode.BNOT] = (p, w) => `r.setNumber(${p.a[w]},~r.getNumber(${p.b[w]}));`;
for (const [op, operator] of [
	[OpCode.ADD, '+'], [OpCode.SUB, '-'], [OpCode.MUL, '*'], [OpCode.DIV, '/'],
	[OpCode.BAND, '&'], [OpCode.BOR, '|'], [OpCode.BXOR, '^'],
	[OpCode.SHL, '<<'], [OpCode.SHR, '>>'],
] as const) {
	emitters[op] = (p, w, image) => `r.setNumber(${p.a[w]},(${numberOperand(p.b[w], image)})${operator}(${numberOperand(p.c[w], image)}));`;
}
emitters[OpCode.JMP] = () => '';

export function compiledBlockSupports(op: number): boolean {
	return emitters[op] !== undefined;
}

/** The caller admits decoded, non-observed, side-effect-free instructions. */
export function compileJavaScriptBlock(
	page: DecodedInstructionPage,
	firstWord: number,
	endWord: number,
	pc: number,
	image: Blua32ExecutionImage,
): CompiledBlock {
	const source = ['"use strict";'];
	let cycles = 0;
	let registerTop = 0;
	let currentPc = pc;
	let lastPc = pc;
	let nextPc = pc;
	for (let word = firstWord; word < endWord; word += page.widths[word]) {
		const op = page.ops[word];
		source.push(emitters[op]!(page, word, image));
		cycles += BASE_CYCLES[op];
		currentPc = pc;
		lastPc = (pc + (page.widths[word] - 1) * INSTRUCTION_BYTES) >>> 0;
		pc = (pc + page.widths[word] * INSTRUCTION_BYTES) >>> 0;
		nextPc = op === OpCode.JMP ? page.bx[word] : pc;
		if (op !== OpCode.JMP) registerTop = Math.max(registerTop, page.a[word] + 1);
	}
	const body = source.join('\n');
	return {
		execute: new Function('r', 'k', body) as CompiledBlock['execute'],
		cycles, registerTop, nextPc, currentPc, lastPc,
		sourceUnits: body.length,
	};
}
