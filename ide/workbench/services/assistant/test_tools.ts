import type { TestInspection } from '../../../testing/inspection';
import type { TestStopInspection } from '../../../testing/stop_inspection';
import type { TestDebugger } from '../../../testing/debugger';
import { SOURCE_EXECUTION_MODES } from '../../../runtime/source_debugger';
import type { TestTargetInspection } from '../../../testing/retained_inspection';
import type { ScenarioRun, ScenarioTestResult, ScenarioRetainedSequence,
	ScenarioResultLog, ScenarioResultCapture, ScenarioFsmTransitionTrace, ScenarioActionEffectTrace,
	ScenarioFsmTransitionRecord, ScenarioActionEffectFact } from '../../../testing/scenario/result_service';
import { decodeTestToolRequest } from './test_tool_protocol';
import { StudioToolInputError } from './tool_input';
import type { ScenarioRunService } from '../testing/scenario_runs';
import type { ScenarioTestNodeId, ScenarioTestNode, ScenarioTestRoot, ScenarioTestModule } from '../../../testing/scenario/test_collection';

type RunSummary = Readonly<Pick<ScenarioRun, 'mode' | 'sequence' | 'scopeId' | 'state' | 'completedCount' | 'passedCount' | 'failedCount' | 'cancelledCount' | 'skippedCount'>>
	& { readonly run: string; readonly testCount: number; readonly canCancel: boolean };
type CaseSummary = Readonly<Pick<ScenarioTestResult, 'test' | 'sourceRevision' | 'state' | 'startTick' | 'endTick'>> & { readonly result: string };
type RetainedOutput<T> = { readonly omitted: number; readonly entries: readonly T[] };
export type ToolTestRun = RunSummary & { readonly revision: number; readonly cases: readonly CaseSummary[] };
export type ToolTestResult = CaseSummary & Pick<ScenarioTestResult, 'source' | 'failures' | 'fault'> & {
	readonly revision: number;
	readonly sourceCoverage: 'accepted-suite-only';
	readonly logs: RetainedOutput<ScenarioResultLog>;
	readonly captures: RetainedOutput<ScenarioResultCapture>;
	readonly fsmTransitionTrace: (Omit<ScenarioFsmTransitionTrace, 'transitions'> & { transitions: RetainedOutput<ScenarioFsmTransitionRecord> }) | null;
	readonly actionEffectTrace: (Omit<ScenarioActionEffectTrace, 'facts'> & { facts: RetainedOutput<ScenarioActionEffectFact> }) | null;
};
type TestDiscovery = {
	readonly coverage: 'current-test-declarations';
	readonly revision: number;
	readonly roots: readonly (Pick<ScenarioTestRoot, 'domain' | 'label' | 'testCount'> & {
		readonly scope: string;
		readonly modules: readonly (Pick<ScenarioTestModule, 'label' | 'resource'> & {
			readonly scope: string;
			readonly sourceRevision: number;
			readonly kind: 'unit' | 'integration' | null;
			readonly diagnostic: { readonly message: string; readonly line: number; readonly column: number } | null;
			readonly cases: readonly { readonly scope: string; readonly name: string; readonly range: ScenarioTestModule['children'][number]['range'] }[];
		})[];
	})[];
};
export type TestToolResult =
	| { kind: 'test-debugger'; data: ReturnType<TestDebugger['snapshot']> }
	| { kind: 'test-debug-sources'; data: { sources: TestDebugger['sources']['catalog'] } }
	| { kind: 'test-debug-source'; data: ReturnType<TestDebugger['sources']['read']> }
	| { kind: 'test-breakpoints'; data: { source: string; breakpoints: ReturnType<TestDebugger['sources']['setBreakpoints']> } }
	| { kind: 'test-stop-inspection'; data: TestStopInspection['state'] }
	| { kind: 'test-inspection'; data: TestTargetInspection['state'] }
	| { kind: 'test-stack'; data: ReturnType<TestInspection['readStack']> }
	| { kind: 'test-frame-scopes'; data: ReturnType<TestInspection['frameScopes']> }
	| { kind: 'test-frame-source'; data: ReturnType<TestInspection['frameSource']> }
	| { kind: 'test-values'; data: ReturnType<TestInspection['read']> }
	| { kind: 'tests'; data: TestDiscovery }
	| { kind: 'test-runs'; data: { coverage: 'retained-studio-runs'; revision: number; runs: readonly RunSummary[] } }
	| { kind: 'test-run'; data: ToolTestRun }
	| { kind: 'test-result'; data: ToolTestResult };
