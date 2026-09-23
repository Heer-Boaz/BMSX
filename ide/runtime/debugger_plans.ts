import type { Thread } from '../../machine/ts/machine/cpu/thread';
import type {
	ExecutionDomainId,
	ExecutionDomainMask,
} from '../../machine/ts/spec/blua32/execution_domain';

export const enum RuntimeDebuggerPlanResult {
	Active,
	Complete,
}

/** Evaluation can run behind workbench controls; recovery resumes the game. */
export type RuntimeDebuggerExecutionContext = 'game' | 'workbench';

export interface RuntimeDebuggerControlPlan {
	readonly executionDomainMask: ExecutionDomainMask;
	readonly preMaskableInterruptDomainMask: ExecutionDomainMask;
	shouldStop(executionDomainId: ExecutionDomainId, pc: number): boolean;
	willExecute(): void;
	didExecute(): RuntimeDebuggerPlanResult;
	didFault(): RuntimeDebuggerPlanResult;
	discard(): void;
}

export type RuntimeDebuggerCompletionBatch = {
	readonly firstFrameIndex: number;
	readonly executionDomains: readonly ExecutionDomainId[];
};

export type RuntimeDebuggerCompletionResult =
	| { readonly status: 'completed' | 'discarded' }
	| { readonly status: 'faulted'; readonly sequence: number };

class RuntimeDebuggerCompletionBatchRecord implements RuntimeDebuggerCompletionBatch {
	public constructor(
		public readonly thread: Thread,
		public readonly firstFrameIndex: number,
		public readonly executionDomains: readonly ExecutionDomainId[],
		private settled: ((result: RuntimeDebuggerCompletionResult) => void) | null,
	) {
	}

	public isPending(): boolean {
		return this.thread.frames.length > this.firstFrameIndex
			&& this.thread.frames[this.firstFrameIndex].returnToCompletionLatch;
	}

	public containsFrame(thread: Thread, frameIndex: number): boolean {
		return thread === this.thread && frameIndex >= this.firstFrameIndex
			&& frameIndex < this.firstFrameIndex + this.executionDomains.length;
	}

	public settle(result: RuntimeDebuggerCompletionResult): void {
		// A fault retires the observer, not the physical roots needed by recovery.
		const settled = this.settled;
		this.settled = null;
		settled?.(result);
	}
}

export class RuntimeDebuggerPlanManager {
	private controlPlan: RuntimeDebuggerControlPlan | null = null;
	private controlContext: RuntimeDebuggerExecutionContext = 'game';
	private suspended = false;
	private readonly completionBatches: RuntimeDebuggerCompletionBatchRecord[] = [];

	public get controlActive(): boolean {
		return this.controlPlan !== null;
	}

	public get controlSuspended(): boolean { return this.controlActive && this.suspended; }
	public get controlExecutionRequested(): boolean { return this.controlActive && !this.suspended; }
	public get workbenchControlActive(): boolean { return this.controlActive && this.controlContext === 'workbench'; }
	public get workbenchExecutionRequested(): boolean { return this.workbenchControlActive && !this.suspended; }

	/** Suspension retains the call stack and all mutations; it does not cancel/unwind. */
	public setControlSuspended(suspended: boolean): void { this.suspended = suspended; }

	/** Tool-driven execution is not a replayable interval of ordinary guest input. */
	public get mutationActive(): boolean {
		return this.controlPlan !== null || this.completionBatches.length !== 0;
	}

	public get executionDomainMask(): ExecutionDomainMask {
		return this.controlPlan === null ? 0 : this.controlPlan.executionDomainMask;
	}

	public get preMaskableInterruptDomainMask(): ExecutionDomainMask {
		return this.controlPlan === null ? 0 : this.controlPlan.preMaskableInterruptDomainMask;
	}

