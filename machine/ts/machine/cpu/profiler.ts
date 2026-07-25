import { BASE_CYCLES, OPCODE_CATEGORY, OPCODE_COUNT, OpCode, getOpcodeName } from './opcode_info';
import { INSTRUCTION_BYTES } from './instruction_format';
import {
	DECODED_PAGE_SHIFT,
	DECODED_PAGE_WORDS,
	type Blua32ExecutionImage,
	type CpuInstructionTrace,
} from './execution_image';
import type { CPU } from './cpu';
import type { ExecutionDomainId } from './execution_address_space';

export type CpuProfilerSourcePosition = {
	line: number;
	column: number;
};

export type CpuProfilerSourceRange = {
	path: string;
	start: CpuProfilerSourcePosition;
	end: CpuProfilerSourcePosition;
};

export type CpuProfilerFunction = {
	address: number;
	codeAddress: number;
	codeByteCount: number;
};

export type CpuProfilerMetadata = {
	debugRanges: ReadonlyArray<CpuProfilerSourceRange | null>;
};

export type CpuProfilerImage = {
	textAddress: number;
	functions: ReadonlyArray<CpuProfilerFunction>;
	functionIds: ReadonlyArray<string>;
	metadata: CpuProfilerMetadata | null;
	opcodeByWord: Uint8Array;
};

export type CpuProfilerSnapshot = {
	totalInstructions: number;
	totalBaseCycles: number;
	opcodeCounts: Uint32Array;
	pcCounts: Uint32Array;
	pcByWord: Uint32Array;
	opcodeByWord: Uint8Array;
	functionByWord: Int32Array;
	functionIds: string[];
	debugRanges: Array<CpuProfilerSourceRange | null>;
};

export type CpuProfilerHotOpcode = {
	opcode: number;
	name: string;
	count: number;
	percent: number;
	baseCost: number;
	cycles: number;
	cyclePercent: number;
	category: string;
};

export type CpuProfilerHotPath = {
	path: string;
	count: number;
	percent: number;
	cycles: number;
	cyclePercent: number;
};

export type CpuProfilerHotFunction = {
	functionIndex: number;
	functionId: string;
	path: string;
	count: number;
	percent: number;
	cycles: number;
	cyclePercent: number;
};

export type CpuProfilerOpcodePressure = {
	label: string;
	totalCount: number;
	percent: number;
	totalCycles: number;
	cyclePercent: number;
	opcodes: CpuProfilerHotOpcode[];
};

export type CpuProfilerCategoryPressure = {
	category: string;
	count: number;
	percent: number;
	cycles: number;
	cyclePercent: number;
	avgCost: number;
};

export type CpuProfilerOpcodeGroupFunction = {
	functionIndex: number;
	functionId: string;
	path: string;
	groupCount: number;
	groupCycles: number;
	totalCycles: number;
	cyclePercent: number;
	ofFunctionCyclePercent: number;
};

export type CpuProfilerHotPc = {
	wordIndex: number;
	pc: number;
	opcode: number;
	opcodeName: string;
	count: number;
	percent: number;
	functionIndex: number;
	functionId: string;
	range: CpuProfilerSourceRange | null;
};

export type CpuProfilerReportOptions = {
	topPaths?: number;
	topFunctions?: number;
	topOpcodes?: number;
	topPcs?: number;
};

const EMPTY_U32 = new Uint32Array(0);
const EMPTY_U8 = new Uint8Array(0);
const EMPTY_I32 = new Int32Array(0);

function percent(count: number, total: number): number {
	return total === 0 ? 0 : ((count / total) * 100);
}

function visitCountedFunctionWords(snapshot: CpuProfilerSnapshot, visit: (wordIndex: number, functionIndex: number, count: number) => void): void {
	for (let wordIndex = 0; wordIndex < snapshot.pcCounts.length; wordIndex += 1) {
		const count = snapshot.pcCounts[wordIndex];
		if (count === 0) {
			continue;
		}
		const functionIndex = snapshot.functionByWord[wordIndex];
		if (functionIndex < 0) {
			continue;
		}
		visit(wordIndex, functionIndex, count);
	}
}