type RunEntry = { run: ScenarioRun; owned: boolean; data?: ToolTestRun };
type ResultEntry = { result: ScenarioTestResult; data?: ToolTestResult };

/** Prompt-local discovery/evidence handles and cancellation authority; the workspace owns execution. */
export class WorkspaceTestTools {
	private readonly id = crypto.randomUUID();
	private readonly runs = new Map<string, RunEntry>();
	private readonly results = new Map<string, ResultEntry>();
	private readonly scopes = new Map<string, ScenarioTestNodeId>();
	private scopeRoot: ScenarioTestRoot | undefined;
	private scopeGeneration = 0;
	private discovery: TestDiscovery | undefined;
	private catalog: Extract<TestToolResult, { kind: 'test-runs' }>['data'] | undefined;
	private disposed = false;
	private inspection: TestInspection | undefined;
	private readonly lifetime = new AbortController();
	private readonly onDisconnect = () => this.dispose();

	public constructor(private readonly owner: ScenarioRunService, private readonly connection: AbortSignal) {
		connection.throwIfAborted();
		connection.addEventListener('abort', this.onDisconnect, { once: true });
	}

	public execute(name: string, argumentsValue: unknown, requestSignal?: AbortSignal): TestToolResult | Promise<TestToolResult> {
		if (this.disposed) throw new StudioToolInputError('Test tool context is disposed');
		requestSignal?.throwIfAborted();
		const request = decodeTestToolRequest(name, argumentsValue);
		switch (request.name) {
			case 'studio_inspect_test_target': {
				const entry = this.results.get(request.result);
				if (entry === undefined) throw new StudioToolInputError('Case handle must be read from a run in this prompt');
				const inspection = this.owner.inspect(entry.result);
				this.inspection?.dispose();
				this.inspection = inspection;
				return { kind: 'test-inspection', data: inspection.state };
			}
			case 'studio_read_test_stack': return { kind: 'test-stack', data: this.currentInspection().readStack(request.stack, request.start, request.count) };
			case 'studio_read_test_frame_scopes': return { kind: 'test-frame-scopes', data: this.currentInspection().frameScopes(request.frame) };
			case 'studio_read_test_frame_source': return { kind: 'test-frame-source', data: this.currentInspection().frameSource(request.frame) };
			case 'studio_read_test_values': return { kind: 'test-values', data: this.currentInspection().read(request.reference, request.start, request.count) };
			case 'studio_list_tests': return { kind: 'tests', data: this.discover() };
			case 'studio_debug_test':
			case 'studio_start_test_run': {
				const scope = this.scopes.get(request.scope);
				if (scope === undefined) throw new StudioToolInputError('Scope handle must be discovered in this prompt');
				this.owner.refreshSources();
				if (this.scopeRoot !== this.owner.collection.roots[0]) throw new StudioToolInputError('Test source owner changed; discover current scopes again');
				const run = this.owner.start(scope, request.name === 'studio_debug_test' ? 'debug' : 'run');
				this.pruneRuns();
				return this.readRun(this.admit(run, true));
			}
			case 'studio_wait_test_debugger': {
				const entry = this.runEntry(request.run);
				const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
				return this.owner.waitForDebugger(entry.run, signal).then(async debug => debug === undefined
					? this.readRun(request.run) : { kind: 'test-debugger', data: await debug.wait(signal) });
			}
			case 'studio_pause_test_debugger': {
				const debug = this.debugger(request.run, true);
				debug.pause(); return { kind: 'test-debugger', data: debug.snapshot() };
			}
			case 'studio_list_test_debug_sources': return { kind: 'test-debug-sources', data: { sources: this.debugger(request.run).sources.catalog } };
			case 'studio_read_test_debug_source': return { kind: 'test-debug-source', data: this.debugger(request.run).sources.read(request.source) };
			case 'studio_set_test_breakpoints': {
				const debug = this.debugger(request.run, true);
				return { kind: 'test-breakpoints', data: { source: request.source, breakpoints: debug.sources.setBreakpoints(request.source, request.lines) } };
			}
			case 'studio_inspect_test_stop': {
				const debug = this.debugger(request.run, false, request.revision), inspection = debug.inspect();
				this.inspection?.dispose(); this.inspection = inspection;
				return { kind: 'test-stop-inspection', data: inspection.state };
			}
			case 'studio_resume_test_debugger': {
				const debug = this.debugger(request.run, true, request.revision);
				const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
				const mode = SOURCE_EXECUTION_MODES[request.mode];
				return debug.execute(mode, signal).then(data => ({ kind: 'test-debugger', data }));
			}
			case 'studio_wait_test_run':
			case 'studio_cancel_test_run': {
				const entry = this.runEntry(request.run);
				if (request.name === 'studio_cancel_test_run') {
					if (!entry.owned) throw new StudioToolInputError('This prompt can cancel only runs it started');
					this.owner.cancel(entry.run);
				}
				const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
				return this.owner.wait(entry.run, signal).then(() => this.readRun(request.run));
			}
			case 'studio_list_test_runs': {
				if (this.catalog?.revision !== this.owner.results.revision) {
					this.pruneRuns();
					const runs = this.owner.results.runs.map(run => {
						const handle = this.admit(run);
						return runSummary(handle, run, this.runs.get(handle)!.owned);
					});
					this.catalog = { coverage: 'retained-studio-runs', revision: this.owner.results.revision, runs };
				}
				return { kind: 'test-runs', data: this.catalog };
			}
			case 'studio_read_test_run': return this.readRun(request.run);
			case 'studio_read_test_result': {
				const entry = this.results.get(request.result);
				if (entry === undefined) throw new StudioToolInputError('Case handle must be read from a run in this prompt');
				const result = entry.result;
				if (!this.owner.results.hasRetainedResult(result.id)) throw new StudioToolInputError('Case result is no longer retained');
				if (entry.data?.revision !== this.owner.results.revision) {
					entry.data = { ...caseSummary(request.result, result), revision: this.owner.results.revision,
						sourceCoverage: 'accepted-suite-only', source: result.source, failures: result.failures.slice(), fault: result.fault,
						logs: retainedOutput(result.logs),
						captures: { omitted: result.captures.droppedCount, entries: Array.from({ length: result.captures.length }, (_, index) => ({ ...result.captures.at(index) })) },
						fsmTransitionTrace: result.fsmTransitionTrace === null ? null : { ...result.fsmTransitionTrace, transitions: retainedOutput(result.fsmTransitionTrace.transitions) },
						actionEffectTrace: result.actionEffectTrace === null ? null : { ...result.actionEffectTrace, facts: retainedOutput(result.actionEffectTrace.facts) },
					};
				}
				return { kind: 'test-result', data: entry.data };
			}
		}
	}

