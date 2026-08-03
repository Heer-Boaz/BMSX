import type { ExecutionHook } from '../../machine/ts/machine/runtime/cpu_executor';
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
	resumeSuppressionPending: boolean;
	resumeDomain: ExecutionDomainId;
	resumePc: number;
};

export function createRuntimeDebuggerState(
	runtime: Runtime,
	sources: RuntimeSourceState,
): RuntimeDebuggerState {
	let state: RuntimeDebuggerState;
	const executionHook: ExecutionHook = (executionDomainId, pc) => {
		if (state.stopped) {
			return true;
		}
		if (state.resumeSuppressionPending
			&& state.resumeDomain === executionDomainId
			&& state.resumePc === pc) {
			state.resumeSuppressionPending = false;
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
		resumeSuppressionPending: false,
		resumeDomain: -1 as ExecutionDomainId,
		resumePc: 0,
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
	state.runtime.cpuExecution.setExecutionHook(
		domainMask !== 0
			? state.executionHook
			: null,
		domainMask,
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
							point.inlineDepth,
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
				target.set(codeAddress + point.wordOffset * INSTRUCTION_BYTES, point.inlineDepth);
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
	state.resumeDomain = state.stopDomain;
	state.resumePc = state.stopPc;
	state.resumeSuppressionPending = state.stepMode !== RuntimeDebuggerStepMode.None
		|| state.breakpointPcs[state.stopDomain + 1].has(state.stopPc);
	state.stopped = false;
	state.stopPresentationPending = false;
	updateExecutionHookBinding(state);
}

export function resetRuntimeDebuggerExecution(state: RuntimeDebuggerState): void {
	state.stopped = false;
	state.stopPresentationPending = false;
	state.stepMode = RuntimeDebuggerStepMode.None;
	state.resumeSuppressionPending = false;
	rebuildRuntimeBreakpointPcs(state);
}

export function prepareRuntimeDebuggerForHotResume(
	state: RuntimeDebuggerState,
	breakpointPcs: RuntimeBreakpointPcs,
): boolean {
	const resumeStoppedExecution = state.stopped;
	state.stopped = false;
	state.stopPresentationPending = false;
	state.stepMode = RuntimeDebuggerStepMode.None;
	state.resumeSuppressionPending = false;
	for (let domainIndex = 0; domainIndex < state.stepPcs.length; domainIndex += 1) {
		state.stepPcs[domainIndex].clear();
	}
	installRuntimeBreakpointPcs(state, breakpointPcs);
	return resumeStoppedExecution;
}

export function finishRuntimeDebuggerHotResume(
	state: RuntimeDebuggerState,
	resumeStoppedExecution: boolean,
): void {
	if (!resumeStoppedExecution || state.stopped) {
		return;
	}
	const cpu = state.runtime.machine.cpu;
	const frameIndex = cpu.getFrameDepth() - 1;
	state.resumeDomain = cpu.readFrameExecutionDomain(frameIndex);
	state.resumePc = cpu.readFramePc(frameIndex);
	state.resumeSuppressionPending = state.breakpointPcs[state.resumeDomain + 1].has(state.resumePc);
}
