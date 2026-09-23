import type { ScenarioResultService, ScenarioRun, ScenarioTestResult, ScenarioRetainedSequence,
	ScenarioResultLog, ScenarioResultCapture, ScenarioFsmTransitionTrace, ScenarioActionEffectTrace,
	ScenarioFsmTransitionRecord, ScenarioActionEffectFact } from '../../../testing/scenario/result_service';
import { decodeTestToolRequest } from './test_tool_protocol';
import { StudioToolInputError } from './tool_input';

type RunSummary = Readonly<Pick<ScenarioRun, 'sequence' | 'scopeId' | 'state' | 'completedCount' | 'passedCount' | 'failedCount' | 'cancelledCount' | 'skippedCount'>>
	& { readonly run: string; readonly testCount: number };
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
export type TestToolResult =
	| { kind: 'test-runs'; data: { coverage: 'retained-studio-runs'; revision: number; runs: readonly RunSummary[] } }
	| { kind: 'test-run'; data: ToolTestRun }
	| { kind: 'test-result'; data: ToolTestResult };
type RunEntry = { run: ScenarioRun; data?: ToolTestRun };
type ResultEntry = { result: ScenarioTestResult; data?: ToolTestResult };

/** Prompt-scoped, read-only access to the existing result owner; no machine or workspace writer. */
export class WorkspaceTestTools {
	private readonly runs = new Map<string, RunEntry>();
	private readonly results = new Map<string, ResultEntry>();
	private catalog: Extract<TestToolResult, { kind: 'test-runs' }>['data'] | undefined;
	private disposed = false;
	private readonly onDisconnect = () => this.dispose();

	public constructor(private readonly owner: ScenarioResultService, private readonly connection: AbortSignal) {
		connection.throwIfAborted();
		const id = crypto.randomUUID();
		for (const run of owner.runs) this.runs.set(`${id}/run/${run.sequence}`, { run });
		connection.addEventListener('abort', this.onDisconnect, { once: true });
	}

	public execute(name: string, argumentsValue: unknown): TestToolResult {
		if (this.disposed) throw new StudioToolInputError('Test evidence context is disposed');
		const request = decodeTestToolRequest(name, argumentsValue);
		switch (request.name) {
			case 'studio_list_test_runs': {
				if (this.catalog?.revision !== this.owner.revision) {
					const runs: RunSummary[] = [];
					for (const [handle, entry] of this.runs) {
						if (this.owner.hasRetainedResult(entry.run.id)) runs.push(runSummary(handle, entry.run));
					}
					this.catalog = { coverage: 'retained-studio-runs', revision: this.owner.revision, runs };
				}
				return { kind: 'test-runs', data: this.catalog };
			}
			case 'studio_read_test_run': {
				const entry = this.runs.get(request.run);
				if (entry === undefined) throw new StudioToolInputError('Run handle does not belong to this prompt');
				if (!this.owner.hasRetainedResult(entry.run.id)) throw new StudioToolInputError('Run is no longer retained');
				if (entry.data?.revision !== this.owner.revision) {
					const cases = entry.run.items.map((result, index) => {
						const handle = `${request.run}/case/${index}`;
						if (!this.results.has(handle)) this.results.set(handle, { result });
						return caseSummary(handle, result);
					});
					entry.data = { ...runSummary(request.run, entry.run), revision: this.owner.revision, cases };
				}
				return { kind: 'test-run', data: entry.data };
			}
			case 'studio_read_test_result': {
				const entry = this.results.get(request.result);
				if (entry === undefined) throw new StudioToolInputError('Case handle must be read from a run in this prompt');
				const result = entry.result;
				if (!this.owner.hasRetainedResult(result.id)) throw new StudioToolInputError('Case result is no longer retained');
				if (entry.data?.revision !== this.owner.revision) {
					entry.data = { ...caseSummary(request.result, result), revision: this.owner.revision,
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

	public dispose(): void {
		this.disposed = true;
		this.connection.removeEventListener('abort', this.onDisconnect);
		this.runs.clear(); this.results.clear(); this.catalog = undefined;
	}
}

function runSummary(handle: string, run: ScenarioRun): RunSummary {
	return { run: handle, sequence: run.sequence, scopeId: run.scopeId, state: run.state, testCount: run.items.length,
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
