import type { StringPool } from '../../../machine/ts/machine/cpu/string_pool';

import type { TableRecords } from '../../../machine/ts/machine/cpu/table';
import { asInteger, asStringId, isTruthy, valuePayload } from '../../../machine/ts/machine/cpu/value';
export type FsmTransitionSink = (sequence: number, millisecondsWord: number, observedTick: number,
	lane: string, previous: string, target: string, outcome: 'committed' | 'rejected') => void;

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
export class FsmTransitionObservation {
	private readonly capacity: number;
	private readonly records: number;
	public readonly instanceId: string;
	public readonly machineId: string;
	public droppedCount = 0;
	private consumedSequence = 0;

	public constructor(
		private readonly channel: number,
		private readonly stringPool: StringPool,
		private readonly tables: TableRecords,
		private readonly publish: FsmTransitionSink,
		private readonly retention: 'strict' | 'rolling' = 'strict',
	) {
		this.capacity = asInteger(this.tables.getInteger(channel, CHANNEL_CAPACITY));
		this.records = valuePayload(this.tables.getInteger(channel, CHANNEL_RECORDS));
		this.instanceId = this.readString(channel, CHANNEL_INSTANCE_ID);
		this.machineId = this.readString(channel, CHANNEL_MACHINE_ID);
	}

	/** A restored live subscription begins at its accepted publication, not an older heap's cursor. */
	public discardPublished(): void { this.consumedSequence = valuePayload(this.tables.getInteger(this.channel, CHANNEL_PUBLISHED_SEQUENCE)); }

	public drain(observedTick: number): void {
		const publishedSequence = valuePayload(this.tables.getInteger(this.channel, CHANNEL_PUBLISHED_SEQUENCE));
		let available = (publishedSequence - this.consumedSequence) >>> 0;
		if (available === 0) return;
		if (available > this.capacity) {
			if (this.retention === 'strict') {
				throw new Error(
					`FSM transition recorder '${this.instanceId}' overflowed its ${this.capacity}-record buffer.`,
				);
			}
			this.droppedCount += available - this.capacity;
			this.consumedSequence = (publishedSequence - this.capacity) >>> 0;
			available = this.capacity;
		}
		while (available > 0) {
			const producerSequence = (this.consumedSequence + 1) >>> 0;
			const slot = ((producerSequence - 1) & (this.capacity - 1)) + 1;
			const record = valuePayload(this.tables.getInteger(this.records, slot));
			const recordSequence = valuePayload(this.tables.getInteger(record, RECORD_PRODUCER_SEQUENCE));
			if (recordSequence !== producerSequence) {
				if (this.retention === 'strict') throw new Error(`FSM transition recorder '${this.instanceId}' overflowed its ${this.capacity}-record buffer.`);
				this.droppedCount++;
				this.consumedSequence = producerSequence;
				available--;
				continue;
			}
			const committed = isTruthy(this.tables.getInteger(record, RECORD_COMMITTED));
			this.publish(
				recordSequence,
				valuePayload(this.tables.getInteger(record, RECORD_PRODUCER_TIME_MILLISECONDS_WORD)),
				observedTick,
				this.readString(record, RECORD_LANE_DEF_ID),
				this.readString(record, RECORD_FROM_DEF_ID),
				this.readString(record, RECORD_TO_DEF_ID),
				committed ? 'committed' : 'rejected',
			);
			this.consumedSequence = producerSequence;
			available--;
		}
	}

	private readString(table: number, index: number): string {
		return this.stringPool.toString(asStringId(this.tables.getInteger(table, index)));
	}
}
