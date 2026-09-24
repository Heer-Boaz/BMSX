import type { RuntimeFrameNavigation } from './frame_navigation';
import { HostPauseReason, type HostExecutionControl } from '../../hosts/common/execution_control';
import type { HostRewind } from '../../hosts/common/rewind';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import type { Table } from '../../machine/ts/machine/cpu/table';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { ResourceDomain } from '../common/resource';
import { runtimeDebuggerExecutionRequested, type RuntimeDebuggerState } from './debugger_state';
import type { RuntimeFaultState } from './fault_state';
import { Blua32GlobalRegisterFile, type Blua32SourceImage, type RuntimeSourceState } from './sources';
import { SuspendedGuestValueKind, type SuspendedGuestSession, type SuspendedGuestValue } from './suspended_guest';

export type InspectedValue = {
	readonly kind: 'nil' | 'boolean' | 'number' | 'string' | 'table' | 'function' | 'thread';
	readonly display: string;
	readonly reference?: string;
};
export type InspectedEntry = {
	readonly key: InspectedValue;
	readonly value: InspectedValue;
	/** Present for global bindings; domain identifies symbol provenance, not a separate bank. */
	readonly registerFile?: 'ordinary' | 'system';
};
type GlobalBinding = readonly [name: string, registerFile: Blua32GlobalRegisterFile];
type Container =
	| { kind: 'globals'; names: ReadonlyMap<string, Blua32GlobalRegisterFile>; bindings?: readonly GlobalBinding[] }
	| { kind: 'table'; value: SuspendedGuestValue; entries?: readonly (readonly [SuspendedGuestValue, SuspendedGuestValue])[] };
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
	) {}

	public get canInspect(): boolean {
		return this.navigation.active === undefined && this.tasks.ready && !this.execution.launchPending && !this.execution.frameStepPending
			&& !this.rewind.seeking && !this.rewind.playing && !this.fault.hostFrameFailed
			&& (this.rewind.active || this.debuggerState.stopped || this.debuggerState.plans.controlSuspended
				|| this.execution.executionBlocked(runtimeDebuggerExecutionRequested(this.debuggerState)));
	}

	public status() {
		return { target: this.target, role: 'authoring' as const,
			activeCartridge: this.runtime.machine.cpu.activeCartridgeSlot(),
			cycles: this.runtime.machine.scheduler.currentNowCycles(), videoTick: this.runtime.frameScheduler.lastTickSequence,
			paused: this.execution.paused, userPaused: this.execution.userPaused, debuggerStopped: this.debuggerState.stopped,
			operationActive: this.navigation.active !== undefined || !this.tasks.ready || this.debuggerState.plans.controlActive,
			history: this.navigation.historyState(),
			rewindActive: this.rewind.active, canInspect: this.canInspect };
	}

	/** Does not resume a debugger, cancel a guest call or change any other pause reason. */
	public pause(): ReturnType<RuntimeInspectionService['status']> {
		if (this.navigation.active !== undefined || !this.tasks.ready || this.execution.launchPending || this.execution.frameStepPending
			|| this.rewind.active || this.debuggerState.plans.controlActive || runtimeDebuggerExecutionRequested(this.debuggerState)) {
			throw new Error('Finish or interrupt the active machine operation before pausing for inspection.');
		}
		this.execution.setPauseReason(HostPauseReason.Requested, true);
		return this.status();
	}

	public open(): RuntimeInspection {
		if (!this.canInspect) throw new Error('Runtime inspection requires a paused, idle target.');
		return new RuntimeInspection(this, this.sources, this.guest);
	}
}

/** Lazy, stop-scoped guest borrows. This is neither a heap copy nor an evaluator. */
export class RuntimeInspection {
	public readonly id = crypto.randomUUID();
	public readonly state: ReturnType<RuntimeInspectionService['status']>;
	public readonly scopes: InspectionScope[] = [];
	private readonly containers = new Map<string, Container>();
	private readonly tables = new Map<number, string>();
	private readonly unbind: () => void;
	private retired = false;

	public constructor(private readonly owner: RuntimeInspectionService, sources: RuntimeSourceState, private readonly guest: SuspendedGuestSession) {
		this.state = owner.status();
		this.unbind = guest.onDidInvalidate(() => this.dispose());
		this.addScope(-1, sources.currentBlua32Media.system);
		const slot = this.state.activeCartridge;
		if (slot !== -1) this.addScope(slot, sources.currentBlua32Media.cartridgeSlots[slot]);
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

	public read(reference: string, start: number, count: number) {
		if (this.retired) throw new Error('Inspection expired. Open a new inspection of the current stopped target.');
		if (!this.owner.canInspect) {
			this.dispose();
			throw new Error('Target is no longer available for suspended inspection.');
		}
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
		} else {
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
		}
		return { inspection: this.id, reference, start, total, entries };
	}

	public dispose(): void {
		this.retired = true;
		this.unbind();
		this.containers.clear(); this.tables.clear();
	}
}
