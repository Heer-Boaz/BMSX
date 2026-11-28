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
import { controlInstruction } from './window_instructions';
import { lowerWindowVararg, WINDOW_VARARG_SCRATCH_WORDS } from './window_varargs';

const RAW_WINDOW_CONTROL_WORDS = 3;

type Body = { proto: Proto; instructions: readonly Instruction[] };
type DirectSite = { caller: number; instruction: number; producer: number };
type ResultRange = { min: number; max: number };
type BodyReturns = ResultRange & {
	forwarded: number[]; suffixes: Map<number, number>; observesCount: boolean; variadic: boolean; varargScratch: boolean;
};
type WindowLayout = ResultRange & {
	top: number; width: number; sealed: boolean; bias: number; parameters: number; observesCount: boolean; extras: ResultRange; scratch: number;
};
type WindowCall = { callee: WindowLayout; supplied: ResultRange };
type CallEdge = { target: WindowCandidate; site: DirectSite };
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
	if (proto.upvalueDescs.length !== 0 || !proto.staticClosure || proto.maxStack > MAX_EXT_REGISTER_A) return;
	const forwarded: number[] = [];
	const suffixes = new Map<number, number>();
	let observesCount = false, variadic = false, varargScratch = false;
	let min = Infinity, max = -1;
	for (let i = 0; i < instructions.length; ++i) {
		const instruction = instructions[i];
		// The borrowed view reserves R0 for the first result, rebasing the
		// original registers by one. An ABx register must still encode.
		if (instruction.format !== 'ABC' && instruction.a >= MAX_ABX_REGISTER_A) return;
		switch (instruction.op) {
			case OpCode.RET: {
				const previous = instructions[i - 1];
				if (i > 0 && isSkipInstruction(previous)) return;
				if (instruction.c === ReturnSource.ExtraArguments) {
					if (!proto.isVararg || instruction.b !== 0 || previous === undefined || previous.a !== instruction.a) return;
					const skip = previous.op === OpCode.K0 ? 0 : previous.op === OpCode.K1 ? 1
						: previous.op === OpCode.KSMI ? previous.b >>> 0 : -1;
					if (skip === -1) return;
					suffixes.set(i, skip);
					observesCount = variadic = varargScratch = true;
					break;
				}
				if (instruction.c !== ReturnSource.Registers) return;
				if (instruction.b === 0) {
					if (previous === undefined || previous.a < instruction.a
						|| !((previous.op === OpCode.CALL && previous.c === 0) || (previous.op === OpCode.VARARG && previous.b === 0))) return;
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
			case OpCode.VARARG:
				if (!proto.isVararg || instruction.b === 1 || (i > 0 && isSkipInstruction(instructions[i - 1]))) return;
				if (instruction.b === 0) {
					const next = instructions[i + 1];
					if (next?.b !== 0 || !((next.op === OpCode.RET && next.c === ReturnSource.Registers && next.a <= instruction.a)
						|| (next.op === OpCode.CALL && next.a < instruction.a))) return;
				}
				observesCount = variadic = true;
				if (instruction.b === 0) varargScratch = true;
				break;
			case OpCode.ARGC:
				observesCount = true;
				break;
			// These operations observe or may suspend/resume a language activation.
			case OpCode.SVC:
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
	if (forwarded.length !== 0 || suffixes.size !== 0) {
		// A variable return must observe its adjacent producer, not arbitrary
		// incoming register state from a different edge.
		const targets = new Set<number>();
		for (const instruction of instructions) visitBranchTargets(instruction, target => targets.add(target));
		if (forwarded.some(pc => targets.has(pc))) return;
		for (const pc of suffixes.keys()) if (targets.has(pc)) return;
	} else if (max === -1) return;
	return { min, max, forwarded, suffixes, observesCount, variadic, varargScratch };
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

function shiftWindowRegisters(instruction: Instruction, bias: number): Instruction {
	const reads = OPCODE_SCALAR_REGISTER_READS[instruction.op];
	const a = (reads & REGISTER_OPERAND_A) !== 0 || OPCODE_WRITES_REGISTER_A[instruction.op] !== 0
		|| instruction.op === OpCode.LOADNIL ? instruction.a + bias : instruction.a;
	const b = (reads & REGISTER_OPERAND_B) !== 0 && instruction.b >= 0 ? instruction.b + bias : instruction.b;
	const c = (reads & REGISTER_OPERAND_C) !== 0 && instruction.c >= 0 ? instruction.c + bias : instruction.c;
	return { ...instruction, a, b, c, rkMask: instruction.rkMask | OPCODE_RK_OPERANDS[instruction.op] };
}

function controlPacketBase(base: number, { callee, supplied }: WindowCall): number {
	const end = base + Math.max(supplied.max + 1, callee.top);
	// A count-observing call moves the raw target out of the result lane.
	// With an open input, keep an extra lane for the sampled old Top.
	return end + (callee.observesCount ? supplied.min !== supplied.max && end === base + supplied.max + 1 ? 2 : 1 : 0);
}

function fixedTopRegister(wanted: number, callee: WindowLayout): number {
	if (wanted === -1 || wanted > callee.max || (wanted === callee.max && wanted === callee.min)) return -1;
	// Every path has initialized this first discarded register or has Top
	// at it. A padded receiver instead uses a register past all results.
	return wanted <= callee.min ? wanted : callee.max;
}

function callWindowEnd(base: number, wanted: number, call: WindowCall): number {
	const { callee } = call;
	const adaptedEnd = Math.max(fixedTopRegister(wanted, callee) + 1, wanted);
	// The child owns its local capacity after entry. The caller includes
	// only the outgoing initialized prefix, controls and returned values.
	return Math.max(base + Math.max(callee.max, adaptedEnd), controlPacketBase(base, call) + RAW_WINDOW_CONTROL_WORDS);
}

function windowFitsAt(base: number, wanted: number, call: WindowCall): boolean {
	return controlPacketBase(base, call) + RAW_WINDOW_CONTROL_WORDS - 1 <= MAX_ABX_REGISTER_A
		&& base + fixedTopRegister(wanted, call.callee) <= MAX_ABX_REGISTER_A
		&& callWindowEnd(base, wanted, call) <= MAX_EXT_REGISTER_A + 1;
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
	instructions.push(controlInstruction(origin, OpCode.KSMI, index, origin.a + entry.bias));
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

function prepareWindowCall(instructions: Instruction[], origin: Instruction, base: number, call: WindowCall): void {
	const { callee, supplied } = call;
	const initialized = base + supplied.max + 1, packet = controlPacketBase(base, call);
	const admittedTop = base + callee.top;
	let target = base;
	if (callee.observesCount) {
		target = packet - 1;
		const dynamic = supplied.min !== supplied.max;
		const formals = base + callee.bias;
		const prefixEnd = callee.bias === 1 ? admittedTop : formals;
		const nilStart = initialized + (dynamic ? 1 : 0);
		if (dynamic) instructions.push(controlInstruction(origin, OpCode.MOV, initialized, 0, ValueMoveKind.ReadTop));
		if (nilStart < prefixEnd) instructions.push(controlInstruction(origin, OpCode.LOADNIL, nilStart, prefixEnd - nilStart));
		// Keep the original variadic tuple below the language register view.
		// The first formal can share the sampled Top slot until its last use.
		const deferredFormal = dynamic && callee.bias !== 1 && initialized === formals && callee.parameters !== 0;
		if (callee.bias !== 1) {
			const copied = Math.min(supplied.max, callee.parameters);
			for (let formal = deferredFormal ? 1 : 0; formal < copied; ++formal)
				instructions.push(controlInstruction(origin, OpCode.MOV, formals + formal, base + 1 + formal));
			if (copied < callee.parameters)
				instructions.push(controlInstruction(origin, OpCode.LOADNIL, formals + copied, callee.parameters - copied));
		}
		instructions.push(controlInstruction(origin, OpCode.MOV, target, base));
		if (dynamic) {
			instructions.push(controlInstruction(origin, OpCode.KSMI, packet, base + 1));
			instructions.push(controlInstruction(origin, OpCode.SUB, base, initialized, packet));
			if (deferredFormal) instructions.push(controlInstruction(origin, OpCode.MOV, formals, base + 1));
			else if (initialized < admittedTop) instructions.push(controlInstruction(origin, OpCode.KNIL, initialized, 0));
		} else instructions.push(controlInstruction(origin, OpCode.KSMI, base, supplied.max));
	} else if (initialized < admittedTop) {
		instructions.push(controlInstruction(origin, OpCode.LOADNIL, initialized, admittedTop - initialized));
	}
	// Controls are beyond all evaluated actuals; only the admitted prefix
	// belongs to the new view. A fixed callee doesn't need an actual count.
	instructions.push(controlInstruction(origin, OpCode.KSMI, packet, base));
	instructions.push(controlInstruction(origin, OpCode.KSMI, packet + 1, callee.width));
	instructions.push(controlInstruction(origin, OpCode.KSMI, packet + 2, callee.top));
	instructions.push(controlInstruction(origin, OpCode.JREG, target, packet, RegisterJumpMode.EnterWindow));
}

function lowerWindowBody(body: Body, entry: WindowLayout | undefined, callees: ReadonlyMap<number, WindowCall> | undefined,
	returns: BodyReturns | undefined): WindowBodyLowering {
	const instructions: Instruction[] = [], origins: number[] = [], starts = new Array<number>(body.instructions.length + 1);
	const branches: Instruction[] = [];
	const registerBias = entry === undefined ? 0 : entry.bias;
	let maxStack = entry === undefined ? body.proto.maxStack : entry.width;
	for (let i = 0; i < body.instructions.length; ++i) {
		const instruction = body.instructions[i];
		starts[i] = instructions.length;
		if (entry !== undefined && (instruction.op === OpCode.ARGC || instruction.op === OpCode.VARARG
			|| (instruction.op === OpCode.RET && instruction.c === ReturnSource.ExtraArguments))) {
			lowerWindowVararg(instructions, instruction, {
				bias: entry.bias, parameters: entry.parameters, extras: entry.extras, maxResults: entry.max,
				sealed: entry.sealed, scratch: entry.scratch,
			}, returns!.suffixes.get(i));
		} else if (entry !== undefined && instruction.op === OpCode.RET) {
			const producer = body.instructions[i - 1];
			const child = instruction.b !== 0 ? undefined : producer.op === OpCode.VARARG ? entry.extras : callees!.get(i - 1)!.callee;
			if (child !== undefined && child.min !== child.max) {
				lowerOpenReturn(instructions, instruction, producer.a + entry.bias + child.max, entry);
			} else {
				const count = child === undefined ? decodeValueCount(instruction.b, 0)
					: producer.a - instruction.a + child.max;
				// Both ranges are contiguous and the destination is lower. A forward
				// register transfer keeps still-unread produced values intact.
				for (let result = 0; result < count; ++result)
					instructions.push(controlInstruction(instruction, OpCode.MOV, result, instruction.a + entry.bias + result));
				if (entry.sealed && count < entry.max)
					instructions.push(controlInstruction(instruction, OpCode.LOADNIL, count, entry.max - count));
				instructions.push(controlInstruction(instruction, OpCode.JREG, 0, count, RegisterJumpMode.LeaveWindow));
			}
		} else {
			const call = callees?.get(i);
			if (call === undefined) {
				const lower = registerBias === 0 ? { ...instruction } : shiftWindowRegisters(instruction, registerBias);
				instructions.push(lower);
				if (isJump(lower) || (lower.op === OpCode.JREG && lower.branchTargets !== undefined)) branches.push(lower);
			} else {
				const { callee } = call;
				const base = instruction.a + registerBias;
				const wanted = decodeValueCount(instruction.c, -1);
				prepareWindowCall(instructions, instruction, base, call);
				const topRegister = fixedTopRegister(wanted, callee);
				if (wanted > callee.max) {
					instructions.push(controlInstruction(instruction, OpCode.LOADNIL, base + callee.max, wanted - callee.max));
				} else if (topRegister !== -1) {
					instructions.push(controlInstruction(instruction, OpCode.KSMI, base + topRegister, base + wanted));
					instructions.push(controlInstruction(instruction, OpCode.MOV, 0, base + topRegister, ValueMoveKind.SetTop));
				}
				if (entry === undefined) maxStack = Math.max(maxStack, callWindowEnd(base, wanted, call));
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
			let producer = -1;
			if (site.b === 0) {
				const previous = instructions[call - 1];
				if (previous === undefined || previous.a <= site.a
					|| !((previous.op === OpCode.CALL && previous.c === 0) || (previous.op === OpCode.VARARG && previous.b === 0))) {
					signatures.delete(callee);
					continue;
				}
				producer = call - 1;
			}
			let uses = sites.get(callee);
			if (uses === undefined) sites.set(callee, uses = []);
			uses.push({ caller, instruction: call, producer });
		}
	}
	const candidates = new Map<number, WindowCandidate>();
	const edges = new Map<number, Map<number, CallEdge>>();
	for (const [protoIndex, returns] of signatures) {
		const uses = sites.get(protoIndex);
		if (uses === undefined) continue;
		const candidate: WindowCandidate = { protoIndex, returns, dependencies: [], complete: true,
			index: -1, lowlink: 0, component: -1, active: false };
		candidates.set(protoIndex, candidate);
		for (const site of uses) {
			let byPc = edges.get(site.caller);
			if (byPc === undefined) edges.set(site.caller, byPc = new Map());
			byPc.set(site.instruction, { target: candidate, site });
		}
	}
	for (const candidate of candidates.values()) {
		const { protoIndex, dependencies } = candidate;
		const instructions = bodies[protoIndex].instructions;
		const callees = edges.get(protoIndex);
		for (let i = 0; i < instructions.length; ++i) {
			if (instructions[i].op !== OpCode.CALL) continue;
			const edge = callees?.get(i);
			if (edge === undefined) candidate.complete = false;
			else dependencies.push(edge.target);
		}
	}

	// Operand counts do not depend on the transitive window extent. For
	// example B(A()) can borrow both A and B even if the body of A calls B.
	// Only a real cycle in the count provenance prevents a finite proof.
	const argumentBounds = new Map<DirectSite, ResultRange>();
	const inputBounds = new Map<number, ResultRange | null>();
	const resultBounds = new Map<number, ResultRange | null>();
	const extraBounds = (input: ResultRange, parameters: number): ResultRange =>
		({ min: Math.max(0, input.min - parameters), max: Math.max(0, input.max - parameters) });
	function boundCall(site: DirectSite): ResultRange | null {
		const prior = argumentBounds.get(site);
		if (prior !== undefined) return prior;
		const instructions = bodies[site.caller].instructions;
		const call = instructions[site.instruction];
		let bounds: ResultRange;
		if (site.producer === -1) {
			const count = decodeValueCount(call.b, 0);
			bounds = { min: count, max: count };
		} else {
			const producer = instructions[site.producer];
			let results: ResultRange | null;
			if (producer.op === OpCode.VARARG) {
				if (!candidates.has(site.caller)) return null;
				const input = boundInputs(site.caller);
				results = input === null ? null : extraBounds(input, bodies[site.caller].proto.numParams);
			} else {
				const edge = edges.get(site.caller)?.get(site.producer);
				results = edge === undefined ? null : boundResults(edge.target);
			}
			if (results === null) return null;
			const prefix = producer.a - call.a - 1;
			bounds = { min: prefix + results.min, max: prefix + results.max };
		}
		argumentBounds.set(site, bounds);
		return bounds;
	}
	function boundInputs(protoIndex: number): ResultRange | null {
		const prior = inputBounds.get(protoIndex);
		if (prior !== undefined) return prior;
		inputBounds.set(protoIndex, null);
		let min = Infinity, max = -1;
		for (const site of sites.get(protoIndex)!) {
			const bounds = boundCall(site);
			if (bounds === null) return null;
			min = Math.min(min, bounds.min);
			max = Math.max(max, bounds.max);
		}
		const bounds = { min, max };
		inputBounds.set(protoIndex, bounds);
		return bounds;
	}
	function boundResults({ protoIndex, returns }: WindowCandidate): ResultRange | null {
		const prior = resultBounds.get(protoIndex);
		if (prior !== undefined) return prior;
		resultBounds.set(protoIndex, null);
		const { proto, instructions } = bodies[protoIndex];
		let extras: ResultRange | undefined;
		if (returns.suffixes.size !== 0 || returns.forwarded.some(pc => instructions[pc - 1].op === OpCode.VARARG)) {
			const inputs = boundInputs(protoIndex);
			if (inputs === null) return null;
			extras = extraBounds(inputs, proto.numParams);
		}
		let { min, max } = returns;
		for (const pc of returns.forwarded) {
			const previous = instructions[pc - 1];
			const edge = edges.get(protoIndex)?.get(pc - 1);
			const results = previous.op === OpCode.VARARG ? extras! : edge === undefined ? null : boundResults(edge.target);
			if (results === null) return null;
			const prefix = previous.a - instructions[pc].a;
			min = Math.min(min, prefix + results.min);
			max = Math.max(max, prefix + results.max);
		}
		for (const skip of returns.suffixes.values()) {
			min = Math.min(min, Math.max(0, extras!.min - skip));
			max = Math.max(max, Math.max(0, extras!.max - skip));
		}
		const bounds = { min, max };
		resultBounds.set(protoIndex, bounds);
		return bounds;
	}

	// Certify the acyclic call graph bottom-up, but size each physical view
	// from its own instructions and outgoing transfer registers only.
	const windows = new Map<number, WindowLayout>();
	components: for (const component of stronglyConnectedComponents(candidates.values())) {
		const candidate = component[0], { complete, protoIndex, returns, dependencies } = candidate;
		if (component.length !== 1 || !complete || dependencies.includes(candidate)) continue;
		const { proto, instructions } = bodies[protoIndex];
		const inputs = boundInputs(protoIndex), results = boundResults(candidate);
		if (inputs === null || results === null) continue;
		const parameters = proto.numParams, { min, max } = results;
		const extras = extraBounds(inputs, parameters);
		const inputPrefix = returns.variadic ? Math.max(parameters, inputs.max) + 1 : 1;
		const scratch = returns.varargScratch ? Math.max(inputPrefix, returns.suffixes.size === 0 ? 0 : max) : 0;
		const bias = returns.varargScratch ? scratch + WINDOW_VARARG_SCRATCH_WORDS : inputPrefix;
		if (scratch + WINDOW_VARARG_SCRATCH_WORDS - 1 > MAX_ABX_REGISTER_A
			|| instructions.some(instruction => instruction.format !== 'ABC' && instruction.a + bias > MAX_ABX_REGISTER_A)) continue;
		let width = Math.max(proto.maxStack, parameters) + bias;
		for (const instruction of instructions)
			if (instruction.op === OpCode.VARARG && instruction.b === 0)
				width = Math.max(width, instruction.a + bias + extras.max);
		let forwardEnd = -1;
		const callees = edges.get(protoIndex);
		if (callees !== undefined) {
			for (const [pc, edge] of callees) {
				const { a, c } = instructions[pc], base = a + bias, wanted = decodeValueCount(c, -1);
				const callee = windows.get(edge.target.protoIndex), supplied = boundCall(edge.site);
				if (callee === undefined || supplied === null) continue components;
				const call = { callee, supplied };
				if (!windowFitsAt(base, wanted, call)) continue components;
				width = Math.max(width, callWindowEnd(base, wanted, call));
			}
		}
		for (const pc of returns.forwarded) {
			const producer = instructions[pc - 1];
			const child = producer.op === OpCode.VARARG ? extras : windows.get(callees!.get(pc - 1)!.target.protoIndex)!;
			if (child.min !== child.max) forwardEnd = Math.max(forwardEnd, producer.a + bias + child.max);
		}
		if (forwardEnd !== -1) {
			const end = Math.max(forwardEnd, max) + FORWARD_CONTROL_WORDS;
			if (end - 1 > MAX_ABX_REGISTER_A) continue;
			width = Math.max(width, end);
		}
		if (width > MAX_EXT_REGISTER_A + 1) continue;
		const window = { min, max, width, top: parameters + bias, sealed: false, bias, parameters, extras, scratch,
			observesCount: returns.observesCount };
		for (const site of sites.get(protoIndex)!) {
			const { a, c } = bodies[site.caller].instructions[site.instruction], wanted = decodeValueCount(c, -1);
			if (!windowFitsAt(a, wanted, { callee: window, supplied: argumentBounds.get(site)! })) continue components;
			if (min !== max && wanted > min) window.sealed = true;
		}
		windows.set(protoIndex, window);
	}
	// A producer can have a finite result shape but still fail to acquire a
	// raw body (e.g. outgoing controls do not encode). Open input needs its physical
	// initialized suffix; drop that consumer and every dependent raw body.
	const dependents = new Map<number, number[]>(), unavailable: number[] = [];
	function requireWindow(owner: number, target: number): void {
		const list = dependents.get(target);
		if (list === undefined) dependents.set(target, [owner]);
		else list.push(owner);
	}
	for (const { protoIndex, dependencies } of candidates.values()) {
		if (!windows.has(protoIndex)) {
			unavailable.push(protoIndex);
			continue;
		}
		for (const dependency of dependencies) requireWindow(protoIndex, dependency.protoIndex);
		for (const site of sites.get(protoIndex)!) {
			if (site.producer === -1) continue;
			const producer = bodies[site.caller].instructions[site.producer];
			requireWindow(protoIndex, producer.op === OpCode.VARARG ? site.caller
				: edges.get(site.caller)!.get(site.producer)!.target.protoIndex);
		}
	}
	for (let i = 0; i < unavailable.length; ++i) {
		const applications = dependents.get(unavailable[i]);
		if (applications === undefined) continue;
		for (const owner of applications) if (windows.delete(owner)) unavailable.push(owner);
	}

	for (const [protoIndex] of windows) {
		for (const site of sites.get(protoIndex)!) {
			if (site.producer === -1 || bodies[site.caller].instructions[site.producer].op === OpCode.VARARG) continue;
			const producer = windows.get(edges.get(site.caller)!.get(site.producer)!.target.protoIndex)!;
			if (producer.min !== producer.max) producer.sealed = true;
		}
		const { forwarded } = candidates.get(protoIndex)!.returns;
		const instructions = bodies[protoIndex].instructions, callees = edges.get(protoIndex);
		for (const pc of forwarded) {
			if (instructions[pc - 1].op === OpCode.VARARG) continue;
			const callee = windows.get(callees!.get(pc - 1)!.target.protoIndex)!;
			if (callee.min !== callee.max) callee.sealed = true;
		}
	}

	const rewrites = new Map<number, WindowBodyLowering>();
	for (let protoIndex = 0; protoIndex < bodies.length; ++protoIndex) {
		const window = windows.get(protoIndex), callees = edges.get(protoIndex);
		let lowered: Map<number, WindowCall> | undefined;
		if (callees !== undefined) {
			for (const [pc, edge] of callees) {
				const callee = windows.get(edge.target.protoIndex);
				if (callee !== undefined) (lowered ??= new Map()).set(pc, { callee, supplied: argumentBounds.get(edge.site)! });
			}
		}
		if (window !== undefined || lowered !== undefined)
			rewrites.set(protoIndex, lowerWindowBody(bodies[protoIndex], window, lowered, signatures.get(protoIndex)));
	}
	return { entries: new Set(windows.keys()), bodies: rewrites };
}
