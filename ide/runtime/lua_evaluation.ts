import { type RuntimeStackTraceFrame } from './stack_trace';
import type { HostExecutionControl } from '../../hosts/common/execution_control';
import type { HostRewind } from '../../hosts/common/rewind';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { valueString, type Value } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { IO_SYS_STATUS, SYS_STATUS_SUPERVISOR_ACTIVE } from '../../machine/ts/spec/bmsx/io';
import { resumeRuntimeDebugger, RuntimeDebuggerResumeMode, type RuntimeDebuggerState } from './debugger_state';
import type { RuntimeFaultState } from './fault_state';
import { scheduleRuntimeGuestCall } from './guest_call';
import { readRuntimeLuaModuleExport } from './lua_inspection';
import type { RuntimeSourceState } from './sources';
import type { SuspendedGuestSession } from './suspended_guest';
import { clearExecutionStopHighlights } from '../runtime_error/navigation';

export type LuaGlobalContext = 'cart' | 'session';
export type LuaFrameContext = { readonly kind: 'frame'; readonly stopId: number; readonly frame: RuntimeStackTraceFrame };
export type LuaEvaluationContext = LuaGlobalContext | LuaFrameContext;
export type LuaEvaluationResult = { readonly status: 'completed' | 'lua-error' | 'interrupted' | 'host-error'; readonly values: readonly string[] };
export type LuaEvaluationObservation = {
	readonly id: number;
	readonly context: LuaGlobalContext | 'frame';
	readonly status: 'queued' | 'running' | 'paused' | LuaEvaluationResult['status'];
	readonly values: readonly string[];
	readonly output: readonly string[];
	readonly outputTruncated: boolean;
};
const EVALUATION_OUTPUT_CAPACITY = 2048;

export class LuaEvaluation {
	public readonly output: string[] = [];
	public outputCount = 0;
	private readonly settled = Promise.withResolvers<LuaEvaluationResult>();
	public readonly completion = this.settled.promise;
	public result: LuaEvaluationResult | undefined;
	public outcome: LuaEvaluationResult | undefined;
	public status: 'queued' | 'running' | 'paused' = 'queued';
	public controlVersion = 0;
	public readonly listeners = new Set<() => void>();
	public constructor(public readonly source: string, public readonly context: LuaGlobalContext | 'frame', public readonly id: number, public executionRevision: number) {}
	public finish(result: LuaEvaluationResult): void { this.result = result; this.settled.resolve(result); }
}

