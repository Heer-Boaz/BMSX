import type { StringPool } from '../../../machine/ts/machine/cpu/string_pool';
import { Table } from '../../../machine/ts/machine/cpu/table';
import {
	asStringId,
	type StringValue,
} from '../../../machine/ts/machine/cpu/value';
import {
	type ScenarioActionEffectFact,
	type ScenarioActionEffectTrace,
	type ScenarioActionEffectTriggerOutcome,
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
const RECORD_KIND = 3;
const RECORD_EFFECT_ID = 4;
const RECORD_VALUE = 5;

/**
 * Drains one selected ActionEffect component directly from its retained guest
 * tables. The producer sequence is the publication barrier; trigger outcomes
 * and aggregate activity counts retain their producer representation and order.
 */
export class ScenarioActionEffectObservation {
	private readonly capacity: number;
	private readonly records: Table;
	private readonly trace: ScenarioActionEffectTrace;
	private consumedSequence = 0;

	public constructor(
		private readonly channel: Table,
		private readonly stringPool: StringPool,
		private readonly results: ScenarioResultService,
		result: ScenarioRunResult,
	) {
		this.capacity = channel.getInteger(CHANNEL_CAPACITY) as number;
		this.records = channel.getInteger(CHANNEL_RECORDS) as Table;
		this.trace = results.beginActionEffectTrace(
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
				`ActionEffect recorder '${this.trace.ownerId}' overflowed its ${this.capacity}-record buffer.`,
			);
		}
		while (this.consumedSequence < publishedSequence) {
			const producerSequence = this.consumedSequence + 1;
			const slot = ((producerSequence - 1) % this.capacity) + 1;
			const record = this.records.getInteger(slot) as Table;
			const recordSequence = record.getInteger(RECORD_PRODUCER_SEQUENCE) as number;
			const producerTime = record.getInteger(
				RECORD_PRODUCER_TIME_MILLISECONDS_WORD,
			) as number;
			const effectId = this.readString(record, RECORD_EFFECT_ID);
			const kind = this.readString(record, RECORD_KIND) as ScenarioActionEffectFact['kind'];
			if (kind === 'trigger') {
				this.results.appendActionEffectTrigger(
					this.trace,
					recordSequence,
					producerTime,
					observedTick,
					effectId,
					this.readString(record, RECORD_VALUE) as ScenarioActionEffectTriggerOutcome,
				);
			} else {
				this.results.appendActionEffectActivity(
					this.trace,
					recordSequence,
					producerTime,
					observedTick,
					effectId,
					kind,
					record.getInteger(RECORD_VALUE) as number,
				);
			}
			this.consumedSequence = producerSequence;
		}
	}

	private readString(table: Table, index: number): string {
		return this.stringPool.toString(asStringId(table.getInteger(index) as StringValue));
	}
}
