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
import { lowerWindowVararg, WINDOW_VARARG_SCRATCH_WORDS } from './window_varargs';

const RAW_WINDOW_CONTROL_WORDS = 3;

type Body = { proto: Proto; instructions: readonly Instruction[] };
type CallSite = { caller: number; instruction: number; producer: number; targets: readonly number[]; targetLive: readonly number[] };
type ResultRange = { min: number; max: number };
type BodyReturns = ResultRange & {
	forwarded: number[]; suffixes: Map<number, number>; observesCount: boolean; variadic: boolean; hasOpenVararg: boolean;
};
type WindowLayout = ResultRange & {
	top: number; width: number; sealed: boolean; bias: number; parameters: number; observesCount: boolean; extras: ResultRange; scratch: number;
	direct: boolean; discardResults: boolean; publishesCount: boolean; placement: number;
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
	let observesCount = false, variadic = false, hasOpenVararg = false;
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
				observesCount = variadic = true;
				if (instruction.b === 0) hasOpenVararg = true;
				break;
			case OpCode.ARGC:
				observesCount = true;
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
	return { min, max, forwarded, suffixes, observesCount, variadic, hasOpenVararg };
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

function needsFixedTop(wanted: number, callee: WindowLayout): boolean {
	return wanted >= 0 && wanted <= callee.max && (wanted !== callee.max || wanted !== callee.min);
}

function callWindowEnd(base: number, wanted: number, call: WindowCall): number {
	const { callee } = call;
	const resultEnd = base + Math.max(callee.max, wanted);
	if (callee.direct) return Math.max(base + callee.width, resultEnd);
	// The child owns its local capacity after entry. The caller includes
	// only the outgoing initialized prefix, controls and returned values.
	return Math.max(resultEnd, controlPacketBase(base, call) + RAW_WINDOW_CONTROL_WORDS);
}

function windowFitsAt(base: number, wanted: number, call: WindowCall): boolean {
	const { callee } = call;
	if (callWindowEnd(base, wanted, call) > MAX_EXT_REGISTER_A + 1) return false;
	if (callee.direct) return base + (wanted === -1 ? callee.max : wanted) <= MAX_EXT_REGISTER_A;
	return controlPacketBase(base, call) + RAW_WINDOW_CONTROL_WORDS - 1 <= MAX_ABX_REGISTER_A
		&& (!needsFixedTop(wanted, callee) || base + wanted <= MAX_EXT_REGISTER_A);
}

const FORWARD_CONTROL_WORDS = 5;

function fixedReturnLink(entry: WindowLayout, sourceEnd: number, count: number): number {
	const published = entry.sealed ? entry.max : count;
	return entry.direct && published !== 0 ? Math.max(sourceEnd, published + +entry.publishesCount) : 0;
}

function lowerOpenReturn(instructions: Instruction[], origin: Instruction, sourceEnd: number, entry: WindowLayout,
	linkSlots: WindowBodyLowering['linkSlots'][number][]): void {
	// The child's bounded suffix is initialized even when its actual result
	// is shorter. Materializing an index above Top must not expose stale tags.
	const end = Math.max(sourceEnd, entry.sealed ? entry.max : 0);
	const index = end + 1, count = end + 2, one = end + 3;
	const link = entry.direct ? end + 4 : 0, value = end + (entry.direct ? 5 : 4);
	instructions.push(controlInstruction(origin, OpCode.MOV, sourceEnd, 0, ValueMoveKind.ReadTop));
	if (end !== sourceEnd) {
		if (end !== sourceEnd + 1)
			instructions.push(controlInstruction(origin, OpCode.LOADNIL, sourceEnd + 1, end - sourceEnd - 1));
		instructions.push(controlInstruction(origin, OpCode.MOV, end, sourceEnd));
	}
	instructions.push(controlInstruction(origin, OpCode.KSMI, index, origin.a + entry.bias));
	instructions.push(controlInstruction(origin, OpCode.K0, count, 0));
	instructions.push(controlInstruction(origin, OpCode.K1, one, 0));
	if (entry.direct) {
		instructions.push(controlInstruction(origin, OpCode.MOV, link, 0));
		linkSlots.push({ instruction: instructions.length, slot: link });
	}

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
	if (entry.direct) {
		if (entry.publishesCount) instructions.push(controlInstruction(origin, OpCode.MOV, entry.max, count));
		instructions.push(controlInstruction(origin, OpCode.JREG, link, 0, RegisterJumpMode.Jump));
		linkSlots.push({ instruction: instructions.length, slot: 0 });
	} else instructions.push(controlInstruction(origin, OpCode.JREG, 0, count, RegisterJumpMode.LeaveWindowFromRegister));
}

function prepareWindowCall(instructions: Instruction[], origin: Instruction, base: number, call: WindowCall): number {
	const { callee, supplied } = call;
	const initialized = base + supplied.max + 1;
	const admittedTop = base + callee.top;
	if (callee.direct) {
		if (initialized < admittedTop)
			instructions.push(controlInstruction(origin, OpCode.LOADNIL, initialized, admittedTop - initialized));
		const displacement = base - callee.placement;
		if (displacement !== 0) instructions.push(controlInstruction(origin, OpCode.MOV, 0, displacement, ValueMoveKind.AddBase));
		const jump = instructions.length;
		if (call.directTarget === undefined)
			instructions.push(controlInstruction(origin, OpCode.JREG, 0, 0, RegisterJumpMode.Link));
		else instructions.push({ ...controlInstruction(origin, OpCode.JAL, callee.placement, 0), format: 'AsBx', jumpProtoIndex: call.directTarget });
		return jump;
	}
	const packet = controlPacketBase(base, call);
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
	return instructions.length - 1;
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
			instructions.push(controlInstruction(instruction, OpCode.JREG, placement, 0,
				entry.direct ? RegisterJumpMode.Jump : RegisterJumpMode.LeaveWindow));
		} else if (entry !== undefined && (instruction.op === OpCode.ARGC || instruction.op === OpCode.VARARG
			|| (instruction.op === OpCode.RET && instruction.c === ReturnSource.ExtraArguments))) {
			lowerWindowVararg(instructions, instruction, {
				bias: entry.bias, parameters: entry.parameters, extras: entry.extras, maxResults: entry.max,
				sealed: entry.sealed, scratch: entry.scratch,
			}, returns!.suffixes.get(i));
		} else if (entry !== undefined && instruction.op === OpCode.RET) {
			const producer = body.instructions[i - 1];
			const child = instruction.b !== 0 ? undefined : producer.op === OpCode.VARARG ? entry.extras : callees!.get(i - 1)!.callee;
			if (child !== undefined && child.min !== child.max) {
				lowerOpenReturn(instructions, instruction, producer.a + entry.bias + child.max, entry, linkSlots);
			} else {
				const count = child === undefined ? decodeValueCount(instruction.b, 0)
					: producer.a - instruction.a + child.max;
				const source = instruction.a + registerBias;
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
				instructions.push(entry.direct
					? controlInstruction(instruction, OpCode.JREG, link, 0, RegisterJumpMode.Jump)
					: controlInstruction(instruction, OpCode.JREG, 0, count, RegisterJumpMode.LeaveWindow));
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
				if (callee.direct) {
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
				} else if (wanted > callee.max) {
					instructions.push(controlInstruction(instruction, OpCode.LOADNIL, base + callee.max, wanted - callee.max));
				} else if (needsFixedTop(wanted, callee)) {
					instructions.push(controlInstruction(instruction, OpCode.MOV, base + wanted, 0, ValueMoveKind.SetTopImmediate));
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
	return { instructions, origins, starts, maxStack, registerBias, softwareEntry: entry?.direct === true, softwareCalls, linkSlots };
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
			min = Math.min(min, Math.max(0, extras!.min - skip));
			max = Math.max(max, Math.max(0, extras!.max - skip));
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
				|| other.top !== first.top || other.observesCount !== first.observesCount || other.direct !== first.direct) return;
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
		const observesCount = returns.observesCount || returnsSuffix;
		const inputPrefix = returns.variadic || returnsSuffix ? Math.max(parameters, inputs.max) + 1 : 1;
		let dynamicSuffix = false;
		if (returnsSuffix && extras.min !== extras.max) {
			for (const skip of returns.suffixes.values()) {
				if (skip < extras.max) { dynamicSuffix = true; break; }
			}
		}
		const needsVarargScratch = dynamicSuffix || (extras.min !== extras.max && returns.hasOpenVararg);
		const scratch = needsVarargScratch ? Math.max(inputPrefix, dynamicSuffix ? max : 0) : 0;
		const bias = needsVarargScratch ? scratch + WINDOW_VARARG_SCRATCH_WORDS : inputPrefix;
		if ((needsVarargScratch && bias - 1 > MAX_ABX_REGISTER_A)
			|| instructions.some(instruction => instruction.format !== 'ABC' && instruction.a + bias > MAX_ABX_REGISTER_A)) continue;
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
		let direct = !observesCount;
		if (callees !== undefined) {
			for (const [pc, edge] of callees) {
				const { a, c } = instructions[pc], base = a + bias, wanted = decodeValueCount(c, -1);
				const callee = sharedWindow(edge), supplied = boundCall(edge.site);
				if (callee === undefined || supplied === null) continue components;
				direct &&= callee.direct;
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
			const end = Math.max(forwardEnd, max) + FORWARD_CONTROL_WORDS + +direct;
			if (end - 1 > MAX_ABX_REGISTER_A) continue;
			width = Math.max(width, end);
		}
		const uses = sites.get(protoIndex)!;
		const publishesCount = direct && min !== max && uses.some(site => bodies[site.caller].instructions[site.instruction].c === 0);
		if (publishesCount && max > MAX_ABX_REGISTER_A) continue;
		const sealed = min !== max && (publishesCount
			|| uses.some(site => decodeValueCount(bodies[site.caller].instructions[site.instruction].c, -1) > min));
		const window = { min, max, width, top: parameters + bias, sealed, bias, parameters, extras, scratch,
			observesCount, direct, discardResults, publishesCount, placement: 0 };
		if (direct && max !== 0) {
			for (let pc = 0; pc < instructions.length; ++pc) {
				const instruction = instructions[pc];
				if (instruction.op !== OpCode.RET) continue;
				const producer = instructions[pc - 1];
				const child = instruction.b !== 0 ? undefined : sharedWindow(callees!.get(pc - 1)!);
				if (child !== undefined && child.min !== child.max) continue;
				const count = child === undefined ? decodeValueCount(instruction.b, 0)
					: producer.a - instruction.a + child.max;
				width = Math.max(width, fixedReturnLink(window, instruction.a + bias + count, count) + 1);
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

	for (const [protoIndex, window] of windows) {
		for (const site of sites.get(protoIndex)!) {
			if (site.producer === -1 || bodies[site.caller].instructions[site.producer].op === OpCode.VARARG) continue;
			for (const target of edges.get(site.caller)!.get(site.producer)!.targets) {
				const producer = windows.get(target.protoIndex)!;
				if (producer.min !== producer.max) producer.sealed = true;
			}
		}
		if (window.discardResults) continue;
		const { forwarded } = candidates.get(protoIndex)!.returns;
		const instructions = bodies[protoIndex].instructions, callees = edges.get(protoIndex);
		for (const pc of forwarded) {
			if (instructions[pc - 1].op === OpCode.VARARG) continue;
			for (const target of callees!.get(pc - 1)!.targets) {
				const callee = windows.get(target.protoIndex)!;
				if (callee.min !== callee.max) callee.sealed = true;
			}
		}
	}

	// When every direct caller already supplies the same slots, a leaf can
	// name them directly. No register shuffling, window switch or code clone.
	for (const [index, window] of windows) {
		if (!window.direct || window.min !== window.max || candidates.get(index)!.dependencies.length !== 0) continue;
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
