import { SOURCE_EXECUTION_MODES, type SourceExecutionMode } from './source_debugger';
import { HostPauseReason, type HostExecutionControl } from '../../hosts/common/execution_control';
import type { HostRewind } from '../../hosts/common/rewind';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import { interruptRuntimeDebuggerExecution, resumeRuntimeDebugger, RuntimeDebuggerStopReason, type RuntimeDebuggerState } from './debugger_state';
import type { RuntimeDebuggerControlPlan, RuntimeDebuggerExecutionContext } from './debugger_plans';
import type { RuntimeFaultState } from './fault_state';
import type { RuntimeFrameNavigation } from './frame_navigation';
import type { SuspendedGuestSession } from './suspended_guest';

type Position = { cycles: number; videoTick: number };
export type SourceExecutionResult = {
	mode: SourceExecutionMode;
	status: 'stopped' | 'interrupted' | 'replaced' | 'failed';
	reason: string;
	before: Position;
	after: Position;
	stop?: { reason: 'breakpoint' | 'step'; domain: ExecutionDomainId; pc: number; inlineDepth: number };
};
export class SourceExecutionOperation {
	private readonly settled = Promise.withResolvers<SourceExecutionResult>();
	public readonly completion = this.settled.promise;
	public result: SourceExecutionResult | undefined;
	public outcome: SourceExecutionResult | undefined;
	public detach: (() => void) | undefined;
	public constructor(public readonly mode: SourceExecutionMode, public readonly context: RuntimeDebuggerExecutionContext,
		public readonly before: Position, public executionRevision: number, public debuggerRevision: number,
		public readonly rewindRevision: number, public readonly plan: RuntimeDebuggerControlPlan | null) {}
	public finish(result: SourceExecutionResult): void {
		this.detach?.();
		this.result = result;
		this.settled.resolve(result);
	}
}

/** Source execution on the existing physical target. No private interpreter/scheduler or control plan. */
export class RuntimeDebuggerExecution {
	public active: SourceExecutionOperation | undefined;
	private closing = false;
	public constructor(
		private readonly runtime: Runtime,
		public readonly state: RuntimeDebuggerState,
		private readonly execution: HostExecutionControl,
		private readonly rewind: HostRewind,
		private readonly tasks: RuntimeTaskQueue,
		private readonly fault: RuntimeFaultState,
		private readonly guest: SuspendedGuestSession,
		private readonly navigation: RuntimeFrameNavigation,
	) {}

	public canResume(mode: SourceExecutionMode): boolean {
		const state = this.state, plans = state.plans;
		return !this.closing && this.active === undefined && this.tasks.ready && !this.execution.frameStepBlocked
			&& !this.execution.frameStepPending && this.navigation.active === undefined && !this.rewind.active
			&& !this.fault.hostFrameFailed && this.fault.faultSnapshot === null
			&& (!plans.controlActive || plans.honorUserStops && (state.source.stopped || plans.controlSuspended))
			&& (state.source.stopped || this.execution.paused || plans.controlSuspended)
			&& (mode === 'continue' || state.source.stopped)
			&& (mode !== 'out' || state.source.canStepOut);
	}
	public resume(mode: SourceExecutionMode, context: RuntimeDebuggerExecutionContext, signal?: AbortSignal): SourceExecutionOperation {
		signal?.throwIfAborted();
		if (!this.canResume(mode)) throw new Error('Source debugger execution is unavailable in the current target state.');
		if (context === 'workbench') this.execution.setPauseReason(HostPauseReason.Requested, true);
		this.execution.requestExecution(context === 'game' && mode === 'continue');
		this.guest.invalidate();
		resumeRuntimeDebugger(this.state, SOURCE_EXECUTION_MODES[mode], context);
		const operation = new SourceExecutionOperation(mode, context, this.position(), this.execution.revision,
			this.state.executionRevision, this.rewind.revision, this.state.plans.activeControlPlan);
		this.active = operation;
		if (signal !== undefined) {
			const abort = () => this.cancel(operation);
			signal.addEventListener('abort', abort, { once: true });
			operation.detach = () => signal.removeEventListener('abort', abort);
		}
		return operation;
	}
	private position(): Position {
		return { cycles: this.runtime.machine.scheduler.currentNowCycles(), videoTick: this.runtime.frameScheduler.lastTickSequence };
	}
	private superseded(operation: SourceExecutionOperation): boolean {
		return operation.executionRevision !== this.execution.revision || operation.debuggerRevision !== this.state.executionRevision
			|| operation.rewindRevision !== this.rewind.revision;
	}
	private releaseIntent(operation: SourceExecutionOperation): void {
		if (operation.debuggerRevision !== this.state.executionRevision) return;
		interruptRuntimeDebuggerExecution(this.state);
		operation.debuggerRevision = this.state.executionRevision;
	}
	private suspend(operation: SourceExecutionOperation): void {
		this.execution.setPauseReason(HostPauseReason.Requested, true);
		operation.executionRevision = this.execution.revision;
		if (operation.plan !== null && this.state.plans.activeControlPlan === operation.plan) this.state.plans.setControlSuspended(true);
	}
	private stopped(operation: SourceExecutionOperation, status: SourceExecutionResult['status'], reason: string): void {
		this.releaseIntent(operation);
		const state = this.state;
		operation.outcome = { mode: operation.mode, status, reason, before: operation.before, after: this.position(),
			stop: state.source.stopped ? { reason: state.source.stopReason === RuntimeDebuggerStopReason.Breakpoint ? 'breakpoint' : 'step',
				domain: state.source.stopDomain, pc: state.source.stopPc, inlineDepth: state.source.stopInlineDepth } : undefined };
	}
	public cancel(operation: SourceExecutionOperation): void {
		if (this.active !== operation) return;
		if (this.superseded(operation)) {
			this.stopped(operation, 'interrupted', 'superseded');
			this.finish(operation); return;
		}
		this.suspend(operation);
		this.stopped(operation, 'interrupted', 'cancelled');
	}

