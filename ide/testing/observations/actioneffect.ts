import type { StringPool } from '../../../machine/ts/machine/cpu/string_pool';
import { Table } from '../../../machine/ts/machine/cpu/table';
import {
	asStringId,
	type StringValue,
} from '../../../machine/ts/machine/cpu/value';
export type ActionEffectTriggerOutcome = 'accepted' | 'cooldown' | 'required_tag_missing' | 'blocked_tag_present'
	| 'required_state_missing' | 'blocked_state_present' | 'custom_gate';
export type ActionEffectActivityKind = 'activate' | 'deactivate';
export type ActionEffectSink = {
	trigger(sequence: number, millisecondsWord: number, observedTick: number, effect: string, outcome: ActionEffectTriggerOutcome): void;
	activity(sequence: number, millisecondsWord: number, observedTick: number, effect: string, kind: ActionEffectActivityKind, count: number): void;
};

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
export class ActionEffectObservation {
	private readonly capacity: number;
	private readonly records: Table;
	public readonly ownerId: string;
	public readonly definitionId: string;
	public droppedCount = 0;
	private consumedSequence = 0;

	public constructor(
		private readonly channel: Table,
		private readonly stringPool: StringPool,
		private readonly publish: ActionEffectSink,
		private readonly retention: 'strict' | 'rolling' = 'strict',
	) {
		this.capacity = channel.getInteger(CHANNEL_CAPACITY) as number;
		this.records = channel.getInteger(CHANNEL_RECORDS) as Table;
		this.ownerId = this.readString(channel, CHANNEL_OWNER_ID);
		this.definitionId = this.readString(channel, CHANNEL_OWNER_DEFINITION_ID);
	}

	/** A restored live subscription begins at its accepted publication, not an older heap's cursor. */
	public discardPublished(): void { this.consumedSequence = this.channel.getInteger(CHANNEL_PUBLISHED_SEQUENCE) as number; }

	public drain(observedTick: number): void {
		const publishedSequence = this.channel.getInteger(
			CHANNEL_PUBLISHED_SEQUENCE,
		) as number;
		if (publishedSequence - this.consumedSequence > this.capacity) {
			if (this.retention === 'strict') {
				throw new Error(
					`ActionEffect recorder '${this.ownerId}' overflowed its ${this.capacity}-record buffer.`,
				);
			}
			const oldest = publishedSequence - this.capacity;
			this.droppedCount += oldest - this.consumedSequence;
			this.consumedSequence = oldest;
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
			const kind = this.readString(record, RECORD_KIND) as 'trigger' | ActionEffectActivityKind;
			if (kind === 'trigger') {
				this.publish.trigger(
					recordSequence,
					producerTime,
					observedTick,
					effectId,
					this.readString(record, RECORD_VALUE) as ActionEffectTriggerOutcome,
				);
			} else {
				this.publish.activity(
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
