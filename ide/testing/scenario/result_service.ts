import type { FaultSnapshot } from '../../runtime/fault_state';
import type { ResourceIdentity } from '../../common/resource';
import type {
	ScenarioTestId,
	ScenarioTestItem,
	ScenarioTestNodeId,
} from './test_collection';

export const SCENARIO_RUN_RETAIN_COUNT = 128;
export const SCENARIO_RESULT_LOG_RETAIN_COUNT = 512;
export const SCENARIO_RESULT_CAPTURE_RETAIN_COUNT = 64;
export const SCENARIO_RESULT_FSM_TRANSITION_RETAIN_COUNT = 1024;
export const SCENARIO_RESULT_ACTIONEFFECT_FACT_RETAIN_COUNT = 1024;

export type ScenarioRunState =
	| 'running'
	| 'passed'
	| 'failed'
	| 'cancelled';

export type ScenarioTestResultState =
	| 'queued'
	| 'preparing'
	| 'running'
	| 'passed'
	| 'failed'
	| 'cancelled'
	| 'skipped';

export type ScenarioResultState = ScenarioRunState | ScenarioTestResultState;

export type ScenarioSourceLocation = {
	readonly resource: ResourceIdentity;
	readonly line: number;
	readonly column: number;
};

export type ScenarioResultLog = {
	readonly id: string;
	readonly tick: number;
	readonly text: string;
	readonly location: ScenarioSourceLocation;
};

export type ScenarioResultCapture = {
	readonly id: string;
	readonly label: string;
	readonly requestTick: number;
	readonly location: ScenarioSourceLocation;
	presentedFrame: number | null;
};

export type ScenarioRunFailure = {
	readonly message: string;
	readonly location: ScenarioSourceLocation;
};

export type ScenarioFsmTransitionOutcome = 'committed' | 'rejected';

export type ScenarioFsmTransitionRecord = {
	readonly id: string;
	readonly producerSequence: number;
	readonly producerTimeMillisecondsWord: number;
	readonly observedTick: number;
	readonly laneDefId: string;
	readonly fromDefId: string;
	readonly toDefId: string;
	readonly outcome: ScenarioFsmTransitionOutcome;
};

export type ScenarioFsmTransitionTrace = {
	readonly executionDomain: 0 | 1;
	readonly instanceId: string;
	readonly machineId: string;
	readonly transitions: ScenarioRetainedSequence<ScenarioFsmTransitionRecord>;
};

export type ScenarioActionEffectTriggerOutcome =
	| 'accepted'
	| 'cooldown'
	| 'required_tag_missing'
	| 'blocked_tag_present'
	| 'required_state_missing'
	| 'blocked_state_present'
	| 'custom_gate';

type ScenarioActionEffectFactBase = {
	readonly id: string;
	readonly producerSequence: number;
	readonly producerTimeMillisecondsWord: number;
	readonly observedTick: number;
	readonly effectId: string;
};

export type ScenarioActionEffectTriggerFact = ScenarioActionEffectFactBase & {
	readonly kind: 'trigger';
	readonly outcome: ScenarioActionEffectTriggerOutcome;
};

export type ScenarioActionEffectActivityKind = 'activate' | 'deactivate';

export type ScenarioActionEffectActivityFact = ScenarioActionEffectFactBase & {
	readonly kind: ScenarioActionEffectActivityKind;
	readonly activeCount: number;
};

export type ScenarioActionEffectFact =
	| ScenarioActionEffectTriggerFact
	| ScenarioActionEffectActivityFact;

export type ScenarioActionEffectTrace = {
	readonly executionDomain: 0 | 1;
	readonly ownerId: string;
	readonly ownerDefinitionId: string;
	readonly facts: ScenarioRetainedSequence<ScenarioActionEffectFact>;
};

