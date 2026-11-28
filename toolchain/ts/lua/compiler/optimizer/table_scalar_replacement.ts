import { ValueMoveKind } from '../../../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../../../machine/ts/spec/blua32/opcode';
import { integerConstant } from '../../number';
import { buildBasicBlocks, buildBlockGraph, isSkipInstruction, remapInstructions } from '../control_flow';
import type { ProgramConstant } from '../program';
import type { Instruction, InstructionSet, OptimizationContext } from './index';
import { computeMaxRegister, createsTable } from './instructions';
import {
	computeBlockLiveOut,
	visitInstructionDefs,
	visitInstructionOpenUpvalueRegisters,
	visitInstructionUses,
} from './liveness';
import {
	constPoolValueForOptimization,
	readImmediateValue,
	loadKConstValueForOptimization,
	replaceWithConst,
	replaceWithMov,
} from './values';

type Scalar =
	| { kind: 'constant'; value: ProgramConstant }
	| { kind: 'register'; index: number; version: number };

type VirtualTable = {
	escaped: boolean;
	// Only a dense sequence has a unique positive-key length boundary.
	length: number | null;
	elements: Map<number, Scalar>;
	fields: Map<number, Scalar>;
	stores: number[];
	loads: Array<{ index: number; value: Scalar }>;
};

type Scan = {
	tables: Array<VirtualTable | undefined>;
	versions: Uint32Array;
	constants: Array<ProgramConstant | undefined>;
	subject: number;
};

function observeTableUse(state: Scan, register: number): void {
	if (register === state.subject) {
		state.subject = -1;
		return;
	}
	const table = state.tables[register];
	if (table !== undefined) table.escaped = true;
}

function redefine(state: Scan, register: number): void {
	state.tables[register] = undefined;
	state.versions[register] += 1;
	state.constants[register] = undefined;
}

function markCapture(captured: Uint8Array, register: number): void {
	captured[register] = 1;
}

function storeScalar(
	instruction: Instruction,
	state: Scan,
	context: OptimizationContext,
	captured: Uint8Array,
): Scalar | undefined {
	const register = instruction.c;
	if (register < 0) {
		const constant = constPoolValueForOptimization(context, -1 - register);
		return constant === null ? undefined : { kind: 'constant', value: constant.value };
	}
	if (captured[register] !== 0) return undefined;
	const value = state.constants[register];
	return value === undefined
		? { kind: 'register', index: register, version: state.versions[register] }
		: { kind: 'constant', value };
}

function updateLength(table: VirtualTable, key: number, scalar: Scalar): void {
	const length = table.length;
	if (length === null || key < 1) return;
	if (scalar.kind !== 'constant') {
		table.length = null;
	} else if (scalar.value === null) {
		if (key < length) table.length = null;
		else if (key === length) table.length = length - 1;
	} else if (key === length + 1) {
		table.length = length + 1;
	} else if (key > length + 1) {
		table.length = null;
	}
}

