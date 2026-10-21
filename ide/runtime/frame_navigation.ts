import { HostPauseReason, type HostExecutionControl } from '../../hosts/common/execution_control';
import type { HostRewind } from '../../hosts/common/rewind';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { RuntimeRestoreOrigin } from '../../machine/ts/machine/runtime/save_state';
import { runtimeDebuggerExecutionRequested, type SourceExecutionState } from './debugger_state';
import type { RuntimeFaultState } from './fault_state';
import type { SuspendedGuestSession } from './suspended_guest';

type Position = { cycles: number; videoTick: number };
type NavigationRequest = { kind: 'frames'; direction: -1 | 1; count: number } | { kind: 'seek'; cycles: number }
	| { kind: 'finish-review'; destination: 'here' | 'present' };
type HistoryPosition = { reviewing: boolean; earliestCycles: number; latestCycles: number };
export type FrameNavigationResult = {
	status: 'completed' | 'stopped' | 'interrupted' | 'replaced' | 'failed';
	reason?: string;
	request: NavigationRequest;
	before: Position;
	after: Position;
	completedFrames: number;
	history: HistoryPosition;
};

export class FrameNavigationOperation {
	public result: FrameNavigationResult | undefined;
	private resolve!: (result: FrameNavigationResult) => void;
	public readonly completion = new Promise<FrameNavigationResult>(resolve => { this.resolve = resolve; });
	public completedFrames = 0;
	public executionRevision = 0;
	public rewindRevision = 0;
	public frameStartTick = 0;
	public ownsRewind = false;
	public cancelling = false;
	public detach: (() => void) | undefined;
	public constructor(public readonly request: NavigationRequest, public readonly before: Position) {}
	public finish(status: FrameNavigationResult['status'], after: Position, history: HistoryPosition, reason?: string): void {
		this.detach?.();
		this.result = { status, reason, request: this.request, before: this.before, after, completedFrames: this.completedFrames, history };
		this.resolve(this.result);
	}
}

/** Finite physical-target operations shared by Studio commands and tools. No execution loop of its own. */
export class RuntimeFrameNavigation {
	public active: FrameNavigationOperation | undefined;
	private closing = false;
	/** The host rechecks operation authority after asynchronous GPU work, before replacing machine state. */
	private readonly isCurrent = (): boolean => this.active !== undefined
		&& this.active.executionRevision === this.execution.revision && this.active.rewindRevision === this.rewind.revision;
	public constructor(
		private readonly runtime: Runtime,
		private readonly execution: HostExecutionControl,
		private readonly rewind: HostRewind,
		private readonly tasks: RuntimeTaskQueue,
		private readonly debuggerState: SourceExecutionState,
		private readonly fault: RuntimeFaultState,
		private readonly guest: SuspendedGuestSession,
	) {}

	public get available(): boolean {
		return !this.closing && this.active === undefined && this.tasks.ready && !this.execution.frameStepBlocked
			&& !this.execution.frameStepPending
			&& this.fault.hostFrameFailure === undefined && !this.debuggerState.plans.mutationActive
			&& !runtimeDebuggerExecutionRequested(this.debuggerState) && !this.rewind.seeking && !this.rewind.playing;
	}
	public canStep(direction: -1 | 1): boolean {
		return this.available && (direction < 0
			? this.rewind.available && this.rewind.frameStepCycles(-1) < this.rewind.positionCycles
			: this.debuggerState.source.stop === undefined && this.fault.faultSnapshot === null);
	}
	public get canFinishReview(): boolean { return this.available && this.rewind.active; }
	public historyState() {
		const history = this.runtime.history;
		return { available: this.rewind.available, earliestCycles: history.earliestCycles, latestCycles: history.latestCycles,
			reviewing: this.rewind.active, positionCycles: this.runtime.machine.scheduler.currentNowCycles(),
			canStepBack: this.canStep(-1), canStepForward: this.canStep(1), canFinishReview: this.canFinishReview,
			operationActive: this.active !== undefined };
	}

