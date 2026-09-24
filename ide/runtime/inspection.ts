import type { RuntimeDebuggerExecution } from './debugger_execution';
import type { RuntimeFrameNavigation } from './frame_navigation';
import { HostPauseReason, type HostExecutionControl } from '../../hosts/common/execution_control';
import type { HostRewind } from '../../hosts/common/rewind';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import type { CallFrame } from '../../machine/ts/machine/cpu/call_state';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { ResourceDomain } from '../common/resource';
import { DisposableStore } from '../common/lifecycle';
import { runtimeDebuggerExecutionRequested, RuntimeDebuggerStopReason, type RuntimeDebuggerState } from './debugger_state';
import type { RuntimeFaultState } from './fault_state';
import type { Blua32SourceImage, RuntimeSourceState } from './sources';
import type { SuspendedGuestSession } from './suspended_guest';
import { InspectionValues } from './inspection_values';
export type { InspectedEntry, InspectedValue } from './inspection_values';
import { buildLuaStackFrames, createLuaSourceStackTraceFrame, readRuntimeStackFrames, type RuntimeStackFrame, type RuntimeStackTraceFrame } from './stack_trace';
import { runtimeLuaFrameScopes, type RuntimeLuaFrameScope } from './lua_inspection';

type InspectedFrameScope = { readonly kind: RuntimeLuaFrameScope['kind']; readonly status: RuntimeLuaFrameScope['status']; readonly reference?: string; readonly count?: number };
type InspectedFrame = RuntimeStackTraceFrame & { readonly reference: string; readonly functionAddress: number; readonly pc: number; readonly domain: ResourceDomain };
export type InspectionScope = {
	readonly domain: ResourceDomain;
	readonly status: 'available' | 'not-loaded' | 'symbols-unavailable';
	readonly reference?: string;
	readonly count?: number;
};
/** A physical authoring target, not the currently visible pane or selected source. */
export class RuntimeInspectionService {
	public readonly target = crypto.randomUUID();
	public constructor(
		private readonly runtime: Runtime,
		private readonly sources: RuntimeSourceState,
		private readonly guest: SuspendedGuestSession,
		private readonly debuggerState: RuntimeDebuggerState,
		private readonly execution: HostExecutionControl,
		private readonly tasks: RuntimeTaskQueue,
		private readonly rewind: HostRewind,
		private readonly fault: RuntimeFaultState,
		private readonly navigation: RuntimeFrameNavigation,
		private readonly debuggerExecution: RuntimeDebuggerExecution,
	) {}

	public get canInspect(): boolean {
		return this.debuggerExecution.active === undefined && this.navigation.active === undefined && this.tasks.ready && !this.execution.launchPending && !this.execution.frameStepPending
			&& !this.rewind.seeking && !this.rewind.playing && !this.fault.hostFrameFailed
			&& (this.rewind.active || this.debuggerState.source.stopped || this.debuggerState.plans.controlSuspended
				|| this.execution.executionBlocked(runtimeDebuggerExecutionRequested(this.debuggerState)));
	}

	public status() {
		const stop = this.debuggerState.source.stopped ? {
			reason: this.debuggerState.source.stopReason === RuntimeDebuggerStopReason.Breakpoint ? 'breakpoint' as const : 'step' as const,
			domain: this.debuggerState.source.stopDomain, pc: this.debuggerState.source.stopPc, inlineDepth: this.debuggerState.source.stopInlineDepth,
		} : undefined;
		const fault = this.fault.faultSnapshot;
		return { target: this.target, role: 'authoring' as const,
			activeCartridge: this.runtime.machine.cpu.activeCartridgeSlot(),
			cycles: this.runtime.machine.scheduler.currentNowCycles(), videoTick: this.runtime.frameScheduler.lastTickSequence,
			paused: this.execution.paused, userPaused: this.execution.userPaused, debuggerStopped: this.debuggerState.source.stopped,
			stop, fault: fault === null ? undefined : { message: fault.message, resource: fault.resource, line: fault.line, column: fault.column },
			operationActive: this.debuggerExecution.active !== undefined || this.navigation.active !== undefined || !this.tasks.ready || this.debuggerState.plans.controlActive,
			history: this.navigation.historyState(),
			rewindActive: this.rewind.active, canInspect: this.canInspect };
	}