	/** Resolve run ownership before touching a physical debugger; revisions reject stale manual/conversation intent. */
	private debugger(handle: string, control = false, revision?: number): TestDebugger {
		const entry = this.runEntry(handle);
		if (control && !entry.owned) throw new StudioToolInputError('This prompt can control only debug runs it started');
		const debug = this.owner.debugger;
		if (this.owner.session?.result !== entry.run || debug === undefined) throw new StudioToolInputError('This run has no live test debugger; wait for admission or read the terminal result');
		if (revision !== undefined && debug.revision !== revision) throw new StudioToolInputError('Test debugger changed since the observed stop; read its current stop again');
		return debug;
	}

	private currentInspection(): TestInspection {
		if (this.inspection === undefined) throw new StudioToolInputError('Open a test inspection first');
		return this.inspection;
	}

	private discover(): TestDiscovery {
		this.owner.refreshSources();
		const collection = this.owner.collection;
		if (this.scopeRoot !== collection.roots[0]) {
			this.scopeRoot = collection.roots[0];
			this.scopeGeneration++;
		}
		if (this.discovery?.revision !== collection.revision) {
			this.scopes.clear();
			this.discovery = { coverage: 'current-test-declarations', revision: collection.revision,
				roots: collection.roots.map(root => ({ scope: this.scope(root), domain: root.domain, label: root.label, testCount: root.testCount,
					modules: root.children.map(module => ({ scope: this.scope(module), label: module.label, resource: module.resource,
						sourceRevision: module.sourceTimestamp, kind: module.suite === null ? null : module.suite.kind,
						diagnostic: module.diagnostic === null ? null : { message: module.diagnostic.message, line: module.diagnostic.line, column: module.diagnostic.column },
						cases: module.children.map(test => ({ scope: this.scope(test), name: test.caseName, range: test.range })) })),
				})),
			};
		}
		return this.discovery;
	}

