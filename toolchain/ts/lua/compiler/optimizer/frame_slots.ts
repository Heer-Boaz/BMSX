import {
	OpCode, OPCODE_SCALAR_REGISTER_READS, OPCODE_WRITES_REGISTER_A,
	REGISTER_OPERAND_A, REGISTER_OPERAND_B, REGISTER_OPERAND_C, decodeValueCount,
} from '../../../../../machine/ts/spec/blua32/opcode';
import type { Instruction } from './index';
import {
	computeInstructionLivenessAt, visitInstructionDefs, visitInstructionOpenUpvalueRegisters,
	type ClosureUpvalueResolver,
} from './liveness';

export type FrameSlotAllocation = {
	slots: Int32Array;
	instructions: Instruction[];
	maxStack: number;
};

function pinSlot(pinned: Uint8Array, register: number): void {
	pinned[register] = 1;
}

type IntervalEnds = {
	start: Int32Array;
	end: Int32Array;
	at: number;
};

function markInterval(ends: IntervalEnds, register: number): void {
	if (ends.at < ends.start[register]) ends.start[register] = ends.at;
	if (ends.at > ends.end[register]) ends.end[register] = ends.at;
}

/**
 * Keep the calling convention and captured cells in place. Ordinary slots
 * can share a location when their lifetimes do not intersect on any path.
 * Instruction reads and writes occupy distinct positions: the destination
 * can overwrite a scalar source after its final read.
 */