function formatLocation(range: CpuProfilerSourceRange | null, functionId: string, pc: number): string {
	if (range === null) {
		return `${functionId} @ pc=${pc}`;
	}
	return `${range.path}:${range.start.line}:${range.start.column}`;
}

function sumBaseCycles(counts: ArrayLike<number>): number {
	let total = 0;
	for (let opcode = 0; opcode < counts.length; opcode += 1) {
		total += counts[opcode] * BASE_CYCLES[opcode];
	}
	return total;
}

function opcodeCountForPredicate(counts: Uint32Array, predicate: (opcode: number) => boolean): { count: number; cycles: number } {
	let count = 0;
	let cycles = 0;
	for (let opcode = 0; opcode < counts.length; opcode += 1) {
		if (!predicate(opcode) || counts[opcode] === 0) {
			continue;
		}
		count += counts[opcode];
		cycles += counts[opcode] * BASE_CYCLES[opcode];
	}
	return { count, cycles };
}

function collectTopOpcodesFromCounts(counts: Uint32Array, totalInstructions: number, totalBaseCycles: number, limit: number): CpuProfilerHotOpcode[] {
	const rows: CpuProfilerHotOpcode[] = [];
	for (let opcode = 0; opcode < counts.length; opcode += 1) {
		const count = counts[opcode];
		if (count === 0) {
			continue;
		}
		const baseCost = BASE_CYCLES[opcode];
		const cycles = count * baseCost;
		rows.push({
			opcode,
			name: getOpcodeName(opcode as OpCode),
			count,
			percent: percent(count, totalInstructions),
			baseCost,
			cycles,
			cyclePercent: percent(cycles, totalBaseCycles),
			category: OPCODE_CATEGORY[opcode],
		});
	}
	rows.sort((left, right) => {
		if (right.cycles !== left.cycles) {
			return right.cycles - left.cycles;
		}
		if (right.count !== left.count) {
			return right.count - left.count;
		}
		return left.opcode - right.opcode;
	});
	return rows.slice(0, limit);
}

export class CpuExecutionProfiler {
	private totalInstructions = 0;
	private opcodeCounts = new Uint32Array(OPCODE_COUNT);
	private pcCounts = EMPTY_U32;
	private pcByWord = EMPTY_U32;
	private opcodeByWord = EMPTY_U8;
	private functionByWord = EMPTY_I32;
	private functionIds: string[] = [];
	private debugRanges: Array<CpuProfilerSourceRange | null> = [];
	private imageWordOffsets = EMPTY_I32;

