import type { HostExecutionControl } from '../../../../hosts/common/execution_control';
import type { HostRewind } from '../../../../hosts/common/rewind';
import type { RuntimeTaskQueue } from '../../../../hosts/common/runtime_task_queue';
import type { Closure } from '../../../../machine/ts/machine/cpu/closure';
import { valueString, type Value } from '../../../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import { IO_SYS_STATUS, SYS_STATUS_SUPERVISOR_ACTIVE } from '../../../../machine/ts/spec/bmsx/io';
import { resumeRuntimeDebugger, RuntimeDebuggerResumeMode, type RuntimeDebuggerState } from '../../../runtime/debugger_state';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import { scheduleRuntimeGuestCall } from '../../../runtime/guest_call';
import { readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { clearExecutionStopHighlights } from '../../../runtime_error/navigation';
import { TerminalTranscript } from './transcript';

export type TerminalResult = { readonly status: 'completed' | 'lua-error' | 'interrupted' | 'host-error'; readonly values: readonly string[] };
export class TerminalEvaluation {
	private readonly settled = Promise.withResolvers<TerminalResult>();
	public readonly completion = this.settled.promise;
	public result: TerminalResult | undefined;
	public constructor(public readonly source: string, public readonly id: number) {}
	public finish(result: TerminalResult): void { this.result = result; this.settled.resolve(result); }
}

/** One execution owner for manual input and future clients, never an interpreter. */
export class LuaTerminalSession {
	public readonly transcript = new TerminalTranscript();
	public readonly history: string[] = [];
	public active: TerminalEvaluation | undefined;
	private serial = 0;
	private generation = 0;
	private closed = false;
	private readonly values: Value[] = [];
	public readonly receiveOutput = (text: string): void => { this.transcript.append('output', text); };
	public constructor(
		private readonly runtime: Runtime,
		private readonly sources: RuntimeSourceState,
		private readonly guest: SuspendedGuestSession,
		private readonly debuggerState: RuntimeDebuggerState,
		private readonly fault: RuntimeFaultState,
		private readonly tasks: RuntimeTaskQueue,
		private readonly execution: HostExecutionControl,
		private readonly rewind: HostRewind,
	) {}

	public get canEvaluate(): boolean {
		return !this.closed && this.active === undefined && this.tasks.mutationReady && !this.execution.launchPending
			&& !this.debuggerState.plans.mutationActive && !this.rewind.active
			&& !this.fault.hostFrameFailed && this.fault.faultSnapshot === null
			&& this.runtime.machine.cpu.activeCartridgeSlot() !== -1
			&& (this.runtime.machine.memory.readIoU32(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_ACTIVE) === 0;
	}
	public get paused(): boolean { return this.debuggerState.plans.controlSuspended || this.debuggerState.stopped; }
	public get canToggleExecution(): boolean {
		return this.active !== undefined && this.tasks.ready && this.debuggerState.plans.workbenchControlActive
			&& this.fault.faultSnapshot === null;
	}
	public toggleExecution(): void {
		if (!this.canToggleExecution) return;
		const plans = this.debuggerState.plans;
		if (this.debuggerState.stopped) {
			resumeRuntimeDebugger(this.debuggerState, RuntimeDebuggerResumeMode.Continue);
			clearExecutionStopHighlights();
		} else plans.setControlSuspended(!plans.controlSuspended);
		if (!plans.controlSuspended) this.execution.requestExecution(false);
	}

	public evaluate(source: string): TerminalEvaluation {
		if (!this.canEvaluate) throw new Error('Lua execution is unavailable while another machine operation or the BIOS monitor is active.');
		const operation = new TerminalEvaluation(source, ++this.serial), generation = this.generation;
		this.active = operation;
		if (this.history[this.history.length - 1] !== source) {
			this.history.push(source);
			if (this.history.length > 100) this.history.shift();
		}
		this.transcript.append('input', source);
		void scheduleRuntimeGuestCall(this.runtime, this.guest, this.debuggerState, this.tasks, {
			honorUserStops: true,
			isCurrent: () => generation === this.generation,
			prepare: () => {
				const module = readRuntimeLuaModuleExport(this.sources, this.guest, -1, 'shell/repl');
				if (module.kind !== 'value') throw new Error('The installed BIOS does not contain shell/repl. Rebuild and reboot the BIOS.');
				return { domain: -1, closure: this.guest.readStringMember(module.value, 'evaluate') as Closure,
					args: () => {
						const pool = this.runtime.machine.cpu.stringPool;
						return [valueString(pool.intern(source)), valueString(pool.intern(`=terminal:${operation.id}`))];
					} };
			},
		}, () => { clearExecutionStopHighlights(); this.execution.requestExecution(false); }, completed => {
			if (operation.result !== undefined) return;
			if (!completed) { this.finish(operation, 'interrupted', ['Lua call interrupted; existing guest mutations are retained.']); return; }
			this.runtime.machine.cpu.readCompletionValues(this.values);
			const succeeded = this.values[0] === true;
			const result: string[] = [];
			for (let index = 1; index < this.values.length; index++) result.push(this.guest.previewValue(this.values[index], 2, 12));
			this.values.length = 0;
			this.finish(operation, succeeded ? 'completed' : 'lua-error', result);
		}, error => { if (operation.result === undefined) this.finish(operation, 'host-error', [String(error)]); });
		return operation;
	}
	private finish(operation: TerminalEvaluation, status: TerminalResult['status'], values: readonly string[]): void {
		operation.finish({ status, values });
		this.active = undefined;
		if (values.length > 0) this.transcript.append(status === 'completed' ? 'result' : 'error', values.join('\t'));
	}
	public didReplaceMachine(): void {
		this.generation++;
		if (this.active !== undefined) this.finish(this.active, 'interrupted', ['Machine state replaced; pending Lua call ended.']);
		this.transcript.append('notice', 'Machine state replaced. Lua session follows the guest state; scrollback is historical.');
	}
	public shutdown(): Promise<void> {
		this.closed = true;
		this.generation++;
		if (this.active !== undefined) this.finish(this.active, 'interrupted', ['Terminal session closed.']);
		return this.tasks.join();
	}
}
