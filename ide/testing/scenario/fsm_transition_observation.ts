import type { StringPool } from '../../../machine/ts/machine/cpu/string_pool';
import { Table } from '../../../machine/ts/machine/cpu/table';
import {
	asStringId,
	type StringValue,
} from '../../../machine/ts/machine/cpu/value';
import {
	type ScenarioFsmTransitionTrace,
	type ScenarioTestResult,
	ScenarioResultService,
} from './result_service';

const CHANNEL_INSTANCE_ID = 1;
const CHANNEL_MACHINE_ID = 2;
const CHANNEL_CAPACITY = 3;
const CHANNEL_PUBLISHED_SEQUENCE = 4;
const CHANNEL_RECORDS = 5;

const RECORD_PRODUCER_SEQUENCE = 1;
const RECORD_PRODUCER_TIME_MILLISECONDS_WORD = 2;
const RECORD_LANE_DEF_ID = 3;
const RECORD_FROM_DEF_ID = 4;
const RECORD_TO_DEF_ID = 5;
const RECORD_COMMITTED = 6;

/**
 * Drains one selected cartlib FSM recorder directly from its retained guest
 * tables. The producer sequence is the publication barrier; no heap or world
 * discovery participates in this path.
 */
export class ScenarioFsmTransitionObservation {
	private readonly capacity: number;
	private readonly records: Table;
	private readonly trace: ScenarioFsmTransitionTrace;
	private consumedSequence = 0;

	public constructor(
		private readonly channel: Table,
		private readonly stringPool: StringPool,
		private readonly results: ScenarioResultService,
		result: ScenarioTestResult,
	) {
		this.capacity = channel.getInteger(CHANNEL_CAPACITY) as number;
		this.records = channel.getInteger(CHANNEL_RECORDS) as Table;
		this.trace = results.beginFsmTransitionTrace(
			result,
			this.readString(channel, CHANNEL_INSTANCE_ID),
			this.readString(channel, CHANNEL_MACHINE_ID),
		);
	}

	public drain(observedTick: number): void {
		const publishedSequence = this.channel.getInteger(
			CHANNEL_PUBLISHED_SEQUENCE,
		) as number;
		if (publishedSequence - this.consumedSequence > this.capacity) {
			throw new Error(
				`FSM transition recorder '${this.trace.instanceId}' overflowed its ${this.capacity}-record buffer.`,
			);
		}
		while (this.consumedSequence < publishedSequence) {
			const producerSequence = this.consumedSequence + 1;
			const slot = ((producerSequence - 1) % this.capacity) + 1;
			const record = this.records.getInteger(slot) as Table;
			const committed = record.getInteger(RECORD_COMMITTED) as boolean;
			this.results.appendFsmTransition(
				this.trace,
				record.getInteger(RECORD_PRODUCER_SEQUENCE) as number,
				record.getInteger(RECORD_PRODUCER_TIME_MILLISECONDS_WORD) as number,
				observedTick,
				this.readString(record, RECORD_LANE_DEF_ID),
				this.readString(record, RECORD_FROM_DEF_ID),
				this.readString(record, RECORD_TO_DEF_ID),
				committed ? 'committed' : 'rejected',
			);
			this.consumedSequence = producerSequence;
		}
	}

	private readString(table: Table, index: number): string {
		return this.stringPool.toString(asStringId(table.getInteger(index) as StringValue));
	}
}
