import { COP0_EVENT_CYCLES } from '../../../../machine/ts/spec/blua32/cop0';
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
import { createWindowCallTargetProof } from './window_call_targets';
import { lowerWindowVararg, windowVarargRange, WINDOW_VARARG_SCRATCH_WORDS } from './window_varargs';

type Body = { proto: Proto; instructions: readonly Instruction[] };
type CallSite = { caller: number; instruction: number; producer: number; targets: readonly number[]; targetLive: readonly number[] };
type ResultRange = { min: number; max: number };
type BodyReturns = ResultRange & {
	forwarded: number[]; suffixes: Map<number, number>; readsArgumentCount: boolean; variadic: boolean; hasOpenVararg: boolean;
};
type WindowLayout = ResultRange & {
	width: number; sealed: boolean; bias: number; parameters: number; extras: ResultRange; scratch: number;
	argumentCountSlot: number; argumentCount: number; discardResults: boolean; publishesCount: boolean; placement: number;
};
type WindowCall = { callee: WindowLayout; supplied: ResultRange; directTarget?: number };
type WindowCallSite = WindowCall & { targets: readonly number[]; targetLive: readonly number[] };
type CallEdge = { targets: readonly WindowCandidate[]; site: CallSite };
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
	softwareEntry: boolean;
	softwareCalls: readonly {
		origin: number; start: number; jump: number; end: number; baseDelta: number;
		targets: readonly number[]; targetLive: readonly number[];
	}[];
	linkSlots: readonly { instruction: number; slot: number }[];
};

export type WindowCallLowering = {
	entries: ReadonlySet<number>;
	bodies: ReadonlyMap<number, WindowBodyLowering>;
};