	public pushControlPlan(plan: RuntimeDebuggerControlPlan, context: RuntimeDebuggerExecutionContext = 'game'): void {
		if (this.controlPlan !== null) {
			this.controlPlan.discard();
		}
		this.controlPlan = plan;
		this.controlContext = context;
		this.suspended = false;
	}

	public shouldStop(executionDomainId: ExecutionDomainId, pc: number): boolean {
		return this.suspended || this.controlPlan!.shouldStop(executionDomainId, pc);
	}

	public willExecute(): boolean {
		const executionDomainMask = this.executionDomainMask;
		const preMaskableInterruptDomainMask = this.preMaskableInterruptDomainMask;
		this.controlPlan!.willExecute();
		return executionDomainMask !== this.executionDomainMask
			|| preMaskableInterruptDomainMask !== this.preMaskableInterruptDomainMask;
	}

	public didExecute(): boolean {
		const executionDomainMask = this.executionDomainMask;
		const preMaskableInterruptDomainMask = this.preMaskableInterruptDomainMask;
		if (this.controlPlan!.didExecute() === RuntimeDebuggerPlanResult.Complete) {
			this.controlPlan = null;
			return true;
		}
		return executionDomainMask !== this.executionDomainMask
			|| preMaskableInterruptDomainMask !== this.preMaskableInterruptDomainMask;
	}

	public didFault(): boolean {
		const executionDomainMask = this.executionDomainMask;
		const preMaskableInterruptDomainMask = this.preMaskableInterruptDomainMask;
		if (this.controlPlan!.didFault() === RuntimeDebuggerPlanResult.Complete) {
			this.controlPlan = null;
			return true;
		}
		this.suspended = true;
		return executionDomainMask !== this.executionDomainMask
			|| preMaskableInterruptDomainMask !== this.preMaskableInterruptDomainMask;
	}

	public pushCompletionBatch(
		thread: Thread,
		firstFrameIndex: number,
		executionDomains: readonly ExecutionDomainId[],
		settled: (result: RuntimeDebuggerCompletionResult) => void,
	): void {
		this.completionBatches.push(new RuntimeDebuggerCompletionBatchRecord(
			thread,
			firstFrameIndex,
			executionDomains,
			settled,
		));
	}

	public pruneCompletedCompletionBatches(): void {
		// Roots are LIFO within one thread, not across suspended coroutines.
		for (let index = this.completionBatches.length - 1; index >= 0; index -= 1) {
			const batch = this.completionBatches[index];
			if (batch.isPending()) continue;
			this.completionBatches.splice(index, 1);
			batch.settle({ status: 'completed' });
		}
	}

	public faultCompletionBatches(sequence: number): void {
		// Init may have returned before an ordinary gameplay fault in this slice.
		this.pruneCompletedCompletionBatches();
		for (const batch of this.completionBatches) batch.settle({ status: 'faulted', sequence });
	}

	public completionBatchAtFrame(thread: Thread, frameIndex: number): RuntimeDebuggerCompletionBatch | null {
		for (let batchIndex = this.completionBatches.length - 1;
			batchIndex >= 0;
			batchIndex -= 1) {
			const batch = this.completionBatches[batchIndex];
			if (batch.containsFrame(thread, frameIndex)) {
				return batch;
			}
		}
		return null;
	}

	public discardCompletionBatchesFrom(thread: Thread, frameIndex: number): void {
		for (let index = this.completionBatches.length - 1; index >= 0; index -= 1) {
			const batch = this.completionBatches[index];
			if (batch.thread === thread && batch.firstFrameIndex >= frameIndex) {
				this.completionBatches.splice(index, 1);
				batch.settle({ status: 'discarded' });
			}
		}
	}

	public discardAll(): void {
		if (this.controlPlan !== null) {
			this.controlPlan.discard();
			this.controlPlan = null;
		}
		while (this.completionBatches.length !== 0) this.completionBatches.pop()!.settle({ status: 'discarded' });
	}
}
