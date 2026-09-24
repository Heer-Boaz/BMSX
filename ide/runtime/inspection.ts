import type { RuntimeDebuggerExecution } from './debugger_execution';
import type { RuntimeFrameNavigation } from './frame_navigation';
import { HostPauseReason, type HostExecutionControl } from '../../hosts/common/execution_control';
import type { HostRewind } from '../../hosts/common/rewind';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import type { Table } from '../../machine/ts/machine/cpu/table';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { ResourceDomain } from '../common/resource';
import { runtimeDebuggerExecutionRequested, RuntimeDebuggerStopReason, type RuntimeDebuggerState } from './debugger_state';
import type { RuntimeFaultState } from './fault_state';
import { Blua32GlobalRegisterFile, type Blua32SourceImage, type RuntimeSourceState } from './sources';
import { SuspendedGuestValueKind, type SuspendedGuestSession, type SuspendedGuestValue } from './suspended_guest';
import { buildLuaStackFrames, createLuaSourceStackTraceFrame, readRuntimeStackFrames, type RuntimeStackFrame, type RuntimeStackTraceFrame } from './stack_trace';
import { runtimeLuaFrameScopes, type RuntimeLuaFrameBinding, type RuntimeLuaFrameScope } from './lua_inspection';
import type { SourceRange } from '../../toolchain/ts/lua/source_range';

export type InspectedValue = {
	readonly kind: 'nil' | 'boolean' | 'number' | 'string' | 'table' | 'function' | 'thread';
	readonly display: string;
	readonly reference?: string;
};
export type InspectedEntry = {
	readonly key: InspectedValue;
	readonly value: InspectedValue | { readonly kind: 'unavailable'; readonly reason: 'no-live-location'; readonly display: string; readonly reference?: never };
	/** Present for global bindings; domain identifies symbol provenance, not a separate bank. */
	readonly registerFile?: 'ordinary' | 'system';
	/** Installed module-path range. Null means a retained capture whose declaration was removed. */
	readonly definition?: SourceRange | null;
};
type GlobalBinding = readonly [name: string, registerFile: Blua32GlobalRegisterFile];
type Container =
	| { kind: 'globals'; names: ReadonlyMap<string, Blua32GlobalRegisterFile>; bindings?: readonly GlobalBinding[] }
	| { kind: 'locals' | 'upvalues'; physicalFrameIndex: number; bindings: readonly RuntimeLuaFrameBinding[] }
	| { kind: 'table'; value: SuspendedGuestValue; entries?: readonly (readonly [SuspendedGuestValue, SuspendedGuestValue])[] };
