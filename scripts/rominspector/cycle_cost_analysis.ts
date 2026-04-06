// Fantasy CPU cycle cost analysis for ROM programs.
// Works directly with the Program/Proto bytecode — no text parsing.

import { OpCode, type Program, type ProgramMetadata } from '../../src/bmsx/emulator/cpu';
import { INSTRUCTION_BYTES, readInstructionWord } from '../../src/bmsx/emulator/instruction_format';

// ── Opcode name table ──────────────────────────────────────────────────

const OPCODE_NAMES: string[] = (() => {
	const names = new Array<string>(64).fill('???');
	names[OpCode.WIDE] = 'WIDE';
	names[OpCode.MOV] = 'MOV';
	names[OpCode.LOADK] = 'LOADK';
	names[OpCode.LOADNIL] = 'LOADNIL';
	names[OpCode.LOADBOOL] = 'LOADBOOL';
	names[OpCode.KNIL] = 'KNIL';
	names[OpCode.KFALSE] = 'KFALSE';
	names[OpCode.KTRUE] = 'KTRUE';
	names[OpCode.K0] = 'K0';
	names[OpCode.K1] = 'K1';
	names[OpCode.KM1] = 'KM1';
	names[OpCode.KSMI] = 'KSMI';
	names[OpCode.GETG] = 'GETG';
	names[OpCode.SETG] = 'SETG';
	names[OpCode.GETT] = 'GETT';
	names[OpCode.SETT] = 'SETT';
	names[OpCode.NEWT] = 'NEWT';
	names[OpCode.ADD] = 'ADD';
	names[OpCode.SUB] = 'SUB';
	names[OpCode.MUL] = 'MUL';
	names[OpCode.DIV] = 'DIV';
	names[OpCode.MOD] = 'MOD';
	names[OpCode.FLOORDIV] = 'FLOORDIV';
	names[OpCode.POW] = 'POW';
	names[OpCode.BAND] = 'BAND';
	names[OpCode.BOR] = 'BOR';
	names[OpCode.BXOR] = 'BXOR';
	names[OpCode.SHL] = 'SHL';
	names[OpCode.SHR] = 'SHR';
	names[OpCode.CONCAT] = 'CONCAT';
	names[OpCode.CONCATN] = 'CONCATN';
	names[OpCode.UNM] = 'UNM';
	names[OpCode.NOT] = 'NOT';
	names[OpCode.LEN] = 'LEN';
	names[OpCode.BNOT] = 'BNOT';
	names[OpCode.EQ] = 'EQ';
	names[OpCode.LT] = 'LT';
	names[OpCode.LE] = 'LE';
	names[OpCode.TEST] = 'TEST';
	names[OpCode.TESTSET] = 'TESTSET';
	names[OpCode.JMP] = 'JMP';
	names[OpCode.JMPIF] = 'JMPIF';
	names[OpCode.JMPIFNOT] = 'JMPIFNOT';
	names[OpCode.CLOSURE] = 'CLOSURE';
	names[OpCode.GETUP] = 'GETUP';
	names[OpCode.SETUP] = 'SETUP';
	names[OpCode.VARARG] = 'VARARG';
	names[OpCode.CALL] = 'CALL';
	names[OpCode.RET] = 'RET';
	names[OpCode.LOAD_MEM] = 'LOAD_MEM';
	names[OpCode.STORE_MEM] = 'STORE_MEM';
	names[OpCode.STORE_MEM_WORDS] = 'STORE_MEM_WORDS';
	names[OpCode.BR_TRUE] = 'BR_TRUE';
	names[OpCode.BR_FALSE] = 'BR_FALSE';
	names[OpCode.GETSYS] = 'GETSYS';
	names[OpCode.SETSYS] = 'SETSYS';
	names[OpCode.GETGL] = 'GETGL';
	names[OpCode.SETGL] = 'SETGL';
	names[OpCode.GETI] = 'GETI';
	names[OpCode.SETI] = 'SETI';
	names[OpCode.GETFIELD] = 'GETFIELD';
	names[OpCode.SETFIELD] = 'SETFIELD';
	names[OpCode.SELF] = 'SELF';
	return names;
})();

// ── Base cycle costs (mirrors cpu.ts BASE_CYCLES) ──────────────────────

const BASE_CYCLES = new Uint8Array(64);
BASE_CYCLES.fill(1);