// Scalar-replace a fresh aggregate whose complete object lifetime is in one
// basic block. Other blocks, calls, captures and unknown operations cannot see
// the virtual object. RHS producers are not removed by this transform.
export function scalarReplacePrivateTables(set: InstructionSet, context: OptimizationContext): InstructionSet {
	const { instructions, ranges } = set;
	if (!instructions.some(createsTable)) return set;
	const maxRegister = computeMaxRegister(instructions);
	const captured = new Uint8Array(maxRegister + 1);
	const resolveClosure = context.getClosureUpvalues;
	for (const instruction of instructions) {
		if (instruction.unknownFunctionBinding) return set;
		visitInstructionOpenUpvalueRegisters(instruction, maxRegister, resolveClosure, captured, markCapture);
	}
	const blocks = buildBasicBlocks(instructions);
	const liveOut = computeBlockLiveOut(instructions, blocks, buildBlockGraph(instructions, blocks).successors, maxRegister, resolveClosure);
	const state: Scan = {
		tables: new Array(maxRegister + 1),
		versions: new Uint32Array(maxRegister + 1),
		constants: new Array(maxRegister + 1),
		subject: -1,
	};
	const candidates: VirtualTable[] = [];
	const nil: Scalar = { kind: 'constant', value: null };
	let keep: boolean[] | undefined;
	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
		const { start, end } = blocks[blockIndex];
		let firstTable = start;
		while (firstTable < end && !createsTable(instructions[firstTable])) firstTable += 1;
		if (firstTable === end) continue;
		state.tables.fill(undefined);
		state.constants.fill(undefined);
		candidates.length = 0;
		for (let index = start; index < end; index += 1) {
			const instruction = instructions[index];
			const { op, a, b } = instruction;
			const copy = op === OpCode.MOV && instruction.c === ValueMoveKind.Copy;
			const fieldRead = op === OpCode.GETI || op === OpCode.GETFIELD;
			const fieldWrite = op === OpCode.SETI || op === OpCode.SETFIELD;
			const previous = index === 0 ? undefined : instructions[index - 1];
			const skipVictim = previous !== undefined && isSkipInstruction(previous);
			const subject = copy || fieldRead || op === OpCode.LEN ? b : fieldWrite ? a : -1;
			const table = subject < 0 ? undefined : state.tables[subject];
			const copiedConstant = copy ? state.constants[b] : undefined;
			state.subject = subject;
			if (candidates.length !== 0) {
				visitInstructionUses(instruction, maxRegister, resolveClosure, state, observeTableUse);
				if (op === OpCode.ITERN) {
					// On the declining edge, prior results can still escape this block.
					visitInstructionDefs(instruction, maxRegister, state, observeTableUse);
				}
			}
			if (table !== undefined && !table.escaped) {
				if (copy) {
					table.escaped = skipVictim || captured[a] !== 0;
					table.stores.push(index);
				} else if (fieldWrite) {
					const value = storeScalar(instruction, state, context, captured);
					if (skipVictim || value === undefined) {
						table.escaped = true;
					} else {
						(op === OpCode.SETI ? table.elements : table.fields).set(b, value);
						if (op === OpCode.SETI) updateLength(table, b, value);
						table.stores.push(index);
					}
				} else {
					const value: Scalar | undefined = fieldRead
						? (op === OpCode.GETI ? table.elements : table.fields).get(instruction.c) ?? nil
						: table.length === null ? undefined : { kind: 'constant', value: integerConstant(table.length) };
					if (value === undefined || (value.kind === 'register' && state.versions[value.index] !== value.version)) {
						table.escaped = true;
					} else {
						table.loads.push({ index, value });
					}
				}
			}
			visitInstructionDefs(instruction, maxRegister, state, redefine);
			if (createsTable(instruction) && !skipVictim && captured[a] === 0) {
				const created: VirtualTable = { escaped: false, length: 0, elements: new Map(), fields: new Map(), stores: [index], loads: [] };
				state.tables[a] = created;
				candidates.push(created);
			} else if (copy) {
				state.tables[a] = table;
				if (captured[a] === 0) state.constants[a] = copiedConstant;
			} else if (captured[a] === 0) {
				const constant = op === OpCode.LOADK
					? loadKConstValueForOptimization(instruction, context)?.value
					: readImmediateValue(instruction);
				if (constant !== undefined) state.constants[a] = constant;
			}
		}
		if (candidates.length === 0) continue;
		for (let register = 0; register <= maxRegister; register += 1) {
			const table = state.tables[register];
			if (table !== undefined && liveOut[blockIndex][register] !== 0) table.escaped = true;
		}
		for (const table of candidates) {
			if (table.escaped) continue;
			keep ??= new Array<boolean>(instructions.length).fill(true);
			for (const index of table.stores) keep[index] = false;
			for (const { index, value } of table.loads) {
				const instruction = instructions[index];
				if (value.kind === 'register') replaceWithMov(instruction, instruction.a, value.index);
				else replaceWithConst(instruction, instruction.a, value.value, context);
			}
		}
	}
	return keep === undefined ? set : remapInstructions(instructions, ranges, keep, true);
}