function boundedBodyReturns({ proto, instructions }: Body): BodyReturns | undefined {
	if (proto.upvalueDescs.length !== 0 || !proto.staticClosure || proto.maxStack > MAX_EXT_REGISTER_A) return;
	const forwarded: number[] = [];
	const suffixes = new Map<number, number>();
	let readsArgumentCount = false, variadic = false, hasOpenVararg = false;
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
				variadic = true;
				if (instruction.b === 0) hasOpenVararg = true;
				break;
			case OpCode.ARGC:
				readsArgumentCount = true;
				break;
			case OpCode.MFC0:
				// The clock horizon depends on executed cycles, not on the
				// language activation that owns this register window.
				if (instruction.b !== COP0_EVENT_CYCLES) return;
				break;
			// These operations observe or may suspend/resume a language activation.
			case OpCode.SVC:
			case OpCode.GETUP: case OpCode.SETUP: case OpCode.JAL: case OpCode.JREG:
			case OpCode.HALT: case OpCode.RFE: case OpCode.MTC0:
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
	return { min, max, forwarded, suffixes, readsArgumentCount, variadic, hasOpenVararg };
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

function callWindowEnd(base: number, wanted: number, call: WindowCall): number {
	const { callee, supplied } = call;
	const count = callee.argumentCountSlot;
	const countEnd = count === 0 ? 0 : count + 1 + +(supplied.min !== supplied.max && supplied.max + 1 === count);
	return base + Math.max(callee.width, callee.max, wanted, countEnd);
}

function windowFitsAt(base: number, wanted: number, call: WindowCall): boolean {
	const { callee, supplied } = call;
	if (callWindowEnd(base, wanted, call) > MAX_EXT_REGISTER_A + 1) return false;
	const count = callee.argumentCountSlot;
	if (count !== 0 && base + count + +(supplied.min !== supplied.max && supplied.max + 1 === count) > MAX_ABX_REGISTER_A) return false;
	return base + (wanted === -1 ? callee.max : wanted) <= MAX_EXT_REGISTER_A;
}

const FORWARD_CONTROL_WORDS = 6;

function fixedReturnLink(entry: WindowLayout, sourceEnd: number, count: number): number {
	const published = entry.sealed ? entry.max : count;
	return published !== 0 ? Math.max(sourceEnd, published + +entry.publishesCount) : 0;
}

function lowerOpenReturn(instructions: Instruction[], origin: Instruction, sourceEnd: number, entry: WindowLayout,
	linkSlots: WindowBodyLowering['linkSlots'][number][]): void {
	// The child's bounded suffix is initialized even when its actual result
	// is shorter. Materializing an index above Top must not expose stale tags.
	const end = Math.max(sourceEnd, entry.sealed ? entry.max : 0);
	const index = end + 1, count = end + 2, one = end + 3, link = end + 4, value = end + 5;
	instructions.push(controlInstruction(origin, OpCode.MOV, sourceEnd, 0, ValueMoveKind.ReadTop));
	if (end !== sourceEnd) {
		if (end !== sourceEnd + 1)
			instructions.push(controlInstruction(origin, OpCode.LOADNIL, sourceEnd + 1, end - sourceEnd - 1));
		instructions.push(controlInstruction(origin, OpCode.MOV, end, sourceEnd));
	}
	instructions.push(controlInstruction(origin, OpCode.KSMI, index, origin.a + entry.bias));
	instructions.push(controlInstruction(origin, OpCode.K0, count, 0));
	instructions.push(controlInstruction(origin, OpCode.K1, one, 0));
	instructions.push(controlInstruction(origin, OpCode.MOV, link, 0));
	linkSlots.push({ instruction: instructions.length, slot: link });

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
	if (entry.publishesCount) instructions.push(controlInstruction(origin, OpCode.MOV, entry.max, count));
	instructions.push(controlInstruction(origin, OpCode.JREG, link, 0, RegisterJumpMode.Jump));
	linkSlots.push({ instruction: instructions.length, slot: 0 });
}

function prepareWindowCall(instructions: Instruction[], origin: Instruction, base: number, call: WindowCall): number {
	const { callee, supplied } = call;
	let initialized = base + supplied.max + 1;
	const formals = base + callee.bias;
	if (callee.argumentCountSlot !== 0) {
		const count = base + callee.argumentCountSlot;
		if (supplied.min === supplied.max) {
			if (initialized < count) instructions.push(controlInstruction(origin, OpCode.LOADNIL, initialized, count - initialized));
			instructions.push(controlInstruction(origin, OpCode.KSMI, count, supplied.max));
			initialized = count + 1;
		} else {
			// The open producer sealed this site's argument prefix. Sample
			// Top before any later nil padding or formal copies can raise it.
			const sample = initialized;
			const subtract = sample === count ? count + 1 : count;
			instructions.push(controlInstruction(origin, OpCode.MOV, sample, 0, ValueMoveKind.ReadTop));
			if (sample + 1 < subtract)
				instructions.push(controlInstruction(origin, OpCode.LOADNIL, sample + 1, subtract - sample - 1));
			instructions.push(controlInstruction(origin, OpCode.KSMI, subtract, base + 1));
			instructions.push(controlInstruction(origin, OpCode.SUB, count, sample, subtract));
			if (sample !== count) instructions.push(controlInstruction(origin, OpCode.KNIL, sample, 0));
			initialized = subtract + 1;
		}
	}
	const prefixEnd = callee.bias === 1 ? formals + callee.parameters : formals;
	if (initialized < prefixEnd) instructions.push(controlInstruction(origin, OpCode.LOADNIL, initialized, prefixEnd - initialized));
	if (callee.bias !== 1) {
		const copied = Math.min(supplied.max, callee.parameters);
		for (let formal = 0; formal < copied; ++formal)
			instructions.push(controlInstruction(origin, OpCode.MOV, formals + formal, base + 1 + formal));
		if (copied < callee.parameters)
			instructions.push(controlInstruction(origin, OpCode.LOADNIL, formals + copied, callee.parameters - copied));
	}
	const displacement = base - callee.placement;
	if (displacement !== 0) instructions.push(controlInstruction(origin, OpCode.MOV, 0, displacement, ValueMoveKind.AddBase));
	const jump = instructions.length;
	if (call.directTarget === undefined)
		instructions.push(controlInstruction(origin, OpCode.JREG, 0, 0, RegisterJumpMode.Link));
	else instructions.push({ ...controlInstruction(origin, OpCode.JAL, callee.placement, 0), format: 'AsBx', jumpProtoIndex: call.directTarget });
	return jump;
}

function lowerWindowBody(body: Body, entry: WindowLayout | undefined, callees: ReadonlyMap<number, WindowCallSite> | undefined,
	returns: BodyReturns | undefined): WindowBodyLowering {
	const instructions: Instruction[] = [], origins: number[] = [], starts = new Array<number>(body.instructions.length + 1);
	const branches: Instruction[] = [];
	const softwareCalls: WindowBodyLowering['softwareCalls'][number][] = [];
	const linkSlots: WindowBodyLowering['linkSlots'][number][] = [];
	const placement = entry?.placement ?? 0;
	const registerBias = entry === undefined ? 0 : entry.bias + placement;
	let maxStack = entry === undefined ? body.proto.maxStack : entry.width + placement;
	if (placement !== 0) linkSlots.push({ instruction: 0, slot: placement });
	for (let i = 0; i < body.instructions.length; ++i) {
		const instruction = body.instructions[i];
		starts[i] = instructions.length;
		if (entry !== undefined && entry.discardResults && instruction.op === OpCode.RET) {
			// Keep every expression producer without overwriting the link.
			instructions.push(controlInstruction(instruction, OpCode.JREG, placement, 0, RegisterJumpMode.Jump));
		} else if (entry !== undefined && (instruction.op === OpCode.ARGC || instruction.op === OpCode.VARARG)) {
			lowerWindowVararg(instructions, instruction, entry, linkSlots);
		} else if (entry !== undefined && instruction.op === OpCode.RET) {
			const skip = returns!.suffixes.get(i);
			const suffix = skip === undefined ? undefined : windowVarargRange(entry.extras, skip);
			const producer = body.instructions[i - 1];
			const child = suffix !== undefined || instruction.b !== 0 ? undefined
				: producer.op === OpCode.VARARG ? entry.extras : callees!.get(i - 1)!.callee;
			if (suffix !== undefined && suffix.min !== suffix.max) {
				lowerWindowVararg(instructions, instruction, entry, linkSlots, skip);
			} else if (child !== undefined && child.min !== child.max) {
				lowerOpenReturn(instructions, instruction, producer.a + entry.bias + child.max, entry, linkSlots);
			} else {
				const count = suffix !== undefined ? suffix.max : child === undefined ? decodeValueCount(instruction.b, 0)
					: producer.a - instruction.a + child.max;
				const source = skip === undefined || count === 0 ? instruction.a + registerBias : entry.parameters + 1 + skip;
				const sourceEnd = source + count;
				const link = placement + fixedReturnLink(entry, sourceEnd - placement, count);
				if (link !== placement) {
					if (sourceEnd < link) instructions.push(controlInstruction(instruction, OpCode.LOADNIL, sourceEnd, link - sourceEnd));
					instructions.push(controlInstruction(instruction, OpCode.MOV, link, placement));
					linkSlots.push({ instruction: instructions.length, slot: link });
				}
				// Both ranges are contiguous and the destination is lower. A forward
				// register transfer keeps still-unread produced values intact.
				for (let result = 0; result < count; ++result)
					instructions.push(controlInstruction(instruction, OpCode.MOV, placement + result, source + result));
				const resultEnd = placement + count, maxEnd = placement + entry.max;
				const padEnd = link === placement ? maxEnd : Math.min(maxEnd, sourceEnd);
				if (entry.sealed && resultEnd < padEnd)
					instructions.push(controlInstruction(instruction, OpCode.LOADNIL, resultEnd, padEnd - resultEnd));
				if (entry.publishesCount) instructions.push(controlInstruction(instruction, OpCode.KSMI, entry.max, count));
				instructions.push(controlInstruction(instruction, OpCode.JREG, link, 0, RegisterJumpMode.Jump));
				if (link !== placement) linkSlots.push({ instruction: instructions.length, slot: placement });
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
				const jump = prepareWindowCall(instructions, instruction, base, call);
				const placement = callee.placement;
				// The count and link must remain below Top until the raw
				// jump retires: firmware can clear the dead suffix on IRQ.
				if (wanted === -1 && callee.publishesCount)
					instructions.push(controlInstruction(instruction, OpCode.MOV, 0, callee.max, ValueMoveKind.SetTop));
				else {
					const results = wanted === -1 ? callee.max : wanted;
					if (results > callee.max)
						instructions.push(controlInstruction(instruction, OpCode.LOADNIL, placement + callee.max, results - callee.max));
					instructions.push(controlInstruction(instruction, OpCode.MOV, placement + results, 0, ValueMoveKind.SetTopImmediate));
				}
				const displacement = base - placement;
				if (displacement !== 0) instructions.push(controlInstruction(instruction, OpCode.MOV, 0, -displacement, ValueMoveKind.AddBase));
				softwareCalls.push({ origin: i, start: starts[i], jump, end: instructions.length,
					baseDelta: displacement, targets: call.targets, targetLive: call.targetLive });
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
	return { instructions, origins, starts, maxStack, registerBias, softwareEntry: entry !== undefined, softwareCalls, linkSlots };
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
	const sites = new Map<number, CallSite[]>(), allSites: CallSite[] = [];
	for (let caller = 0; caller < bodies.length; ++caller) {
		const { proto, instructions } = bodies[caller];
		let entries: Set<number> | undefined;
		let proveFiniteCall: ReturnType<typeof createWindowCallTargetProof> | undefined;
		let found: Set<number> | undefined;
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
			let call = opensCaptures ? -1 : directCallAfterLoad(instructions, proto.maxStack, i, entries, resolveClosure);
			let targets: readonly number[] = [callee];
			let targetLive: readonly number[] = [];
			if (call === -1 && !opensCaptures) {
				proveFiniteCall ??= createWindowCallTargetProof(instructions, proto.maxStack, resolveClosure);
				const choice = proveFiniteCall(i);
				if (choice !== undefined) {
					const symbols = choice.loads.map(load => resolveSymbol(instructions[load].symbolicReloc!));
					if (symbols.every(symbol => symbol !== undefined)) {
						call = choice.instruction;
						targets = [...new Set(symbols)];
						if (targets.length > 1) targetLive = choice.live;
					}
				}
			}
			if (call < 0) {
				signatures.delete(callee);
				continue;
			}
			if (found?.has(call)) continue;
			(found ??= new Set()).add(call);
			const instruction = instructions[call];
			let producer = -1;
			if (instruction.b === 0) {
				const previous = instructions[call - 1];
				// The direct proof excludes other incoming edges; a finite choice
				// may join at the call, so an open source must be exclusive too.
				if (previous === undefined || previous.a <= instruction.a || entries.has(call)
					|| !((previous.op === OpCode.CALL && previous.c === 0) || (previous.op === OpCode.VARARG && previous.b === 0))) {
					for (const target of targets) signatures.delete(target);
					continue;
				}
				producer = call - 1;
			}
			const site = { caller, instruction: call, producer, targets, targetLive };
			allSites.push(site);
			for (const target of targets) {
				const uses = sites.get(target);
				if (uses === undefined) sites.set(target, [site]);
				else uses.push(site);
			}
		}
	}
	// A finite indirect call has only one physical ABI. If one arm needs
	// results at any of its uses, every connected arm keeps the result ABI.
	const observedResults = new Set<number>();
	for (const site of allSites) {
		if (bodies[site.caller].instructions[site.instruction].c !== 1)
			for (const target of site.targets) observedResults.add(target);
	}
	for (const target of observedResults) {
		for (const site of sites.get(target)!)
			for (const other of site.targets) observedResults.add(other);
	}
	const candidates = new Map<number, WindowCandidate>();
	const edges = new Map<number, Map<number, CallEdge>>();
	for (const [protoIndex, returns] of signatures) {
		const uses = sites.get(protoIndex);
		if (uses === undefined) continue;
		const candidate: WindowCandidate = { protoIndex, returns, dependencies: [], complete: true,
			index: -1, lowlink: 0, component: -1, active: false };
		candidates.set(protoIndex, candidate);
	}
	for (const site of allSites) {
		const targets = site.targets.map(target => candidates.get(target));
		if (!targets.every(target => target !== undefined)) {
			for (const target of targets) if (target !== undefined) target.complete = false;
			continue;
		}
		let byPc = edges.get(site.caller);
		if (byPc === undefined) edges.set(site.caller, byPc = new Map());
		byPc.set(site.instruction, { targets, site });
	}
	for (const candidate of candidates.values()) {
		const { protoIndex, dependencies } = candidate;
		const instructions = bodies[protoIndex].instructions;
		const callees = edges.get(protoIndex);
		for (let i = 0; i < instructions.length; ++i) {
			if (instructions[i].op !== OpCode.CALL) continue;
			const edge = callees?.get(i);
			if (edge === undefined) candidate.complete = false;
			else dependencies.push(...edge.targets);
		}
	}

	// Operand counts do not depend on the transitive window extent. For
	// example B(A()) can borrow both A and B even if the body of A calls B.
	// Only a real cycle in the count provenance prevents a finite proof.
	const argumentBounds = new Map<CallSite, ResultRange>();
	const inputBounds = new Map<number, ResultRange | null>();
	const resultBounds = new Map<number, ResultRange | null>();
	const extraBounds = (input: ResultRange, parameters: number): ResultRange =>
		({ min: Math.max(0, input.min - parameters), max: Math.max(0, input.max - parameters) });
	function boundCall(site: CallSite): ResultRange | null {
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
				results = edge === undefined ? null : edgeResultBounds(edge);
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
		if (!observedResults.has(protoIndex)) return { min: 0, max: 0 };
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
			const results = previous.op === OpCode.VARARG ? extras! : edge === undefined ? null : edgeResultBounds(edge);
			if (results === null) return null;
			const prefix = previous.a - instructions[pc].a;
			min = Math.min(min, prefix + results.min);
			max = Math.max(max, prefix + results.max);
		}
		for (const skip of returns.suffixes.values()) {
			const suffix = windowVarargRange(extras!, skip);
			min = Math.min(min, suffix.min);
			max = Math.max(max, suffix.max);
		}
		const bounds = { min, max };
		resultBounds.set(protoIndex, bounds);
		return bounds;
	}
	function edgeResultBounds(edge: CallEdge): ResultRange | null {
		const bounds = boundResults(edge.targets[0]);
		if (bounds === null) return null;
		for (let index = 1; index < edge.targets.length; ++index) {
			const other = boundResults(edge.targets[index]);
			if (other === null || bounds.min !== other.min || bounds.max !== other.max) return null;
		}
		return bounds;
	}

	// Certify the acyclic call graph bottom-up, but size each physical view
	// from its own instructions and outgoing transfer registers only.
	const windows = new Map<number, WindowLayout>();
	function sharedWindow(edge: CallEdge): WindowLayout | undefined {
		const first = windows.get(edge.targets[0].protoIndex);
		if (first === undefined) return;
		let width = first.width;
		for (let index = 1; index < edge.targets.length; ++index) {
			const other = windows.get(edge.targets[index].protoIndex);
			if (other === undefined || other.min !== first.min || other.max !== first.max || other.bias !== first.bias
				|| other.parameters !== first.parameters || other.argumentCountSlot !== first.argumentCountSlot) return;
			width = Math.max(width, other.width);
		}
		return width === first.width ? first : { ...first, width };
	}
	components: for (const component of stronglyConnectedComponents(candidates.values())) {
		const candidate = component[0], { complete, protoIndex, returns, dependencies } = candidate;
		if (component.length !== 1 || !complete || dependencies.includes(candidate)) continue;
		const { proto, instructions } = bodies[protoIndex];
		const inputs = boundInputs(protoIndex), results = boundResults(candidate);
		if (inputs === null || results === null) continue;
		const parameters = proto.numParams, { min, max } = results;
		const extras = extraBounds(inputs, parameters);
		const discardResults = !observedResults.has(protoIndex);
		const returnsSuffix = !discardResults && returns.suffixes.size !== 0;
		let dynamicSuffix = false;
		if (returnsSuffix && extras.min !== extras.max) {
			for (const skip of returns.suffixes.values()) {
				if (skip < extras.max) { dynamicSuffix = true; break; }
			}
		}
		const dynamicVararg = extras.min !== extras.max && returns.hasOpenVararg;
		const dynamicCount = inputs.min !== inputs.max && (returns.readsArgumentCount || dynamicSuffix || dynamicVararg);
		const tupleEnd = returns.variadic || returnsSuffix || dynamicCount ? Math.max(parameters, inputs.max) + 1 : 1;
		const argumentCountSlot = dynamicCount ? tupleEnd : 0;
		const inputPrefix = tupleEnd + +dynamicCount;
		const uses = sites.get(protoIndex)!;
		const publishesCount = min !== max && uses.some(site => bodies[site.caller].instructions[site.instruction].c === 0);
		if (publishesCount && max > MAX_ABX_REGISTER_A) continue;
		const needsVarargScratch = dynamicSuffix || dynamicVararg;
		const scratch = needsVarargScratch ? Math.max(inputPrefix, dynamicSuffix ? max + +publishesCount : 0) : 0;
		const bias = needsVarargScratch ? scratch + WINDOW_VARARG_SCRATCH_WORDS + +dynamicSuffix : inputPrefix;
		if ((needsVarargScratch && bias - 1 > MAX_ABX_REGISTER_A)
			|| instructions.some(instruction => (instruction.format !== 'ABC' || (instruction.op === OpCode.ARGC && !dynamicCount))
				&& instruction.a + bias > MAX_ABX_REGISTER_A)) continue;
		let width = Math.max(proto.maxStack, parameters) + bias;
		for (const instruction of instructions) {
			if (instruction.op === OpCode.VARARG && instruction.b === 0) {
				const end = instruction.a + bias + extras.max;
				if (extras.min === extras.max && end > MAX_EXT_REGISTER_A) continue components;
				width = Math.max(width, end);
			}
		}
		let forwardEnd = -1;
		const callees = edges.get(protoIndex);
		if (callees !== undefined) {
			for (const [pc, edge] of callees) {
				const { a, c } = instructions[pc], base = a + bias, wanted = decodeValueCount(c, -1);
				const callee = sharedWindow(edge), supplied = boundCall(edge.site);
				if (callee === undefined || supplied === null) continue components;
				const call = { callee, supplied };
				if (!windowFitsAt(base, wanted, call)) continue components;
				width = Math.max(width, callWindowEnd(base, wanted, call));
			}
		}
		if (!discardResults) {
			for (const pc of returns.forwarded) {
				const producer = instructions[pc - 1];
				const child = producer.op === OpCode.VARARG ? extras : sharedWindow(callees!.get(pc - 1)!)!;
				if (child.min !== child.max) forwardEnd = Math.max(forwardEnd, producer.a + bias + child.max);
			}
		}
		if (forwardEnd !== -1) {
			const end = Math.max(forwardEnd, max) + FORWARD_CONTROL_WORDS;
			if (end - 1 > MAX_ABX_REGISTER_A) continue;
			width = Math.max(width, end);
		}
		const sealed = min !== max && (publishesCount
			|| uses.some(site => decodeValueCount(bodies[site.caller].instructions[site.instruction].c, -1) > min));
		const window = { min, max, width, sealed, bias, parameters, extras, scratch, argumentCountSlot, argumentCount: inputs.min,
			discardResults, publishesCount, placement: 0 };
		if (max !== 0) {
			for (let pc = 0; pc < instructions.length; ++pc) {
				const instruction = instructions[pc];
				if (instruction.op !== OpCode.RET) continue;
				const skip = returns.suffixes.get(pc);
				const suffix = skip === undefined ? undefined : windowVarargRange(extras, skip);
				if (suffix !== undefined && suffix.min !== suffix.max) continue;
				const producer = instructions[pc - 1];
				const child = suffix !== undefined || instruction.b !== 0 ? undefined
					: producer.op === OpCode.VARARG ? extras : sharedWindow(callees!.get(pc - 1)!);
				if (child !== undefined && child.min !== child.max) continue;
				const count = suffix !== undefined ? suffix.max : child === undefined ? decodeValueCount(instruction.b, 0)
					: producer.a - instruction.a + child.max;
				const source = skip === undefined || count === 0 ? instruction.a + bias : parameters + 1 + skip;
				width = Math.max(width, fixedReturnLink(window, source + count, count) + 1);
			}
		}
		if (width > MAX_EXT_REGISTER_A + 1) continue;
		window.width = width;
		for (const site of uses) {
			const { a, c } = bodies[site.caller].instructions[site.instruction], wanted = decodeValueCount(c, -1);
			if (!windowFitsAt(a, wanted, { callee: window, supplied: argumentBounds.get(site)! })) continue components;
		}
		windows.set(protoIndex, window);
	}
	// A joined site either has one physical ABI for the complete target
	// set, or every arm keeps its ordinary tagged CodeFunction relocation.
	for (const site of allSites) {
		if (site.targets.length === 1) continue;
		const edge = edges.get(site.caller)?.get(site.instruction);
		if (edge !== undefined && sharedWindow(edge) === undefined)
			for (const target of site.targets) windows.delete(target);
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
			for (const target of site.targets) if (target !== protoIndex) requireWindow(protoIndex, target);
			if (site.producer === -1) continue;
			const producer = bodies[site.caller].instructions[site.producer];
			if (producer.op === OpCode.VARARG) requireWindow(protoIndex, site.caller);
			else for (const target of edges.get(site.caller)!.get(site.producer)!.targets)
				requireWindow(protoIndex, target.protoIndex);
		}
	}
	for (let i = 0; i < unavailable.length; ++i) {
		const applications = dependents.get(unavailable[i]);
		if (applications === undefined) continue;
		for (const owner of applications) if (windows.delete(owner)) unavailable.push(owner);
	}

	// When every direct caller already supplies the same slots, a leaf can
	// name them directly. No register shuffling, window switch or code clone.
	for (const [index, window] of windows) {
		const { returns, dependencies } = candidates.get(index)!;
		if (window.bias !== 1 || window.min !== window.max || dependencies.length !== 0
			|| returns.readsArgumentCount || returns.variadic || (!window.discardResults && returns.suffixes.size !== 0)) continue;
		const uses = sites.get(index)!;
		const { caller, instruction } = uses[0];
		const placement = bodies[caller].instructions[instruction].a + (windows.get(caller)?.bias ?? 0);
		if (placement === 0 || placement > MAX_ABX_REGISTER_A || placement + window.width > MAX_EXT_REGISTER_A + 1) continue;
		if (uses.some(site => site.targets.length !== 1
			|| bodies[site.caller].instructions[site.instruction].a + (windows.get(site.caller)?.bias ?? 0) !== placement)) continue;
		if (bodies[index].instructions.some(row => row.format !== 'ABC' && row.a + window.bias + placement > MAX_ABX_REGISTER_A)) continue;
		window.placement = placement;
	}

	const rewrites = new Map<number, WindowBodyLowering>();
	for (let protoIndex = 0; protoIndex < bodies.length; ++protoIndex) {
		const window = windows.get(protoIndex), callees = edges.get(protoIndex);
		let lowered: Map<number, WindowCallSite> | undefined;
		if (callees !== undefined) {
			for (const [pc, edge] of callees) {
				const callee = sharedWindow(edge);
				if (callee !== undefined) (lowered ??= new Map()).set(pc, { callee, supplied: argumentBounds.get(edge.site)!, targets: edge.site.targets,
					targetLive: edge.site.targetLive,
					directTarget: edge.targets.length === 1 ? edge.targets[0].protoIndex : undefined });
			}
		}
		if (window !== undefined || lowered !== undefined)
			rewrites.set(protoIndex, lowerWindowBody(bodies[protoIndex], window, lowered, signatures.get(protoIndex)));
	}
	return { entries: new Set(windows.keys()), bodies: rewrites };
}
