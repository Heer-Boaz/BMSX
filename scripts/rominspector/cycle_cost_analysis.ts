// Fantasy CPU cycle cost analysis for ROM programs.
// Works directly with the Program/Proto bytecode — no text parsing.

import { BASE_CYCLES, OPCODE_CATEGORY, OPCODE_COUNT, OPCODE_NAMES, OpCode } from '../../src/bmsx/emulator/cpu_opcode_info';
import { INSTRUCTION_BYTES, readInstructionWord } from '../../src/bmsx/emulator/instruction_format';

type ProgramProto = {
	entryPC: number;
	codeLen: number;
};

type Program = {
	code: Uint8Array;
	protos: ProgramProto[];
};

type ProgramMetadata = {
	protoIds: string[];
};

// ── Analysis data structures ───────────────────────────────────────────

type ProtoStats = {
	index: number;
	id: string;
	instrCount: number;
	totalBaseCycles: number;
	opCounts: Uint32Array; // per-opcode count within this proto
};

// ── Core analysis ──────────────────────────────────────────────────────

function analyzeProgram(program: Program, metadata: ProgramMetadata | null): {
	protos: ProtoStats[];
	globalOpCount: Uint32Array;
	globalOpCycles: Float64Array;
	totalInstructions: number;
	totalBaseCycles: number;
} {
	const code = program.code;
	const protos: ProtoStats[] = [];
	const globalOpCount = new Uint32Array(OPCODE_COUNT);
	const globalOpCycles = new Float64Array(OPCODE_COUNT);
	let totalInstructions = 0;
	let totalBaseCycles = 0;

	for (let pi = 0; pi < program.protos.length; pi += 1) {
		const proto = program.protos[pi];
		const id = metadata ? metadata.protoIds[pi] : `proto_${pi}`;
		const opCounts = new Uint32Array(OPCODE_COUNT);
		let protoInstrCount = 0;
		let protoBaseCycles = 0;

		const startWord = proto.entryPC / INSTRUCTION_BYTES;
		const endWord = (proto.entryPC + proto.codeLen) / INSTRUCTION_BYTES;

		for (let wi = startWord; wi < endWord; wi += 1) {
			const instr = readInstructionWord(code, wi);
			const op = (instr >>> 18) & 0x3f;
			if (op === OpCode.WIDE) continue; // WIDE prefix: cost 0, not a real instruction
			const cost = BASE_CYCLES[op];
			opCounts[op] += 1;
			globalOpCount[op] += 1;
			globalOpCycles[op] += cost;
			protoInstrCount += 1;
			protoBaseCycles += cost;
		}

		protos.push({ index: pi, id, instrCount: protoInstrCount, totalBaseCycles: protoBaseCycles, opCounts });
		totalInstructions += protoInstrCount;
		totalBaseCycles += protoBaseCycles;
	}

	return { protos, globalOpCount, globalOpCycles, totalInstructions, totalBaseCycles };
}

// ── Formatting helpers ─────────────────────────────────────────────────

const SEP = '─'.repeat(100);
const BANNER = '='.repeat(100);
const pct = (part: number, whole: number) => ((part / whole) * 100).toFixed(1) + '%';
const shortId = (id: string, max = 80) => id.length > max ? id.slice(0, max - 3) + '...' : id;

function opCountForCategory(opCounts: Uint32Array, predicate: (op: number) => boolean): { count: number; cycles: number } {
	let count = 0;
	let cycles = 0;
	for (let op = 0; op < OPCODE_COUNT; op += 1) {
		if (predicate(op) && opCounts[op] > 0) {
			count += opCounts[op];
			cycles += opCounts[op] * BASE_CYCLES[op];
		}
	}
	return { count, cycles };
}

// ── Report generation ──────────────────────────────────────────────────