	public configureImages(images: ReadonlyArray<CpuProfilerImage>): void {
		let instructionCount = 0;
		let functionCount = 0;
		for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
			instructionCount += images[imageIndex].opcodeByWord.length;
			functionCount += images[imageIndex].functions.length;
		}
		if (this.pcCounts.length !== instructionCount) {
			this.pcCounts = new Uint32Array(instructionCount);
			this.pcByWord = new Uint32Array(instructionCount);
			this.opcodeByWord = new Uint8Array(instructionCount);
			this.functionByWord = new Int32Array(instructionCount);
		}
		if (this.imageWordOffsets.length !== images.length) {
			this.imageWordOffsets = new Int32Array(images.length);
		}
		this.reset();
		this.functionByWord.fill(-1);
		this.functionIds = new Array(functionCount);
		this.debugRanges = new Array<CpuProfilerSourceRange | null>(instructionCount);
		let wordBase = 0;
		let functionBase = 0;
		for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
			const image = images[imageIndex];
			this.imageWordOffsets[imageIndex] = wordBase;
			this.opcodeByWord.set(image.opcodeByWord, wordBase);
			for (let functionIndex = 0; functionIndex < image.functions.length; functionIndex += 1) {
				const fn = image.functions[functionIndex];
				const startWord = wordBase + (fn.codeAddress - image.textAddress) / INSTRUCTION_BYTES;
				const endWord = startWord + fn.codeByteCount / INSTRUCTION_BYTES;
				for (let wordIndex = startWord; wordIndex < endWord; wordIndex += 1) {
					this.functionByWord[wordIndex] = functionBase + functionIndex;
				}
				this.functionIds[functionBase + functionIndex] = image.functionIds[functionIndex];
			}
			for (let localWord = 0; localWord < image.opcodeByWord.length; localWord += 1) {
				this.pcByWord[wordBase + localWord] = image.textAddress + localWord * INSTRUCTION_BYTES;
				this.debugRanges[wordBase + localWord] = image.metadata !== null
					? image.metadata.debugRanges[localWord]
					: null;
			}
			wordBase += image.opcodeByWord.length;
			functionBase += image.functions.length;
		}
	}

	public reset(): void {
		this.totalInstructions = 0;
		this.opcodeCounts.fill(0);
		this.pcCounts.fill(0);
	}

	public record(imageIndex: number, wordIndex: number, opcode: number): void {
		this.totalInstructions += 1;
		this.opcodeCounts[opcode] += 1;
		this.pcCounts[this.imageWordOffsets[imageIndex] + wordIndex] += 1;
	}

	public snapshot(): CpuProfilerSnapshot {
		const totalBaseCycles = sumBaseCycles(this.opcodeCounts);
		return {
			totalInstructions: this.totalInstructions,
			totalBaseCycles,
			opcodeCounts: this.opcodeCounts.slice(),
			pcCounts: this.pcCounts.slice(),
			pcByWord: this.pcByWord.slice(),
			opcodeByWord: this.opcodeByWord.slice(),
			functionByWord: this.functionByWord.slice(),
			functionIds: this.functionIds.slice(),
			debugRanges: this.debugRanges.slice(),
		};
	}
}

export class CpuProfilerSession implements CpuInstructionTrace {
	public readonly profiler = new CpuExecutionProfiler();
	private readonly functionIdsByDomain = new Map<ExecutionDomainId, ReadonlyArray<string>>();
	private readonly metadataByDomain = new Map<ExecutionDomainId, CpuProfilerMetadata | null>();
	private readonly imageIndexes = new Map<Blua32ExecutionImage, number>();
	private enabled = false;

	public constructor(private readonly cpu: CPU) {
	}

	public attachDebugInfo(
		executionDomainId: ExecutionDomainId,
		functionIds: ReadonlyArray<string>,
		metadata: CpuProfilerMetadata | null,
	): void {
		this.functionIdsByDomain.set(executionDomainId, functionIds);
		this.metadataByDomain.set(executionDomainId, metadata);
		if (this.enabled) {
			this.configureImages();
		}
	}

	public enable(): void {
		if (this.enabled) {
			this.profiler.reset();
			return;
		}
		this.configureImages();
		this.cpu.setInstructionTrace(this);
		this.enabled = true;
	}

	public disable(): void {
		if (!this.enabled) {
			return;
		}
		this.cpu.setInstructionTrace(null);
		this.enabled = false;
	}

	public recordInstruction(image: Blua32ExecutionImage, wordIndex: number, opcode: number): void {
		let imageIndex = this.imageIndexes.get(image);
		if (imageIndex === undefined) {
			this.configureImages();
			imageIndex = this.cpu.currentExecutionImages().indexOf(image);
		}
		this.profiler.record(imageIndex, wordIndex, opcode);
	}

	private configureImages(): void {
		const images = this.cpu.currentExecutionImages();
		const descriptors = new Array<CpuProfilerImage>(images.length);
		this.imageIndexes.clear();
		for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
			const image = images[imageIndex];
			this.imageIndexes.set(image, imageIndex);
			const attachedFunctionIds = this.functionIdsByDomain.get(image.executionDomainId);
			let functionIds: ReadonlyArray<string>;
			if (attachedFunctionIds === undefined) {
				const generatedFunctionIds = new Array<string>(image.functions.length);
				for (let functionIndex = 0; functionIndex < image.functions.length; functionIndex += 1) {
					generatedFunctionIds[functionIndex] = `function@${image.functions[functionIndex].address.toString(16)}`;
				}
				functionIds = generatedFunctionIds;
			} else {
				functionIds = attachedFunctionIds;
			}
			const attachedMetadata = this.metadataByDomain.get(image.executionDomainId);
			descriptors[imageIndex] = {
				textAddress: image.layout.header.textAddress,
				functions: image.functions,
				functionIds,
				metadata: attachedMetadata === undefined ? null : attachedMetadata,
				opcodeByWord: buildProfilerOpcodeByWord(image),
			};
		}
		this.profiler.configureImages(descriptors);
	}
}

