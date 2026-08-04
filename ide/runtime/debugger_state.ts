import type { ExecutionHook } from '../../machine/ts/machine/cpu/cpu';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import {
	ALL_EXECUTION_DOMAINS_MASK,
	executionDomainBit,
	type ExecutionDomainId,
	type ExecutionDomainMask,
} from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import {
	resolveRuntimeLuaSource,
	type RuntimeSourceState,
} from './sources';
import type { Blua32SourceMedia } from './sources';
import {
	RuntimeDebuggerPlanManager,
	type RuntimeDebuggerControlPlan,
} from './debugger_plans';

type RuntimeBreakpointLines = [
	Map<string, Set<number>>,
	Map<string, Set<number>>,
	Map<string, Set<number>>,
];

export type RuntimeBreakpointPcs = [Map<number, number>, Map<number, number>, Map<number, number>];

type RuntimeStepPcs = [Map<number, number>, Map<number, number>, Map<number, number>];

const enum RuntimeDebuggerStepMode {
	None,
	Into,
	Over,
	Out,
}

export const enum RuntimeDebuggerResumeMode {
	Continue,
	StepInto,
	StepOver,
	StepOut,
}

export const enum RuntimeDebuggerStopReason {
	Breakpoint,
	Step,
}

export type RuntimeBreakpointState = {
	readonly breakpoints: RuntimeBreakpointLines;
};

export type RuntimeDebuggerState = RuntimeBreakpointState & {
	readonly breakpointPcs: RuntimeBreakpointPcs;
	readonly stepPcs: RuntimeStepPcs;
	readonly executionHook: ExecutionHook;
	readonly plans: RuntimeDebuggerPlanManager;
	readonly runtime: Runtime;
	readonly sources: RuntimeSourceState;
	stopped: boolean;
	stopDomain: ExecutionDomainId;
	stopPc: number;
	stopInlineDepth: number;
	stopReason: RuntimeDebuggerStopReason;
	stopPresentationPending: boolean;
	stepMode: RuntimeDebuggerStepMode;
	stepDepth: number;
	stepInlineDepth: number;
	readonly resumeSuppressionFrameDepths: number[];
};

export function createRuntimeDebuggerState(
	runtime: Runtime,
	sources: RuntimeSourceState,
): RuntimeDebuggerState {
	let state: RuntimeDebuggerState;
	const executionHook: ExecutionHook = (executionDomainId, pc) => {
		if (state.plans.controlActive) {
			return state.plans.shouldStop(executionDomainId, pc);
		}
		if (state.stopped) {
			return true;
		}
		const suppressionCount = state.resumeSuppressionFrameDepths.length;
		if (suppressionCount !== 0
			&& state.resumeSuppressionFrameDepths[suppressionCount - 1]
				=== state.runtime.machine.cpu.getFrameDepth()) {
			state.resumeSuppressionFrameDepths.length = suppressionCount - 1;
			updateExecutionHookBinding(state);
			return false;
		}
		const domainIndex = executionDomainId + 1;
		let stopReason: RuntimeDebuggerStopReason;
		let stopInlineDepth: number;
		if (state.stepMode !== RuntimeDebuggerStepMode.None) {
			const stepInlineDepth = state.stepPcs[domainIndex].get(pc);
			if (stepInlineDepth === undefined) {
				return false;
			}
			let stopForStep = state.stepMode === RuntimeDebuggerStepMode.Into;
			if (!stopForStep) {
				const depth = state.runtime.machine.cpu.getFrameDepth();
				const shallowerFrame = depth < state.stepDepth;
				const sameFrame = depth === state.stepDepth;
				stopForStep = state.stepMode === RuntimeDebuggerStepMode.Over
					? shallowerFrame || (sameFrame && stepInlineDepth <= state.stepInlineDepth)
					: shallowerFrame || (sameFrame && stepInlineDepth < state.stepInlineDepth);
			}
			if (stopForStep) {
				stopReason = RuntimeDebuggerStopReason.Step;
				stopInlineDepth = stepInlineDepth;
			} else {
				const breakpointInlineDepth = state.breakpointPcs[domainIndex].get(pc);
				if (breakpointInlineDepth === undefined) {
					return false;
				}
				stopReason = RuntimeDebuggerStopReason.Breakpoint;
				stopInlineDepth = breakpointInlineDepth;
			}
		} else {
			const breakpointInlineDepth = state.breakpointPcs[domainIndex].get(pc);
			if (breakpointInlineDepth === undefined) {
				return false;
			}
			stopReason = RuntimeDebuggerStopReason.Breakpoint;
			stopInlineDepth = breakpointInlineDepth;
		}
		state.stopped = true;
		state.stopDomain = executionDomainId;
		state.stopPc = pc;
		state.stopInlineDepth = stopInlineDepth;
		state.stopReason = stopReason;
		state.stopPresentationPending = true;
		state.stepMode = RuntimeDebuggerStepMode.None;
		return true;
	};
	state = {
		breakpoints: [new Map(), new Map(), new Map()],
		breakpointPcs: [new Map(), new Map(), new Map()],
		stepPcs: [new Map(), new Map(), new Map()],
		executionHook,
		plans: new RuntimeDebuggerPlanManager(),
		runtime,
		sources,
		stopped: false,
		stopDomain: -1 as ExecutionDomainId,
		stopPc: 0,
		stopInlineDepth: 0,
		stopReason: RuntimeDebuggerStopReason.Breakpoint,
		stopPresentationPending: false,
		stepMode: RuntimeDebuggerStepMode.None,
		stepDepth: 0,
		stepInlineDepth: 0,
		resumeSuppressionFrameDepths: [],
	};
	return state;
}

