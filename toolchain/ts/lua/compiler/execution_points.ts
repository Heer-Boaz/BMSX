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
import type { FrameSlotAllocation } from './optimizer/frame_slots';
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
	sourceRanges: ReadonlyArray<SourceRange | null>,
	instructionWordOffsets: number[],
	wordCount: number,
	localSlots: ReadonlyArray<LocalSlotDebug>,
	maxStack: number,
	resolveClosureUpvalues: ClosureUpvalueResolver,
	outerBindings: ReadonlyArray<OuterBindingDebug>,
	allocation?: FrameSlotAllocation,
	physicalRegisterBase = 0,
	selectedLiveRegisters?: Map<number, readonly number[]>,
): { resumePoints: ProgramResumePoint[]; localSlots: LocatedLocalSlotDebug[]; outerBindings: LocatedOuterBindingDebug[] } {
	// Liveness before slot assignment supplies the intervals. When a slot has several
	// lexical owners, intersect it with each owner's source/inline scope.
	const rangesByRegister = new Map<number, ProgramWordRange[]>();
	const ownersByRegister = new Map<number, LocalSlotDebug[]>();
	const reusedRanges = new Map<LocalSlotDebug, ProgramWordRange[]>();
	for (const slot of localSlots) {
		const owners = ownersByRegister.get(slot.registerIndex);
		if (owners === undefined) {
			ownersByRegister.set(slot.registerIndex, [slot]);
			rangesByRegister.set(slot.registerIndex, []);
		} else {
			if (owners.length === 1) reusedRanges.set(owners[0], []);
			owners.push(slot);
			reusedRanges.set(slot, []);
		}
	}
	for (const slot of outerBindings) {
		const location = slot.location;
		if (location !== null && location.inStack && !rangesByRegister.has(location.index)) rangesByRegister.set(location.index, []);
	}
	const registers: number[] = [];
	const locations: ProgramWordRange[][] = [];
	const sharedSlots: Array<ReadonlyArray<{ slot: LocalSlotDebug; ranges: ProgramWordRange[] }> | undefined> = [];
	for (const [register, ranges] of rangesByRegister) {
		// Folding after inlining can remove the high end of the remapped frame.
		// Those declarations keep empty intervals, outside the physical window.
		if (register < maxStack) {
			registers.push(register);
			locations.push(ranges);
			const owners = ownersByRegister.get(register);
			sharedSlots.push(owners !== undefined && owners.length > 1
				? owners.map(slot => ({ slot, ranges: reusedRanges.get(slot)! })) : undefined);
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
	const record = (ranges: ProgramWordRange[], start: number, end: number): void => {
		const previous = ranges[ranges.length - 1];
		if (previous !== undefined && previous.start === end) previous.start = start;
		else ranges.push({ start, end });
	};
	const maxRegister = maxStack - 1;
	const liveByCandidate = computeInstructionLivenessAt(
		instructions,
		maxRegister,
		candidateIndices,
		resolveClosureUpvalues,
		'in',
		registers.length === 0 && selectedLiveRegisters === undefined ? undefined : (instructionIndex, live) => {
			if (selectedLiveRegisters?.has(instructionIndex)) {
				const selected: number[] = [];
				for (let register = 0; register < live.length; ++register) {
					if (live[register] !== 0)
						selected.push((allocation === undefined ? register : allocation.slots[register]) + physicalRegisterBase);
				}
				selected.sort((a, b) => a - b);
				selectedLiveRegisters.set(instructionIndex, selected);
			}
			if (registers.length === 0) return;
			const start = instructionWordOffsets[instructionIndex];
			const end = instructionIndex + 1 < instructions.length ? instructionWordOffsets[instructionIndex + 1] : wordCount;
			if (start === end) return; // A physical argument can already reside in its final slot.
			const range = sourceRanges[instructionIndex];
			const inline = instructions[instructionIndex].inlineCallSites ?? ROOT_INLINE_CALL_SITES;
			for (let index = 0; index < registers.length; index += 1) {
				const register = registers[index];
				if (live[register] === 0) continue;
				record(locations[index], start, end);
				const owners = sharedSlots[index];
				if (range === null || owners === undefined) continue;
				for (const { slot, ranges } of owners) {
					const context = resolveInlineLocalContextRange(slot, range, inline);
					if (context !== null && context.path === slot.scope.path
						&& sourcePositionInRange(context.start.line, context.start.column, slot.scope)) {
						record(ranges, start, end);
					}
				}
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
		const physical = allocation === undefined ? instruction : allocation.instructions[instructionIndex];
		const physicalMaxRegister = allocation === undefined ? maxRegister : allocation.maxStack - 1;
		if (allocation !== undefined) {
			for (let index = 0; index < liveRegisters.length; index += 1) liveRegisters[index] = allocation.slots[liveRegisters[index]];
			liveRegisters.sort((a, b) => a - b);
		}
		const uses = collectInstructionUses(physical, physicalMaxRegister, resolveClosureUpvalues);
		const defs = collectInstructionDefs(physical, physicalMaxRegister);
		if (physicalRegisterBase !== 0) {
			for (let i = 0; i < liveRegisters.length; ++i) liveRegisters[i] += physicalRegisterBase;
			for (let i = 0; i < uses.length; ++i) uses[i] += physicalRegisterBase;
			for (let i = 0; i < defs.length; ++i) defs[i] += physicalRegisterBase;
		}
		points.push({
			resumeId: instruction.resumeId,
			wordOffset: instructionWordOffsets[instructionIndex],
			range,
			op: instruction.op,
			liveRegisters,
			uses,
			defs,
			inlineCallSites,
		});
	}
	for (const ranges of locations) ranges.reverse();
	for (const ranges of reusedRanges.values()) ranges.reverse();
	const functionRange = [{ start: 0, end: wordCount }];
	const noLocation: readonly ProgramWordRange[] = [];
	return {
		resumePoints: points,
		localSlots: localSlots.map(slot => ({
			...slot,
			registerIndex: (allocation !== undefined && slot.registerIndex < maxStack
				? allocation.slots[slot.registerIndex] : slot.registerIndex) + physicalRegisterBase,
			liveWordRanges: reusedRanges.get(slot) ?? rangesByRegister.get(slot.registerIndex)!,
		})),
		outerBindings: outerBindings.map(slot => {
			const location = slot.location;
			return {
				...slot,
				location: location !== null && location.inStack
					? { inStack: true, index: (allocation !== undefined && location.index < maxStack
						? allocation.slots[location.index] : location.index) + physicalRegisterBase } : location,
				liveWordRanges: location === null ? noLocation
					: location.inStack ? rangesByRegister.get(location.index)! : functionRange,
			};
		}),
	};
}
