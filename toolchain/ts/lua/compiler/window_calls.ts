import { MAX_EXT_REGISTER_A, RegisterJumpMode, ReturnSource, ValueMoveKind } from '../../../../machine/ts/spec/blua32/instruction_format';
import {
	OpCode, OPCODE_RK_OPERANDS, OPCODE_SCALAR_REGISTER_READS, OPCODE_WRITES_REGISTER_A,
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
type ResultRange = { min: number; max: number };
type BodyReturns = ResultRange & { forwarded: number[] };
type WindowLayout = ResultRange & { top: number; width: number; sealed: boolean };
type WindowCandidate = StronglyConnectedNode<WindowCandidate> & {
	protoIndex: number;
	returns: BodyReturns;
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

function boundedBodyReturns({ proto, instructions }: Body): BodyReturns | undefined {
	if (proto.isVararg || proto.upvalueDescs.length !== 0 || !proto.staticClosure || proto.maxStack > MAX_EXT_REGISTER_A) return;
	const forwarded: number[] = [];
	let min = Infinity, max = -1;
	for (let i = 0; i < instructions.length; ++i) {
		const instruction = instructions[i];
		// The borrowed view reserves R0 for the first result, rebasing the
		// original registers by one. An ABx register must still encode.
		if (instruction.format !== 'ABC' && instruction.a >= MAX_ABX_REGISTER_A) return;
		switch (instruction.op) {
			case OpCode.RET: {
				if (instruction.c !== ReturnSource.Registers || (i > 0 && isSkipInstruction(instructions[i - 1]))) return;
				if (instruction.b === 0) {
					const previous = instructions[i - 1];
					if (previous?.op !== OpCode.CALL || previous.c !== 0 || previous.a < instruction.a) return;
					forwarded.push(i);
				} else {
					const count = decodeValueCount(instruction.b, 0);
					min = Math.min(min, count);
					max = Math.max(max, count);
				}
				break;
			}
			case OpCode.JMP:
				if (instruction.a !== 0) return;
				break;
			case OpCode.CALL:
				if (instruction.b === 0) return;
				break;
			// These operations observe or may suspend/resume a language activation.
			case OpCode.SVC: case OpCode.VARARG: case OpCode.ARGC:
			case OpCode.GETUP: case OpCode.SETUP: case OpCode.JAL: case OpCode.JREG:
			case OpCode.HALT: case OpCode.RFE: case OpCode.MTC0: case OpCode.MFC0:
			case OpCode.GETT: case OpCode.GETI: case OpCode.GETFIELD: case OpCode.SELF:
			case OpCode.SETT: case OpCode.SETI: case OpCode.SETFIELD: case OpCode.ITERN:
			case OpCode.LEN:
				return;
			default:
				break;
		}
	}
	if (forwarded.length !== 0) {
		// An open return must observe the frontier from the adjacent call,
		// not arbitrary incoming register state from a different edge.
		const targets = new Set<number>();
		for (const instruction of instructions) visitBranchTargets(instruction, target => targets.add(target));
		if (forwarded.some(pc => targets.has(pc))) return;
	} else if (max === -1) return;
	return { min, max, forwarded };
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
		rkMask: OPCODE_RK_OPERANDS[op], inlineCallSites: origin.inlineCallSites,
	};
}

function controlPacketBase(base: number, supplied: number, callee: WindowLayout): number {
	return base + Math.max(supplied + 1, callee.top);
}

function fixedTopRegister(wanted: number, callee: WindowLayout): number {
	if (wanted === -1 || wanted > callee.max || (wanted === callee.max && wanted === callee.min)) return -1;
	// Every path has initialized this first discarded register or has Top
	// at it. A padded receiver instead uses a register past all results.
	return wanted <= callee.min ? wanted : callee.max;
}

function callWindowEnd(base: number, supplied: number, wanted: number, callee: WindowLayout): number {
	const adaptedEnd = Math.max(fixedTopRegister(wanted, callee) + 1, wanted);
	return Math.max(base + Math.max(callee.width, adaptedEnd), controlPacketBase(base, supplied, callee) + RAW_WINDOW_CONTROL_WORDS);
}

function windowFitsAt(base: number, supplied: number, wanted: number, callee: WindowLayout): boolean {
	return controlPacketBase(base, supplied, callee) + RAW_WINDOW_CONTROL_WORDS - 1 <= MAX_ABX_REGISTER_A
		&& base + fixedTopRegister(wanted, callee) <= MAX_ABX_REGISTER_A
		&& callWindowEnd(base, supplied, wanted, callee) <= MAX_EXT_REGISTER_A + 1;
}

const FORWARD_CONTROL_WORDS = 5;

function lowerOpenReturn(instructions: Instruction[], origin: Instruction, sourceEnd: number, entry: WindowLayout): void {
	// The child's bounded suffix is initialized even when its actual result
	// is shorter. Materializing an index above Top must not expose stale tags.
	const end = Math.max(sourceEnd, entry.sealed ? entry.max : 0);
	const index = end + 1, count = end + 2, one = end + 3, value = end + 4;
	if (end !== sourceEnd) {
		instructions.push(controlInstruction(origin, OpCode.MOV, 0, 0, ValueMoveKind.ReadTop));
		instructions.push(controlInstruction(origin, OpCode.LOADNIL, sourceEnd, end - sourceEnd));
		instructions.push(controlInstruction(origin, OpCode.MOV, end, 0));
	} else instructions.push(controlInstruction(origin, OpCode.MOV, end, 0, ValueMoveKind.ReadTop));
	instructions.push(controlInstruction(origin, OpCode.KSMI, index, origin.a + 1));
	instructions.push(controlInstruction(origin, OpCode.K0, count, 0));
	instructions.push(controlInstruction(origin, OpCode.K1, one, 0));

	const loop = instructions.length;
	instructions.push(controlInstruction(origin, OpCode.LT, 0, index, end));
	const exit = { ...controlInstruction(origin, OpCode.JMP, 0, 0), format: 'AsBx' as const, target: 0 };
	instructions.push(exit);
	instructions.push(controlInstruction(origin, OpCode.MOV, value, index, ValueMoveKind.ReadIndexed));
	instructions.push(controlInstruction(origin, OpCode.MOV, count, value, ValueMoveKind.WriteIndexed));
	instructions.push(controlInstruction(origin, OpCode.ADD, index, index, one));
	instructions.push(controlInstruction(origin, OpCode.ADD, count, count, one));
	instructions.push({ ...exit, target: loop });
	exit.target = instructions.length;

	if (entry.sealed) {
		instructions.push(controlInstruction(origin, OpCode.MOV, index, count));
		instructions.push(controlInstruction(origin, OpCode.KSMI, end, entry.max));
		instructions.push(controlInstruction(origin, OpCode.KNIL, value, 0));
		const clear = instructions.length;
		instructions.push(controlInstruction(origin, OpCode.LT, 0, index, end));
		const done = { ...exit, target: 0 };
		instructions.push(done);
		instructions.push(controlInstruction(origin, OpCode.MOV, index, value, ValueMoveKind.WriteIndexed));
		instructions.push(controlInstruction(origin, OpCode.ADD, index, index, one));
		instructions.push({ ...exit, target: clear });
		done.target = instructions.length;
	}
	instructions.push(controlInstruction(origin, OpCode.JREG, 0, count, RegisterJumpMode.LeaveWindowFromRegister));
}

function lowerWindowBody(body: Body, entry: WindowLayout | undefined, callees: ReadonlyMap<number, WindowLayout> | undefined): WindowBodyLowering {
	const instructions: Instruction[] = [], origins: number[] = [], starts = new Array<number>(body.instructions.length + 1);
	const branches: Instruction[] = [];
	const registerBias = entry === undefined ? 0 : 1;
	let maxStack = entry === undefined ? body.proto.maxStack : entry.width;
	for (let i = 0; i < body.instructions.length; ++i) {
		const instruction = body.instructions[i];
		starts[i] = instructions.length;
		if (entry !== undefined && instruction.op === OpCode.RET) {
			const child = instruction.b === 0 ? callees!.get(i - 1)! : undefined;
			if (child !== undefined && child.min !== child.max) {
				lowerOpenReturn(instructions, instruction, body.instructions[i - 1].a + 1 + child.max, entry);
			} else {
				const count = child === undefined ? decodeValueCount(instruction.b, 0)
					: body.instructions[i - 1].a - instruction.a + child.max;
				// Both ranges are contiguous and the destination is lower. A forward
				// register transfer keeps still-unread produced values intact.
				for (let result = 0; result < count; ++result)
					instructions.push(controlInstruction(instruction, OpCode.MOV, result, instruction.a + 1 + result));
				if (entry.sealed && count < entry.max)
					instructions.push(controlInstruction(instruction, OpCode.LOADNIL, count, entry.max - count));
				instructions.push(controlInstruction(instruction, OpCode.JREG, 0, count, RegisterJumpMode.LeaveWindow));
			}
		} else {
			const callee = callees?.get(i);
			if (callee === undefined) {
				const lower = registerBias === 0 ? { ...instruction } : shiftWindowRegisters(instruction);
				instructions.push(lower);
				if (isJump(lower) || (lower.op === OpCode.JREG && lower.branchTargets !== undefined)) branches.push(lower);
			} else {
				const base = instruction.a + registerBias, supplied = decodeValueCount(instruction.b, 0);
				const wanted = decodeValueCount(instruction.c, -1);
				const initialized = supplied + 1, packet = controlPacketBase(base, supplied, callee);
				if (initialized < callee.top)
					instructions.push(controlInstruction(instruction, OpCode.LOADNIL, base + initialized, callee.top - initialized));
				// Put controls beyond all evaluated actuals. Surplus arguments
				// cease to be visible when entry publishes the formal frontier.
				instructions.push(controlInstruction(instruction, OpCode.KSMI, packet, base));
				instructions.push(controlInstruction(instruction, OpCode.KSMI, packet + 1, callee.width));
				instructions.push(controlInstruction(instruction, OpCode.KSMI, packet + 2, callee.top));
				instructions.push(controlInstruction(instruction, OpCode.JREG, base, packet, RegisterJumpMode.EnterWindow));
				const topRegister = fixedTopRegister(wanted, callee);
				if (wanted > callee.max) {
					instructions.push(controlInstruction(instruction, OpCode.LOADNIL, base + callee.max, wanted - callee.max));
				} else if (topRegister !== -1) {
					instructions.push(controlInstruction(instruction, OpCode.KSMI, base + topRegister, base + wanted));
					instructions.push(controlInstruction(instruction, OpCode.MOV, 0, base + topRegister, ValueMoveKind.SetTop));
				}
				if (entry === undefined) maxStack = Math.max(maxStack, callWindowEnd(base, supplied, wanted, callee));
			}
		}
		const first = instructions[starts[i]];
		first.statementRange = instruction.statementRange;
		first.resumeRange = instruction.resumeRange;
		first.resumeId = instruction.resumeId;
		for (let written = starts[i]; written < instructions.length; ++written) origins.push(i);
	}
	starts[body.instructions.length] = instructions.length;
	for (const instruction of branches) rewriteBranchTargets(instruction, index => starts[index]);
	return { instructions, origins, starts, maxStack, registerBias };
}

/**
 * A software-only entry has one physical body. An address escape or one
 * unmatched calling convention keeps the whole symbol in the language ABI.
 */
export function lowerWindowCalls(bodies: readonly Body[], staticProtos: ReadonlySet<number>, escaped: ReadonlySet<number>,
	resolveSymbol: (target: ProgramCodeFunctionTarget) => number | undefined, resolveClosure: ClosureUpvalueResolver): WindowCallLowering {
	const signatures = new Map<number, BodyReturns>();
	for (const proto of staticProtos) {
		if (escaped.has(proto)) continue;
		const returns = boundedBodyReturns(bodies[proto]);
		if (returns !== undefined) signatures.set(proto, returns);
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
			if (site.b === 0) {
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
	for (const [protoIndex, returns] of signatures) {
		const uses = sites.get(protoIndex);
		if (uses === undefined) continue;
		const candidate: WindowCandidate = { protoIndex, returns, dependencies: [], complete: true,
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
		const { complete, protoIndex, returns, dependencies } = component[0];
		if (component.length !== 1 || !complete || dependencies.includes(component[0])) continue;
		const { proto, instructions } = bodies[protoIndex];
		let width = Math.max(proto.maxStack, proto.numParams) + 1;
		let { min, max } = returns;
		let forwardEnd = -1;
		const callees = edges.get(protoIndex);
		if (callees !== undefined) {
			for (const [site, target] of callees) {
				const { a, b, c } = instructions[site], base = a + 1, supplied = decodeValueCount(b, 0), wanted = decodeValueCount(c, -1);
				const callee = windows.get(target.protoIndex);
				if (callee === undefined || !windowFitsAt(base, supplied, wanted, callee)) continue components;
				width = Math.max(width, callWindowEnd(base, supplied, wanted, callee));
			}
			for (const pc of returns.forwarded) {
				const callee = windows.get(callees.get(pc - 1)!.protoIndex)!;
				const callBase = instructions[pc - 1].a;
				const prefix = callBase - instructions[pc].a;
				min = Math.min(min, prefix + callee.min);
				max = Math.max(max, prefix + callee.max);
				if (callee.min !== callee.max) forwardEnd = Math.max(forwardEnd, callBase + 1 + callee.max);
			}
		}
		if (forwardEnd !== -1) {
			const end = Math.max(forwardEnd, max) + FORWARD_CONTROL_WORDS;
			if (end - 1 > MAX_ABX_REGISTER_A) continue;
			width = Math.max(width, end);
		}
		const window = { min, max, width, top: proto.numParams + 1, sealed: false };
		for (const { caller, instruction } of sites.get(protoIndex)!) {
			const { a, b, c } = bodies[caller].instructions[instruction], wanted = decodeValueCount(c, -1);
			if (!windowFitsAt(a, decodeValueCount(b, 0), wanted, window)) continue components;
			if (min !== max && wanted > min) window.sealed = true;
		}
		windows.set(protoIndex, window);
	}
	for (const [protoIndex] of windows) {
		const forwarded = candidates.get(protoIndex)!.returns.forwarded;
		if (forwarded.length === 0) continue;
		const callees = edges.get(protoIndex)!;
		for (const pc of forwarded) {
			const callee = windows.get(callees.get(pc - 1)!.protoIndex)!;
			if (callee.min !== callee.max) callee.sealed = true;
		}
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