	private position(): Position {
		return { cycles: this.runtime.machine.scheduler.currentNowCycles(), videoTick: this.runtime.frameScheduler.lastTickSequence };
	}
	private accept(request: NavigationRequest, signal?: AbortSignal): FrameNavigationOperation {
		signal?.throwIfAborted();
		const operation = new FrameNavigationOperation(request, this.position());
		this.active = operation;
		this.execution.setPauseReason(HostPauseReason.Requested, true);
		this.guest.invalidate();
		if (signal !== undefined) {
			const cancel = () => this.cancel(operation);
			signal.addEventListener('abort', cancel, { once: true });
			operation.detach = () => signal.removeEventListener('abort', cancel);
		}
		return operation;
	}
	public step(direction: -1 | 1, count = 1, signal?: AbortSignal): FrameNavigationOperation {
		if (!this.canStep(direction)) throw new Error('Frame navigation is not available in the current runtime state.');
		const operation = this.accept({ kind: 'frames', direction, count }, signal);
		if (direction < 0) {
			operation.ownsRewind = true;
			this.rewind.seekTo(this.rewind.frameStepCycles(-1, count), this.isCurrent);
			operation.executionRevision = this.execution.revision;
			operation.rewindRevision = this.rewind.revision;
		} else this.issueFrame(operation);
		return operation;
	}
	public seek(cycles: number, signal?: AbortSignal): FrameNavigationOperation {
		if (!this.available || !this.rewind.available) throw new Error('Retained history navigation is not available.');
		const history = this.runtime.history;
		if (cycles < history.earliestCycles || cycles > history.latestCycles) throw new Error('Requested cycles are outside the retained history range.');
		const operation = this.accept({ kind: 'seek', cycles }, signal);
		operation.ownsRewind = true;
		this.rewind.seekTo(cycles, this.isCurrent);
		operation.executionRevision = this.execution.revision;
		operation.rewindRevision = this.rewind.revision;
		return operation;
	}
	/** End review without starting gameplay. The history owner alone commits or rejoins the recording. */
	public finishReview(destination: 'here' | 'present', signal?: AbortSignal): FrameNavigationOperation {
		if (!this.canFinishReview) throw new Error('History review cannot be finished in the current runtime state.');
		const operation = this.accept({ kind: 'finish-review', destination }, signal);
		operation.ownsRewind = true;
		if (destination === 'here') this.rewind.resumeHere();
		else this.rewind.returnToPresent(this.isCurrent);
		operation.executionRevision = this.execution.revision;
		operation.rewindRevision = this.rewind.revision;
		return operation;
	}
	private issueFrame(operation: FrameNavigationOperation): void {
		operation.frameStartTick = this.runtime.frameScheduler.lastTickSequence;
		operation.ownsRewind = this.rewind.active;
		if (this.rewind.active && this.rewind.frameStepCycles(1) > this.rewind.positionCycles) this.rewind.stepFrame(1);
		else {
			if (this.rewind.active) this.rewind.resumeHere();
			this.execution.requestFrameStep();
		}
		operation.executionRevision = this.execution.revision;
		operation.rewindRevision = this.rewind.revision;
	}

	/** A cancelled operation cannot stop or rewrite newer explicit user intent. */
	public cancel(operation: FrameNavigationOperation): void {
		if (this.active !== operation) return;
		const superseded = operation.executionRevision !== this.execution.revision || operation.rewindRevision !== this.rewind.revision;
		this.stopOwnedCommands(operation);
		if (superseded) {
			this.finish('interrupted', 'superseded'); return;
		}
		operation.cancelling = true;
		operation.rewindRevision = this.rewind.revision;
	}
	private stopOwnedCommands(operation: FrameNavigationOperation): void {
		// A newer timeline selection may replace our replay intent without replacing
		// our pending live tick (and vice versa). Release each owner independently.
		if (operation.executionRevision === this.execution.revision) this.execution.finishFrameStep();
		if (operation.ownsRewind && operation.rewindRevision === this.rewind.revision) this.rewind.pauseSeek();
	}

