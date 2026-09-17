import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Value } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { ALL_EXECUTION_DOMAINS_MASK, type ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { RuntimeDebuggerPlanResult, type RuntimeDebuggerControlPlan } from './debugger_plans';
import { pushRuntimeDebuggerControlPlan, type RuntimeDebuggerState } from './debugger_state';
import type { RuntimeFunctionLocation, SuspendedGuestSession } from './suspended_guest';
import { runtimeFunctionReturnTarget, runtimeReturnTargetReached, type RuntimeReturnTarget } from './function_return';

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
	/** Finish an existing non-reentrant operation before resolving the evaluation. */
	readonly waitForReturn?: () => readonly RuntimeFunctionLocation[];
	readonly prepare: () => RuntimeGuestCall | undefined;
};

/** A debugger function evaluation, executed by the ordinary scheduled CPU. */
export class RuntimeGuestCallPlan implements RuntimeDebuggerControlPlan {
	public readonly executionDomainMask = ALL_EXECUTION_DOMAINS_MASK;
	public readonly preMaskableInterruptDomainMask = this.executionDomainMask;

	public constructor(
		private readonly runtime: Runtime,
		private readonly target: RuntimeReturnTarget,
		private readonly finish: (completed: boolean) => void,
	) {}

	public shouldStop(): boolean { return runtimeReturnTargetReached(this.runtime.machine.cpu, this.target); }
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
	const admitCall = (checkFunctionReturn: boolean): boolean => {
		if (!request.isCurrent()) { finished(false); return false; }
		const cpu = runtime.machine.cpu;
		const exceptionDepth = cpu.readExceptionReturnFrameDepth();
		let target: RuntimeReturnTarget | undefined;
		if (exceptionDepth !== -1) target = { frameDepth: exceptionDepth };
		else if (checkFunctionReturn) {
			const locations = request.waitForReturn?.();
			if (locations !== undefined) for (const location of locations) {
				const candidate = runtimeFunctionReturnTarget(cpu, debuggerState.sources, location);
				if (candidate !== undefined && (target === undefined || candidate.frameDepth < target.frameDepth
					|| candidate.frameDepth === target.frameDepth && (candidate.inline?.depth ?? 0) < (target.inline?.depth ?? 0))) target = candidate;
			}
		}
		if (target !== undefined) {
			guest.invalidate();
			runtime.history.stop();
			pushRuntimeDebuggerControlPlan(debuggerState, new RuntimeGuestCallPlan(runtime, target, completed => {
				if (!completed) { finished(false); return; }
				// The returning function may have submitted GPU work and changed the
				// inspected heap. Re-enter admission, then resolve the call afresh.
				// An adjacent inline call can begin at the return PC. It has not
				// executed: do not chase subsequent invocations around a game loop.
				void tasks.schedule(() => { admitCall(exceptionDepth !== -1 && checkFunctionReturn); }, failed);
			}), 'workbench');
			return true;
		}
		const call = request.prepare();
		if (call === undefined) { finished(false); return false; }
		guest.invalidate();
		runtime.history.stop();
		const returnTarget = { frameDepth: cpu.getFrameDepth() };
		cpu.beginCompletionClosureInExecutionDomain(call.domain, call.closure, call.args());
		pushRuntimeDebuggerControlPlan(debuggerState, new RuntimeGuestCallPlan(runtime, returnTarget, finished), 'workbench');
		return true;
	};
	return tasks.schedule(() => {
		if (admitCall(true)) started();
	}, failed);
}