function updateExecutionHookBinding(state: RuntimeDebuggerState): void {
	let domainMask: ExecutionDomainMask = state.stopped
		? ALL_EXECUTION_DOMAINS_MASK
		: 0;
	for (let domainIndex = 0; domainIndex < state.breakpointPcs.length; domainIndex += 1) {
		if (state.breakpointPcs[domainIndex].size !== 0
			|| (state.stepMode !== RuntimeDebuggerStepMode.None
				&& state.stepPcs[domainIndex].size !== 0)) {
			domainMask |= executionDomainBit((domainIndex - 1) as ExecutionDomainId);
		}
	}
	for (const frameDepth of state.resumeSuppressionFrameDepths) {
		domainMask |= executionDomainBit(
			state.runtime.machine.cpu.readFrameExecutionDomain(frameDepth - 1),
		);
	}
	domainMask |= state.plans.executionDomainMask;
	state.runtime.machine.cpu.setExecutionHook(
		domainMask !== 0 ? state.executionHook : null,
		domainMask,
		state.plans.preMaskableInterruptDomainMask,
	);
}

export function buildRuntimeBreakpointPcs(
	state: RuntimeDebuggerState,
	media: Blua32SourceMedia,
): RuntimeBreakpointPcs {
	const breakpointPcs: RuntimeBreakpointPcs = [new Map(), new Map(), new Map()];
	for (let domainIndex = 0; domainIndex < breakpointPcs.length; domainIndex += 1) {
		const target = breakpointPcs[domainIndex];
		const breakpoints = state.breakpoints[domainIndex];
		if (breakpoints.size === 0) {
			continue;
		}
		const domain = (domainIndex - 1) as ExecutionDomainId;
		const image = blua32ToolingImageForDomain(media, domain)!;
		const symbols = image.symbols!;
		for (const [path, lines] of breakpoints) {
			const source = resolveRuntimeLuaSource(state.sources, { domain, path })!;
			const modulePath = source.record.module_path;
			for (let functionIndex = 0; functionIndex < image.layout.functions.length; functionIndex += 1) {
				const points = symbols.metadata.statementPointsByFunction[functionIndex];
				for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
					const point = points[pointIndex];
					if (point.range.path === modulePath && lines.has(point.range.start.line)) {
						target.set(
							image.layout.functions[functionIndex].codeAddress
							+ point.wordOffset * INSTRUCTION_BYTES,
							point.inlineCallSites.length,
						);
					}
				}
			}
		}
	}
	return breakpointPcs;
}

function installRuntimeBreakpointPcs(
	state: RuntimeDebuggerState,
	breakpointPcs: RuntimeBreakpointPcs,
): void {
	for (let domainIndex = 0; domainIndex < breakpointPcs.length; domainIndex += 1) {
		state.breakpointPcs[domainIndex] = breakpointPcs[domainIndex];
	}
	updateExecutionHookBinding(state);
}

export function rebuildRuntimeBreakpointPcs(state: RuntimeDebuggerState): void {
	installRuntimeBreakpointPcs(
		state,
		buildRuntimeBreakpointPcs(state, state.sources.currentBlua32Media),
	);
}

function rebuildRuntimeStepPcs(state: RuntimeDebuggerState): void {
	for (let domainIndex = 0; domainIndex < state.stepPcs.length; domainIndex += 1) {
		const target = state.stepPcs[domainIndex];
		target.clear();
		const domain = (domainIndex - 1) as ExecutionDomainId;
		const image = blua32ToolingImageForDomain(state.sources.currentBlua32Media, domain);
		if (image === null) {
			continue;
		}
		for (let functionIndex = 0; functionIndex < image.layout.functions.length; functionIndex += 1) {
			const codeAddress = image.layout.functions[functionIndex].codeAddress;
			const points = image.symbols!.metadata.statementPointsByFunction[functionIndex];
			for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
				const point = points[pointIndex];
				target.set(
					codeAddress + point.wordOffset * INSTRUCTION_BYTES,
					point.inlineCallSites.length,
				);
			}
		}
	}
}

