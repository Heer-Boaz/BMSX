import {
	buildBasicBlocks,
	buildBlockGraph,
	isSkipInstruction,
	remapInstructions,
} from '../control_flow';
import type { InstructionSet, OptimizationContext } from './index';
import { computeMaxRegister, isPureInstruction } from './instructions';
import {
	collectInstructionDefs,
	collectInstructionUses,
	computeBlockLiveOut,
	computeBlockOpenUpvaluesIn,
	visitInstructionOpenUpvalueRegisters,
} from './liveness';

type FirstOpenState = {
	index: number;
	registers: Int32Array;
};

const recordFirstOpen = (state: FirstOpenState, register: number): void => {
	if (state.registers[register] > state.index) {
		state.registers[register] = state.index;
	}
};

export const eliminateDeadStores = (
	set: InstructionSet,
	context: OptimizationContext,
): InstructionSet => {
	const { instructions, ranges } = set;
	const count = instructions.length;
	if (count === 0) {
		return set;
	}
	const maxRegister = computeMaxRegister(instructions);
	const registerCount = maxRegister + 1;
	const blocks = buildBasicBlocks(instructions);
	const { predecessors, successors } = buildBlockGraph(instructions, blocks);
	const resolveClosureUpvalues = context.getClosureUpvalues;
	const liveOut = computeBlockLiveOut(
		instructions,
		blocks,
		successors,
		maxRegister,
		resolveClosureUpvalues,
	);
	const openIn = computeBlockOpenUpvaluesIn(
		instructions,
		blocks,
		predecessors,
		maxRegister,
		resolveClosureUpvalues,
	);
	// A CLOSURE makes every in-stack capture live at this instruction and leaves
	// later writes externally observable through the open upvalue until frame return.
	const pinned = new Uint8Array(count);
	for (let index = 0; index + 1 < count; index += 1) {
		if (isSkipInstruction(instructions[index])) {
			pinned[index + 1] = 1;
		}
	}

	const keep = new Array<boolean>(count).fill(true);
	const firstOpen = new Int32Array(registerCount);
	const firstOpenState: FirstOpenState = { index: 0, registers: firstOpen };
	let removed = 0;
	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
		const block = blocks[blockIndex];
		firstOpen.fill(count);
		const incomingOpen = openIn[blockIndex];
		for (let register = 0; register < registerCount; register += 1) {
			if (incomingOpen[register] !== 0) {
				firstOpen[register] = block.start;
			}
		}
		for (let index = block.start; index < block.end; index += 1) {
			firstOpenState.index = index;
			visitInstructionOpenUpvalueRegisters(
				instructions[index],
				maxRegister,
				resolveClosureUpvalues,
				firstOpenState,
				recordFirstOpen,
			);
		}

		const live = liveOut[blockIndex].slice();
		for (let index = block.end - 1; index >= block.start; index -= 1) {
			const instruction = instructions[index];
			const defs = collectInstructionDefs(instruction, maxRegister);
			let observed = false;
			for (let defIndex = 0; defIndex < defs.length; defIndex += 1) {
				const register = defs[defIndex];
				if (live[register] !== 0 || firstOpen[register] <= index) {
					observed = true;
					break;
				}
			}
			if (pinned[index] === 0
				&& defs.length > 0
				&& isPureInstruction(instruction)
				&& !observed) {
				keep[index] = false;
				removed += 1;
				continue;
			}
			for (let defIndex = 0; defIndex < defs.length; defIndex += 1) {
				live[defs[defIndex]] = 0;
			}
			const uses = collectInstructionUses(
				instruction,
				maxRegister,
				resolveClosureUpvalues,
			);
			for (let useIndex = 0; useIndex < uses.length; useIndex += 1) {
				live[uses[useIndex]] = 1;
			}
		}
	}

	return removed === 0
		? set
		: remapInstructions(instructions, ranges, keep, true);
};
