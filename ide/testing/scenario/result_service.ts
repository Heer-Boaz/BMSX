import type { FaultSnapshot } from '../../runtime/fault_state';
import type { ResourceIdentity } from '../../common/resource';
import type { ScenarioTestItem } from './test_collection';

export const SCENARIO_RESULT_RETAIN_COUNT = 128;
export const SCENARIO_RESULT_LOG_RETAIN_COUNT = 512;
export const SCENARIO_RESULT_CAPTURE_RETAIN_COUNT = 64;
export const SCENARIO_RESULT_FSM_TRANSITION_RETAIN_COUNT = 1024;

export type ScenarioRunState =
	| 'preparing'
	| 'running'
	| 'passed'
	| 'failed'
	| 'cancelled';

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

export type ScenarioRunResult = {
	readonly id: string;
	readonly sequence: number;
	readonly test: ScenarioTestItem;
	readonly sourceRevision: number;
	readonly startTick: number;
	state: ScenarioRunState;
	endTick: number | null;
	readonly logs: ScenarioRetainedSequence<ScenarioResultLog>;
	readonly captures: ScenarioRetainedSequence<ScenarioResultCapture>;
	fsmTransitionTrace: ScenarioFsmTransitionTrace | null;
	failure: ScenarioRunFailure | null;
	fault: FaultSnapshot | null;
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
	public readonly results: ScenarioRunResult[] = [];
	public revision = 0;
	private nextRunSequence = 1;
	private nextLogSequence = 1;
	private nextCaptureSequence = 1;
	private nextFsmTransitionSequence = 1;
	private _liveResult: ScenarioRunResult | null = null;

	public get liveResult(): ScenarioRunResult | null {
		return this._liveResult;
	}

	public begin(test: ScenarioTestItem, sourceRevision: number, startTick: number): ScenarioRunResult {
		if (this._liveResult !== null) {
			throw new Error('A scenario run is already active.');
		}
		const result: ScenarioRunResult = {
			id: `scenario-run:${this.nextRunSequence}`,
			sequence: this.nextRunSequence,
			test,
			sourceRevision,
			startTick,
			state: 'preparing',
			endTick: null,
			logs: new ScenarioRetainedSequence(SCENARIO_RESULT_LOG_RETAIN_COUNT),
			captures: new ScenarioRetainedSequence(SCENARIO_RESULT_CAPTURE_RETAIN_COUNT),
			fsmTransitionTrace: null,
			failure: null,
			fault: null,
		};
		this.nextRunSequence += 1;
		this.results.unshift(result);
		if (this.results.length > SCENARIO_RESULT_RETAIN_COUNT) {
			this.results.length = SCENARIO_RESULT_RETAIN_COUNT;
		}
		this._liveResult = result;
		this.revision += 1;
		return result;
	}

	public beginFsmTransitionTrace(
		result: ScenarioRunResult,
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

	public markRunning(result: ScenarioRunResult): void {
		result.state = 'running';
		this.revision += 1;
	}

	public appendLog(result: ScenarioRunResult, tick: number, text: string): void {
		result.logs.push({
			id: `scenario-log:${this.nextLogSequence}`,
			tick,
			text,
			location: sourceStart(result.test),
		});
		this.nextLogSequence += 1;
		this.revision += 1;
	}

	public requestCapture(result: ScenarioRunResult, tick: number, label: string): void {
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

	public recordPresentation(result: ScenarioRunResult, presentedFrame: number): number {
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

	public pass(result: ScenarioRunResult, endTick: number): void {
		this.complete(result, 'passed', endTick);
	}

	public cancel(result: ScenarioRunResult, endTick: number): void {
		this.complete(result, 'cancelled', endTick);
	}

	public fail(
		result: ScenarioRunResult,
		endTick: number,
		failure: ScenarioRunFailure,
		fault: FaultSnapshot | null,
	): void {
		result.failure = failure;
		result.fault = fault;
		this.complete(result, 'failed', endTick);
	}

	private complete(
		result: ScenarioRunResult,
		state: 'passed' | 'failed' | 'cancelled',
		endTick: number,
	): void {
		result.state = state;
		result.endTick = endTick;
		this._liveResult = null;
		this.revision += 1;
	}
}