	/** Does not resume a debugger, cancel a guest call or change any other pause reason. */
	public pause(): ReturnType<RuntimeInspectionService['status']> {
		if (this.debuggerExecution.active !== undefined || this.navigation.active !== undefined || !this.tasks.ready || this.execution.launchPending || this.execution.frameStepPending
			|| this.rewind.active || this.debuggerState.plans.controlActive || runtimeDebuggerExecutionRequested(this.debuggerState)) {
			throw new Error('Finish or interrupt the active machine operation before pausing for inspection.');
		}
		this.execution.setPauseReason(HostPauseReason.Requested, true);
		return this.status();
	}

	public open(): RuntimeInspection {
		if (!this.canInspect) throw new Error('Runtime inspection requires a paused, idle target.');
		return new RuntimeInspection(this, this.sources, this.guest, this.runtime);
	}
}

/** Lazy, stop-scoped guest borrows. This is neither a heap copy nor an evaluator. */
export class RuntimeInspection {
	public readonly id = crypto.randomUUID();
	public readonly state: ReturnType<RuntimeInspectionService['status']>;
	public readonly scopes: InspectionScope[] = [];
	/** Domain readers share this lifetime/alias registry and requireSuspended() before borrowing. */
	public readonly lifetime = new DisposableStore();
	public readonly values: InspectionValues;
	private readonly frames = new Map<string, { physical: RuntimeStackFrame; frame: CallFrame; trace: InspectedFrame; scopes?: readonly InspectedFrameScope[] }>();
	private stack: InspectedFrame[] | undefined;
	private readonly unbind: () => void;

	public constructor(private readonly owner: RuntimeInspectionService, public readonly sources: RuntimeSourceState,
		public readonly guest: SuspendedGuestSession, private readonly runtime: Runtime) {
		this.state = owner.status();
		this.values = this.lifetime.add(new InspectionValues(this.id, guest));
		this.unbind = guest.onDidInvalidate(() => this.dispose());
		this.addScope(-1, sources.currentBlua32Media.system);
		const slot = this.state.activeCartridge;
		if (slot !== -1) this.addScope(slot, sources.currentBlua32Media.cartridgeSlots[slot]);
	}

	public readStack(start: number, count: number) {
		this.requireSuspended();
		if (this.stack === undefined) {
			const physical = readRuntimeStackFrames(this.runtime.machine.cpu, this.sources);
			this.stack = buildLuaStackFrames(physical,
				(domain, path, line, column, name) => createLuaSourceStackTraceFrame(this.sources, domain, path, line, column, name))
				.map((frame, index): InspectedFrame => {
					const location = physical[frame.physicalFrameIndex];
					const reference = `${this.id}/frame/${index}`;
					const trace = { ...frame, reference, domain: location.executionDomainId, pc: location.tracePc, functionAddress: location.functionAddress };
					this.frames.set(reference, { physical: location, frame: this.runtime.machine.cpu.activeThread.frames[frame.physicalFrameIndex], trace });
					return trace;
				});
		}
		return { inspection: this.id, origin: 'current-cpu' as const, source: 'installed' as const,
			start, total: this.stack.length, frames: this.stack.slice(start, start + count) };
	}

	public frameScopes(reference: string) {
		this.requireSuspended();
		const frame = this.frames.get(reference);
		if (frame === undefined) throw new Error('Frame reference does not belong to this inspection.');
		if (frame.scopes === undefined) {
			frame.scopes = runtimeLuaFrameScopes(frame.physical, frame.trace.inlineDepth).map(scope => {
				if (scope.status !== 'available') return { kind: scope.kind, status: scope.status };
				return { kind: scope.kind, status: scope.status, count: scope.bindings.length,
					reference: this.values.frame(scope.kind, frame.frame, scope.bindings) };
			});
		}
		return { inspection: this.id, frame: reference, scopes: frame.scopes };
	}

	private addScope(domain: ResourceDomain, image: Blua32SourceImage | null): void {
		if (image === null || image.symbols === null) {
			this.scopes.push({ domain, status: image === null ? 'not-loaded' : 'symbols-unavailable' });
			return;
		}
		const names = image.globalRegisterFileByName;
		const reference = this.values.globals(names);
		this.scopes.push({ domain, status: 'available', reference, count: names.size });
	}

	public requireSuspended(): void {
		if (this.lifetime.isDisposed) throw new Error('Inspection expired. Open a new inspection of the current stopped target.');
		if (!this.owner.canInspect) {
			this.dispose();
			throw new Error('Target is no longer available for suspended inspection.');
		}
	}

	public read(reference: string, start: number, count: number) {
		this.requireSuspended();
		return this.values.read(reference, start, count);
	}

	public dispose(): void {
		this.unbind();
		this.lifetime.dispose();
		this.frames.clear(); this.stack = undefined;
	}
}
