import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { FrameField, FRAME_COMPLETION } from '../../machine/ts/machine/cpu/call_state';
import { MAX_THREAD_VALUE_SLOTS } from '../../machine/ts/machine/cpu/thread_record';
import type { Value } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { ALL_EXECUTION_DOMAINS_MASK, type ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import { BLUA32_FUNCTION_VARARG } from '../../machine/ts/spec/blua32/image_format';
import { CPU_RESET_BANK_ADDRESS } from '../../machine/ts/spec/bmsx/memory_map';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { RuntimeDebuggerPlanResult, type RuntimeDebuggerControlPlan } from './debugger_plans';
import { pushRuntimeDebuggerControlPlan, type SourceExecutionState } from './debugger_state';
import type { SuspendedGuestSession } from './suspended_guest';
import type { RuntimeDebuggerSourceStop } from './source_debugger';

export type RuntimeGuestCall = {
	readonly domain: ExecutionDomainId;
	readonly closure: number;
	readonly argumentCount: number;
	/** Borrow existing Values for immediate insertion, or supply immediate operands. Never allocate guest storage here. */
	readonly args: () => readonly Value[];
	/** Report when an ordinary call within the admitted activation first reaches this closure. */
	readonly observeEntry?: { readonly closure: number; readonly entered: () => void };
};

export type RuntimeGuestCallBoundary = {
	/** Ask the guest owner for an admission receipt using its ordinary API. */
	readonly request: RuntimeGuestCall;
	/** Bind a condition to the receipt returned by that call, not UI heap borrows. */
	readonly condition: (values: readonly Value[]) => () => boolean;
};
export type RuntimeGuestCallRequest = {
	readonly honorUserStops: boolean;
	/** Request lifetime is independent of any suspended-heap borrow. */
	readonly isCurrent: () => boolean;
	readonly prepare: () => RuntimeGuestCall | undefined;
	/** The final activation was inserted; a rendezvous or exception entry does not count. */
	readonly didEnter?: (call: RuntimeGuestCall) => void;
} & ({
	readonly admission: 'quiescent';
	/** The guest lifecycle, rather than debugger function names, admits this edit. */
	readonly boundary?: () => RuntimeGuestCallBoundary | undefined;
} | {
	/** Call above the current suspended stack; never finish its exception first. */
	readonly admission: 'at-stop';
});

/** A debugger function evaluation, executed by the ordinary scheduled CPU. */
export class RuntimeGuestCallPlan implements RuntimeDebuggerControlPlan {
	public readonly executionDomainMask = ALL_EXECUTION_DOMAINS_MASK;
	public readonly preMaskableInterruptDomainMask = this.executionDomainMask;

	protected readonly thread: number;
	protected readonly cpu: CPU;
	public constructor(
		runtime: Runtime,
		private readonly returnDepth: number,
		private readonly boundary: 'completion' | 'exception',
		public readonly honorUserStops: boolean,
		private readonly finish: (completed: boolean) => void,
	) { this.cpu = runtime.machine.cpu; this.thread = this.cpu.activeThread.address; }

	public shouldStop(): boolean {
		if (this.boundary === 'exception') return !this.cpu.hasFramesAbove(this.thread, this.returnDepth);
		// A parked caller can accept an IRQ before the next hook. That IRQ may
		// reuse the returned call's depth, but it is not its completion root.
		return this.cpu.readThreadFrameDepth(this.thread) <= this.returnDepth
			|| (this.cpu.readThreadFrameWord(this.thread, this.returnDepth, FrameField.Flags) & FRAME_COMPLETION) === 0;
	}
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

/** Observe a nested target before the source debugger can stop at its first instruction. */
class RuntimeGuestTargetPlan extends RuntimeGuestCallPlan {
	private readonly domain: ExecutionDomainId;
	private readonly pc: number;
	private readonly closure: number;
	private entered: (() => void) | undefined;

	public constructor(runtime: Runtime, depth: number, honorUserStops: boolean, finish: (completed: boolean) => void,
		entry: NonNullable<RuntimeGuestCall['observeEntry']>) {
		super(runtime, depth, 'completion', honorUserStops, finish);
		const binding = this.cpu.captureClosureBinding(entry.closure);
		this.domain = binding.executionDomainId;
		this.pc = binding.codeAddress;
		this.closure = entry.closure;
		this.entered = entry.entered;
	}

	public override shouldStop(domain?: ExecutionDomainId, pc?: number): boolean {
		if (this.entered !== undefined && domain === this.domain && pc === this.pc && this.cpu.activeThread.address === this.thread
			&& this.cpu.activeThread.currentFrame!.closureAddress === this.closure) {
			const entered = this.entered;
			this.entered = undefined;
			entered();
		}
		return super.shouldStop();
	}
}

/** A guest-owned rendezvous. Only an explicit evaluation installs this hook. */
class RuntimeGuestBoundaryPlan implements RuntimeDebuggerControlPlan {
	public readonly honorUserStops = false;
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
	runtime: Runtime, guest: SuspendedGuestSession, debuggerState: SourceExecutionState, tasks: RuntimeTaskQueue,
	request: RuntimeGuestCallRequest,
	started: () => void,
	finished: (completed: boolean) => void,
	failed: (error: unknown) => void,
): Promise<void> {
	const beginCall = (call: RuntimeGuestCall, honorUserStops: boolean, finish: (completed: boolean) => void): void => {
		guest.invalidate();
		runtime.history.stop();
		const cpu = runtime.machine.cpu;
		const depth = cpu.getFrameDepth();
		cpu.beginCompletionCall(call.closure, call.args());
		let retained: RuntimeDebuggerSourceStop | undefined;
		const onReturn = request.admission === 'at-stop' ? (completed: boolean) => {
			if (completed && retained !== undefined && debuggerState.source.returnToStop(retained)) {
				debuggerState.stopPresentationPending = true;
			}
			finish(completed);
		} : finish;
		const plan = call.observeEntry === undefined
			? new RuntimeGuestCallPlan(runtime, depth, 'completion', honorUserStops, onReturn)
			: new RuntimeGuestTargetPlan(runtime, depth, honorUserStops, onReturn, call.observeEntry);
		retained = pushRuntimeDebuggerControlPlan(debuggerState, plan, 'workbench', request.admission === 'at-stop' ? 'retain' : 'resume');
	};
	const admitCall = (checkBoundary: boolean, windowRequested = false): boolean => {
		if (!request.isCurrent() || !runtime.admitExternalCpuMutation()) { finished(false); return false; }
		const cpu = runtime.machine.cpu;
		if (request.admission === 'quiescent') {
			const exceptionDepth = cpu.readExceptionReturnFrameDepth();
			if (exceptionDepth !== -1) {
				guest.invalidate();
				runtime.history.stop();
				pushRuntimeDebuggerControlPlan(debuggerState, new RuntimeGuestCallPlan(runtime, exceptionDepth, 'exception', false, completed => {
					if (!completed) { finished(false); return; }
					// The handler may have submitted GPU work or replaced inspected values.
					void tasks.schedule(() => { admitCall(checkBoundary); }, failed);
				}), 'workbench');
				return true;
			}
		}
		const boundary = checkBoundary && request.admission === 'quiescent' ? request.boundary?.() : undefined;
		const call = boundary === undefined ? request.prepare() : boundary.request;
		if (call === undefined) { finished(false); return false; }
		const thread = cpu.activeThread;
		const { maxStack, numParams, flags } = cpu.captureClosureBinding(call.closure);
		// An external call owns only the tail above every retained window.
		let base = thread.stackTop;
		for (let frame = thread.currentFrame; frame !== null; frame = frame.previous)
			base = Math.max(base, frame.stackBase + frame.stackCapacity);
		const valueEnd = base + Math.max(1, numParams, maxStack)
			+ ((flags & BLUA32_FUNCTION_VARARG) !== 0 ? call.argumentCount : 0);
		if (call.argumentCount > MAX_THREAD_VALUE_SLOTS || valueEnd > MAX_THREAD_VALUE_SLOTS) {
			failed(new Error('The call exceeds the machine register window.'));
			return false;
		}
		if (!thread.frameSpaceFits(valueEnd)) {
			if (windowRequested) {
				failed(new Error('Not enough guest memory for the call register window.'));
				return false;
			}
			const depth = thread.frameDepth;
			if (depth === 0 || thread.address === CPU_RESET_BANK_ADDRESS
				|| (request.admission === 'at-stop' && cpu.readExceptionReturnFrameDepth() !== -1)) {
				failed(new Error('A register window cannot be requested without a stopped ordinary frame.'));
				return false;
			}
			let retained: RuntimeDebuggerSourceStop | undefined;
			const plan = new RuntimeGuestCallPlan(runtime, depth, 'exception', false, completed => {
				if (!completed) { finished(false); return; }
				if (retained !== undefined && debuggerState.source.returnToStop(retained))
					debuggerState.stopPresentationPending = true;
				// No closure or argument borrow crosses the firmware allocation.
				void tasks.schedule(() => { admitCall(checkBoundary, true); }, failed);
			});
			guest.invalidate();
			runtime.history.stop();
			cpu.requestRegisterWindow(valueEnd, depth + 2, runtime.machine.scheduler.cyclesUntilDeadline());
			retained = pushRuntimeDebuggerControlPlan(debuggerState, plan, 'workbench', 'retain');
			return true;
		}
		if (boundary !== undefined) {
			beginCall(call, false, completed => {
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
		beginCall(call, request.honorUserStops, finished);
		request.didEnter?.(call);
		return true;
	};
	return tasks.schedule(() => {
		if (admitCall(true)) started();
	}, failed);
}