export function allocateFrameSlots(
	instructions: Instruction[],
	maxStack: number,
	numParams: number,
	resolveClosure: ClosureUpvalueResolver,
): FrameSlotAllocation | undefined {
	if (maxStack - numParams < 2) return undefined;
	const pinned = new Uint8Array(maxStack);
	pinned.fill(1, 0, numParams);
	// ABI operands cannot move, but a dead ABI slot can hold an ordinary
	// value. An open window or a captured cell cannot lend out its slot.
	const fixed = new Uint8Array(maxStack);
	const bands = new Uint8Array(maxStack);
	const discardCalls = new Uint8Array(maxStack);
	let openBase = maxStack;
	for (const instruction of instructions) {
		const { op, a, b, c } = instruction;
		switch (op) {
			case OpCode.CLOSURE:
				if (instruction.closureAddressRegister) return undefined;
				visitInstructionOpenUpvalueRegisters(instruction, maxStack - 1, resolveClosure, pinned, pinSlot);
				break;
			case OpCode.CALL:
				bands[a] = 1;
				if (b === 0 || c === 0) openBase = Math.min(openBase, a);
				if (b === 1 && c === 1) discardCalls[a] = 1;
				else fixed.fill(1, a, a + Math.max(1 + decodeValueCount(b, 0), decodeValueCount(c, 0)));
				break;
			case OpCode.VARARG:
				bands[a] = 1;
				if (b === 0) openBase = Math.min(openBase, a);
				fixed.fill(1, a, a + Math.max(1, decodeValueCount(b, 0)));
				break;
			case OpCode.RET:
				if (b === 0) openBase = Math.min(openBase, a);
				if (b !== 2) fixed.fill(1, a, a + Math.max(1, decodeValueCount(b, 0)));
				break;
			case OpCode.SELF:
				fixed.fill(1, a, a + 2);
				break;
			case OpCode.CONCATN:
				fixed[a] = 1;
				fixed.fill(1, b, b + c);
				break;
			case OpCode.LOADNIL:
				fixed.fill(1, a, a + Math.max(1, b));
				break;
			case OpCode.STORE_MEM_WORDS:
			case OpCode.STORE_MEM_WORDS_D:
				fixed.fill(1, a, a + Math.max(1, c));
				break;
		}
	}
	// An open input or result uses the current top; neither a slot's position
	// above that base nor the size of the populated tail can be changed.
	pinned.fill(1, openBase);
	let available = 0;
	let canShare = false;
	for (let slot = numParams; slot < openBase; slot += 1) {
		const earlier = available;
		if (bands[slot] !== 0) available = 0;
		if (pinned[slot] !== 0) continue;
		if (fixed[slot] === 0 && (discardCalls[slot] !== 0 ? earlier : available) !== 0) {
			canShare = true;
			break;
		}
		available += 1;
	}
	if (!canShare) return undefined;

	const ends: IntervalEnds = {
		start: new Int32Array(maxStack).fill(instructions.length * 2),
		end: new Int32Array(maxStack).fill(-1),
		at: 0,
	};
	const liveAcrossDiscard = new Map<number, Set<number>>();
	computeInstructionLivenessAt(instructions, maxStack - 1, [], resolveClosure, 'in', (index, live) => {
		// The CALL tail is a liveness kill rather than a set of actual writes.
		// Only fixed results write actual slots; open windows are pinned.
		const instruction = instructions[index];
		ends.at = index * 2 + 1;
		if (instruction.op === OpCode.CALL) {
			const length = decodeValueCount(instruction.c, 0);
			for (let offset = 0; offset < length; offset += 1) markInterval(ends, instruction.a + offset);
			const base = instruction.a;
			if (instruction.b === 1 && instruction.c === 1 && base < openBase
				&& pinned[base] === 0 && fixed[base] === 0) {
				let kept = liveAcrossDiscard.get(base);
				if (kept === undefined) {
					kept = new Set<number>();
					liveAcrossDiscard.set(base, kept);
				}
				for (let register = numParams; register < base; register += 1)
					if (live[register] !== 0 || pinned[register] !== 0) kept.add(register);
			}
		} else {
			// These instructions own an implicit register range. Treat the
			// destination as busy for the whole operation.
			if (instruction.op === OpCode.SELF || instruction.op === OpCode.CONCATN) ends.at -= 1;
			visitInstructionDefs(instruction, maxStack - 1, ends, markInterval);
		}
		ends.at = index * 2;
		for (let register = numParams; register < openBase; register += 1) {
			if (live[register] !== 0 && pinned[register] === 0) markInterval(ends, register);
		}
	});

	const slots = new Int32Array(maxStack);
	const occupants: Array<number[] | undefined> = new Array(maxStack);
	let bandBase = numParams;
	let changed = false;
	let reservation = 1;
	for (let register = 0; register < maxStack; register += 1) {
		const previousBand = bandBase;
		if (bands[register] !== 0) bandBase = register;
		slots[register] = register;
		if (pinned[register] !== 0) {
			reservation = register + 1;
			continue;
		}
		const start = ends.start[register], end = ends.end[register];
		if (fixed[register] !== 0) {
			if (end >= 0) occupants[register] = [register];
			reservation = register + 1;
			continue;
		}
		if (end < 0) continue;
		// Fixed calls truncate the top at their base. An empty-input,
		// discard-result call can also lower its base past dead scratch.
		let minimum = bandBase;
		const kept = liveAcrossDiscard.get(register);
		if (kept !== undefined) {
			minimum = previousBand;
			for (const live of kept) minimum = Math.max(minimum, slots[live] + 1);
		}
		placement: for (let slot = minimum; slot <= register; slot += 1) {
			if (pinned[slot] !== 0) continue;
			const held = occupants[slot];
			if (held !== undefined) {
				for (const other of held)
					if (start <= ends.end[other] && ends.start[other] <= end) continue placement;
				held.push(register);
			} else occupants[slot] = [register];
			slots[register] = slot;
			reservation = Math.max(reservation, slot + 1);
			changed ||= slot !== register;
			break;
		}
	}
	if (!changed) return undefined;

	const allocated = instructions.map(instruction => {
		if (instruction.op === OpCode.RET) {
			const a = slots[instruction.a];
			return a === instruction.a ? instruction : { ...instruction, a };
		}
		const reads = OPCODE_SCALAR_REGISTER_READS[instruction.op];
		const a = (reads & REGISTER_OPERAND_A) !== 0 || OPCODE_WRITES_REGISTER_A[instruction.op] !== 0
			? slots[instruction.a] : instruction.a;
		const b = (reads & REGISTER_OPERAND_B) !== 0 && instruction.b >= 0 ? slots[instruction.b] : instruction.b;
		const c = (reads & REGISTER_OPERAND_C) !== 0 && instruction.c >= 0 ? slots[instruction.c] : instruction.c;
		return a === instruction.a && b === instruction.b && c === instruction.c
			? instruction : { ...instruction, a, b, c };
	});
	return { slots, instructions: allocated, maxStack: reservation };
}
