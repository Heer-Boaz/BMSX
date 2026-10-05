import type { ExecutionHook } from '../../machine/ts/machine/cpu/cpu';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { RuntimeSourceState } from './sources';
import { RuntimeBreakpoints, type RuntimeBreakpointBindings } from './breakpoints';
import { SourceDebugger, RuntimeDebuggerResumeMode, type RuntimeDebuggerSourceStop } from './source_debugger';
import { RuntimeDebuggerPlanManager, type RuntimeDebuggerControlPlan, type RuntimeDebuggerExecutionContext } from './debugger_plans';
export { RuntimeDebuggerResumeMode, RuntimeDebuggerStopReason } from './source_debugger';

export type RuntimeBreakpointState = { readonly breakpoints: RuntimeBreakpoints };

/** Authoring execution policy composes source stops with its own control plans. */
export type RuntimeDebuggerState = RuntimeBreakpointState & {
	readonly source: SourceDebugger;
	executionRevision: number;
	executionContext: RuntimeDebuggerExecutionContext | undefined;
	readonly executionHook: ExecutionHook;
	readonly plans: RuntimeDebuggerPlanManager;
	readonly runtime: Runtime;
	readonly sources: RuntimeSourceState;
	stopPresentationPending: boolean;
};

export function createRuntimeDebuggerState(runtime: Runtime, sources: RuntimeSourceState): RuntimeDebuggerState {
	let state: RuntimeDebuggerState;
	const executionHook: ExecutionHook = (domain, pc) => {
		const controlActive = state.plans.controlActive;
		if (state.source.stop !== undefined || state.source.stepThreadFinished || controlActive && state.plans.shouldStop(domain, pc)) return true;
		if (!state.source.shouldStop(domain, pc, !controlActive || state.plans.honorUserStops)) return false;
		if (controlActive) state.plans.setControlSuspended(true);
		state.stopPresentationPending = true;
		return true;
	};
	const breakpoints = new RuntimeBreakpoints(sources, () => state.source.install(sources.currentBlua32Media, state.breakpoints.bindings.pcs));
	state = {
		source: new SourceDebugger(runtime.machine.cpu, sources.currentBlua32Media, breakpoints.bindings.pcs, () => updateExecutionHookBinding(state)),
		breakpoints,
		executionRevision: 0, executionContext: undefined, executionHook,
		plans: new RuntimeDebuggerPlanManager(), runtime, sources, stopPresentationPending: false,
	};
	updateExecutionHookBinding(state);
	return state;
}

function updateExecutionHookBinding(state: RuntimeDebuggerState): void {
	const domainMask = state.source.domainMask | state.plans.executionDomainMask;
	state.runtime.machine.cpu.setExecutionHook(domainMask === 0 ? null : state.executionHook,
		domainMask, state.plans.preMaskableInterruptDomainMask);
}

export function resumeRuntimeDebugger(state: RuntimeDebuggerState, mode: RuntimeDebuggerResumeMode, context?: RuntimeDebuggerExecutionContext): void {
	state.executionRevision++;
	state.executionContext = context;
	state.stopPresentationPending = false;
	state.plans.setControlSuspended(false);
	state.source.resume(mode);
}

export function runtimeDebuggerExecutionRequested(state: RuntimeDebuggerState): boolean {
	return state.source.stop === undefined && (state.executionContext !== undefined || state.source.stepping)
		|| state.plans.controlExecutionRequested;
}

export function interruptRuntimeDebuggerExecution(state: RuntimeDebuggerState): void {
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

export function discardRuntimeDebuggerPlans(state: RuntimeDebuggerState): void {
	state.plans.discardAll();
	updateExecutionHookBinding(state);
}

export function pushRuntimeDebuggerControlPlan(
	state: RuntimeDebuggerState,
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

export function discardRuntimeDebuggerFramesFrom(state: RuntimeDebuggerState, frameIndex: number): void {
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
