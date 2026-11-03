import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { RuntimeDebuggerPlanResult, type RuntimeDebuggerControlPlan } from './debugger_plans';

/** Publish submitted GPU work at a real video edge without resuming the stopped
 * guest. Device time and IRQ latches advance; no guest instruction or IRQ entry does. */
export class RuntimeDeviceSettlementPlan implements RuntimeDebuggerControlPlan {
	public readonly devicesOnly = true;
	public readonly honorUserStops = false;
	public readonly executionDomainMask = 0;
	public readonly preMaskableInterruptDomainMask = 0;
	private readonly sequence: number;
	public constructor(private readonly runtime: Runtime, private readonly finish: (completed: boolean) => void) {
		this.sequence = runtime.frameScheduler.lastTickSequence;
	}
	public shouldStop(): boolean { return true; }
	public willExecute(): void {}
	public didExecute(): RuntimeDebuggerPlanResult {
		const scheduler = this.runtime.frameScheduler;
		if (scheduler.lastTickSequence === this.sequence || !scheduler.lastTickVisualFrameCommitted) return RuntimeDebuggerPlanResult.Active;
		this.finish(true);
		return RuntimeDebuggerPlanResult.Complete;
	}
	public didFault(): RuntimeDebuggerPlanResult { this.finish(false); return RuntimeDebuggerPlanResult.Complete; }
	public discard(): void { this.finish(false); }
}