export function resumeRuntimeDebugger(
	state: RuntimeDebuggerState,
	mode: RuntimeDebuggerResumeMode,
): void {
	switch (mode) {
		case RuntimeDebuggerResumeMode.Continue:
			state.stepMode = RuntimeDebuggerStepMode.None;
			break;
		case RuntimeDebuggerResumeMode.StepInto:
			state.stepMode = RuntimeDebuggerStepMode.Into;
			break;
		case RuntimeDebuggerResumeMode.StepOver:
			state.stepMode = RuntimeDebuggerStepMode.Over;
			break;
		case RuntimeDebuggerResumeMode.StepOut:
			state.stepMode = RuntimeDebuggerStepMode.Out;
			break;
	}
	if (state.stepMode !== RuntimeDebuggerStepMode.None) {
		state.stepDepth = state.runtime.machine.cpu.getFrameDepth();
		state.stepInlineDepth = state.stopInlineDepth;
		rebuildRuntimeStepPcs(state);
	}
	if (state.stepMode !== RuntimeDebuggerStepMode.None
		|| state.breakpointPcs[state.stopDomain + 1].has(state.stopPc)) {
		state.resumeSuppressionFrameDepths.push(state.runtime.machine.cpu.getFrameDepth());
	}
	state.stopped = false;
	state.stopPresentationPending = false;
	updateExecutionHookBinding(state);
}

export function resetRuntimeDebuggerExecution(state: RuntimeDebuggerState): void {
	discardRuntimeDebuggerPlans(state);
	state.stopped = false;
	state.stopPresentationPending = false;
	state.stepMode = RuntimeDebuggerStepMode.None;
	state.resumeSuppressionFrameDepths.length = 0;
	rebuildRuntimeBreakpointPcs(state);
}

export function discardRuntimeDebuggerPlans(state: RuntimeDebuggerState): void {
	state.plans.discardAll();
	updateExecutionHookBinding(state);
}

export function pushRuntimeDebuggerControlPlan(
	state: RuntimeDebuggerState,
	plan: RuntimeDebuggerControlPlan,
): void {
	if (state.stopped) {
		resumeRuntimeDebugger(state, RuntimeDebuggerResumeMode.Continue);
	} else {
		state.stopPresentationPending = false;
		state.stepMode = RuntimeDebuggerStepMode.None;
	}
	state.plans.pushControlPlan(plan);
	updateExecutionHookBinding(state);
}

export function willExecuteRuntimeDebuggerPlan(state: RuntimeDebuggerState): void {
	if (state.plans.willExecute()) {
		updateExecutionHookBinding(state);
	}
}

export function didExecuteRuntimeDebuggerPlan(state: RuntimeDebuggerState): void {
	if (state.plans.didExecute()) {
		updateExecutionHookBinding(state);
	}
}

export function didFaultRuntimeDebuggerPlan(state: RuntimeDebuggerState): void {
	if (state.plans.didFault()) {
		updateExecutionHookBinding(state);
	}
}

export function discardRuntimeDebuggerFramesFrom(
	state: RuntimeDebuggerState,
	frameIndex: number,
): void {
	while (state.resumeSuppressionFrameDepths.length !== 0
		&& state.resumeSuppressionFrameDepths[state.resumeSuppressionFrameDepths.length - 1]
			> frameIndex) {
		state.resumeSuppressionFrameDepths.length -= 1;
	}
}

export function applyRuntimeDebuggerHotResume(
	state: RuntimeDebuggerState,
	breakpointPcs: RuntimeBreakpointPcs,
): void {
	const resumeStoppedExecution = state.stopped;
	state.stopped = false;
	state.stopPresentationPending = false;
	state.stepMode = RuntimeDebuggerStepMode.None;
	for (let domainIndex = 0; domainIndex < state.stepPcs.length; domainIndex += 1) {
		state.stepPcs[domainIndex].clear();
	}
	if (resumeStoppedExecution) {
		const cpu = state.runtime.machine.cpu;
		const frameDepth = cpu.getFrameDepth();
		const frameIndex = frameDepth - 1;
		const resumeDomain = cpu.readFrameExecutionDomain(frameIndex);
		const resumePc = cpu.readFramePc(frameIndex);
		if (breakpointPcs[resumeDomain + 1].has(resumePc)) {
			state.resumeSuppressionFrameDepths.push(frameDepth);
		}
	}
	installRuntimeBreakpointPcs(state, breakpointPcs);
}