export type ScenarioTestResult = {
	readonly id: string;
	readonly test: ScenarioTestItem;
	readonly sourceRevision: number;
	state: ScenarioTestResultState;
	startTick: number | null;
	endTick: number | null;
	readonly logs: ScenarioRetainedSequence<ScenarioResultLog>;
	readonly captures: ScenarioRetainedSequence<ScenarioResultCapture>;
	fsmTransitionTrace: ScenarioFsmTransitionTrace | null;
	actionEffectTrace: ScenarioActionEffectTrace | null;
	failure: ScenarioRunFailure | null;
	fault: FaultSnapshot | null;
};

export type ScenarioRun = {
	readonly id: string;
	readonly sequence: number;
	readonly scopeId: ScenarioTestNodeId;
	readonly items: readonly ScenarioTestResult[];
	state: ScenarioRunState;
	completedCount: number;
	passedCount: number;
	failedCount: number;
	cancelledCount: number;
	skippedCount: number;
};

export type ScenarioRunItemSource = {
	readonly test: ScenarioTestItem;
	readonly sourceRevision: number;
};

/** Fixed-capacity insertion-ordered storage without overflow copies. */
export class ScenarioRetainedSequence<T> {
	private readonly entries: T[] = [];
	private startIndex = 0;

	public constructor(private readonly capacity: number) {}

	public get length(): number {
		return this.entries.length;
	}

	public at(index: number): T {
		return this.entries[(this.startIndex + index) % this.entries.length];
	}

	public push(value: T): void {
		if (this.entries.length < this.capacity) {
			this.entries.push(value);
			return;
		}
		this.entries[this.startIndex] = value;
		this.startIndex = (this.startIndex + 1) % this.capacity;
	}
}

function sourceStart(test: ScenarioTestItem): ScenarioSourceLocation {
	return { resource: test.resource, line: 1, column: 1 };
}

/** Separate, bounded owner for live and completed Scenario Lab results. */
export class ScenarioResultService {
	public readonly runs: ScenarioRun[] = [];
	public revision = 0;
	private readonly retainedIds = new Set<string>();
	private readonly latestRunsByScope = new Map<ScenarioTestNodeId, ScenarioRun>();
	private readonly latestResultsByTest = new Map<ScenarioTestId, ScenarioTestResult>();
	private nextRunSequence = 1;
	private nextLogSequence = 1;
	private nextCaptureSequence = 1;
	private nextFsmTransitionSequence = 1;
	private nextActionEffectFactSequence = 1;
	private _liveRun: ScenarioRun | null = null;
	private _activeResult: ScenarioTestResult | null = null;

	public get liveRun(): ScenarioRun | null {
		return this._liveRun;
	}

	public get activeResult(): ScenarioTestResult | null {
		return this._activeResult;
	}

