import type { MachineModelSpec } from '../../../../machine/ts/spec/bmsx/model';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { LuaTextModelSourceSnapshot } from '../../services/working_copy/lua_sources';
import { TestRun, type TestSource } from '../../../testing/run';
import type { TestTargetFactory } from '../../../testing/target';
import { ScenarioResultService, type ScenarioRun } from '../../../testing/scenario/result_service';
import type { ScenarioTestNodeId } from '../../../testing/scenario/test_collection';
import { scenarioFailureFromError } from '../../../testing/scenario/failure';
import { buildTestRunMedia } from './media_build';

export type ScenarioRunTestSource = TestSource;
export type ScenarioRunEvent = { readonly type: 'started' | 'complete' } | { readonly type: 'error'; readonly error: unknown };

/** Captures workspace sources and owns an isolated run; authoring media is never installed or restored. */
export class ScenarioRunService {
	public readonly results = new ScenarioResultService();
	public session: TestRun | null = null;
	private preparing: ScenarioRun | null = null;
	private readonly listeners = new Set<(event: ScenarioRunEvent) => void>();

	public constructor(
		private readonly sources: RuntimeSourceState,
		private readonly tooling: RuntimeLuaTooling,
		private readonly storage: KeyValueStorage,
		private readonly model: MachineModelSpec,
		private readonly createTarget: TestTargetFactory,
	) {}

	public get active(): boolean { return this.preparing !== null || (this.session !== null && this.session.active); }

	public async start(scopeId: ScenarioTestNodeId, tests: readonly TestSource[], programSources: readonly LuaTextModelSourceSnapshot[]): Promise<void> {
		if (this.active) throw new Error('A test run is already active.');
		this.session?.dispose();
		this.session = null;
		const run = this.results.beginRun(scopeId, tests);
		this.preparing = run;
		this.emit({ type: 'started' });
		try {
			const media = await buildTestRunMedia(this.sources, this.tooling, this.storage, programSources,
				tests[0].test.resource.domain, this.model);
			if (this.preparing !== run) return; // Cancelled while the workspace build was pending.
			this.session = new TestRun(run, tests, media, this.results, this.createTarget, () => this.emit({ type: 'complete' }));
			this.preparing = null;
			await this.session.prepare();
		} catch (error) {
			if (this.preparing !== run) return;
			const result = this.results.startItem(run, 0, 0);
			this.results.fail(result, 0, scenarioFailureFromError(this.sources, result.test.resource.domain, 'prepare', error), null);
			this.results.failRun(run);
			this.preparing = null;
			this.emit({ type: 'error', error });
		}
	}

	public onDidChangeRun(listener: (event: ScenarioRunEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	public advance(): void {
		const session = this.session;
		if (session === null) return;
		// Host-frame batching avoids tying each small CPU grant to a 20 ms UI tick.
		// The grant count is bounded even under a virtual host clock.
		for (let grant = 0; grant < 16 && session.active && session.execution !== null; grant++) session.advance();
	}

	public cancel(): void {
		if (this.preparing !== null) {
			this.results.cancelRun(this.preparing);
			this.preparing = null;
			this.emit({ type: 'complete' });
		} else this.session!.cancel();
	}

	public dispose(): void {
		if (this.active) this.cancel();
		this.session?.dispose();
		this.session = null;
	}

	private emit(event: ScenarioRunEvent): void { for (const listener of this.listeners) listener(event); }
}
