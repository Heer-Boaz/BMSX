import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { Input } from '../../../../hosts/common/input/manager';
import type { RuntimeTaskQueue } from '../../../../hosts/common/runtime_task_queue';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import type { RuntimeDebuggerState } from '../../../runtime/debugger_state';
import { admitHotResume, buildBlua32Revision, type BuiltBlua32Revision, type HotResumeEvent } from '../../../runtime/hot_resume';
import { blua32MediaRequiresRebuild } from '../../../runtime/lua_pipeline';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { WorkspaceRecord } from '../../../workspace/records';
import { applyAllWorkspaceSourceOverrides, applyLuaTextModelSources } from '../../../workspace/workspace';
import { captureLuaTextModelSources, type LuaTextModelSourceSnapshot } from '../working_copy/lua_sources';

export type HotResumeResult =
	| { readonly status: 'completed'; readonly applied: true }
	| { readonly status: 'rejected'; readonly applied: false; readonly phase: 'build' | 'relocation'; readonly error: unknown }
	| { readonly status: 'failed'; readonly applied: boolean; readonly error: unknown }
	| { readonly status: 'faulted'; readonly applied: boolean; readonly sequence: number }
	| { readonly status: 'cancelled'; readonly applied: boolean; readonly reason: 'machine-reset' | 'shutdown' | 'plan-discarded' };

export type HotResumeAdmissionResult =
	| { readonly status: 'accepted'; readonly mode: 'applied' | 'deferred' }
	| { readonly status: 'not-admitted'; readonly result: HotResumeResult };

export type HotResumeStatus = 'queued' | 'building' | 'waiting-for-user' | 'installing' | 'initializing' | HotResumeResult['status'];

export interface HotResumeOperation {
	readonly sourceSnapshots: readonly LuaTextModelSourceSnapshot[];
	readonly status: HotResumeStatus;
	readonly applied: boolean;
	readonly result: HotResumeResult | null;
	readonly admission: Promise<HotResumeAdmissionResult>;
	readonly completion: Promise<HotResumeResult>;
}

class PendingHotResume implements HotResumeOperation {
	public status: HotResumeStatus = 'queued';
	public applied = false;
	public result: HotResumeResult | null = null;
	public acceptance: 'applied' | 'deferred' | null = null;
	public admission!: Promise<HotResumeAdmissionResult>;
	private resolveCompletion!: (result: HotResumeResult) => void;
	public readonly completion = new Promise<HotResumeResult>(resolve => { this.resolveCompletion = resolve; });

	public constructor(public readonly sourceSnapshots: readonly LuaTextModelSourceSnapshot[]) {}
	public readonly isCurrent = (): boolean => this.result === null;

	public finish(result: HotResumeResult): void {
		// Fault results are final even if recovery later discards/returns the retained roots.
		if (this.result !== null) return;
		this.result = result;
		this.status = result.status;
		this.resolveCompletion(result);
	}

	public readonly report = (event: HotResumeEvent): void => {
		if (this.result !== null) return;
		switch (event.kind) {
			case 'applied': this.applied = true; this.status = 'installing'; return;
			case 'initializing': this.status = 'initializing'; return;
			case 'completed': this.finish({ status: 'completed', applied: true }); return;
			case 'rejected': this.finish({ status: 'rejected', phase: 'relocation', applied: false, error: event.error }); return;
			case 'failed': this.finish({ status: 'failed', applied: this.applied, error: event.error }); return;
			case 'faulted': this.finish({ status: 'faulted', applied: this.applied, sequence: event.sequence }); return;
			case 'discarded': this.finish({ status: 'cancelled', applied: this.applied, reason: 'plan-discarded' }); return;
		}
	};
}

/** Owns source admission and request lifetime, never guest scheduling or command UI. */
export class HotResumeService {
	private readonly pending = new Set<PendingHotResume>();
	private latest: HotResumeOperation | null = null;
	private closing = false;

	public constructor(
		private readonly sources: RuntimeSourceState,
		private readonly tooling: RuntimeLuaTooling,
		private readonly fault: RuntimeFaultState,
		private readonly debuggerState: RuntimeDebuggerState,
		private readonly input: Input,
		private readonly runtime: Runtime,
		private readonly tasks: RuntimeTaskQueue,
		private readonly storage: KeyValueStorage,
		private readonly dirtyRecords: ReadonlyMap<string, WorkspaceRecord>,
	) {}

	public get acceptingRequests(): boolean { return !this.closing; }
	public get latestOperation(): HotResumeOperation | null { return this.latest; }

	public resume(): HotResumeOperation {
		if (this.closing) throw new Error('Cannot Hot Resume after workbench shutdown has started.');
		const operation = new PendingHotResume(captureLuaTextModelSources(this.sources));
		this.latest = operation;
		this.pending.add(operation);
		void operation.completion.then(() => this.pending.delete(operation));
		operation.admission = this.tasks.schedule(async () => {
			if (!operation.isCurrent()) return;
			operation.status = 'building';
			let built: BuiltBlua32Revision | null;
			try {
				await applyAllWorkspaceSourceOverrides(this.storage, this.sources, this.dirtyRecords);
				if (!operation.isCurrent()) return;
				applyLuaTextModelSources(this.sources, operation.sourceSnapshots);
				built = blua32MediaRequiresRebuild(this.sources)
					? buildBlua32Revision(this.sources, this.tooling, this.runtime,
						this.sources.systemBlua32MediaDirty, this.sources.cartridgeBlua32MediaDirty)
					: null;
			} catch (error) {
				operation.finish({ status: 'rejected', phase: 'build', applied: false, error });
				return;
			}
			const admission = admitHotResume(this.sources, this.tooling, this.fault, this.debuggerState,
				this.input, this.tasks, this.runtime, built, operation.isCurrent, operation.report);
			if (admission !== 'rejected') {
				operation.acceptance = admission;
				if (admission === 'deferred') operation.status = 'waiting-for-user';
			}
		}, error => operation.finish({ status: 'failed', applied: operation.applied, error })).then(() =>
			operation.acceptance === null
				? { status: 'not-admitted', result: operation.result! }
				: { status: 'accepted', mode: operation.acceptance });
		return operation;
	}

	public cancelPending(reason: 'machine-reset' | 'shutdown'): void {
		this.latest = null;
		for (const operation of this.pending) operation.finish({ status: 'cancelled', applied: operation.applied, reason });
	}

	public failPending(error: unknown): void {
		for (const operation of this.pending) operation.finish({ status: 'failed', applied: operation.applied, error });
	}

	public shutdown(): Promise<void> {
		this.closing = true;
		this.cancelPending('shutdown');
		return this.tasks.join();
	}
}
