import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import type {
	ExecutionDomainId,
	ExecutionDomainMask,
} from '../../machine/ts/spec/blua32/execution_domain';

export const enum RuntimeDebuggerPlanResult {
	Active,
	Complete,
}

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

class RuntimeDebuggerCompletionBatchRecord implements RuntimeDebuggerCompletionBatch {
	public constructor(
		private readonly cpu: CPU,
		public readonly firstFrameIndex: number,
		public readonly executionDomains: readonly ExecutionDomainId[],
	) {
	}

	public isPending(): boolean {
		return this.cpu.getFrameDepth() > this.firstFrameIndex
			&& this.cpu.readFrameReturnsToCompletionLatch(this.firstFrameIndex);
	}

	public containsFrame(frameIndex: number): boolean {
		return frameIndex >= this.firstFrameIndex
			&& frameIndex < this.firstFrameIndex + this.executionDomains.length;
	}
}

export class RuntimeDebuggerPlanManager {
	private controlPlan: RuntimeDebuggerControlPlan | null = null;
	private readonly completionBatches: RuntimeDebuggerCompletionBatchRecord[] = [];

	public get controlActive(): boolean {
		return this.controlPlan !== null;
	}

	public get executionDomainMask(): ExecutionDomainMask {
		return this.controlPlan === null ? 0 : this.controlPlan.executionDomainMask;
	}

	public get preMaskableInterruptDomainMask(): ExecutionDomainMask {
		return this.controlPlan === null ? 0 : this.controlPlan.preMaskableInterruptDomainMask;
	}

	public pushControlPlan(plan: RuntimeDebuggerControlPlan): void {
		if (this.controlPlan !== null) {
			this.controlPlan.discard();
		}
		this.controlPlan = plan;
	}

	public shouldStop(executionDomainId: ExecutionDomainId, pc: number): boolean {
		return this.controlPlan!.shouldStop(executionDomainId, pc);
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
		return executionDomainMask !== this.executionDomainMask
			|| preMaskableInterruptDomainMask !== this.preMaskableInterruptDomainMask;
	}

	public pushCompletionBatch(
		cpu: CPU,
		firstFrameIndex: number,
		executionDomains: readonly ExecutionDomainId[],
	): void {
		this.completionBatches.push(new RuntimeDebuggerCompletionBatchRecord(
			cpu,
			firstFrameIndex,
			executionDomains,
		));
	}

	public pruneCompletedCompletionBatches(): void {
		while (this.completionBatches.length !== 0) {
			const batch = this.completionBatches[this.completionBatches.length - 1];
			if (batch.isPending()) {
				return;
			}
			this.completionBatches.length -= 1;
		}
	}

	public completionBatchAtFrame(frameIndex: number): RuntimeDebuggerCompletionBatch | null {
		for (let batchIndex = this.completionBatches.length - 1;
			batchIndex >= 0;
			batchIndex -= 1) {
			const batch = this.completionBatches[batchIndex];
			if (batch.containsFrame(frameIndex)) {
				return batch;
			}
		}
		return null;
	}

	public discardCompletionBatchesFrom(frameIndex: number): void {
		while (this.completionBatches.length !== 0
			&& this.completionBatches[this.completionBatches.length - 1].firstFrameIndex
				>= frameIndex) {
			this.completionBatches.length -= 1;
		}
	}

	public discardAll(): void {
		if (this.controlPlan !== null) {
			this.controlPlan.discard();
			this.controlPlan = null;
		}
		this.completionBatches.length = 0;
	}
}