function buildProfilerOpcodeByWord(image: Blua32ExecutionImage): Uint8Array {
	const opcodeByWord = new Uint8Array(image.decodedWordCount);
	const decodedPages = image.decodedPages;
	for (let pageIndex = 0; pageIndex < decodedPages.length; pageIndex += 1) {
		const page = decodedPages[pageIndex];
		const pageStart = pageIndex << DECODED_PAGE_SHIFT;
		const remainingWords = opcodeByWord.length - pageStart;
		const pageWords = remainingWords < DECODED_PAGE_WORDS ? remainingWords : DECODED_PAGE_WORDS;
		for (let offset = 0; offset < pageWords; offset += 1) {
			opcodeByWord[pageStart + offset] = page.ops[offset];
		}
	}
	return opcodeByWord;
}

export function collectCpuProfilerHotPaths(snapshot: CpuProfilerSnapshot, limit = 16): CpuProfilerHotPath[] {
	const counts = new Map<string, { count: number; cycles: number }>();
	for (let wordIndex = 0; wordIndex < snapshot.pcCounts.length; wordIndex += 1) {
		const count = snapshot.pcCounts[wordIndex];
		if (count === 0) {
			continue;
		}
		const cycles = count * BASE_CYCLES[snapshot.opcodeByWord[wordIndex]];
		const range = snapshot.debugRanges[wordIndex];
		const path = range !== null ? range.path : '<unknown>';
		const entry = counts.get(path);
		if (entry === undefined) {
			counts.set(path, { count, cycles });
			continue;
		}
		entry.count += count;
		entry.cycles += cycles;
	}
	const rows: CpuProfilerHotPath[] = [];
	for (const [path, entry] of counts) {
		rows.push({
			path,
			count: entry.count,
			percent: percent(entry.count, snapshot.totalInstructions),
			cycles: entry.cycles,
			cyclePercent: percent(entry.cycles, snapshot.totalBaseCycles),
		});
	}
	rows.sort((left, right) => {
		if (right.cycles !== left.cycles) {
			return right.cycles - left.cycles;
		}
		if (right.count !== left.count) {
			return right.count - left.count;
		}
		return left.path.localeCompare(right.path);
	});
	return rows.slice(0, limit);
}

export function collectCpuProfilerHotFunctions(snapshot: CpuProfilerSnapshot, limit = 16): CpuProfilerHotFunction[] {
	const functionCount = snapshot.functionIds.length;
	const counts = new Int32Array(functionCount);
	const cycles = new Int32Array(functionCount);
	const paths = new Array<string>(functionCount).fill('<unknown>');
	visitCountedFunctionWords(snapshot, (wordIndex, functionIndex, count) => {
		counts[functionIndex] += count;
		cycles[functionIndex] += count * BASE_CYCLES[snapshot.opcodeByWord[wordIndex]];
		if (paths[functionIndex] === '<unknown>') {
			const range = snapshot.debugRanges[wordIndex];
			if (range !== null) {
				paths[functionIndex] = range.path;
			}
		}
	});
	const rows: CpuProfilerHotFunction[] = [];
	for (let functionIndex = 0; functionIndex < counts.length; functionIndex += 1) {
		const count = counts[functionIndex];
		if (count === 0) {
			continue;
		}
		rows.push({
			functionIndex,
			functionId: snapshot.functionIds[functionIndex],
			path: paths[functionIndex],
			count,
			percent: percent(count, snapshot.totalInstructions),
			cycles: cycles[functionIndex],
			cyclePercent: percent(cycles[functionIndex], snapshot.totalBaseCycles),
		});
	}
	rows.sort((left, right) => {
		if (right.cycles !== left.cycles) {
			return right.cycles - left.cycles;
		}
		if (right.count !== left.count) {
			return right.count - left.count;
		}
		return left.functionId.localeCompare(right.functionId);
	});
	return rows.slice(0, limit);
}

