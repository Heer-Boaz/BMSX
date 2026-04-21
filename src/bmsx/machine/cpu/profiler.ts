import { BASE_CYCLES, OPCODE_CATEGORY, OPCODE_COUNT, OpCode, getOpcodeName } from './opcode_info';
import { INSTRUCTION_BYTES } from './instruction_format';

export type CpuProfilerSourcePosition = {
	line: number;
	column: number;
};

export type CpuProfilerSourceRange = {
	path: string;
	start: CpuProfilerSourcePosition;
	end: CpuProfilerSourcePosition;
};

export type CpuProfilerProto = {
	entryPC: number;
	codeLen: number;
};

export type CpuProfilerProgram = {
	protos: ReadonlyArray<CpuProfilerProto>;
};

export type CpuProfilerMetadata = {
	debugRanges: ReadonlyArray<CpuProfilerSourceRange | null>;
	protoIds: ReadonlyArray<string>;
};

export type CpuProfilerSnapshot = {
	totalInstructions: number;
	totalBaseCycles: number;
	opcodeCounts: Uint32Array;
	pcCounts: Uint32Array;
	opcodeByWord: Uint8Array;
	protoByWord: Int32Array;
	protoIds: string[];
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

export type CpuProfilerHotProto = {
	protoIndex: number;
	protoId: string;
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

export type CpuProfilerOpcodeGroupProto = {
	protoIndex: number;
	protoId: string;
	path: string;
	groupCount: number;
	groupCycles: number;
	totalCycles: number;
	cyclePercent: number;
	ofProtoCyclePercent: number;
};

export type CpuProfilerHotPc = {
	wordIndex: number;
	pc: number;
	opcode: number;
	opcodeName: string;
	count: number;
	percent: number;
	protoIndex: number;
	protoId: string;
	range: CpuProfilerSourceRange | null;
};

export type CpuProfilerReportOptions = {
	topPaths?: number;
	topProtos?: number;
	topOpcodes?: number;
	topPcs?: number;
};

const EMPTY_U32 = new Uint32Array(0);
const EMPTY_U8 = new Uint8Array(0);
const EMPTY_I32 = new Int32Array(0);

function percent(count: number, total: number): number {
	return total === 0 ? 0 : ((count / total) * 100);
}

function formatLocation(range: CpuProfilerSourceRange | null, protoId: string, pc: number): string {
	if (range === null) {
		return `${protoId} @ pc=${pc}`;
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
			name: getCpuProfilerOpcodeName(opcode),
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

export function getCpuProfilerOpcodeName(opcode: number): string {
	return getOpcodeName(opcode);
}

export class CpuExecutionProfiler {
	private totalInstructions = 0;
	private opcodeCounts = new Uint32Array(OPCODE_COUNT);
	private pcCounts = EMPTY_U32;
	private opcodeByWord = EMPTY_U8;
	private protoByWord = EMPTY_I32;
	private protoIds: string[] = [];
	private debugRanges: Array<CpuProfilerSourceRange | null> = [];

	public configureProgram(program: CpuProfilerProgram, metadata: CpuProfilerMetadata | null, decodedOps: Uint8Array): void {
		const instructionCount = decodedOps.length;
		if (this.pcCounts.length !== instructionCount) {
			this.pcCounts = new Uint32Array(instructionCount);
			this.opcodeByWord = new Uint8Array(instructionCount);
			this.protoByWord = new Int32Array(instructionCount);
		}
		this.reset();
		this.opcodeByWord.set(decodedOps);
		this.protoByWord.fill(-1);
		for (let protoIndex = 0; protoIndex < program.protos.length; protoIndex += 1) {
			const proto = program.protos[protoIndex];
			const startWord = proto.entryPC / INSTRUCTION_BYTES;
			const endWord = (proto.entryPC + proto.codeLen) / INSTRUCTION_BYTES;
			for (let wordIndex = startWord; wordIndex < endWord; wordIndex += 1) {
				this.protoByWord[wordIndex] = protoIndex;
			}
		}
		this.protoIds = new Array(program.protos.length);
		for (let protoIndex = 0; protoIndex < program.protos.length; protoIndex += 1) {
			this.protoIds[protoIndex] = metadata !== null ? metadata.protoIds[protoIndex] : `proto:${protoIndex}`;
		}
		this.debugRanges = new Array<CpuProfilerSourceRange | null>(instructionCount);
		for (let wordIndex = 0; wordIndex < instructionCount; wordIndex += 1) {
			this.debugRanges[wordIndex] = metadata !== null ? metadata.debugRanges[wordIndex] : null;
		}
	}

	public reset(): void {
		this.totalInstructions = 0;
		this.opcodeCounts.fill(0);
		this.pcCounts.fill(0);
	}

	public record(wordIndex: number, opcode: number): void {
		this.totalInstructions += 1;
		this.opcodeCounts[opcode] += 1;
		this.pcCounts[wordIndex] += 1;
	}

	public snapshot(): CpuProfilerSnapshot {
		const totalBaseCycles = sumBaseCycles(this.opcodeCounts);
		return {
			totalInstructions: this.totalInstructions,
			totalBaseCycles,
			opcodeCounts: this.opcodeCounts.slice(),
			pcCounts: this.pcCounts.slice(),
			opcodeByWord: this.opcodeByWord.slice(),
			protoByWord: this.protoByWord.slice(),
			protoIds: this.protoIds.slice(),
			debugRanges: this.debugRanges.slice(),
		};
	}
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

export function collectCpuProfilerHotProtos(snapshot: CpuProfilerSnapshot, limit = 16): CpuProfilerHotProto[] {
	const protoCount = snapshot.protoIds.length;
	const counts = new Int32Array(protoCount);
	const cycles = new Int32Array(protoCount);
	const paths = new Array<string>(protoCount).fill('<unknown>');
	for (let wordIndex = 0; wordIndex < snapshot.pcCounts.length; wordIndex += 1) {
		const count = snapshot.pcCounts[wordIndex];
		if (count === 0) {
			continue;
		}
		const protoIndex = snapshot.protoByWord[wordIndex];
		if (protoIndex < 0) {
			continue;
		}
		counts[protoIndex] += count;
		cycles[protoIndex] += count * BASE_CYCLES[snapshot.opcodeByWord[wordIndex]];
		if (paths[protoIndex] === '<unknown>') {
			const range = snapshot.debugRanges[wordIndex];
			if (range !== null) {
				paths[protoIndex] = range.path;
			}
		}
	}
	const rows: CpuProfilerHotProto[] = [];
	for (let protoIndex = 0; protoIndex < counts.length; protoIndex += 1) {
		const count = counts[protoIndex];
		if (count === 0) {
			continue;
		}
		rows.push({
			protoIndex,
			protoId: snapshot.protoIds[protoIndex],
			path: paths[protoIndex],
			count,
			percent: percent(count, snapshot.totalInstructions),
			cycles: cycles[protoIndex],
			cyclePercent: percent(cycles[protoIndex], snapshot.totalBaseCycles),
		});
	}
	rows.sort((left, right) => {
		if (right.cycles !== left.cycles) {
			return right.cycles - left.cycles;
		}
		if (right.count !== left.count) {
			return right.count - left.count;
		}
		return left.protoId.localeCompare(right.protoId);
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
		const protoIndex = snapshot.protoByWord[wordIndex];
		rows.push({
			wordIndex,
			pc: wordIndex * INSTRUCTION_BYTES,
			opcode,
			opcodeName: getCpuProfilerOpcodeName(opcode),
			count,
			percent: percent(count, snapshot.totalInstructions),
			protoIndex,
			protoId: protoIndex >= 0 ? snapshot.protoIds[protoIndex] : '<unknown>',
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

export function collectCpuProfilerProtoOpcodePressure(snapshot: CpuProfilerSnapshot, protoLimit = 8, opcodeLimit = 5): CpuProfilerOpcodePressure[] {
	const protoRows = collectCpuProfilerHotProtos(snapshot, protoLimit);
	const countsByProto = new Array<Uint32Array | null>(snapshot.protoIds.length).fill(null);
	for (let wordIndex = 0; wordIndex < snapshot.pcCounts.length; wordIndex += 1) {
		const count = snapshot.pcCounts[wordIndex];
		if (count === 0) {
			continue;
		}
		const protoIndex = snapshot.protoByWord[wordIndex];
		if (protoIndex < 0) {
			continue;
		}
		let counts = countsByProto[protoIndex];
		if (counts === null) {
			counts = new Uint32Array(OPCODE_COUNT);
			countsByProto[protoIndex] = counts;
		}
		counts[snapshot.opcodeByWord[wordIndex]] += count;
	}
	const rows: CpuProfilerOpcodePressure[] = [];
	for (let index = 0; index < protoRows.length; index += 1) {
		const protoRow = protoRows[index];
		const counts = countsByProto[protoRow.protoIndex];
		if (counts === null) {
			continue;
		}
		rows.push({
			label: protoRow.protoId,
			totalCount: protoRow.count,
			percent: protoRow.percent,
			totalCycles: protoRow.cycles,
			cyclePercent: protoRow.cyclePercent,
			opcodes: collectTopOpcodesFromCounts(counts, snapshot.totalInstructions, snapshot.totalBaseCycles, opcodeLimit),
		});
	}
	return rows;
}

export function collectCpuProfilerOpcodeGroupProtos(snapshot: CpuProfilerSnapshot, predicate: (opcode: number) => boolean, limit = 8): CpuProfilerOpcodeGroupProto[] {
	const protoCount = snapshot.protoIds.length;
	const countsByProto = new Array<Uint32Array | null>(protoCount).fill(null);
	const paths = new Array<string>(protoCount).fill('<unknown>');
	const totalCyclesByProto = new Uint32Array(protoCount);
	for (let wordIndex = 0; wordIndex < snapshot.pcCounts.length; wordIndex += 1) {
		const count = snapshot.pcCounts[wordIndex];
		if (count === 0) {
			continue;
		}
		const protoIndex = snapshot.protoByWord[wordIndex];
		if (protoIndex < 0) {
			continue;
		}
		let counts = countsByProto[protoIndex];
		if (counts === null) {
			counts = new Uint32Array(OPCODE_COUNT);
			countsByProto[protoIndex] = counts;
		}
		const opcode = snapshot.opcodeByWord[wordIndex];
		counts[opcode] += count;
		totalCyclesByProto[protoIndex] += count * BASE_CYCLES[opcode];
		if (paths[protoIndex] === '<unknown>') {
			const range = snapshot.debugRanges[wordIndex];
			if (range !== null) {
				paths[protoIndex] = range.path;
			}
		}
	}
	const rows: CpuProfilerOpcodeGroupProto[] = [];
	for (let protoIndex = 0; protoIndex < countsByProto.length; protoIndex += 1) {
		const counts = countsByProto[protoIndex];
		if (counts === null) {
			continue;
		}
		const group = opcodeCountForPredicate(counts, predicate);
		if (group.count === 0) {
			continue;
		}
		const totalCycles = totalCyclesByProto[protoIndex];
		rows.push({
			protoIndex,
			protoId: snapshot.protoIds[protoIndex],
			path: paths[protoIndex],
			groupCount: group.count,
			groupCycles: group.cycles,
			totalCycles,
			cyclePercent: percent(group.cycles, snapshot.totalBaseCycles),
			ofProtoCyclePercent: percent(group.cycles, totalCycles),
		});
	}
	rows.sort((left, right) => {
		if (right.groupCycles !== left.groupCycles) {
			return right.groupCycles - left.groupCycles;
		}
		return left.protoId.localeCompare(right.protoId);
	});
	return rows.slice(0, limit);
}

export function formatCpuProfilerReport(snapshot: CpuProfilerSnapshot, options: CpuProfilerReportOptions = {}): string {
	const topPaths = options.topPaths ?? 16;
	const topProtos = options.topProtos ?? 16;
	const topOpcodes = options.topOpcodes ?? 16;
	const topPcs = options.topPcs ?? 32;
	const pathRows = collectCpuProfilerHotPaths(snapshot, topPaths);
	const protoRows = collectCpuProfilerHotProtos(snapshot, topProtos);
	const categoryRows = collectCpuProfilerCategoryPressure(snapshot);
	const pathOpcodePressure = collectCpuProfilerPathOpcodePressure(snapshot);
	const protoOpcodePressure = collectCpuProfilerProtoOpcodePressure(snapshot);
	const closureGroupRows = collectCpuProfilerOpcodeGroupProtos(snapshot, opcode => opcode === OpCode.CLOSURE);
	const tableGroupRows = collectCpuProfilerOpcodeGroupProtos(snapshot, opcode =>
		opcode === OpCode.GETT || opcode === OpCode.SETT || opcode === OpCode.GETI || opcode === OpCode.SETI || opcode === OpCode.GETFIELD || opcode === OpCode.SETFIELD || opcode === OpCode.SELF
	);
	const callGroupRows = collectCpuProfilerOpcodeGroupProtos(snapshot, opcode => opcode === OpCode.CALL || opcode === OpCode.RET);
	const memoryGroupRows = collectCpuProfilerOpcodeGroupProtos(snapshot, opcode =>
		opcode === OpCode.LOAD_MEM || opcode === OpCode.STORE_MEM || opcode === OpCode.STORE_MEM_WORDS
	);
	const concatGroupRows = collectCpuProfilerOpcodeGroupProtos(snapshot, opcode => opcode === OpCode.CONCAT || opcode === OpCode.CONCATN);
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
	lines.push('Top Protos');
	for (let index = 0; index < protoRows.length; index += 1) {
		const row = protoRows[index];
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.protoId} instr=${row.count} share=${row.percent.toFixed(2)}% cycles=${row.cycles} cycle_share=${row.cyclePercent.toFixed(2)}% path=${row.path}`);
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
	lines.push('Proto Opcode Pressure');
	for (let index = 0; index < protoOpcodePressure.length; index += 1) {
		const row = protoOpcodePressure[index];
		const detail = row.opcodes.map(opcode => `${opcode.name}=${opcode.count}x${opcode.baseCost}=${opcode.cycles}`).join(', ');
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.label} instr=${row.totalCount} share=${row.percent.toFixed(2)}% cycles=${row.totalCycles} cycle_share=${row.cyclePercent.toFixed(2)}% :: ${detail}`);
	}
	lines.push('');
	lines.push('Closure-Heavy Protos');
	for (let index = 0; index < closureGroupRows.length; index += 1) {
		const row = closureGroupRows[index];
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.protoId} closures=${row.groupCount} cycles=${row.groupCycles} cycle_share=${row.cyclePercent.toFixed(2)}% of_proto=${row.ofProtoCyclePercent.toFixed(2)}% path=${row.path}`);
	}
	lines.push('');
	lines.push('Table-Access Heavy Protos');
	for (let index = 0; index < tableGroupRows.length; index += 1) {
		const row = tableGroupRows[index];
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.protoId} table_ops=${row.groupCount} cycles=${row.groupCycles} cycle_share=${row.cyclePercent.toFixed(2)}% of_proto=${row.ofProtoCyclePercent.toFixed(2)}% path=${row.path}`);
	}
	lines.push('');
	lines.push('Call/Return Heavy Protos');
	for (let index = 0; index < callGroupRows.length; index += 1) {
		const row = callGroupRows[index];
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.protoId} call_ops=${row.groupCount} cycles=${row.groupCycles} cycle_share=${row.cyclePercent.toFixed(2)}% of_proto=${row.ofProtoCyclePercent.toFixed(2)}% path=${row.path}`);
	}
	lines.push('');
	lines.push('Memory I/O Heavy Protos');
	for (let index = 0; index < memoryGroupRows.length; index += 1) {
		const row = memoryGroupRows[index];
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.protoId} mem_ops=${row.groupCount} cycles=${row.groupCycles} cycle_share=${row.cyclePercent.toFixed(2)}% of_proto=${row.ofProtoCyclePercent.toFixed(2)}% path=${row.path}`);
	}
	lines.push('');
	lines.push('Concat-Heavy Protos');
	for (let index = 0; index < concatGroupRows.length; index += 1) {
		const row = concatGroupRows[index];
		lines.push(`${String(index + 1).padStart(2, ' ')}. ${row.protoId} concat_ops=${row.groupCount} cycles=${row.groupCycles} cycle_share=${row.cyclePercent.toFixed(2)}% of_proto=${row.ofProtoCyclePercent.toFixed(2)}% path=${row.path}`);
	}
	lines.push('');
	lines.push('Hot PCs');
	for (let index = 0; index < pcRows.length; index += 1) {
		const row = pcRows[index];
		lines.push(
			`${String(index + 1).padStart(2, ' ')}. ${row.opcodeName} count=${row.count} share=${row.percent.toFixed(2)}% ` +
			`proto=${row.protoId} loc=${formatLocation(row.range, row.protoId, row.pc)}`
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
