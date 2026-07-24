import type { SourceRange } from '../../machine/cpu/blua32_symbols';
import type { LocalSlotDebug, ProgramResumePoint } from './program';
import { sourcePositionInRange } from '../semantic/source_range';
import type { Instruction } from './optimizer';
import {
	collectInstructionDefs,
	collectInstructionUses,
	computeInstructionLiveInAt,
} from './optimizer/liveness';

function collectNamedLiveRegisters(
	live: Uint8Array,
	named: Uint8Array,
	localSlots: ReadonlyArray<LocalSlotDebug>,
	path: string,
	line: number,
	column: number,
): number[] | null {
	named.fill(0);
	for (let index = 0; index < localSlots.length; index += 1) {
		const slot = localSlots[index];
		if (slot.scope.path === path && sourcePositionInRange(line, column, slot.scope)) {
			named[slot.registerIndex] = 1;
		}
	}
	const registers: number[] = [];
	for (let register = 0; register < live.length; register += 1) {
		if (live[register] === 0) {
			continue;
		}
		if (named[register] === 0) {
			return null;
		}
		registers.push(register);
	}
	return registers;
}

export function buildProgramResumePoints(
	instructions: Instruction[],
	instructionWordOffsets: number[],
	localSlots: ReadonlyArray<LocalSlotDebug>,
	maxStack: number,
): ProgramResumePoint[] {
	const emittedRanges = new Set<SourceRange>();
	const candidateIndices: number[] = [];
	for (let index = 0; index < instructions.length; index += 1) {
		const range = instructions[index].resumeRange;
		if (range === undefined) {
			continue;
		}
		if (emittedRanges.has(range)) {
			continue;
		}
		emittedRanges.add(range);
		candidateIndices.push(index);
	}
	if (candidateIndices.length === 0) {
		return [];
	}

	const maxRegister = maxStack - 1;
	const liveByCandidate = computeInstructionLiveInAt(instructions, maxRegister, candidateIndices);
	const named = new Uint8Array(maxStack);
	const points: ProgramResumePoint[] = [];
	for (let candidateIndex = 0; candidateIndex < candidateIndices.length; candidateIndex += 1) {
		const instructionIndex = candidateIndices[candidateIndex];
		const instruction = instructions[instructionIndex];
		const range = instruction.resumeRange!;
		const liveRegisters = collectNamedLiveRegisters(
			liveByCandidate[candidateIndex],
			named,
			localSlots,
			range.path,
			range.start.line,
			range.start.column,
		);
		if (liveRegisters === null) {
			continue;
		}
		points.push({
			wordOffset: instructionWordOffsets[instructionIndex],
			range,
			op: instruction.op,
			liveRegisters,
			uses: collectInstructionUses(instruction, maxRegister),
			defs: collectInstructionDefs(instruction, maxRegister),
		});
	}
	return points;
}
