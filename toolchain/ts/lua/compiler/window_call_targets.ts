import { OpCode } from '../../../../machine/ts/spec/blua32/opcode';
import { getJumpTarget, isSkipInstruction } from './control_flow';
import type { Instruction } from './optimizer';
import { visitInstructionDefs, visitInstructionUses, type ClosureUpvalueResolver } from './optimizer/liveness';

type Match = { register: number; found: boolean };
function matchRegister(match: Match, register: number): void {
	if (match.register === register) match.found = true;
}

/** A relocated function may become a raw PC only if no path reads it as a
 * Value and every possible definition at its sole CALL can become raw. */
export function createWindowCallTargetProof(
	instructions: readonly Instruction[], maxStack: number, resolveClosure: ClosureUpvalueResolver,
): (load: number) => { instruction: number; loads: readonly number[] } | undefined {
	if (instructions.some(row => row.op === OpCode.JAL || row.op === OpCode.JREG)) return () => undefined;
	const count = instructions.length;
	const successors: number[][] = Array.from({ length: count }, () => []);
	const predecessors: number[][] = Array.from({ length: count }, () => []);
	for (let pc = 0; pc < count; ++pc) {
		const row = instructions[pc], next = pc + 1;
		const outgoing = successors[pc];
		switch (row.op) {
			case OpCode.RET: case OpCode.RFE:
				break;
			case OpCode.JMP:
				outgoing.push(getJumpTarget(row));
				break;
			case OpCode.JMPIF: case OpCode.JMPIFNOT:
				outgoing.push(getJumpTarget(row), next);
				break;
			default:
				outgoing.push(next);
				if (isSkipInstruction(row)) outgoing.push(next + 1);
				break;
		}
		for (const target of outgoing) if (target < count) predecessors[target].push(pc);
	}

	const match: Match = { register: 0, found: false };
	function overwrites(row: Instruction): boolean {
		if (row.op === OpCode.CALL && row.a <= match.register) return true;
		match.found = false;
		visitInstructionDefs(row, maxStack - 1, match, matchRegister);
		return match.found;
	}
	function opaque(row: Instruction): boolean {
		return row.op === OpCode.HALT || row.op === OpCode.RFE || row.op === OpCode.SVC || (row.op === OpCode.JMP && row.a !== 0);
	}

	const consumers = new Map<number, number>();
	function findConsumer(load: number): number {
		const previous = consumers.get(load);
		if (previous !== undefined) return previous;
		match.register = instructions[load].a;
		const pending = successors[load].slice(), visited = new Set<number>();
		let consumer = -1;
		while (pending.length !== 0) {
			const pc = pending.pop()!;
			if (pc >= count || visited.has(pc)) continue;
			visited.add(pc);
			const row = instructions[pc];
			if (row.op === OpCode.CALL && row.a === match.register) {
				if ((consumer !== -1 && consumer !== pc) || (pc > 0 && isSkipInstruction(instructions[pc - 1]))) {
					consumer = -1;
					break;
				}
				consumer = pc;
			} else {
				match.found = false;
				visitInstructionUses(row, maxStack - 1, resolveClosure, match, matchRegister);
				if (match.found || opaque(row)) {
					consumer = -1;
					break;
				}
				if (!overwrites(row)) for (const target of successors[pc]) pending.push(target);
			}
		}
		consumers.set(load, consumer);
		return consumer;
	}

	const definitions = new Map<number, readonly number[]>();
	return (load: number) => {
		const instruction = findConsumer(load);
		if (instruction === -1) return;
		let loads = definitions.get(instruction);
		if (loads === undefined) {
			match.register = instructions[instruction].a;
			const pending = predecessors[instruction].slice(), visited = new Set<number>();
			const found: number[] = [];
			while (pending.length !== 0) {
				const pc = pending.pop()!;
				if (visited.has(pc)) continue;
				visited.add(pc);
				const row = instructions[pc];
				if (overwrites(row)) {
					if (row.op !== OpCode.LOADK || row.symbolicReloc === undefined || findConsumer(pc) !== instruction) {
						found.length = 0;
						break;
					}
					found.push(pc);
				} else if (pc === 0 || opaque(row)) {
					found.length = 0;
					break;
				} else for (const predecessor of predecessors[pc]) pending.push(predecessor);
			}
			loads = found;
			definitions.set(instruction, loads);
		}
		if (loads.includes(load)) return { instruction, loads };
	};
}
