import { MAX_EXT_REGISTER_A, RegisterJumpMode, ReturnSource } from '../../../../machine/ts/spec/blua32/instruction_format';
import {
	OpCode, OPCODE_SCALAR_REGISTER_READS, OPCODE_WRITES_REGISTER_A,
	REGISTER_OPERAND_A, REGISTER_OPERAND_B, REGISTER_OPERAND_C, decodeValueCount,
} from '../../../../machine/ts/spec/blua32/opcode';
import { stronglyConnectedComponents, type StronglyConnectedNode } from '../../collections/strongly_connected_components';
import { isJump, isSkipInstruction, rewriteBranchTargets, visitBranchTargets } from './control_flow';
import type { Instruction } from './optimizer';
import { visitInstructionDefs, visitInstructionUses, type ClosureUpvalueResolver } from './optimizer/liveness';
import type { Proto } from './program';
import type { ProgramCodeFunctionTarget } from './program_object';
import { MAX_ABX_REGISTER_A } from './wide_integer';

const RAW_WINDOW_CONTROL_WORDS = 3;

type Body = { proto: Proto; instructions: readonly Instruction[] };
type DirectSite = { caller: number; instruction: number };
type WindowLayout = { results: number; top: number; width: number };
type WindowCandidate = StronglyConnectedNode<WindowCandidate> & {
	protoIndex: number;
	results: number;
	dependencies: WindowCandidate[];
	complete: boolean;
};

export type WindowBodyLowering = {
	instructions: Instruction[];
	origins: number[];
	starts: number[];
	maxStack: number;
	registerBias: number;
};

export type WindowCallLowering = {
	entries: ReadonlySet<number>;
	bodies: ReadonlyMap<number, WindowBodyLowering>;
};