export function collectCpuProfilerCategoryPressure(snapshot: CpuProfilerSnapshot, limit = 12): CpuProfilerCategoryPressure[] {
	const counts = new Map<string, { count: number; cycles: number }>();
	for (let opcode = 0; opcode < snapshot.opcodeCounts.length; opcode += 1) {
		const count = snapshot.opcodeCounts[opcode];
		if (count === 0) {
			continue;
		}
		const cycles = count * BASE_CYCLES[opcode];
		const category = OPCODE_CATEGORY[opcode];
		const entry = counts.get(category);
		if (entry === undefined) {
			counts.set(category, { count, cycles });
			continue;
		}
		entry.count += count;
		entry.cycles += cycles;
	}
	const rows: CpuProfilerCategoryPressure[] = [];
	for (const [category, entry] of counts) {
		rows.push({
			category,
			count: entry.count,
			percent: percent(entry.count, snapshot.totalInstructions),
			cycles: entry.cycles,
			cyclePercent: percent(entry.cycles, snapshot.totalBaseCycles),
			avgCost: entry.cycles / entry.count,
		});
	}
	rows.sort((left, right) => {
		if (right.cycles !== left.cycles) {
			return right.cycles - left.cycles;
		}
		return left.category.localeCompare(right.category);
	});
	return rows.slice(0, limit);
}

export function collectCpuProfilerHotPcs(snapshot: CpuProfilerSnapshot, limit = 32, opcodeFilter = -1): CpuProfilerHotPc[] {
	const rows: CpuProfilerHotPc[] = [];
	for (let wordIndex = 0; wordIndex < snapshot.pcCounts.length; wordIndex += 1) {
		const count = snapshot.pcCounts[wordIndex];
		if (count === 0) {
			continue;
		}
		const opcode = snapshot.opcodeByWord[wordIndex];
		if (opcodeFilter >= 0 && opcode !== opcodeFilter) {
			continue;
		}
		const functionIndex = snapshot.functionByWord[wordIndex];
		rows.push({
			wordIndex,
			pc: snapshot.pcByWord[wordIndex],
			opcode,
				opcodeName: getOpcodeName(opcode as OpCode),
			count,
			percent: percent(count, snapshot.totalInstructions),
			functionIndex,
			functionId: functionIndex >= 0 ? snapshot.functionIds[functionIndex] : '<unknown>',
			range: snapshot.debugRanges[wordIndex],
		});
	}
	rows.sort((left, right) => {
		if (right.count !== left.count) {
			return right.count - left.count;
		}
		return left.wordIndex - right.wordIndex;
	});
	return rows.slice(0, limit);
}

export function collectCpuProfilerPathOpcodePressure(snapshot: CpuProfilerSnapshot, pathLimit = 8, opcodeLimit = 5): CpuProfilerOpcodePressure[] {
	const pathRows = collectCpuProfilerHotPaths(snapshot, pathLimit);
	const countsByPath = new Map<string, Uint32Array>();
	for (let wordIndex = 0; wordIndex < snapshot.pcCounts.length; wordIndex += 1) {
		const count = snapshot.pcCounts[wordIndex];
		if (count === 0) {
			continue;
		}
		const range = snapshot.debugRanges[wordIndex];
		const path = range !== null ? range.path : '<unknown>';
		let counts = countsByPath.get(path);
		if (counts === undefined) {
			counts = new Uint32Array(OPCODE_COUNT);
			countsByPath.set(path, counts);
		}
		counts[snapshot.opcodeByWord[wordIndex]] += count;
	}
	const rows: CpuProfilerOpcodePressure[] = [];
	for (let index = 0; index < pathRows.length; index += 1) {
		const pathRow = pathRows[index];
		const counts = countsByPath.get(pathRow.path);
		if (counts === undefined) {
			continue;
		}
		rows.push({
			label: pathRow.path,
			totalCount: pathRow.count,
			percent: pathRow.percent,
			totalCycles: pathRow.cycles,
			cyclePercent: pathRow.cyclePercent,
			opcodes: collectTopOpcodesFromCounts(counts, snapshot.totalInstructions, snapshot.totalBaseCycles, opcodeLimit),
		});
	}
	return rows;
}