BASE_CYCLES[OpCode.WIDE] = 0;
BASE_CYCLES[OpCode.MOV] = 1;
BASE_CYCLES[OpCode.LOADK] = 1;
BASE_CYCLES[OpCode.LOADBOOL] = 1;
BASE_CYCLES[OpCode.LOADNIL] = 1;
BASE_CYCLES[OpCode.KNIL] = 1;
BASE_CYCLES[OpCode.KFALSE] = 1;
BASE_CYCLES[OpCode.KTRUE] = 1;
BASE_CYCLES[OpCode.K0] = 1;
BASE_CYCLES[OpCode.K1] = 1;
BASE_CYCLES[OpCode.KM1] = 1;
BASE_CYCLES[OpCode.KSMI] = 1;
BASE_CYCLES[OpCode.GETG] = 1;
BASE_CYCLES[OpCode.SETG] = 2;
BASE_CYCLES[OpCode.GETT] = 1;
BASE_CYCLES[OpCode.SETT] = 2;
BASE_CYCLES[OpCode.NEWT] = 1;
BASE_CYCLES[OpCode.CONCATN] = 2;
BASE_CYCLES[OpCode.TESTSET] = 2;
BASE_CYCLES[OpCode.CLOSURE] = 1;
BASE_CYCLES[OpCode.GETUP] = 1;
BASE_CYCLES[OpCode.SETUP] = 2;
BASE_CYCLES[OpCode.VARARG] = 2;
BASE_CYCLES[OpCode.CALL] = 2;
BASE_CYCLES[OpCode.RET] = 2;
BASE_CYCLES[OpCode.LOAD_MEM] = 1;
BASE_CYCLES[OpCode.STORE_MEM] = 2;
BASE_CYCLES[OpCode.STORE_MEM_WORDS] = 2;
BASE_CYCLES[OpCode.GETSYS] = 1;
BASE_CYCLES[OpCode.SETSYS] = 2;
BASE_CYCLES[OpCode.GETGL] = 1;
BASE_CYCLES[OpCode.SETGL] = 2;
BASE_CYCLES[OpCode.GETI] = 1;
BASE_CYCLES[OpCode.SETI] = 2;
BASE_CYCLES[OpCode.GETFIELD] = 1;
BASE_CYCLES[OpCode.SETFIELD] = 2;
BASE_CYCLES[OpCode.SELF] = 1;

// ── Opcode category mapping ────────────────────────────────────────────

const OPCODE_CATEGORY: string[] = new Array<string>(64).fill('?');
for (const op of [OpCode.MOV, OpCode.LOADK, OpCode.LOADBOOL, OpCode.LOADNIL, OpCode.KNIL, OpCode.KFALSE, OpCode.KTRUE, OpCode.K0, OpCode.K1, OpCode.KM1, OpCode.KSMI]) OPCODE_CATEGORY[op] = 'load/move';
for (const op of [OpCode.GETG, OpCode.SETG, OpCode.GETT, OpCode.SETT, OpCode.GETI, OpCode.SETI, OpCode.GETFIELD, OpCode.SETFIELD, OpCode.SELF]) OPCODE_CATEGORY[op] = 'table get/set';
for (const op of [OpCode.GETGL, OpCode.SETGL, OpCode.GETSYS, OpCode.SETSYS]) OPCODE_CATEGORY[op] = 'global/sys access';
for (const op of [OpCode.GETUP, OpCode.SETUP]) OPCODE_CATEGORY[op] = 'upvalue';
for (const op of [OpCode.ADD, OpCode.SUB, OpCode.MUL, OpCode.DIV, OpCode.MOD, OpCode.FLOORDIV, OpCode.POW, OpCode.UNM]) OPCODE_CATEGORY[op] = 'arithmetic';
for (const op of [OpCode.BAND, OpCode.BOR, OpCode.BXOR, OpCode.SHL, OpCode.SHR, OpCode.BNOT]) OPCODE_CATEGORY[op] = 'bitwise';
for (const op of [OpCode.CONCAT, OpCode.CONCATN]) OPCODE_CATEGORY[op] = 'string concat';
for (const op of [OpCode.EQ, OpCode.LT, OpCode.LE, OpCode.TEST, OpCode.TESTSET]) OPCODE_CATEGORY[op] = 'comparison';
for (const op of [OpCode.JMP, OpCode.JMPIF, OpCode.JMPIFNOT, OpCode.BR_TRUE, OpCode.BR_FALSE]) OPCODE_CATEGORY[op] = 'branch/jump';
for (const op of [OpCode.CALL, OpCode.RET]) OPCODE_CATEGORY[op] = 'call/return';
OPCODE_CATEGORY[OpCode.CLOSURE] = 'closure creation';
OPCODE_CATEGORY[OpCode.NEWT] = 'table creation';
OPCODE_CATEGORY[OpCode.LEN] = 'length';
OPCODE_CATEGORY[OpCode.NOT] = 'logical';
OPCODE_CATEGORY[OpCode.VARARG] = 'vararg';
for (const op of [OpCode.LOAD_MEM, OpCode.STORE_MEM, OpCode.STORE_MEM_WORDS]) OPCODE_CATEGORY[op] = 'memory I/O';
OPCODE_CATEGORY[OpCode.WIDE] = 'wide prefix';

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
	const globalOpCount = new Uint32Array(64);
	const globalOpCycles = new Float64Array(64);
	let totalInstructions = 0;
	let totalBaseCycles = 0;

	for (let pi = 0; pi < program.protos.length; pi += 1) {
		const proto = program.protos[pi];
		const id = metadata ? metadata.protoIds[pi] : `proto_${pi}`;
		const opCounts = new Uint32Array(64);
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
	for (let op = 0; op < 64; op += 1) {
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
	for (let op = 0; op < 64; op += 1) {
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
