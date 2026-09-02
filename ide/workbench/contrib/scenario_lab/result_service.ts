import type { FaultSnapshot } from '../../../runtime/fault_state';
import type { ResourceIdentity } from '../../../common/resource';
import type { ScenarioTestItem } from './test_collection';

export const SCENARIO_RESULT_RETAIN_COUNT = 128;
export const SCENARIO_RESULT_LOG_RETAIN_COUNT = 512;
export const SCENARIO_RESULT_CAPTURE_RETAIN_COUNT = 64;

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
	readonly tick: number;
	readonly text: string;
	readonly location: ScenarioSourceLocation;
};

export type ScenarioResultCapture = {
	readonly label: string;
	readonly requestTick: number;
	readonly location: ScenarioSourceLocation;
	presentedFrame: number | null;
};

export type ScenarioRunFailure = {
	readonly message: string;
	readonly location: ScenarioSourceLocation;
};

export type ScenarioRunResult = {
	readonly id: string;
	readonly test: ScenarioTestItem;
	readonly sourceRevision: number;
	readonly startTick: number;
	state: ScenarioRunState;
	endTick: number | null;
	readonly logs: ScenarioRetainedSequence<ScenarioResultLog>;
	readonly captures: ScenarioRetainedSequence<ScenarioResultCapture>;
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
			test,
			sourceRevision,
			startTick,
			state: 'preparing',
			endTick: null,
			logs: new ScenarioRetainedSequence(SCENARIO_RESULT_LOG_RETAIN_COUNT),
			captures: new ScenarioRetainedSequence(SCENARIO_RESULT_CAPTURE_RETAIN_COUNT),
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

	public markRunning(result: ScenarioRunResult): void {
		result.state = 'running';
		this.revision += 1;
	}

	public appendLog(result: ScenarioRunResult, tick: number, text: string): void {
		result.logs.push({ tick, text, location: sourceStart(result.test) });
		this.revision += 1;
	}

	public requestCapture(result: ScenarioRunResult, tick: number, label: string): void {
		result.captures.push({
			label,
			requestTick: tick,
			presentedFrame: null,
			location: sourceStart(result.test),
		});
		this.revision += 1;
	}

	public recordPresentation(result: ScenarioRunResult, presentedFrame: number): void {
		let changed = false;
		for (let index = 0; index < result.captures.length; index += 1) {
			const capture = result.captures.at(index);
			if (capture.presentedFrame === null) {
				capture.presentedFrame = presentedFrame;
				changed = true;
			}
		}
		if (changed) {
			this.revision += 1;
		}
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
		message: string,
		fault: FaultSnapshot | null,
	): void {
		result.failure = {
			message,
			location: fault === null
				? sourceStart(result.test)
				: {
					resource: fault.resource,
					line: fault.line,
					column: fault.column,
				},
		};
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
