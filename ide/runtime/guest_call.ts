import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Value } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { ALL_EXECUTION_DOMAINS_MASK, type ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { RuntimeDebuggerPlanResult, type RuntimeDebuggerControlPlan } from './debugger_plans';
import { pushRuntimeDebuggerControlPlan, type RuntimeDebuggerState } from './debugger_state';
import type { SuspendedGuestSession } from './suspended_guest';

export type RuntimeGuestCall = {
	readonly domain: ExecutionDomainId;
	readonly closure: Closure;
	/** Materialize new guest values only after the mutation has been admitted. */
	readonly args: () => readonly Value[];
};

export type RuntimeGuestCallObserver = (completed: boolean, values: readonly Value[]) => void;
/** A requester can revoke a queued evaluation before it enters the CPU. */
export type RuntimeGuestCallExecutor = (prepare: () => RuntimeGuestCall | undefined, observer?: RuntimeGuestCallObserver) => void;
export type RuntimeGuestCallRequest = {
	/** Request lifetime is independent of any suspended-heap borrow. */
	readonly isCurrent: () => boolean;
	readonly prepare: () => RuntimeGuestCall | undefined;
};

/** A debugger function evaluation, executed by the ordinary scheduled CPU. */
export class RuntimeGuestCallPlan implements RuntimeDebuggerControlPlan {
	public readonly executionDomainMask = ALL_EXECUTION_DOMAINS_MASK;
	public readonly preMaskableInterruptDomainMask = this.executionDomainMask;

	public constructor(
		private readonly runtime: Runtime,
		private readonly returnDepth: number,
		private readonly finish: (completed: boolean) => void,
	) {}

	public shouldStop(): boolean { return this.runtime.machine.cpu.getFrameDepth() === this.returnDepth; }
	public willExecute(): void {}
	public didExecute(): RuntimeDebuggerPlanResult {
		if (!this.shouldStop()) return RuntimeDebuggerPlanResult.Active;
		this.finish(true);
		return RuntimeDebuggerPlanResult.Complete;
	}
	public didFault(): RuntimeDebuggerPlanResult {
		// A fault suspends, not completes, the evaluation. Keep its mutation hold
		// until the call returns or debugger recovery discards the control plan.
		this.finish(false);
		return RuntimeDebuggerPlanResult.Active;
	}
	public discard(): void { this.finish(false); }
}

/** Prepare against the current suspended heap, never a popup's expired borrow. */
export function scheduleRuntimeGuestCall(
	runtime: Runtime, guest: SuspendedGuestSession, debuggerState: RuntimeDebuggerState, tasks: RuntimeTaskQueue,
	request: RuntimeGuestCallRequest,
	started: () => void,
	finished: (completed: boolean) => void,
	failed: (error: unknown) => void,
): Promise<void> {
	const admitCall = (): boolean => {
		const call = request.isCurrent() ? request.prepare() : undefined;
		if (call === undefined) { finished(false); return false; }
		guest.invalidate();
		runtime.history.stop();
		const cpu = runtime.machine.cpu;
		const returnDepth = cpu.getFrameDepth();
		cpu.beginCompletionClosureInExecutionDomain(call.domain, call.closure, call.args());
		pushRuntimeDebuggerControlPlan(debuggerState, new RuntimeGuestCallPlan(runtime, returnDepth, finished), 'workbench');
		return true;
	};
	return tasks.schedule(() => {
		const returnDepth = runtime.machine.cpu.readExceptionReturnFrameDepth();
		if (returnDepth === -1) {
			if (admitCall()) started();
			return;
		}
		if (!request.isCurrent()) { finished(false); return; }
		// Evaluation is ordinary guest work. Let the active exception return via
		// its own RFE first; never copy Status/EPC or inject a call under its mask.
		guest.invalidate();
		runtime.history.stop();
		pushRuntimeDebuggerControlPlan(debuggerState, new RuntimeGuestCallPlan(runtime, returnDepth, completed => {
			if (!completed) { finished(false); return; }
			// IRQ execution may have submitted GPU work and invalidated UI borrows.
			// Re-enter mutation admission, then resolve the actual call afresh.
			void tasks.schedule(() => { admitCall(); }, failed);
		}), 'workbench');
		started();
	}, failed);
}
