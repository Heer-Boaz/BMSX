import type { StringPool } from '../../../machine/ts/machine/cpu/string_pool';
import { Table } from '../../../machine/ts/machine/cpu/table';
import {
	asStringId,
	type StringValue,
} from '../../../machine/ts/machine/cpu/value';
import {
	type ScenarioActionEffectTriggerOutcome,
	type ScenarioActionEffectTriggerTrace,
	type ScenarioRunResult,
	ScenarioResultService,
} from './result_service';

const CHANNEL_OWNER_ID = 1;
const CHANNEL_OWNER_DEFINITION_ID = 2;
const CHANNEL_CAPACITY = 3;
const CHANNEL_PUBLISHED_SEQUENCE = 4;
const CHANNEL_RECORDS = 5;

const RECORD_PRODUCER_SEQUENCE = 1;
const RECORD_PRODUCER_TIME_MILLISECONDS_WORD = 2;
const RECORD_EFFECT_ID = 3;
const RECORD_OUTCOME = 4;

/**
 * Drains one selected ActionEffect component directly from its retained guest
 * tables. The producer sequence is the publication barrier; outcome remains
 * the producer's interned string rather than a parallel host classification.
 */
export class ScenarioActionEffectTriggerObservation {
	private readonly capacity: number;
	private readonly records: Table;
	private readonly trace: ScenarioActionEffectTriggerTrace;
	private consumedSequence = 0;

	public constructor(
		private readonly channel: Table,
		private readonly stringPool: StringPool,
		private readonly results: ScenarioResultService,
		result: ScenarioRunResult,
	) {
		this.capacity = channel.getInteger(CHANNEL_CAPACITY) as number;
		this.records = channel.getInteger(CHANNEL_RECORDS) as Table;
		this.trace = results.beginActionEffectTriggerTrace(
			result,
			this.readString(channel, CHANNEL_OWNER_ID),
			this.readString(channel, CHANNEL_OWNER_DEFINITION_ID),
		);
	}

	public drain(observedTick: number): void {
		const publishedSequence = this.channel.getInteger(
			CHANNEL_PUBLISHED_SEQUENCE,
		) as number;
		if (publishedSequence - this.consumedSequence > this.capacity) {
			throw new Error(
				`ActionEffect trigger recorder '${this.trace.ownerId}' overflowed its ${this.capacity}-record buffer.`,
			);
		}
		while (this.consumedSequence < publishedSequence) {
			const producerSequence = this.consumedSequence + 1;
			const slot = ((producerSequence - 1) % this.capacity) + 1;
			const record = this.records.getInteger(slot) as Table;
			this.results.appendActionEffectTrigger(
				this.trace,
				record.getInteger(RECORD_PRODUCER_SEQUENCE) as number,
				record.getInteger(RECORD_PRODUCER_TIME_MILLISECONDS_WORD) as number,
				observedTick,
				this.readString(record, RECORD_EFFECT_ID),
				this.readString(record, RECORD_OUTCOME) as ScenarioActionEffectTriggerOutcome,
			);
			this.consumedSequence = producerSequence;
		}
	}

	private readString(table: Table, index: number): string {
		return this.stringPool.toString(asStringId(table.getInteger(index) as StringValue));
	}
}