type InspectedFrameScope = { readonly kind: RuntimeLuaFrameScope['kind']; readonly status: RuntimeLuaFrameScope['status']; readonly reference?: string; readonly count?: number };
type InspectedFrame = RuntimeStackTraceFrame & { readonly reference: string; readonly functionAddress: number; readonly pc: number; readonly domain: ResourceDomain };
export type InspectionScope = {
	readonly domain: ResourceDomain;
	readonly status: 'available' | 'not-loaded' | 'symbols-unavailable';
	readonly reference?: string;
	readonly count?: number;
};
const VALUE_KINDS: Record<SuspendedGuestValueKind, InspectedValue['kind']> = {
	[SuspendedGuestValueKind.Nil]: 'nil', [SuspendedGuestValueKind.Boolean]: 'boolean',
	[SuspendedGuestValueKind.Number]: 'number', [SuspendedGuestValueKind.String]: 'string',
	[SuspendedGuestValueKind.Table]: 'table', [SuspendedGuestValueKind.Function]: 'function',
	[SuspendedGuestValueKind.Thread]: 'thread',
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
			&& (this.rewind.active || this.debuggerState.stopped || this.debuggerState.plans.controlSuspended
				|| this.execution.executionBlocked(runtimeDebuggerExecutionRequested(this.debuggerState)));
	}

	public status() {
		const stop = this.debuggerState.stopped ? {
			reason: this.debuggerState.stopReason === RuntimeDebuggerStopReason.Breakpoint ? 'breakpoint' as const : 'step' as const,
			domain: this.debuggerState.stopDomain, pc: this.debuggerState.stopPc, inlineDepth: this.debuggerState.stopInlineDepth,
		} : undefined;
		const fault = this.fault.faultSnapshot;
		return { target: this.target, role: 'authoring' as const,
			activeCartridge: this.runtime.machine.cpu.activeCartridgeSlot(),
			cycles: this.runtime.machine.scheduler.currentNowCycles(), videoTick: this.runtime.frameScheduler.lastTickSequence,
			paused: this.execution.paused, userPaused: this.execution.userPaused, debuggerStopped: this.debuggerState.stopped,
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
	private readonly containers = new Map<string, Container>();
	private readonly tables = new Map<number, string>();
	private readonly frames = new Map<string, { physical: RuntimeStackFrame; trace: InspectedFrame; scopes?: readonly InspectedFrameScope[] }>();
	private stack: InspectedFrame[] | undefined;
	private readonly unbind: () => void;
	private retired = false;

	public constructor(private readonly owner: RuntimeInspectionService, private readonly sources: RuntimeSourceState,
		private readonly guest: SuspendedGuestSession, private readonly runtime: Runtime) {
		this.state = owner.status();
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
					this.frames.set(reference, { physical: location, trace });
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
					reference: this.add({ kind: scope.kind, physicalFrameIndex: frame.trace.physicalFrameIndex, bindings: scope.bindings }) };
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
		const reference = this.add({ kind: 'globals', names });
		this.scopes.push({ domain, status: 'available', reference, count: names.size });
	}

	private add(container: Container): string {
		const reference = `${this.id}/${this.containers.size}`;
		this.containers.set(reference, container);
		return reference;
	}

	private describe(value: SuspendedGuestValue): InspectedValue {
		const kind = this.guest.kind(value);
		const display = this.guest.formatValue(value);
		if (kind !== SuspendedGuestValueKind.Table) return { kind: VALUE_KINDS[kind], display };
		const identity = (value as Table).hashId;
		let reference = this.tables.get(identity);
		if (reference === undefined) {
			reference = this.add({ kind: 'table', value });
			this.tables.set(identity, reference);
		}
		return { kind: 'table', display, reference };
	}

	private requireSuspended(): void {
		if (this.retired) throw new Error('Inspection expired. Open a new inspection of the current stopped target.');
		if (!this.owner.canInspect) {
			this.dispose();
			throw new Error('Target is no longer available for suspended inspection.');
		}
	}

	public read(reference: string, start: number, count: number) {
		this.requireSuspended();
		const container = this.containers.get(reference);
		if (container === undefined) throw new Error('Value reference does not belong to this inspection.');
		const entries: InspectedEntry[] = [];
		let total: number;
		if (container.kind === 'globals') {
			if (container.bindings === undefined) container.bindings = Array.from(container.names);
			total = container.bindings.length;
			for (let index = start, end = Math.min(start + count, total); index < end; index++) {
				const [name, bank] = container.bindings[index];
				const value = bank === Blua32GlobalRegisterFile.System ? this.guest.systemGlobal(name) : this.guest.global(name);
				entries.push({ key: { kind: 'string', display: name }, value: this.describe(value),
					registerFile: bank === Blua32GlobalRegisterFile.System ? 'system' : 'ordinary' });
			}
		} else if (container.kind === 'table') {
			if (container.entries === undefined) {
				const stored: [SuspendedGuestValue, SuspendedGuestValue][] = [];
				this.guest.visitTableEntries(container.value, (key, value) => stored.push([key, value]));
				container.entries = stored;
			}
			total = container.entries.length;
			for (let index = start, end = Math.min(start + count, total); index < end; index++) {
				const [key, value] = container.entries[index];
				entries.push({ key: this.describe(key), value: this.describe(value) });
			}
		} else {
			total = container.bindings.length;
			const cpu = this.runtime.machine.cpu;
			for (let index = start, end = Math.min(start + count, total); index < end; index++) {
				const binding = container.bindings[index];
				entries.push({ key: { kind: 'string', display: binding.name }, definition: binding.definition,
					value: binding.available
						? this.describe(container.kind === 'locals' ? cpu.readFrameRegister(container.physicalFrameIndex, binding.index)
							: cpu.readFrameUpvalue(container.physicalFrameIndex, binding.index))
						: { kind: 'unavailable', reason: 'no-live-location', display: '<no live location>' } });
			}
		}
		return { inspection: this.id, reference, start, total, entries };
	}

	public dispose(): void {
		this.retired = true;
		this.unbind();
		this.containers.clear(); this.tables.clear();
		this.frames.clear(); this.stack = undefined;
	}
}