	/** Retire superseded commands before the host can execute a queued seek or branch. */
	public beforeHostFrame(): void {
		const operation = this.active;
		if (operation !== undefined && !this.isCurrent()) this.cancel(operation);
	}
	/** Composition calls once after ordinary host execution, faults and presentation. */
	public afterHostFrame(): void {
		this.beforeHostFrame();
		const operation = this.active;
		if (operation === undefined) return;
		if (this.tasks.failure !== undefined || this.fault.hostFrameFailure !== undefined) {
			this.stopOwnedCommands(operation);
			this.finish('failed', this.tasks.failure !== undefined ? String(this.tasks.failure.error) : 'host-frame-failed'); return;
		}
		const gpu = this.runtime.machine.gxGpu;
		if (!this.tasks.ready || gpu.backendServicePending() || gpu.backendServiceBlocksMachine()) return;
		if (operation.cancelling) {
			if (!this.rewind.seeking) this.finish('interrupted', 'cancelled');
			return;
		}
		const finishingReview = operation.request.kind === 'finish-review';
		// Accepting an already inspected state executes nothing, including at an existing debugger/fault stop.
		const acceptsCurrent = finishingReview && operation.request.destination === 'here';
		if (!acceptsCurrent && (this.debuggerState.source.stop !== undefined || this.fault.faultSnapshot !== null
			|| operation.ownsRewind && this.rewind.active && this.rewind.stopped)) {
			this.stopOwnedCommands(operation);
			this.finish('stopped', this.fault.faultSnapshot !== null ? 'guest-fault' : this.debuggerState.source.stop !== undefined ? 'debugger' : 'replay-stopped'); return;
		}
		if (this.execution.frameStepPending || this.rewind.seeking || this.rewind.playing) return;
		// A return seek may be settled while its subsequent Resume command is still queued.
		if (finishingReview && this.rewind.active) return;
		if (operation.request.kind !== 'frames') { this.finish('completed'); return; }
		if (operation.request.direction < 0) {
			operation.completedFrames = operation.before.videoTick - this.runtime.frameScheduler.lastTickSequence;
			if (operation.completedFrames === operation.request.count) this.finish('completed');
			else this.finish('stopped', 'retained-history-start');
			return;
		}
		const step = this.runtime.frameScheduler.lastTickSequence - operation.frameStartTick;
		if (step !== operation.request.direction) { this.finish('interrupted', 'video-boundary-not-reached'); return; }
		operation.completedFrames += 1;
		if (operation.completedFrames === operation.request.count) { this.finish('completed'); return; }
		this.issueFrame(operation);
	}

	public didRestore(origin: RuntimeRestoreOrigin): void {
		if (origin === RuntimeRestoreOrigin.HistorySeek && this.active?.ownsRewind) return;
		this.didReset();
	}
	public didReset(): void {
		const operation = this.active;
		if (operation === undefined) return;
		this.stopOwnedCommands(operation);
		this.finish('replaced', 'machine-replaced');
	}
	/** Composition reports a physical stop even when no authoring source stack can be captured. */
	public didFault(kind: 'host' | 'guest', reason: string): void {
		const operation = this.active;
		if (operation === undefined) return;
		this.stopOwnedCommands(operation);
		this.finish(kind === 'host' ? 'failed' : 'stopped', reason);
	}
	private finish(status: FrameNavigationResult['status'], reason?: string): void {
		const operation = this.active!;
		this.active = undefined;
		const history = this.runtime.history;
		operation.finish(status, this.position(), { reviewing: this.rewind.active,
			earliestCycles: history.earliestCycles, latestCycles: history.latestCycles }, reason);
	}
	public dispose(): void {
		this.closing = true;
		if (this.active === undefined) return;
		this.cancel(this.active);
		if (this.active !== undefined) this.finish('interrupted', 'target-closed');
	}
}