	/** Retire stale intent before the ordinary host admits the next execution slice. */
	public beforeHostFrame(): void {
		const operation = this.active;
		if (operation === undefined) return;
		if (this.superseded(operation)) {
			this.stopped(operation, 'interrupted', 'superseded');
			this.finish(operation);
		}
	}
	/** A receipt follows the actual stop and outstanding GPU/history work, not resume acceptance. */
	public afterHostFrame(): void {
		this.state.source.didExecute();
		this.beforeHostFrame();
		const operation = this.active;
		if (operation === undefined) return;
		if (this.tasks.failure !== undefined || this.fault.hostFrameFailed) {
			this.suspend(operation);
			this.stopped(operation, 'failed', this.tasks.failure !== undefined ? String(this.tasks.failure.error) : 'host-frame-failed');
			this.finish(operation); return;
		}
		if (operation.outcome === undefined) {
			if (this.state.source.stopped) this.stopped(operation, 'stopped', this.state.source.stopReason === RuntimeDebuggerStopReason.Breakpoint ? 'breakpoint' : 'step');
			else if (this.fault.faultSnapshot !== null) {
				this.suspend(operation); this.stopped(operation, 'stopped', 'guest-fault');
			} else if (operation.plan !== this.state.plans.activeControlPlan) {
				// The call's own owner reports its result. Do not step into the suspended caller/game.
				this.suspend(operation); this.stopped(operation, 'stopped', 'control-boundary');
			} else if (this.state.source.stepThreadFinished) {
				this.suspend(operation); this.stopped(operation, 'stopped', 'thread-completed');
			} else if (this.state.plans.controlSuspended || this.runtime.machine.cpu.getFrameDepth() === 0) {
				this.suspend(operation); this.stopped(operation, 'stopped', 'execution-paused');
			} else if (operation.context === 'game' && this.execution.executionBlocked(true)) {
				this.stopped(operation, 'stopped', 'host-paused');
			}
		}
		const gpu = this.runtime.machine.gxGpu;
		if (operation.outcome !== undefined && this.tasks.ready && !gpu.backendServicePending() && !gpu.backendServiceBlocksMachine()) this.finish(operation);
	}
	private finish(operation: SourceExecutionOperation): void {
		this.active = undefined;
		operation.finish(operation.outcome!);
	}
	/** The composition resets raw debugger latches after the physical machine replacement. */
	public didReset(): void {
		const operation = this.active;
		if (operation === undefined) return;
		this.active = undefined;
		operation.finish({ mode: operation.mode, status: 'replaced', reason: 'machine-replaced', before: operation.before, after: this.position() });
	}
	public dispose(): void {
		this.closing = true;
		const operation = this.active;
		if (operation === undefined) return;
		this.cancel(operation);
		if (this.active !== undefined) this.finish(operation);
	}
}
