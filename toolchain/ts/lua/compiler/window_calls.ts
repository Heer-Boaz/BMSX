import { RegisterJumpMode, ReturnSource } from '../../../../machine/ts/spec/blua32/instruction_format';
import {
	OpCode, OPCODE_SCALAR_REGISTER_READS, OPCODE_WRITES_REGISTER_A,
	REGISTER_OPERAND_A, REGISTER_OPERAND_B, REGISTER_OPERAND_C, decodeValueCount,
} from '../../../../machine/ts/spec/blua32/opcode';
import { MAX_EXT_REGISTER_A } from '../../../../machine/ts/spec/blua32/instruction_format';
import { isJump, isSkipInstruction, rewriteBranchTargets, visitBranchTargets } from './control_flow';
import type { Instruction } from './optimizer';
import { visitInstructionDefs, visitInstructionUses, type ClosureUpvalueResolver } from './optimizer/liveness';
import type { Proto } from './program';
import type { ProgramCodeFunctionTarget } from './program_object';

const RAW_WINDOW_CONTROL_WORDS = 3;

type Body = { proto: Proto; instructions: readonly Instruction[] };
type DirectSite = { caller: number; instruction: number };

export type WindowBodyLowering = {
	instructions: Instruction[];
	origins: number[];
	starts: number[];
	maxStack: number;
	registerBias: number;
};

export type WindowCallLowering = {
	leaves: ReadonlySet<number>;
	bodies: ReadonlyMap<number, WindowBodyLowering>;
};

function fixedLeafResults({ proto, instructions }: Body): number {
	if (proto.isVararg || proto.upvalueDescs.length !== 0 || !proto.staticClosure) return -1;
	let results = -1;
	for (let i = 0; i < instructions.length; ++i) {
		const instruction = instructions[i];
		switch (instruction.op) {
			case OpCode.RET: {
				if (instruction.b === 0 || instruction.c !== ReturnSource.Registers
					|| (i > 0 && isSkipInstruction(instructions[i - 1]))) return -1;
				const count = decodeValueCount(instruction.b, 0);
				if (results !== -1 && results !== count) return -1;
				results = count;
				break;
			}
			case OpCode.JMP:
				if (instruction.a !== 0) return -1;
				break;
			// These operations observe or may suspend/resume a language activation.
			case OpCode.CALL: case OpCode.SVC: case OpCode.VARARG: case OpCode.ARGC:
			case OpCode.GETUP: case OpCode.SETUP: case OpCode.JAL: case OpCode.JREG:
			case OpCode.HALT: case OpCode.RFE: case OpCode.MTC0: case OpCode.MFC0:
			case OpCode.GETT: case OpCode.GETI: case OpCode.GETFIELD: case OpCode.SELF:
			case OpCode.SETT: case OpCode.SETI: case OpCode.SETFIELD: case OpCode.ITERN:
			case OpCode.LEN:
				return -1;
			default:
				break;
		}
	}
	return results;
}

function markRegister(registers: Set<number>, register: number): void {
	registers.add(register);
}

/** Prove the materialized Function value is consumed only by the direct call. */
function directCallAfterLoad(instructions: readonly Instruction[], maxStack: number, start: number,
	entries: ReadonlySet<number>, resolveClosure: ClosureUpvalueResolver): number {
	if (start > 0 && isSkipInstruction(instructions[start - 1])) return -1;
	const register = instructions[start].a;
	const registers = new Set<number>();
	for (let i = start + 1; i < instructions.length; ++i) {
		const instruction = instructions[i];
		if (entries.has(i) || isSkipInstruction(instructions[i - 1])) return -1;
		if (instruction.op === OpCode.CALL && instruction.a === register) return i;
		if (isJump(instruction) || instruction.op === OpCode.JREG || instruction.op === OpCode.RET
			|| instruction.op === OpCode.HALT || instruction.op === OpCode.RFE) return -1;
		registers.clear();
		visitInstructionUses(instruction, maxStack - 1, resolveClosure, registers, markRegister);
		visitInstructionDefs(instruction, maxStack - 1, registers, markRegister);
		// A call truncates the suffix even when it discards all results.
		if (registers.has(register) || (instruction.op === OpCode.CALL && instruction.a <= register)) return -1;
	}
	return -1;
}

function shiftLeafRegisters(instruction: Instruction): Instruction {
	const reads = OPCODE_SCALAR_REGISTER_READS[instruction.op];
	const a = (reads & REGISTER_OPERAND_A) !== 0 || OPCODE_WRITES_REGISTER_A[instruction.op] !== 0
		|| instruction.op === OpCode.LOADNIL ? instruction.a + 1 : instruction.a;
	const b = (reads & REGISTER_OPERAND_B) !== 0 && instruction.b >= 0 ? instruction.b + 1 : instruction.b;
	const c = (reads & REGISTER_OPERAND_C) !== 0 && instruction.c >= 0 ? instruction.c + 1 : instruction.c;
	return { ...instruction, a, b, c };
}

function controlInstruction(origin: Instruction, op: OpCode, a: number, b: number, c = 0): Instruction {
	return {
		op, a, b, c, target: null, format: op === OpCode.KSMI ? 'ABx' : 'ABC',
		rkMask: 0, inlineCallSites: origin.inlineCallSites,
	};
}