export function collectCpuProfilerFunctionOpcodePressure(snapshot: CpuProfilerSnapshot, functionLimit = 8, opcodeLimit = 5): CpuProfilerOpcodePressure[] {
	const functionRows = collectCpuProfilerHotFunctions(snapshot, functionLimit);
	const countsByFunction = new Array<Uint32Array | null>(snapshot.functionIds.length).fill(null);
	visitCountedFunctionWords(snapshot, (wordIndex, functionIndex, count) => {
		let counts = countsByFunction[functionIndex];
		if (counts === null) {
			counts = new Uint32Array(OPCODE_COUNT);
			countsByFunction[functionIndex] = counts;
		}
		counts[snapshot.opcodeByWord[wordIndex]] += count;
	});
	const rows: CpuProfilerOpcodePressure[] = [];
	for (let index = 0; index < functionRows.length; index += 1) {
		const functionRow = functionRows[index];
		const counts = countsByFunction[functionRow.functionIndex];
		if (counts === null) {
			continue;
		}
		rows.push({
			label: functionRow.functionId,
			totalCount: functionRow.count,
			percent: functionRow.percent,
			totalCycles: functionRow.cycles,
			cyclePercent: functionRow.cyclePercent,
			opcodes: collectTopOpcodesFromCounts(counts, snapshot.totalInstructions, snapshot.totalBaseCycles, opcodeLimit),
		});
	}
	return rows;
}

export function collectCpuProfilerOpcodeGroupFunctions(snapshot: CpuProfilerSnapshot, predicate: (opcode: number) => boolean, limit = 8): CpuProfilerOpcodeGroupFunction[] {
	const functionCount = snapshot.functionIds.length;
	const countsByFunction = new Array<Uint32Array | null>(functionCount).fill(null);
	const paths = new Array<string>(functionCount).fill('<unknown>');
	const totalCyclesByFunction = new Uint32Array(functionCount);
	visitCountedFunctionWords(snapshot, (wordIndex, functionIndex, count) => {
		let counts = countsByFunction[functionIndex];
		if (counts === null) {
			counts = new Uint32Array(OPCODE_COUNT);
			countsByFunction[functionIndex] = counts;
		}
		const opcode = snapshot.opcodeByWord[wordIndex];
		counts[opcode] += count;
		totalCyclesByFunction[functionIndex] += count * BASE_CYCLES[opcode];
		if (paths[functionIndex] === '<unknown>') {
			const range = snapshot.debugRanges[wordIndex];
			if (range !== null) {
				paths[functionIndex] = range.path;
			}
		}
	});
	const rows: CpuProfilerOpcodeGroupFunction[] = [];
	for (let functionIndex = 0; functionIndex < countsByFunction.length; functionIndex += 1) {
		const counts = countsByFunction[functionIndex];
		if (counts === null) {
			continue;
		}
		const group = opcodeCountForPredicate(counts, predicate);
		if (group.count === 0) {
			continue;
		}
		const totalCycles = totalCyclesByFunction[functionIndex];
		rows.push({
			functionIndex,
			functionId: snapshot.functionIds[functionIndex],
			path: paths[functionIndex],
			groupCount: group.count,
			groupCycles: group.cycles,
			totalCycles,
			cyclePercent: percent(group.cycles, snapshot.totalBaseCycles),
			ofFunctionCyclePercent: percent(group.cycles, totalCycles),
		});
	}
	rows.sort((left, right) => {
		if (right.groupCycles !== left.groupCycles) {
			return right.groupCycles - left.groupCycles;
		}
		return left.functionId.localeCompare(right.functionId);
	});
	return rows.slice(0, limit);
}