export function generateCycleCostReport(program: Program, metadata: ProgramMetadata | null): string {
	const { protos, globalOpCount, globalOpCycles, totalInstructions, totalBaseCycles } = analyzeProgram(program, metadata);
	const lines: string[] = [];
	const w = (s: string) => lines.push(s);

	w(BANNER);
	w('Fantasy CPU Cycle Cost Analysis');
	w(BANNER);
	w('');
	w(`Total protos: ${protos.length}`);
	w(`Total instructions: ${totalInstructions}`);
	w(`Total base cycles (static): ${totalBaseCycles}`);
	w(`Average cycles/instruction: ${(totalBaseCycles / totalInstructions).toFixed(2)}`);
	w('');

	// ── Section 1: Instruction frequency ───────────────────────────
	w(SEP);
	w('INSTRUCTION FREQUENCY & CYCLE COST (sorted by total cycles descending)');
	w(SEP);
	w('');

	const opEntries: { op: number; name: string; count: number; cost: number; cycles: number }[] = [];
	for (let op = 0; op < OPCODE_COUNT; op += 1) {
		if (globalOpCount[op] > 0) {
			opEntries.push({ op, name: OPCODE_NAMES[op], count: globalOpCount[op], cost: BASE_CYCLES[op], cycles: globalOpCycles[op] });
		}
	}
	opEntries.sort((a, b) => b.cycles - a.cycles);

	w(
		'Opcode'.padEnd(20) +
		'Count'.padStart(8) +
		'BaseCost'.padStart(10) +
		'TotalCycles'.padStart(14) +
		'%Cycles'.padStart(10) +
		'%Instrs'.padStart(10) +
		'  Category'
	);
	for (const e of opEntries) {
		w(
			e.name.padEnd(20) +
			String(e.count).padStart(8) +
			String(e.cost).padStart(10) +
			String(e.cycles).padStart(14) +
			pct(e.cycles, totalBaseCycles).padStart(10) +
			pct(e.count, totalInstructions).padStart(10) +
			'  ' + OPCODE_CATEGORY[e.op]
		);
	}

	// ── Section 2: Category aggregation ────────────────────────────
	w('');
	w(SEP);
	w('CYCLE COST BY CATEGORY (sorted by total cycles descending)');
	w(SEP);
	w('');

	const catMap = new Map<string, { count: number; cycles: number }>();
	for (const e of opEntries) {
		const cat = OPCODE_CATEGORY[e.op];
		const existing = catMap.get(cat);
		if (existing) {
			existing.count += e.count;
			existing.cycles += e.cycles;
		} else {
			catMap.set(cat, { count: e.count, cycles: e.cycles });
		}
	}
	const catEntries = [...catMap.entries()].sort((a, b) => b[1].cycles - a[1].cycles);

	w(
		'Category'.padEnd(25) +
		'Count'.padStart(8) +
		'TotalCycles'.padStart(14) +
		'%Cycles'.padStart(10) +
		'AvgCost'.padStart(10)
	);
	for (const [cat, { count, cycles }] of catEntries) {
		w(
			cat.padEnd(25) +
			String(count).padStart(8) +
			String(cycles).padStart(14) +
			pct(cycles, totalBaseCycles).padStart(10) +
			(cycles / count).toFixed(2).padStart(10)
		);
	}

	// ── Section 3: Top protos by static cycle cost ─────────────────
	w('');
	w(SEP);
	w('TOP 40 PROTOS BY STATIC BASE CYCLE COST (potential hotspots if called frequently)');
	w(SEP);
	w('');

	const sortedProtos = [...protos].sort((a, b) => b.totalBaseCycles - a.totalBaseCycles);
	w(
		'#'.padStart(4) +
		'Proto'.padStart(7) +
		'Instrs'.padStart(8) +
		'Cycles'.padStart(10) +
		'Avg'.padStart(7) +
		'  ID'
	);
	for (let i = 0; i < Math.min(40, sortedProtos.length); i += 1) {
		const p = sortedProtos[i];
		w(
			String(i + 1).padStart(4) +
			String(p.index).padStart(7) +
			String(p.instrCount).padStart(8) +
			String(p.totalBaseCycles).padStart(10) +
			(p.totalBaseCycles / p.instrCount).toFixed(1).padStart(7) +
			'  ' + shortId(p.id)
		);
	}

	// ── Section 4: Highest avg cycle cost per instruction ──────────
	w('');
	w(SEP);
	w('TOP 30 PROTOS BY HIGHEST AVG CYCLE COST PER INSTRUCTION (>=5 instructions)');
	w(SEP);
	w('');

	const sortedByAvg = protos.filter(p => p.instrCount >= 5)
		.sort((a, b) => (b.totalBaseCycles / b.instrCount) - (a.totalBaseCycles / a.instrCount));
	w(
		'#'.padStart(4) +
		'Proto'.padStart(7) +
		'Instrs'.padStart(8) +
		'Cycles'.padStart(10) +
		'Avg'.padStart(7) +
		'  ID'
	);
	for (let i = 0; i < Math.min(30, sortedByAvg.length); i += 1) {
		const p = sortedByAvg[i];
		w(
			String(i + 1).padStart(4) +
			String(p.index).padStart(7) +
			String(p.instrCount).padStart(8) +
			String(p.totalBaseCycles).padStart(10) +
			(p.totalBaseCycles / p.instrCount).toFixed(1).padStart(7) +
			'  ' + shortId(p.id)
		);
	}

	// ── Helper for per-opcode-group top-N tables ───────────────────
	const printOpcodeGroupTable = (
		title: string,
		predicate: (op: number) => boolean,
		topN: number,
		countLabel: string,
		cyclesLabel: string,
		pctLabel: string,
	) => {
		w('');
		w(SEP);
		w(title);
		w(SEP);
		w('');
		const ranked = protos
			.map(p => {
				const { count, cycles } = opCountForCategory(p.opCounts, predicate);
				return { ...p, groupCount: count, groupCycles: cycles };
			})
			.filter(p => p.groupCount > 0)
			.sort((a, b) => b.groupCycles - a.groupCycles);
		w(
			'#'.padStart(4) +
			'Proto'.padStart(7) +
			countLabel.padStart(10) +
			cyclesLabel.padStart(12) +
			'TotalCyc'.padStart(10) +
			pctLabel.padStart(10) +
			'  ID'
		);
		for (let i = 0; i < Math.min(topN, ranked.length); i += 1) {
			const p = ranked[i];
			w(
				String(i + 1).padStart(4) +
				String(p.index).padStart(7) +
				String(p.groupCount).padStart(10) +
				String(p.groupCycles).padStart(12) +
				String(p.totalBaseCycles).padStart(10) +
				pct(p.groupCycles, p.totalBaseCycles).padStart(10) +
				'  ' + shortId(p.id, 70)
			);
		}
	};

	// ── Section 5: Closure-heavy protos ────────────────────────────
	printOpcodeGroupTable(
		'TOP 20 PROTOS WITH MOST CLOSURE INSTRUCTIONS',
		op => op === OpCode.CLOSURE, 20,
		'CLOSUREs', 'ClosureCyc', '%Closure',
	);

	// ── Section 6: Table access heavy protos ───────────────────────
	printOpcodeGroupTable(
		'TOP 20 PROTOS WITH MOST TABLE ACCESS CYCLES (generic + specialized table ops)',
		op => op === OpCode.GETT || op === OpCode.SETT || op === OpCode.GETI || op === OpCode.SETI || op === OpCode.GETFIELD || op === OpCode.SETFIELD || op === OpCode.SELF, 20,
		'TableOps', 'TblCycles', '%Table',
	);

	// ── Section 7: CALL-heavy protos ───────────────────────────────
	printOpcodeGroupTable(
		'TOP 20 PROTOS WITH MOST CALL+RET CYCLES',
		op => op === OpCode.CALL || op === OpCode.RET, 20,
		'Call/Ret', 'CallCycles', '%Call',
	);

	// ── Section 8: Memory I/O heavy protos ─────────────────────────
	printOpcodeGroupTable(
		'TOP 20 PROTOS WITH MOST MEMORY I/O',
		op => op === OpCode.LOAD_MEM || op === OpCode.STORE_MEM || op === OpCode.STORE_MEM_WORDS, 20,
		'MemOps', 'MemCycles', '%Mem',
	);

	// ── Section 9: CONCAT heavy protos ─────────────────────────────
	printOpcodeGroupTable(
		'TOP 15 PROTOS WITH MOST STRING CONCAT CYCLES',
		op => op === OpCode.CONCAT || op === OpCode.CONCATN, 15,
		'ConcatOps', 'ConcatCyc', '%Concat',
	);

	// ── Section 10: Summary ────────────────────────────────────────
	w('');
	w(BANNER);
	w('SUMMARY: FANTASY CPU BOTTLENECK ANALYSIS');
	w(BANNER);
	w('');

	w('Top 5 opcodes consuming the most fantasy CPU cycles:');
	for (let i = 0; i < Math.min(5, opEntries.length); i += 1) {
		const e = opEntries[i];
		w(`  ${i + 1}. ${e.name}: ${e.count} occurrences x ${e.cost} cycles = ${e.cycles} cycles (${pct(e.cycles, totalBaseCycles)})`);
	}
	w('');

	w('Top 3 categories consuming the most fantasy CPU cycles:');
	for (let i = 0; i < Math.min(3, catEntries.length); i += 1) {
		const [cat, { cycles }] = catEntries[i];
		w(`  ${i + 1}. ${cat}: ${cycles} cycles (${pct(cycles, totalBaseCycles)})`);
	}
	w('');

	w('NOTE: These are STATIC costs from the current flat-cost ISA.');
	w('Only a small number of dynamic add-ons remain visible in runtime execution:');
	w('  - Native CALL: +native tier cost (0, 1, 2, or 4)');
	w('  - STORE_MEM_WORDS: +ceil(wordCount/4)');
	w('');
	w('Runtime hotspots depend on call frequency. Protos inside tight update loops');
	w('(e.g. per-frame tick, physics step, render prep) multiply their static cost');
	w('by invocation count.');

	return lines.join('\n');
}
