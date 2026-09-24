import type { SourceRange } from '../source_range';
import type {
	OuterBindingDebug,
	InlineCallSite,
	LocalSlotDebug,
	LocatedLocalSlotDebug,
	LocatedOuterBindingDebug,
	ProgramResumePoint,
	ProgramStatementPoint,
} from './program';
import type { ProgramWordRange } from './word_range';
import { resolveInlineLocalContextRange, ROOT_INLINE_CALL_SITES } from './inline_debug';
import { sourcePositionInRange } from '../semantic/source_range';
import type { Instruction } from './optimizer';
import {
	collectInstructionDefs,
	collectInstructionUses,
	computeInstructionLivenessAt,
	type ClosureUpvalueResolver,
} from './optimizer/liveness';

function collectResumeLiveRegisters(
	live: Uint8Array,
	named: Uint8Array,
	localSlots: ReadonlyArray<LocalSlotDebug>,
	currentRange: SourceRange,
	currentInlineCallSites: ReadonlyArray<InlineCallSite>,
	generated: boolean,
): number[] | null {
	named.fill(0);
	for (let index = 0; index < localSlots.length; index += 1) {
		const slot = localSlots[index];
		const contextRange = resolveInlineLocalContextRange(
			slot,
			currentRange,
			currentInlineCallSites,
		);
		if (contextRange !== null
			&& slot.scope.path === contextRange.path
			&& sourcePositionInRange(contextRange.start.line, contextRange.start.column, slot.scope)) {
			named[slot.registerIndex] = 1;
		}
	}
	const registers: number[] = [];
	for (let register = 0; register < live.length; register += 1) {
		if (live[register] === 0) {
			continue;
		}
		if (!generated && named[register] === 0) {
			return null;
		}
		registers.push(register);
	}
	return registers;
}

export function buildProgramStatementPoints(
	instructions: Instruction[],
	instructionWordOffsets: number[],
): ProgramStatementPoint[] {
	const emittedRanges = new Set<SourceRange>();
	const points: ProgramStatementPoint[] = [];
	for (let index = 0; index < instructions.length; index += 1) {
		const range = instructions[index].statementRange;
		if (range === undefined || emittedRanges.has(range)) {
			continue;
		}
		emittedRanges.add(range);
		const inlineCallSites = instructions[index].inlineCallSites ?? ROOT_INLINE_CALL_SITES;
		points.push({
			wordOffset: instructionWordOffsets[index],
			range,
			inlineCallSites,
		});
	}
	return points;
}

export function buildProgramDebugPoints(
	instructions: Instruction[],
	instructionWordOffsets: number[],
	wordCount: number,
	localSlots: ReadonlyArray<LocalSlotDebug>,
	maxStack: number,
	resolveClosureUpvalues: ClosureUpvalueResolver,
	outerBindings: ReadonlyArray<OuterBindingDebug>,
): { resumePoints: ProgramResumePoint[]; localSlots: LocatedLocalSlotDebug[]; outerBindings: LocatedOuterBindingDebug[] } {
	// Named registers are not recycled within a function; inlining remaps its
	// slots before this final pass. Dead/folded values have no readable location.
	// Reuse the resume-point liveness pass, retaining intervals, not a bitmap
	// for every instruction. Lexical/inline scope is a separate debugger gate.
	const rangesByRegister = new Map<number, ProgramWordRange[]>();
	for (const slot of localSlots) if (!rangesByRegister.has(slot.registerIndex)) rangesByRegister.set(slot.registerIndex, []);
	for (const slot of outerBindings) {
		const location = slot.location;
		if (location !== null && location.inStack && !rangesByRegister.has(location.index)) rangesByRegister.set(location.index, []);
	}
	const registers: number[] = [];
	const locations: ProgramWordRange[][] = [];
	for (const [register, ranges] of rangesByRegister) {
		// Folding after inlining can remove the high end of the remapped frame.
		// Those declarations keep empty intervals, outside the physical window.
		if (register < maxStack) {
			registers.push(register);
			locations.push(ranges);
		}
	}
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
	const maxRegister = maxStack - 1;
	const liveByCandidate = computeInstructionLivenessAt(
		instructions,
		maxRegister,
		candidateIndices,
		resolveClosureUpvalues,
		'in',
		registers.length === 0 ? undefined : (instructionIndex, live) => {
			const start = instructionWordOffsets[instructionIndex];
			const end = instructionIndex + 1 < instructions.length ? instructionWordOffsets[instructionIndex + 1] : wordCount;
			for (let index = 0; index < registers.length; index += 1) {
				if (live[registers[index]] === 0) continue;
				const ranges = locations[index];
				const previous = ranges[ranges.length - 1];
				if (previous !== undefined && previous.start === end) previous.start = start;
				else ranges.push({ start, end });
			}
		},
	);
	const named = new Uint8Array(maxStack);
	const points: ProgramResumePoint[] = [];
	for (let candidateIndex = 0; candidateIndex < candidateIndices.length; candidateIndex += 1) {
		const instructionIndex = candidateIndices[candidateIndex];
		const instruction = instructions[instructionIndex];
		const range = instruction.resumeRange!;
		const inlineCallSites = instruction.inlineCallSites ?? ROOT_INLINE_CALL_SITES;
		// Generated continuation roles own their temporary-register ABI. Authored
		// points can retain only registers with a provable lexical identity.
		const liveRegisters = collectResumeLiveRegisters(
			liveByCandidate[candidateIndex],
			named,
			localSlots,
			range,
			inlineCallSites,
			instruction.resumeId !== undefined,
		);
		if (liveRegisters === null) {
			continue;
		}
		points.push({
			resumeId: instruction.resumeId,
			wordOffset: instructionWordOffsets[instructionIndex],
			range,
			op: instruction.op,
			liveRegisters,
			uses: collectInstructionUses(instruction, maxRegister, resolveClosureUpvalues),
			defs: collectInstructionDefs(instruction, maxRegister),
			inlineCallSites,
		});
	}
	for (const ranges of locations) ranges.reverse();
	const functionRange = [{ start: 0, end: wordCount }];
	const noLocation: readonly ProgramWordRange[] = [];
	return {
		resumePoints: points,
		localSlots: localSlots.map(slot => ({ ...slot, liveWordRanges: rangesByRegister.get(slot.registerIndex)! })),
		outerBindings: outerBindings.map(slot => ({
			...slot,
			liveWordRanges: slot.location === null ? noLocation
				: slot.location.inStack ? rangesByRegister.get(slot.location.index)! : functionRange,
		})),
	};
}