function fixedBodyResults({ proto, instructions }: Body): number {
	if (proto.isVararg || proto.upvalueDescs.length !== 0 || !proto.staticClosure || proto.maxStack > MAX_EXT_REGISTER_A) return -1;
	let results = -1;
	for (let i = 0; i < instructions.length; ++i) {
		const instruction = instructions[i];
		// The borrowed view reserves R0 for the first result, rebasing the
		// original registers by one. An ABx register must still encode.
		if (instruction.format !== 'ABC' && instruction.a >= MAX_ABX_REGISTER_A) return -1;
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
			case OpCode.CALL:
				if (instruction.b === 0 || instruction.c === 0) return -1;
				break;
			// These operations observe or may suspend/resume a language activation.
			case OpCode.SVC: case OpCode.VARARG: case OpCode.ARGC:
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

function shiftWindowRegisters(instruction: Instruction): Instruction {
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

function controlPacketBase(base: number, supplied: number, callee: WindowLayout): number {
	return base + Math.max(supplied + 1, callee.top);
}

function callWindowEnd(base: number, supplied: number, callee: WindowLayout): number {
	return Math.max(base + callee.width, controlPacketBase(base, supplied, callee) + RAW_WINDOW_CONTROL_WORDS);
}

function windowFitsAt(base: number, supplied: number, callee: WindowLayout): boolean {
	return controlPacketBase(base, supplied, callee) + RAW_WINDOW_CONTROL_WORDS - 1 <= MAX_ABX_REGISTER_A
		&& callWindowEnd(base, supplied, callee) <= MAX_EXT_REGISTER_A + 1;
}

function lowerWindowBody(body: Body, entry: WindowLayout | undefined, callees: ReadonlyMap<number, WindowLayout> | undefined): WindowBodyLowering {
	const instructions: Instruction[] = [], origins: number[] = [], starts = new Array<number>(body.instructions.length + 1);
	const registerBias = entry === undefined ? 0 : 1;
	let maxStack = entry === undefined ? body.proto.maxStack : entry.width;
	for (let i = 0; i < body.instructions.length; ++i) {
		const instruction = body.instructions[i];
		starts[i] = instructions.length;
		if (entry !== undefined && instruction.op === OpCode.RET) {
			// Both ranges are contiguous and the destination is lower. A forward
			// register transfer keeps still-unread produced values intact.
			for (let result = 0; result < entry.results; ++result)
				instructions.push(controlInstruction(instruction, OpCode.MOV, result, instruction.a + 1 + result));
			instructions.push(controlInstruction(instruction, OpCode.JREG, 0, entry.results, RegisterJumpMode.LeaveWindow));
		} else {
			const callee = callees?.get(i);
			if (callee === undefined) instructions.push(registerBias === 0 ? { ...instruction } : shiftWindowRegisters(instruction));
			else {
				const base = instruction.a + registerBias, supplied = decodeValueCount(instruction.b, 0);
				const initialized = supplied + 1, packet = controlPacketBase(base, supplied, callee);
				if (initialized < callee.top)
					instructions.push(controlInstruction(instruction, OpCode.LOADNIL, base + initialized, callee.top - initialized));
				// Put controls beyond all evaluated actuals. Surplus arguments
				// cease to be visible when entry publishes the formal frontier.
				instructions.push(controlInstruction(instruction, OpCode.KSMI, packet, base));
				instructions.push(controlInstruction(instruction, OpCode.KSMI, packet + 1, callee.width));
				instructions.push(controlInstruction(instruction, OpCode.KSMI, packet + 2, callee.top));
				instructions.push(controlInstruction(instruction, OpCode.JREG, base, packet, RegisterJumpMode.EnterWindow));
				if (entry === undefined) maxStack = Math.max(maxStack, callWindowEnd(base, supplied, callee));
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
	const signatures = new Map<number, number>();
	for (const proto of staticProtos) {
		if (escaped.has(proto)) continue;
		const results = fixedBodyResults(bodies[proto]);
		if (results >= 0) signatures.set(proto, results);
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
			if (callee === undefined || !signatures.has(callee)) continue;
			if (entries === undefined) {
				entries = new Set();
				for (const instruction of instructions) visitBranchTargets(instruction, entry => entries!.add(entry));
			}
			const call = opensCaptures ? -1 : directCallAfterLoad(instructions, proto.maxStack, i, entries, resolveClosure);
			if (call < 0) {
				signatures.delete(callee);
				continue;
			}
			const site = instructions[call];
			if (site.b === 0 || site.c === 0 || decodeValueCount(site.c, 0) !== signatures.get(callee)) {
				signatures.delete(callee);
				continue;
			}
			let uses = sites.get(callee);
			if (uses === undefined) sites.set(callee, uses = []);
			uses.push({ caller, instruction: call });
		}
	}
	const candidates = new Map<number, WindowCandidate>();
	const edges = new Map<number, Map<number, WindowCandidate>>();
	for (const [protoIndex, results] of signatures) {
		const uses = sites.get(protoIndex);
		if (uses === undefined) continue;
		const candidate: WindowCandidate = { protoIndex, results, dependencies: [], complete: true,
			index: -1, lowlink: 0, component: -1, active: false };
		candidates.set(protoIndex, candidate);
		for (const site of uses) {
			let byPc = edges.get(site.caller);
			if (byPc === undefined) edges.set(site.caller, byPc = new Map());
			byPc.set(site.instruction, candidate);
		}
	}
	for (const candidate of candidates.values()) {
		const { protoIndex, dependencies } = candidate;
		const instructions = bodies[protoIndex].instructions;
		const callees = edges.get(protoIndex);
		for (let i = 0; i < instructions.length; ++i) {
			if (instructions[i].op !== OpCode.CALL) continue;
			const callee = callees?.get(i);
			if (callee === undefined) candidate.complete = false;
			else dependencies.push(callee);
		}
	}

	// A local frame footprint does not include its descendants. Certify the
	// graph bottom-up so each lent view includes all its nested packets and
	// windows, measured from its rebased register A.
	const windows = new Map<number, WindowLayout>();
	components: for (const component of stronglyConnectedComponents(candidates.values())) {
		const { complete, protoIndex, results, dependencies } = component[0];
		if (component.length !== 1 || !complete || dependencies.includes(component[0])) continue;
		const { proto, instructions } = bodies[protoIndex];
		let width = Math.max(proto.maxStack, proto.numParams) + 1;
		const callees = edges.get(protoIndex);
		if (callees !== undefined) {
			for (const [site, target] of callees) {
				const { a, b } = instructions[site], base = a + 1, supplied = decodeValueCount(b, 0);
				const callee = windows.get(target.protoIndex);
				if (callee === undefined || !windowFitsAt(base, supplied, callee)) continue components;
				width = Math.max(width, callWindowEnd(base, supplied, callee));
			}
		}
		const window = { results, width, top: proto.numParams + 1 };
		for (const { caller, instruction } of sites.get(protoIndex)!) {
			const { a, b } = bodies[caller].instructions[instruction];
			if (!windowFitsAt(a, decodeValueCount(b, 0), window)) continue components;
		}
		windows.set(protoIndex, window);
	}

	const rewrites = new Map<number, WindowBodyLowering>();
	for (let protoIndex = 0; protoIndex < bodies.length; ++protoIndex) {
		const window = windows.get(protoIndex), callees = edges.get(protoIndex);
		let lowered: Map<number, WindowLayout> | undefined;
		if (callees !== undefined) {
			for (const [site, target] of callees) {
				const callee = windows.get(target.protoIndex);
				if (callee !== undefined) (lowered ??= new Map()).set(site, callee);
			}
		}
		if (window !== undefined || lowered !== undefined)
			rewrites.set(protoIndex, lowerWindowBody(bodies[protoIndex], window, lowered));
	}
	return { entries: new Set(windows.keys()), bodies: rewrites };
}
