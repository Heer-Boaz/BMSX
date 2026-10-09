import type { ExecutionHook } from '../../machine/ts/machine/cpu/cpu';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';
import type { RuntimeSourceState } from './sources';
import { RuntimeBreakpoints, type RuntimeBreakpointBindings } from './breakpoints';
import { SourceDebugger, RuntimeDebuggerResumeMode, type RuntimeDebuggerSourceStop } from './source_debugger';
import { RuntimeDebuggerPlanManager, type RuntimeDebuggerControlPlan, type RuntimeDebuggerExecutionContext } from './debugger_plans';
import type { Blua32ToolingMedia } from '../../toolchain/ts/rompack/blua32_media';
import type { SourceLocationPcs } from './source_breakpoints';
export { RuntimeDebuggerResumeMode, RuntimeDebuggerStopReason } from './source_debugger';

export type RuntimeBreakpointState = { readonly breakpoints: RuntimeBreakpoints };

/** Source execution belongs to one physical CPU, independently of writable authoring documents. */
export type SourceExecutionState = {
	readonly source: SourceDebugger;
	executionRevision: number;
	executionContext: RuntimeDebuggerExecutionContext | undefined;
	readonly executionHook: ExecutionHook;
	readonly plans: RuntimeDebuggerPlanManager;
	readonly runtime: Runtime;
	stopPresentationPending: boolean;
};
export type RuntimeDebuggerState = SourceExecutionState & RuntimeBreakpointState & { readonly sources: RuntimeSourceState };

export function createRuntimeDebuggerState(runtime: Runtime, sources: RuntimeSourceState): RuntimeDebuggerState {
	let state: SourceExecutionState;
	const breakpoints = new RuntimeBreakpoints(sources, () => state.source.install(sources.currentBlua32Media, breakpoints.bindings.pcs));
	state = createSourceExecutionState(runtime, sources.currentBlua32Media, breakpoints.bindings.pcs);
	// The execution hook and authoring consumer retain the same state identity.
	return Object.assign(state, { breakpoints, sources });
}

export function createSourceExecutionState(runtime: Runtime, media: Blua32ToolingMedia, points: SourceLocationPcs): SourceExecutionState {
	let state: SourceExecutionState;
	const executionHook: ExecutionHook = (domain, pc) => {
		// Recorded input is a closed execution history, not admission of new live debugger intent.
		if (runtime.history.mode === HistoryMode.Replaying) return false;
		const controlActive = state.plans.controlActive;
		if (state.source.stop !== undefined || state.source.stepThreadFinished || controlActive && state.plans.shouldStop(domain, pc)) return true;
		if (!state.source.shouldStop(domain, pc, !controlActive || state.plans.honorUserStops)) return false;
		if (controlActive) state.plans.setControlSuspended(true);
		state.stopPresentationPending = true;
		return true;
	};
	state = {
		source: new SourceDebugger(runtime.machine.cpu, media, points, () => updateExecutionHookBinding(state)),
		executionRevision: 0, executionContext: undefined, executionHook,
		plans: new RuntimeDebuggerPlanManager(), runtime, stopPresentationPending: false,
	};
	updateExecutionHookBinding(state);
	return state;
}

function updateExecutionHookBinding(state: SourceExecutionState): void {
	const domainMask = state.source.domainMask | state.plans.executionDomainMask;
	state.runtime.machine.cpu.setExecutionHook(domainMask === 0 ? null : state.executionHook,
		domainMask, state.plans.preMaskableInterruptDomainMask);
}

export function resumeRuntimeDebugger(state: SourceExecutionState, mode: RuntimeDebuggerResumeMode, context?: RuntimeDebuggerExecutionContext): void {
	state.executionRevision++;
	state.executionContext = context;
	state.stopPresentationPending = false;
	state.plans.setControlSuspended(false);
	state.source.resume(mode);
}

export function runtimeDebuggerExecutionRequested(state: SourceExecutionState): boolean {
	return state.source.stop === undefined && (state.executionContext !== undefined || state.source.stepping)
		|| state.plans.controlExecutionRequested;
}

export function interruptRuntimeDebuggerExecution(state: SourceExecutionState): void {
	state.executionRevision++;
	state.executionContext = undefined;
	state.source.interrupt();
}

export function resetRuntimeDebuggerExecution(state: RuntimeDebuggerState): void {
	state.executionRevision++;
	state.executionContext = undefined;
	state.stopPresentationPending = false;
	state.source.reset();
	state.plans.discardAll();
	state.breakpoints.rebind();
}

export function discardRuntimeDebuggerPlans(state: SourceExecutionState): void {
	state.plans.discardAll();
	updateExecutionHookBinding(state);
}

export function pushRuntimeDebuggerControlPlan(
	state: SourceExecutionState,
	plan: RuntimeDebuggerControlPlan,
	context: RuntimeDebuggerExecutionContext = 'game',
	stopPolicy: 'resume' | 'retain' = 'resume',
): RuntimeDebuggerSourceStop | undefined {
	let retained: RuntimeDebuggerSourceStop | undefined;
	if (state.source.stop !== undefined) {
		if (stopPolicy === 'retain') {
			state.executionRevision++;
			state.executionContext = undefined;
			state.stopPresentationPending = false;
			retained = state.source.suspendStopForCall();
		} else resumeRuntimeDebugger(state, RuntimeDebuggerResumeMode.Continue);
	} else {
		state.executionRevision++;
		state.executionContext = undefined;
		state.source.interrupt();
		state.stopPresentationPending = false;
	}
	state.plans.pushControlPlan(plan, context);
	updateExecutionHookBinding(state);
	return retained;
}

export function willExecuteRuntimeDebuggerPlan(state: SourceExecutionState): void {
	if (state.plans.willExecute()) {
		updateExecutionHookBinding(state);
	}
}

export function didExecuteRuntimeDebuggerPlan(state: SourceExecutionState): void {
	if (state.plans.didExecute()) {
		updateExecutionHookBinding(state);
	}
}

export function didFaultRuntimeDebuggerPlan(state: SourceExecutionState): void {
	if (state.plans.didFault()) {
		updateExecutionHookBinding(state);
	}
}

export function discardRuntimeDebuggerFramesFrom(state: SourceExecutionState, frameIndex: number): void {
	state.source.discardFrames(state.runtime.machine.cpu.activeThread, frameIndex);
}

export function applyRuntimeDebuggerHotResume(state: RuntimeDebuggerState, breakpoints: RuntimeBreakpointBindings): void {
	state.executionRevision++;
	state.executionContext = undefined;
	state.plans.setControlSuspended(false);
	const wasStopped = state.source.stop !== undefined;
	state.stopPresentationPending = false;
	state.breakpoints.install(breakpoints);
	state.source.resumeAfterRecompile(wasStopped);
}