/** Programmatic BIOS evaluation through the debugger scheduler. No terminal UI or host namespace. */
export class RuntimeLuaEvaluation {
	public active: LuaEvaluation | undefined;
	public lastResult: LuaEvaluation | undefined;
	private serial = 0;
	private generation = 0;
	private closed = false;
	private readonly values: Value[] = [];
	public readonly receiveOutput = (text: string): void => {
		const operation = this.active;
		if (operation !== undefined) operation.output[operation.outputCount++ % EVALUATION_OUTPUT_CAPACITY] = text;
	};
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
		return !this.closed && this.active === undefined && this.debuggerState.executionContext === undefined && this.tasks.mutationReady && !this.execution.launchPending
			&& !this.debuggerState.plans.mutationActive && !this.rewind.active && !this.execution.frameStepPending
			&& !this.fault.hostFrameFailed && this.fault.faultSnapshot === null
			&& this.runtime.machine.cpu.activeCartridgeSlot() !== -1
			&& (this.runtime.machine.memory.readIoU32(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_ACTIVE) === 0;
	}
	public frameContext(frame: RuntimeStackTraceFrame): LuaFrameContext {
		const stop = this.debuggerState.source.stop;
		if (stop === undefined || stop.media !== this.sources.currentBlua32Media || frame.kind !== 'source') throw new Error('Frame evaluation requires an installed source frame at the current debugger stop.');
		return { kind: 'frame', stopId: stop.id, frame };
	}
	public contextAvailable(context: LuaEvaluationContext): boolean {
		const stop = this.debuggerState.source.stop;
		return context === 'cart' || context === 'session' || stop !== undefined && context.stopId === stop.id && stop.media === this.sources.currentBlua32Media;
	}
	public get paused(): boolean { return this.debuggerState.plans.controlSuspended || this.debuggerState.source.stop !== undefined; }
	public get canToggleExecution(): boolean {
		return this.active !== undefined && this.tasks.ready && this.debuggerState.plans.workbenchControlActive
			&& this.fault.faultSnapshot === null;
	}
	public setPaused(operation: LuaEvaluation, paused: boolean): void {
		if (this.active !== operation) throw new Error('Lua evaluation is no longer active.');
		if (operation.outcome !== undefined) throw new Error('Lua evaluation has returned and is settling machine work.');
		if (!this.debuggerState.plans.workbenchControlActive) {
			if (!paused) throw new Error('Lua evaluation has not entered the CPU yet.');
			this.finish(operation, { status: 'interrupted', values: ['Lua admission cancelled before execution.'] });
			return;
		}
		if (!paused && !this.canToggleExecution) throw new Error('Lua control is unavailable during machine recovery.');
		operation.controlVersion++;
		const plans = this.debuggerState.plans;
		if (!paused && this.debuggerState.source.stop !== undefined) {
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
		if (this.fault.hostFrameFailed || this.tasks.failure !== undefined) {
			this.finish(operation, { status: 'host-error', values: [this.tasks.failure !== undefined
				? String(this.tasks.failure.error) : 'Host execution failed; use the debugger recovery controls.'] });
			return;
		}
		if (operation.outcome !== undefined) {
			// Guest return precedes plan retirement and its new history checkpoint.
			// Keep admission until the host has settled both, just like source stepping.
			const gpu = this.runtime.machine.gxGpu;
			if (this.tasks.ready && !gpu.backendServicePending() && !gpu.backendServiceBlocksMachine()) this.finish(operation, operation.outcome);
			return;
		}
		if (operation.status === 'queued') return;
		const status = this.paused ? 'paused' : 'running';
		if (operation.status === status) return;
		operation.status = status;
		for (const listener of operation.listeners) listener();
	}

	public observe(operation: LuaEvaluation): LuaEvaluationObservation {
		const output: string[] = [];
		for (let index = Math.max(0, operation.outputCount - EVALUATION_OUTPUT_CAPACITY); index < operation.outputCount; index++) {
			output.push(operation.output[index % EVALUATION_OUTPUT_CAPACITY]);
		}
		return { id: operation.id, context: operation.context, status: operation.result?.status ?? operation.status,
			values: operation.result?.values ?? [], output, outputTruncated: operation.outputCount > EVALUATION_OUTPUT_CAPACITY };
	}

	/** A tool waits for a real return or stop. Abort suspends its own work, never unwinds guest frames. */
	public waitForStop(operation: LuaEvaluation, signal: AbortSignal): Promise<LuaEvaluationObservation> {
		const version = operation.controlVersion;
		return new Promise((resolve, reject) => {
			const dispose = () => { signal.removeEventListener('abort', abort); operation.listeners.delete(changed); };
			const changed = () => {
				if (operation.result === undefined && (operation.outcome !== undefined || operation.status !== 'paused')) return;
				dispose(); resolve(this.observe(operation));
			};
			const abort = () => {
				dispose();
				if (this.active === operation && operation.outcome === undefined && operation.controlVersion === version
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

	public evaluate(source: string, context: LuaEvaluationContext): LuaEvaluation {
		if (!this.canEvaluate) throw new Error('Lua execution is unavailable while another machine operation or the BIOS monitor is active.');
		if (!this.contextAvailable(context)) throw new Error('Selected frame expired. Select a frame at the current debugger stop.');
		const selected = context === 'cart' || context === 'session' ? undefined : context;
		const name = selected === undefined ? context as LuaGlobalContext : 'frame';
		const operation = new LuaEvaluation(source, name, ++this.serial, this.execution.revision), generation = this.generation;
		this.active = operation;
		void scheduleRuntimeGuestCall(this.runtime, this.guest, this.debuggerState, this.tasks, {
			admission: selected === undefined ? 'quiescent' : 'at-stop', honorUserStops: true,
			isCurrent: () => generation === this.generation && operation.result === undefined && this.contextAvailable(context),
			prepare: () => {
				const module = readRuntimeLuaModuleExport(this.sources, this.guest, -1, 'shell/repl');
				if (module.kind !== 'value') throw new Error('The installed BIOS does not contain shell/repl. Rebuild and reboot the BIOS.');
				return { domain: -1, closure: this.guest.readStringMember(module.value, selected === undefined ? 'evaluate' : 'evaluate_frame') as Closure,
					args: () => {
						const pool = this.runtime.machine.cpu.stringPool;
						const args: Value[] = [valueString(pool.intern(source)), valueString(pool.intern(`=evaluation:${operation.id}`))];
						if (selected === undefined) args.push(valueString(pool.intern(name)));
						else args.push(selected.frame.physicalFrameIndex, selected.frame.inlineDepth);
						return args;
					} };
			},
		}, () => {
			clearExecutionStopHighlights(); this.execution.requestExecution(false);
			operation.executionRevision = this.execution.revision;
			operation.status = 'running';
		}, completed => {
			if (operation.result !== undefined || operation.outcome !== undefined) return;
			if (!completed) { this.finish(operation, { status: 'interrupted', values: ['Lua call interrupted; existing guest mutations are retained.'] }); return; }
			this.runtime.machine.cpu.readCompletionValues(this.values);
			const succeeded = this.values[0] === true;
			const result: string[] = [];
			for (let index = 1; index < this.values.length; index++) result.push(this.guest.previewValue(this.values[index], 2, 12));
			this.values.length = 0;
			operation.outcome = { status: succeeded ? 'completed' : 'lua-error', values: result };
		}, error => { if (operation.result === undefined) this.finish(operation, { status: 'host-error', values: [String(error)] }); });
		return operation;
	}
	private finish(operation: LuaEvaluation, result: LuaEvaluationResult): void {
		operation.finish(result);
		this.lastResult = operation;
		this.active = undefined;
		for (const listener of operation.listeners) listener();
	}
	public didReplaceMachine(): void {
		this.generation++;
		if (this.active !== undefined) this.finish(this.active, { status: 'interrupted', values: ['Machine state replaced; pending Lua call ended.'] });
	}
	public shutdown(): Promise<void> {
		this.closed = true;
		this.generation++;
		if (this.active !== undefined) this.finish(this.active, { status: 'interrupted', values: ['Lua evaluation closed.'] });
		return this.tasks.join();
	}
}
