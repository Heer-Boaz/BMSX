import type { Input } from '../../hosts/common/input/manager';
import type { HostExecutionControl } from '../../hosts/common/execution_control';
import type { HostRewind } from '../../hosts/common/rewind';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { Thread } from '../../machine/ts/machine/cpu/thread';
import { IO_SYS_STATUS, SYS_STATUS_SUPERVISOR_ACTIVE, SYS_STATUS_SUPERVISOR_RESUMABLE } from '../../machine/ts/spec/bmsx/io';
import { ALL_EXECUTION_DOMAINS_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { showEditorWarningBanner } from '../common/feedback_state';
import { extractErrorMessage } from '../common/errors';
import { pushRuntimeDebuggerControlPlan, type RuntimeDebuggerState } from './debugger_state';
import { RuntimeDebuggerPlanResult, type RuntimeDebuggerControlPlan } from './debugger_plans';
import type { RuntimeFaultState } from './fault_state';
import type { SuspendedGuestSession } from './suspended_guest';

const enum TerminalPhase { Closed, Queued, Entering, Monitor, Returned }

/** Only Studio admission. Firmware owns the shell, editor, output and retained machine context. */
export class BiosTerminal implements RuntimeDebuggerControlPlan {
	public readonly honorUserStops = false;
	public readonly executionDomainMask = ALL_EXECUTION_DOMAINS_MASK;
	public readonly preMaskableInterruptDomainMask = this.executionDomainMask;
	private phase = TerminalPhase.Closed;
	private returnThread: Thread | undefined;
	private returnDepth = 0;
	public constructor(private readonly runtime: Runtime, private readonly input: Input,
		private readonly guest: SuspendedGuestSession, private readonly debuggerState: RuntimeDebuggerState,
		private readonly tasks: RuntimeTaskQueue, private readonly execution: HostExecutionControl,
		private readonly rewind: HostRewind, private readonly fault: RuntimeFaultState) {}

	public get active(): boolean { return this.phase !== TerminalPhase.Closed; }
	public get canOpen(): boolean {
		return this.active || this.tasks.mutationReady && !this.rewind.active && !this.execution.launchPending
			&& !this.execution.frameStepPending && !this.fault.hostFrameFailed
			&& !this.debuggerState.plans.mutationActive && this.debuggerState.executionContext === undefined;
	}
	public open(): void {
		if (this.active) {
			this.resume();
			return;
		}
		if (!this.canOpen) return;
		this.phase = TerminalPhase.Queued;
		void this.tasks.schedule(() => {
			if (this.phase !== TerminalPhase.Queued) return;
			this.runtime.history.stop();
			this.guest.invalidate();
			const status = this.runtime.machine.memory.readIoU32(IO_SYS_STATUS);
			if ((status & SYS_STATUS_SUPERVISOR_RESUMABLE) !== 0 || this.fault.faultSnapshot !== null) this.enterMonitor();
			else this.phase = TerminalPhase.Entering;
			// Physical NMI admission may finish a live IRQ while producers quiesce.
			// Unlike a pinned function evaluation, it retires the old source stop.
			pushRuntimeDebuggerControlPlan(this.debuggerState, this, 'workbench');
			if (this.phase === TerminalPhase.Entering && (status & SYS_STATUS_SUPERVISOR_ACTIVE) === 0) this.input.setProgrammaticSupervisorRequestLine(true);
			this.execution.requestExecution(false);
		}, error => { this.discard(); showEditorWarningBanner(extractErrorMessage(error), 5); });
	}
	/** Reattaching the view resumes its existing plan; it cannot admit another BIOS visit. */
	public resume(): void {
		const plans = this.debuggerState.plans;
		if (plans.activeControlPlan !== this || !plans.controlSuspended) return;
		plans.setControlSuspended(false);
		this.execution.requestExecution(false);
	}
	/** Leaving the view suspends the shell; it never synthesizes CONT or unwinds firmware. */
	public suspend(): void {
		if (this.phase === TerminalPhase.Queued) this.discard();
		else if (this.debuggerState.plans.activeControlPlan === this) this.debuggerState.plans.setControlSuspended(true);
	}
	private enterMonitor(): void {
		this.phase = TerminalPhase.Monitor;
		this.input.setProgrammaticSupervisorRequestLine(false);
		const cpu = this.runtime.machine.cpu;
		for (let index = 0; index < cpu.getFrameDepth(); index++) {
			if (!cpu.isNonMaskableExceptionFrame(index)) continue;
			this.returnThread = cpu.activeThread;
			this.returnDepth = index;
			break;
		}
	}
	public shouldStop(): boolean {
		if (this.phase === TerminalPhase.Entering) {
			// ACTIVE includes producer quiescence, before the CPU has entered NMI.
			if ((this.runtime.machine.memory.readIoU32(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_RESUMABLE) !== 0) {
				this.enterMonitor();
			}
			return false;
		}
		// CONT can return into BIOS/IRQ code, not just a user-mode cart. Hold
		// the actual NMI caller before another instruction or maskable IRQ.
		if (this.phase === TerminalPhase.Monitor && this.returnThread !== undefined && this.returnThread.frames.length <= this.returnDepth) {
			this.phase = TerminalPhase.Returned;
			return true;
		}
		return false;
	}
	public willExecute(): void {}
	public didExecute(): RuntimeDebuggerPlanResult {
		if (this.phase !== TerminalPhase.Returned) return RuntimeDebuggerPlanResult.Active;
		this.discard();
		return RuntimeDebuggerPlanResult.Complete;
	}
	public didFault(): RuntimeDebuggerPlanResult { this.discard(); return RuntimeDebuggerPlanResult.Complete; }
	public discard(): void {
		this.input.setProgrammaticSupervisorRequestLine(false);
		this.returnThread = undefined;
		this.phase = TerminalPhase.Closed;
	}
}