	public beginRun(
		scopeId: ScenarioTestNodeId,
		sources: readonly ScenarioRunItemSource[],
	): ScenarioRun {
		if (this._liveRun !== null) {
			throw new Error('A scenario run is already active.');
		}
		const runId = `scenario-run:${this.nextRunSequence}`;
		const items = new Array<ScenarioTestResult>(sources.length);
		for (let index = 0; index < sources.length; index += 1) {
			const source = sources[index];
			items[index] = {
				id: `${runId}:item:${index}`,
				test: source.test,
				sourceRevision: source.sourceRevision,
				state: 'queued',
				startTick: null,
				endTick: null,
				logs: new ScenarioRetainedSequence(SCENARIO_RESULT_LOG_RETAIN_COUNT),
				captures: new ScenarioRetainedSequence(SCENARIO_RESULT_CAPTURE_RETAIN_COUNT),
				fsmTransitionTrace: null,
				actionEffectTrace: null,
				failure: null,
				fault: null,
			};
		}
		const run: ScenarioRun = {
			id: runId,
			sequence: this.nextRunSequence,
			scopeId,
			items,
			state: 'running',
			completedCount: 0,
			passedCount: 0,
			failedCount: 0,
			cancelledCount: 0,
			skippedCount: 0,
		};
		this.nextRunSequence += 1;
		this.runs.unshift(run);
		this.retainedIds.add(run.id);
		this.latestRunsByScope.set(scopeId, run);
		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			this.retainedIds.add(item.id);
			this.latestResultsByTest.set(item.test.id, item);
		}
		if (this.runs.length > SCENARIO_RUN_RETAIN_COUNT) {
			this.removeRetainedRun(this.runs.pop()!);
		}
		this._liveRun = run;
		this.revision += 1;
		return run;
	}

	public startItem(run: ScenarioRun, itemIndex: number, startTick: number): ScenarioTestResult {
		const result = run.items[itemIndex];
		result.state = 'preparing';
		result.startTick = startTick;
		this._activeResult = result;
		this.revision += 1;
		return result;
	}

	public latestRunForScope(scopeId: ScenarioTestNodeId): ScenarioRun | null {
		const run = this.latestRunsByScope.get(scopeId);
		return run === undefined ? null : run;
	}

	public latestResultForTest(testId: ScenarioTestId): ScenarioTestResult | null {
		const result = this.latestResultsByTest.get(testId);
		return result === undefined ? null : result;
	}

	public hasRetainedResult(id: string): boolean {
		return this.retainedIds.has(id);
	}

	public beginFsmTransitionTrace(
		result: ScenarioTestResult,
		instanceId: string,
		machineId: string,
	): ScenarioFsmTransitionTrace {
		if (result.fsmTransitionTrace !== null) {
			throw new Error('A scenario run can record one selected FSM instance.');
		}
		const trace: ScenarioFsmTransitionTrace = {
			executionDomain: result.test.resource.domain,
			instanceId,
			machineId,
			transitions: new ScenarioRetainedSequence(
				SCENARIO_RESULT_FSM_TRANSITION_RETAIN_COUNT,
			),
		};
		result.fsmTransitionTrace = trace;
		this.revision += 1;
		return trace;
	}

	public appendFsmTransition(
		trace: ScenarioFsmTransitionTrace,
		producerSequence: number,
		producerTimeMillisecondsWord: number,
		observedTick: number,
		laneDefId: string,
		fromDefId: string,
		toDefId: string,
		outcome: ScenarioFsmTransitionOutcome,
	): void {
		trace.transitions.push({
			id: `scenario-fsm-transition:${this.nextFsmTransitionSequence}`,
			producerSequence,
			producerTimeMillisecondsWord,
			observedTick,
			laneDefId,
			fromDefId,
			toDefId,
			outcome,
		});
		this.nextFsmTransitionSequence += 1;
		this.revision += 1;
	}

	public beginActionEffectTrace(
		result: ScenarioTestResult,
		ownerId: string,
		ownerDefinitionId: string,
	): ScenarioActionEffectTrace {
		if (result.actionEffectTrace !== null) {
			throw new Error('A scenario run can record one selected ActionEffect component.');
		}
		const trace: ScenarioActionEffectTrace = {
			executionDomain: result.test.resource.domain,
			ownerId,
			ownerDefinitionId,
			facts: new ScenarioRetainedSequence(
				SCENARIO_RESULT_ACTIONEFFECT_FACT_RETAIN_COUNT,
			),
		};
		result.actionEffectTrace = trace;
		this.revision += 1;
		return trace;
	}

	public appendActionEffectTrigger(
		trace: ScenarioActionEffectTrace,
		producerSequence: number,
		producerTimeMillisecondsWord: number,
		observedTick: number,
		effectId: string,
		outcome: ScenarioActionEffectTriggerOutcome,
	): void {
		trace.facts.push({
			id: `scenario-actioneffect-fact:${this.nextActionEffectFactSequence}`,
			producerSequence,
			producerTimeMillisecondsWord,
			observedTick,
			effectId,
			kind: 'trigger',
			outcome,
		});
		this.nextActionEffectFactSequence += 1;
		this.revision += 1;
	}

	public appendActionEffectActivity(
		trace: ScenarioActionEffectTrace,
		producerSequence: number,
		producerTimeMillisecondsWord: number,
		observedTick: number,
		effectId: string,
		kind: ScenarioActionEffectActivityKind,
		activeCount: number,
	): void {
		trace.facts.push({
			id: `scenario-actioneffect-fact:${this.nextActionEffectFactSequence}`,
			producerSequence,
			producerTimeMillisecondsWord,
			observedTick,
			effectId,
			kind,
			activeCount,
		});
		this.nextActionEffectFactSequence += 1;
		this.revision += 1;
	}

	public markRunning(result: ScenarioTestResult): void {
		result.state = 'running';
		this.revision += 1;
	}

	public appendLog(result: ScenarioTestResult, tick: number, text: string): void {
		result.logs.push({
			id: `scenario-log:${this.nextLogSequence}`,
			tick,
			text,
			location: sourceStart(result.test),
		});
		this.nextLogSequence += 1;
		this.revision += 1;
	}

	public requestCapture(result: ScenarioTestResult, tick: number, label: string): void {
		result.captures.push({
			id: `scenario-capture:${this.nextCaptureSequence}`,
			label,
			requestTick: tick,
			presentedFrame: null,
			location: sourceStart(result.test),
		});
		this.nextCaptureSequence += 1;
		this.revision += 1;
	}

	public recordPresentation(result: ScenarioTestResult, presentedFrame: number): number {
		let captureCount = 0;
		for (let index = 0; index < result.captures.length; index += 1) {
			const capture = result.captures.at(index);
			if (capture.presentedFrame === null) {
				capture.presentedFrame = presentedFrame;
				captureCount += 1;
			}
		}
		if (captureCount > 0) {
			this.revision += 1;
		}
		return captureCount;
	}

	public pass(result: ScenarioTestResult, endTick: number): void {
		this.complete(result, 'passed', endTick);
	}

	public cancel(result: ScenarioTestResult, endTick: number): void {
		this.complete(result, 'cancelled', endTick);
	}

	public fail(
		result: ScenarioTestResult,
		endTick: number,
		failure: ScenarioRunFailure,
		fault: FaultSnapshot | null,
	): void {
		result.failure = failure;
		result.fault = fault;
		this.complete(result, 'failed', endTick);
	}

	private complete(
		result: ScenarioTestResult,
		state: 'passed' | 'failed' | 'cancelled',
		endTick: number,
	): void {
		result.state = state;
		result.endTick = endTick;
		const run = this._liveRun!;
		run.completedCount += 1;
		switch (state) {
			case 'passed':
				run.passedCount += 1;
				break;
			case 'failed':
				run.failedCount += 1;
				break;
			case 'cancelled':
				run.cancelledCount += 1;
				break;
		}
		this._activeResult = null;
		this.revision += 1;
	}

	public completeRun(run: ScenarioRun): void {
		run.state = run.failedCount === 0 ? 'passed' : 'failed';
		this._liveRun = null;
		this.revision += 1;
	}

	public cancelRun(run: ScenarioRun): void {
		this.finishIncompleteItems(run, 'cancelled');
	}

	public failRun(run: ScenarioRun): void {
		this.finishIncompleteItems(run, 'failed');
	}

	private finishIncompleteItems(
		run: ScenarioRun,
		state: 'cancelled' | 'failed',
	): void {
		const items = run.items;
		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			if (item.state !== 'queued') {
				continue;
			}
			item.state = 'skipped';
			run.completedCount += 1;
			run.skippedCount += 1;
		}
		run.state = state;
		this._activeResult = null;
		this._liveRun = null;
		this.revision += 1;
	}

	private removeRetainedRun(run: ScenarioRun): void {
		this.retainedIds.delete(run.id);
		if (this.latestRunsByScope.get(run.scopeId) === run) {
			this.latestRunsByScope.delete(run.scopeId);
		}
		const items = run.items;
		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			this.retainedIds.delete(item.id);
			if (this.latestResultsByTest.get(item.test.id) === item) {
				this.latestResultsByTest.delete(item.test.id);
			}
		}
	}
}