export function formatCpuProfilerReport(snapshot: CpuProfilerSnapshot, options: CpuProfilerReportOptions = {}): string {
	const topPaths = options.topPaths ?? 16;
	const topFunctions = options.topFunctions ?? 16;
	const topOpcodes = options.topOpcodes ?? 16;
	const topPcs = options.topPcs ?? 32;
	const pathRows = collectCpuProfilerHotPaths(snapshot, topPaths);
	const functionRows = collectCpuProfilerHotFunctions(snapshot, topFunctions);
	const categoryRows = collectCpuProfilerCategoryPressure(snapshot);
	const pathOpcodePressure = collectCpuProfilerPathOpcodePressure(snapshot);
	const functionOpcodePressure = collectCpuProfilerFunctionOpcodePressure(snapshot);
	const closureGroupRows = collectCpuProfilerOpcodeGroupFunctions(snapshot, opcode => opcode === OpCode.CLOSURE);
	const tableGroupRows = collectCpuProfilerOpcodeGroupFunctions(snapshot, opcode =>
		opcode === OpCode.GETT || opcode === OpCode.SETT || opcode === OpCode.GETI || opcode === OpCode.SETI || opcode === OpCode.GETFIELD || opcode === OpCode.SETFIELD || opcode === OpCode.SELF
	);
	const callGroupRows = collectCpuProfilerOpcodeGroupFunctions(snapshot, opcode => opcode === OpCode.CALL || opcode === OpCode.RET);
	const memoryGroupRows = collectCpuProfilerOpcodeGroupFunctions(snapshot, opcode =>
		opcode === OpCode.LOAD_MEM || opcode === OpCode.STORE_MEM || opcode === OpCode.STORE_MEM_WORDS || opcode === OpCode.LOAD_MEM_D || opcode === OpCode.STORE_MEM_D || opcode === OpCode.STORE_MEM_WORDS_D
	);
	const concatGroupRows = collectCpuProfilerOpcodeGroupFunctions(snapshot, opcode => opcode === OpCode.CONCAT || opcode === OpCode.CONCATN);
	const opcodeRows = collectTopOpcodesFromCounts(snapshot.opcodeCounts, snapshot.totalInstructions, snapshot.totalBaseCycles, topOpcodes);
	const pcRows = collectCpuProfilerHotPcs(snapshot, topPcs);
	const lines: string[] = [];
	lines.push('Fantasy CPU Runtime Profile');
	lines.push(`Instructions executed: ${snapshot.totalInstructions}`);
	lines.push(`Estimated base cycles: ${snapshot.totalBaseCycles}`);
	lines.push(`Average base cycles/instruction: ${(snapshot.totalBaseCycles / snapshot.totalInstructions).toFixed(2)}`);
	lines.push('');
	lines.push('Top Paths');
	for (let index = 0; index < pathRows.length; index += 1) {
		const row = pathRows[index];
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.path} instr=${row.count} share=${row.percent.toFixed(2)}% cycles=${row.cycles} cycle_share=${row.cyclePercent.toFixed(2)}%`);
	}
	lines.push('');
	lines.push('Top Functions');
	for (let index = 0; index < functionRows.length; index += 1) {
		const row = functionRows[index];
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.functionId} instr=${row.count} share=${row.percent.toFixed(2)}% cycles=${row.cycles} cycle_share=${row.cyclePercent.toFixed(2)}% path=${row.path}`);
	}
	lines.push('');
	lines.push('Category Pressure');
	for (let index = 0; index < categoryRows.length; index += 1) {
		const row = categoryRows[index];
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.category} instr=${row.count} share=${row.percent.toFixed(2)}% cycles=${row.cycles} cycle_share=${row.cyclePercent.toFixed(2)}% avg=${row.avgCost.toFixed(2)}`);
	}
	lines.push('');
	lines.push('Path Opcode Pressure');
	for (let index = 0; index < pathOpcodePressure.length; index += 1) {
		const row = pathOpcodePressure[index];
		const detail = row.opcodes.map(opcode => `${opcode.name}=${opcode.count}x${opcode.baseCost}=${opcode.cycles}`).join(', ');
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.label} instr=${row.totalCount} share=${row.percent.toFixed(2)}% cycles=${row.totalCycles} cycle_share=${row.cyclePercent.toFixed(2)}% :: ${detail}`);
	}
	lines.push('');
	lines.push('Function Opcode Pressure');
	for (let index = 0; index < functionOpcodePressure.length; index += 1) {
		const row = functionOpcodePressure[index];
		const detail = row.opcodes.map(opcode => `${opcode.name}=${opcode.count}x${opcode.baseCost}=${opcode.cycles}`).join(', ');
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.label} instr=${row.totalCount} share=${row.percent.toFixed(2)}% cycles=${row.totalCycles} cycle_share=${row.cyclePercent.toFixed(2)}% :: ${detail}`);
	}
	lines.push('');
	lines.push('Closure-Heavy Functions');
	for (let index = 0; index < closureGroupRows.length; index += 1) {
		const row = closureGroupRows[index];
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.functionId} closures=${row.groupCount} cycles=${row.groupCycles} cycle_share=${row.cyclePercent.toFixed(2)}% of_function=${row.ofFunctionCyclePercent.toFixed(2)}% path=${row.path}`);
	}
	lines.push('');
	lines.push('Table-Access Heavy Functions');
	for (let index = 0; index < tableGroupRows.length; index += 1) {
		const row = tableGroupRows[index];
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.functionId} table_ops=${row.groupCount} cycles=${row.groupCycles} cycle_share=${row.cyclePercent.toFixed(2)}% of_function=${row.ofFunctionCyclePercent.toFixed(2)}% path=${row.path}`);
	}
	lines.push('');
	lines.push('Call/Return Heavy Functions');
	for (let index = 0; index < callGroupRows.length; index += 1) {
		const row = callGroupRows[index];
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.functionId} call_ops=${row.groupCount} cycles=${row.groupCycles} cycle_share=${row.cyclePercent.toFixed(2)}% of_function=${row.ofFunctionCyclePercent.toFixed(2)}% path=${row.path}`);
	}
	lines.push('');
	lines.push('Memory I/O Heavy Functions');
	for (let index = 0; index < memoryGroupRows.length; index += 1) {
		const row = memoryGroupRows[index];
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.functionId} mem_ops=${row.groupCount} cycles=${row.groupCycles} cycle_share=${row.cyclePercent.toFixed(2)}% of_function=${row.ofFunctionCyclePercent.toFixed(2)}% path=${row.path}`);
	}
	lines.push('');
	lines.push('Concat-Heavy Functions');
	for (let index = 0; index < concatGroupRows.length; index += 1) {
		const row = concatGroupRows[index];
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.functionId} concat_ops=${row.groupCount} cycles=${row.groupCycles} cycle_share=${row.cyclePercent.toFixed(2)}% of_function=${row.ofFunctionCyclePercent.toFixed(2)}% path=${row.path}`);
	}
	lines.push('');
	lines.push('Hot PCs');
	for (let index = 0; index < pcRows.length; index += 1) {
		const row = pcRows[index];
		lines.push(
			`${String(index + 1).padStart(2, ' ')}. ${row.opcodeName} count=${row.count} share=${row.percent.toFixed(2)}% ` +
			`function=${row.functionId} loc=${formatLocation(row.range, row.functionId, row.pc)}`
		);
	}
	lines.push('');
	lines.push('Opcode Mix');
	for (let index = 0; index < opcodeRows.length; index += 1) {
		const row = opcodeRows[index];
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.name} count=${row.count} share=${row.percent.toFixed(2)}% cost=${row.baseCost} cycles=${row.cycles} cycle_share=${row.cyclePercent.toFixed(2)}% cat=${row.category}`);
	}
	return lines.join('\n');
}
