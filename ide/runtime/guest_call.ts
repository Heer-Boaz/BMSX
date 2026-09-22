import type { Thread } from '../../machine/ts/machine/cpu/thread';
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
export type RuntimeGuestCallBoundary = {
	/** Ask the guest owner for an admission receipt using its ordinary API. */
	readonly request: RuntimeGuestCall;
	/** Bind a condition to the receipt returned by that call, not UI heap borrows. */
	readonly condition: (values: readonly Value[]) => () => boolean;
};
export type RuntimeGuestCallRequest = {
	/** Request lifetime is independent of any suspended-heap borrow. */
	readonly isCurrent: () => boolean;
	/** The guest lifecycle, rather than debugger function names, admits this edit. */
	readonly boundary?: () => RuntimeGuestCallBoundary | undefined;
	readonly prepare: () => RuntimeGuestCall | undefined;
};

/** A debugger function evaluation, executed by the ordinary scheduled CPU. */
export class RuntimeGuestCallPlan implements RuntimeDebuggerControlPlan {
	public readonly executionDomainMask = ALL_EXECUTION_DOMAINS_MASK;
	public readonly preMaskableInterruptDomainMask = this.executionDomainMask;

	private readonly thread: Thread;
	public constructor(
		runtime: Runtime,
		private readonly returnDepth: number,
		private readonly finish: (completed: boolean) => void,
	) { this.thread = runtime.machine.cpu.activeThread; }

	public shouldStop(): boolean { return this.thread.frames.length <= this.returnDepth; }
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

/** A guest-owned rendezvous. Only an explicit evaluation installs this hook. */
class RuntimeGuestBoundaryPlan implements RuntimeDebuggerControlPlan {
	public readonly executionDomainMask = ALL_EXECUTION_DOMAINS_MASK;
	public readonly preMaskableInterruptDomainMask = this.executionDomainMask;
	public constructor(
		private readonly request: RuntimeGuestCallRequest,
		private readonly reached: () => boolean,
		private readonly finish: (completed: boolean) => void,
	) {}
	public shouldStop(): boolean { return !this.request.isCurrent() || this.reached(); }
	public willExecute(): void {}
	public didExecute(): RuntimeDebuggerPlanResult {
		if (!this.shouldStop()) return RuntimeDebuggerPlanResult.Active;
		this.finish(this.request.isCurrent());
		return RuntimeDebuggerPlanResult.Complete;
	}
	public didFault(): RuntimeDebuggerPlanResult { this.finish(false); return RuntimeDebuggerPlanResult.Active; }
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
	const beginCall = (call: RuntimeGuestCall, finish: (completed: boolean) => void): void => {
		guest.invalidate();
		runtime.history.stop();
		const cpu = runtime.machine.cpu;
		const depth = cpu.getFrameDepth();
		cpu.beginCompletionClosureInExecutionDomain(call.domain, call.closure, call.args());
		pushRuntimeDebuggerControlPlan(debuggerState, new RuntimeGuestCallPlan(runtime, depth, finish), 'workbench');
	};
	const admitCall = (checkBoundary: boolean): boolean => {
		if (!request.isCurrent()) { finished(false); return false; }
		const cpu = runtime.machine.cpu;
		const exceptionDepth = cpu.readExceptionReturnFrameDepth();
		if (exceptionDepth !== -1) {
			guest.invalidate();
			runtime.history.stop();
			pushRuntimeDebuggerControlPlan(debuggerState, new RuntimeGuestCallPlan(runtime, exceptionDepth, completed => {
				if (!completed) { finished(false); return; }
				// The handler may have submitted GPU work or replaced inspected values.
				void tasks.schedule(() => { admitCall(checkBoundary); }, failed);
			}), 'workbench');
			return true;
		}
		const boundary = checkBoundary ? request.boundary?.() : undefined;
		if (boundary !== undefined) {
			beginCall(boundary.request, completed => {
				if (!completed) { finished(false); return; }
				const values: Value[] = [];
				cpu.readCompletionValues(values);
				const reached = boundary.condition(values);
				// Leave the completion plan before installing the rendezvous. The
				// receipt is owned by this control operation, never a pane borrower.
				void tasks.schedule(() => {
					if (!request.isCurrent()) { finished(false); return; }
					guest.invalidate();
					pushRuntimeDebuggerControlPlan(debuggerState, new RuntimeGuestBoundaryPlan(request, reached, ready => {
						if (!ready) { finished(false); return; }
						// A boundary can submit GPU work and replace the inspected graph.
						void tasks.schedule(() => { admitCall(false); }, failed);
					}), 'workbench');
				}, failed);
			});
			return true;
		}
		const call = request.prepare();
		if (call === undefined) { finished(false); return false; }
		beginCall(call, finished);
		return true;
	};
	return tasks.schedule(() => {
		if (admitCall(true)) started();
	}, failed);
}
