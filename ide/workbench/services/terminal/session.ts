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
import { TerminalTranscript, type TerminalEntry } from './transcript';

export type TerminalResult = { readonly status: 'completed' | 'lua-error' | 'interrupted' | 'host-error'; readonly values: readonly string[] };
export type TerminalObservation = {
	readonly id: number;
	readonly context: 'session';
	readonly status: 'queued' | 'running' | 'paused' | TerminalResult['status'];
	readonly values: readonly string[];
	readonly output: readonly TerminalEntry[];
	readonly outputTruncated: boolean;
};
export class TerminalEvaluation {
	private readonly settled = Promise.withResolvers<TerminalResult>();
	public readonly completion = this.settled.promise;
	public result: TerminalResult | undefined;
	public status: 'queued' | 'running' | 'paused' = 'queued';
	public outputEnd: number | undefined;
	public controlVersion = 0;
	public readonly listeners = new Set<() => void>();
	public constructor(public readonly source: string, public readonly id: number, public readonly outputStart: number,
		public executionRevision: number) {}
	public finish(result: TerminalResult): void { this.result = result; this.settled.resolve(result); }
}

/** One execution owner for manual input and conversation tools, never an interpreter. */
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
			&& !this.debuggerState.plans.mutationActive && !this.rewind.active && !this.execution.frameStepPending
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
		this.setPaused(this.active!, !this.paused);
	}
	public setPaused(operation: TerminalEvaluation, paused: boolean): void {
		if (this.active !== operation) throw new Error('Terminal evaluation is no longer active.');
		if (!this.debuggerState.plans.workbenchControlActive) {
			if (!paused) throw new Error('Terminal evaluation has not entered the CPU yet.');
			this.finish(operation, 'interrupted', ['Lua admission cancelled before execution.']);
			return;
		}
		if (!paused && !this.canToggleExecution) throw new Error('Terminal control is unavailable during machine recovery.');
		operation.controlVersion++;
		const plans = this.debuggerState.plans;
		if (!paused && this.debuggerState.stopped) {
			resumeRuntimeDebugger(this.debuggerState, RuntimeDebuggerResumeMode.Continue);
			clearExecutionStopHighlights();
		} else plans.setControlSuspended(paused);
		if (!paused) this.execution.requestExecution(false);
		operation.executionRevision = this.execution.revision;
		this.afterHostFrame();
	}

	/** Observe scheduler stops without running another CPU loop or polling the provider. */
	public afterHostFrame(): void {
		const operation = this.active;
		if (operation === undefined) return;
		if (this.fault.hostFrameFailed) {
			this.finish(operation, 'host-error', ['Host execution failed; use the debugger recovery controls.']);
			return;
		}
		if (operation.status === 'queued') return;
		const status = this.paused ? 'paused' : 'running';
		if (operation.status === status) return;
		operation.status = status;
		for (const listener of operation.listeners) listener();
	}

	public observe(operation: TerminalEvaluation): TerminalObservation {
		const output: TerminalEntry[] = [];
		for (let id = Math.max(operation.outputStart, this.transcript.start); id < (operation.outputEnd ?? this.transcript.next); id++) output.push(this.transcript.entry(id));
		return { id: operation.id, context: 'session', status: operation.result?.status ?? operation.status,
			values: operation.result?.values ?? [], output, outputTruncated: this.transcript.start > operation.outputStart };
	}

	/** A tool waits for a real return or stop. Abort suspends its own work, never unwinds guest frames. */
	public waitForStop(operation: TerminalEvaluation, signal: AbortSignal): Promise<TerminalObservation> {
		const version = operation.controlVersion;
		return new Promise((resolve, reject) => {
			const dispose = () => { signal.removeEventListener('abort', abort); operation.listeners.delete(changed); };
			const changed = () => {
				if (operation.result === undefined && operation.status !== 'paused') return;
				dispose(); resolve(this.observe(operation));
			};
			const abort = () => {
				dispose();
				if (this.active === operation && operation.controlVersion === version
					&& this.execution.revision === operation.executionRevision) {
					this.setPaused(operation, true);
				}
				reject(signal.reason);
			};
			operation.listeners.add(changed);
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) abort(); else changed();
		});
	}

	public evaluate(source: string): TerminalEvaluation {
		if (!this.canEvaluate) throw new Error('Lua execution is unavailable while another machine operation or the BIOS monitor is active.');
		const operation = new TerminalEvaluation(source, ++this.serial, this.transcript.next, this.execution.revision), generation = this.generation;
		this.active = operation;
		if (this.history[this.history.length - 1] !== source) {
			this.history.push(source);
			if (this.history.length > 100) this.history.shift();
		}
		this.transcript.append('input', source);
		void scheduleRuntimeGuestCall(this.runtime, this.guest, this.debuggerState, this.tasks, {
			honorUserStops: true,
			isCurrent: () => generation === this.generation && operation.result === undefined,
			prepare: () => {
				const module = readRuntimeLuaModuleExport(this.sources, this.guest, -1, 'shell/repl');
				if (module.kind !== 'value') throw new Error('The installed BIOS does not contain shell/repl. Rebuild and reboot the BIOS.');
				return { domain: -1, closure: this.guest.readStringMember(module.value, 'evaluate') as Closure,
					args: () => {
						const pool = this.runtime.machine.cpu.stringPool;
						return [valueString(pool.intern(source)), valueString(pool.intern(`=terminal:${operation.id}`))];
					} };
			},
		}, () => {
			clearExecutionStopHighlights(); this.execution.requestExecution(false);
			operation.executionRevision = this.execution.revision;
			operation.status = 'running';
		}, completed => {
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
		operation.outputEnd = this.transcript.next;
		for (const listener of operation.listeners) listener();
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