	private scope(node: ScenarioTestNode): string {
		const handle = `${this.id}/scope/${this.scopeGeneration}/${node.id}`;
		this.scopes.set(handle, node.id);
		return handle;
	}

	private admit(run: ScenarioRun, owned = false): string {
		const handle = `${this.id}/run/${run.sequence}`;
		if (!this.runs.has(handle)) this.runs.set(handle, { run, owned });
		return handle;
	}

	/** New admissions cannot extend result-owner retention through old cached tool snapshots. */
	private pruneRuns(): void {
		for (const [handle, entry] of this.runs) {
			if (this.owner.results.hasRetainedResult(entry.run.id)) continue;
			this.runs.delete(handle);
			if (entry.data !== undefined) for (const item of entry.data.cases) this.results.delete(item.result);
		}
	}

	private runEntry(handle: string): RunEntry {
		const entry = this.runs.get(handle);
		if (entry === undefined) throw new StudioToolInputError('Run handle does not belong to this prompt');
		if (!this.owner.results.hasRetainedResult(entry.run.id)) throw new StudioToolInputError('Run is no longer retained');
		return entry;
	}

	private readRun(handle: string): Extract<TestToolResult, { kind: 'test-run' }> {
		const entry = this.runEntry(handle);
		if (entry.data?.revision !== this.owner.results.revision) {
			const cases = entry.run.items.map((result, index) => {
				const caseHandle = `${handle}/case/${index}`;
				if (!this.results.has(caseHandle)) this.results.set(caseHandle, { result });
				return caseSummary(caseHandle, result);
			});
			entry.data = { ...runSummary(handle, entry.run, entry.owned), revision: this.owner.results.revision, cases };
		}
		return { kind: 'test-run', data: entry.data };
	}

	public dispose(): void {
		this.disposed = true;
		this.lifetime.abort();
		this.inspection?.dispose(); this.inspection = undefined;
		for (const entry of this.runs.values()) if (entry.owned) this.owner.cancel(entry.run);
		this.connection.removeEventListener('abort', this.onDisconnect);
		this.runs.clear(); this.results.clear(); this.scopes.clear(); this.catalog = undefined; this.discovery = undefined; this.scopeRoot = undefined;
	}
}

function runSummary(handle: string, run: ScenarioRun, owned: boolean): RunSummary {
	return { mode: run.mode, run: handle, sequence: run.sequence, scopeId: run.scopeId, state: run.state, testCount: run.items.length, canCancel: owned && run.state === 'running',
		completedCount: run.completedCount, passedCount: run.passedCount, failedCount: run.failedCount,
		cancelledCount: run.cancelledCount, skippedCount: run.skippedCount };
}
function caseSummary(handle: string, result: ScenarioTestResult): CaseSummary {
	return { result: handle, test: result.test, sourceRevision: result.sourceRevision, state: result.state, startTick: result.startTick, endTick: result.endTick };
}
/** Materialize a retained ring in its public order only on an explicit evidence read. */
function retainedOutput<T>(sequence: ScenarioRetainedSequence<T>): RetainedOutput<T> {
	return { omitted: sequence.droppedCount, entries: Array.from({ length: sequence.length }, (_, index) => sequence.at(index)) };
}
