import type { MachineModelSpec } from '../../../../machine/ts/spec/bmsx/model';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { WorkspaceRecord } from '../../../workspace/records';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { captureCurrentLuaSource, captureLuaTextModelSources, type LuaTextModelSourceSnapshot } from '../working_copy/lua_sources';
import { TestRun, type TestSource } from '../../../testing/run';
import type { TestTargetFactory } from '../../../testing/target';
import { ScenarioResultService, type ScenarioRun } from '../../../testing/scenario/result_service';
import { ScenarioTestCollection, type ScenarioTestModule, type ScenarioTestNodeId } from '../../../testing/scenario/test_collection';
import { isScenarioTestAsset } from '../../../../toolchain/ts/rompack/scenario_test';
import { scenarioFailureFromError } from '../../../testing/scenario/failure';
import { buildTestRunMedia } from './media_build';

export type ScenarioRunEvent = { readonly type: 'started' | 'complete' } | { readonly type: 'error'; readonly error: unknown };
export class ScenarioRunAdmissionError extends Error {}

/** Captures workspace sources and owns an isolated run; authoring media is never installed or restored. */
export class ScenarioRunService {
	public readonly collection: ScenarioTestCollection;
	public readonly results = new ScenarioResultService();
	public session: TestRun | null = null;
	private preparing: ScenarioRun | null = null;
	private readonly listeners = new Set<(event: ScenarioRunEvent) => void>();
	private readonly sourceListeners: (() => void)[];
	private sourcesDirty = true;
	private closed = false;

	public constructor(
		private readonly models: EditorTextModelService,
		private readonly sources: RuntimeSourceState,
		private readonly tooling: RuntimeLuaTooling,
		private readonly storage: KeyValueStorage,
		private readonly dirtyRecords: ReadonlyMap<string, WorkspaceRecord>,
		private readonly model: MachineModelSpec,
		private readonly createTarget: TestTargetFactory,
	) {
		this.collection = new ScenarioTestCollection(sources);
		const changed = (model: EditorTextModel) => {
			if (model.mode === 'lua' && isScenarioTestAsset(model.resource.source)) this.sourcesDirty = true;
		};
		this.sourceListeners = [models.onDidAddModel(changed), models.onDidChangeContent(changed), models.onDidRemoveModel(changed),
			models.onWillClear(() => {
				if (this.active) this.cancel();
				this.session?.dispose();
				this.session = null;
				this.sourcesDirty = true;
			})];
	}

	public get active(): boolean { return this.preparing !== null || (this.session !== null && this.session.active); }

	/** Discovery and source admission do not depend on an attached Scenario Lab view. */
	public refreshSources(): void {
		const membershipChanged = this.collection.refresh();
		if (!this.sourcesDirty && !membershipChanged) return;
		for (const root of this.collection.roots) for (const module of root.children) {
			const snapshot = captureCurrentLuaSource(this.models, this.sources, module.resource);
			this.collection.updateSource(module, snapshot.source, snapshot.revision);
		}
		this.sourcesDirty = false;
	}

	/** Resolve the selection and capture all working copies before any asynchronous build. */
	public start(scopeId: ScenarioTestNodeId): Promise<void> {
		if (this.closed) throw new ScenarioRunAdmissionError('The workspace test service has closed.');
		if (this.active) throw new ScenarioRunAdmissionError('A test run is already active.');
		this.refreshSources();
		const scope = this.collection.getNode(scopeId);
		if (scope === undefined) throw new ScenarioRunAdmissionError('The test selection no longer exists.');
		const cases = this.collection.resolveNode(scope);
		if (cases.length === 0) throw new ScenarioRunAdmissionError('The selection contains no test cases.');
		const tests = cases.map(test => {
			const module = this.collection.getNode(test.parentId) as ScenarioTestModule;
			return { test, source: module.source, sourceRevision: module.sourceTimestamp };
		});
		const programSources = captureLuaTextModelSources(this.models, this.sources, true);
		this.session?.dispose();
		this.session = null;
		const run = this.results.beginRun(scopeId, tests);
		this.preparing = run;
		this.emit({ type: 'started' });
		return this.prepare(run, tests, programSources);
	}

	private async prepare(run: ScenarioRun, tests: readonly TestSource[], programSources: readonly LuaTextModelSourceSnapshot[]): Promise<void> {
		try {
			const media = await buildTestRunMedia(this.sources, this.tooling, this.storage, this.dirtyRecords, programSources,
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
		this.closed = true;
		for (const dispose of this.sourceListeners) dispose();
		if (this.active) this.cancel();
		this.session?.dispose();
		this.session = null;
		this.listeners.clear();
	}

	private emit(event: ScenarioRunEvent): void { for (const listener of this.listeners) listener(event); }
}