function lowerWindowBody(body: Body, leafResults: number | undefined, callees: ReadonlyMap<number, Body> | undefined): WindowBodyLowering {
	const instructions: Instruction[] = [], origins: number[] = [], starts = new Array<number>(body.instructions.length + 1);
	const registerBias = leafResults === undefined ? 0 : 1;
	let maxStack = body.proto.maxStack + registerBias;
	for (let i = 0; i < body.instructions.length; ++i) {
		const instruction = body.instructions[i];
		starts[i] = instructions.length;
		if (leafResults !== undefined && instruction.op === OpCode.RET) {
			// Both ranges are contiguous and the destination is lower. A forward
			// register transfer keeps still-unread produced values intact.
			for (let result = 0; result < leafResults; ++result)
				instructions.push(controlInstruction(instruction, OpCode.MOV, result, instruction.a + 1 + result));
			instructions.push(controlInstruction(instruction, OpCode.JREG, 0, leafResults, RegisterJumpMode.LeaveWindow));
		} else {
			const callee = callees?.get(i);
			if (callee === undefined) instructions.push(registerBias === 0 ? { ...instruction } : shiftLeafRegisters(instruction));
			else {
				const base = instruction.a, width = callee.proto.maxStack + 1;
				const top = callee.proto.numParams + 1, packet = base + top;
				instructions.push(controlInstruction(instruction, OpCode.KSMI, packet, base));
				instructions.push(controlInstruction(instruction, OpCode.KSMI, packet + 1, width));
				instructions.push(controlInstruction(instruction, OpCode.KSMI, packet + 2, top));
				instructions.push(controlInstruction(instruction, OpCode.JREG, base, packet, RegisterJumpMode.EnterWindow));
				maxStack = Math.max(maxStack, base + width, packet + RAW_WINDOW_CONTROL_WORDS);
			}
		}
		const first = instructions[starts[i]];
		first.statementRange = instruction.statementRange;
		first.resumeRange = instruction.resumeRange;
		first.resumeId = instruction.resumeId;
		for (let written = starts[i]; written < instructions.length; ++written) origins.push(i);
	}
	starts[body.instructions.length] = instructions.length;
	for (const instruction of instructions) {
		if (instruction.op !== OpCode.JREG || instruction.branchTargets !== undefined)
			rewriteBranchTargets(instruction, index => starts[index]);
	}
	return { instructions, origins, starts, maxStack, registerBias };
}

/**
 * A software-only entry has one physical body. An address escape or one
 * unmatched calling convention keeps the whole symbol in the language ABI.
 */
export function lowerWindowCalls(bodies: readonly Body[], staticProtos: ReadonlySet<number>, escaped: ReadonlySet<number>,
	resolveSymbol: (target: ProgramCodeFunctionTarget) => number | undefined, resolveClosure: ClosureUpvalueResolver): WindowCallLowering {
	const leaves = new Map<number, number>();
	for (const proto of staticProtos) {
		if (escaped.has(proto)) continue;
		const results = fixedLeafResults(bodies[proto]);
		if (results > 0) leaves.set(proto, results);
	}
	const sites = new Map<number, DirectSite[]>();
	for (let caller = 0; caller < bodies.length; ++caller) {
		const { proto, instructions } = bodies[caller];
		let entries: Set<number> | undefined;
		const opensCaptures = instructions.some(instruction => instruction.boundFunctionProto !== undefined || instruction.unknownFunctionBinding);
		for (let i = 0; i < instructions.length; ++i) {
			const target = instructions[i].symbolicReloc;
			if (target === undefined) continue;
			const callee = resolveSymbol(target);
			if (callee === undefined || !leaves.has(callee)) continue;
			if (entries === undefined) {
				entries = new Set();
				for (const instruction of instructions) visitBranchTargets(instruction, entry => entries!.add(entry));
			}
			const call = opensCaptures ? -1 : directCallAfterLoad(instructions, proto.maxStack, i, entries, resolveClosure);
			if (call < 0) {
				leaves.delete(callee);
				continue;
			}
			const site = instructions[call], targetProto = bodies[callee].proto;
			if (site.b === 0 || site.c === 0 || decodeValueCount(site.b, 0) !== targetProto.numParams
				|| decodeValueCount(site.c, 0) !== leaves.get(callee)
				|| site.a + Math.max(targetProto.maxStack + 1, targetProto.numParams + 1 + RAW_WINDOW_CONTROL_WORDS) > MAX_EXT_REGISTER_A + 1) {
				leaves.delete(callee);
				continue;
			}
			let uses = sites.get(callee);
			if (uses === undefined) sites.set(callee, uses = []);
			uses.push({ caller, instruction: call });
		}
	}
	const calls = new Map<number, Map<number, Body>>();
	for (const [leaf] of leaves) {
		const uses = sites.get(leaf);
		if (uses === undefined) {
			leaves.delete(leaf);
			continue;
		}
		for (const site of uses) {
			let byPc = calls.get(site.caller);
			if (byPc === undefined) calls.set(site.caller, byPc = new Map());
			byPc.set(site.instruction, bodies[leaf]);
		}
	}
	const rewrites = new Map<number, WindowBodyLowering>();
	for (const [proto, results] of leaves) rewrites.set(proto, lowerWindowBody(bodies[proto], results, undefined));
	for (const [proto, targets] of calls) rewrites.set(proto, lowerWindowBody(bodies[proto], undefined, targets));
	return { leaves: new Set(leaves.keys()), bodies: rewrites };
}
