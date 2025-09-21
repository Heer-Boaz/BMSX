import type { Identifier } from '../rompack/rompack';
import type { AbilityId } from './gastypes';

export type IntentKind = 'ability';

export interface BaseIntent<K extends IntentKind> {
	readonly kind: K;
	readonly ownerId: Identifier;
	readonly frame: number;
	readonly sequence: number;
	readonly source?: string;
}

export interface AbilityIntent extends BaseIntent<'ability'> {
	readonly abilityId: AbilityId;
	readonly payload?: Record<string, unknown>;
}

export type GameplayIntent = AbilityIntent;

type EnqueueResult =
	| { ok: true; status: 'queued' | 'duplicate' }
	| { ok: false; reason: 'queue_full' };

const MAX_QUEUE_PER_ENTITY = 16;

/**
 * Intent queue with per-frame ordering, per-entity bounding, and round-robin fairness.
 */
export class GameplayIntentQueue {
	public static readonly instance = new GameplayIntentQueue();

	private _frame: number = 0;
	private _sequence: number = 0;
	private readonly perEntity = new Map<Identifier, GameplayIntent[]>();
	private readonly order: Array<{ ownerId: Identifier; key: string }> = [];
	private readonly enqueued = new Set<Identifier>();

	private constructor() {
		// Singleton; use GameplayIntentQueue.instance
	}

	public beginFrame(frame: number): void {
		this._frame = frame;
		this._sequence = 0;
	}

	public enqueue(intent: Omit<GameplayIntent, 'frame' | 'sequence'>): EnqueueResult {
		const entry: GameplayIntent = {
			...intent,
			frame: this._frame,
			sequence: this._sequence++,
		};
		let bucket = this.perEntity.get(entry.ownerId);
		if (!bucket) {
			bucket = [];
			this.perEntity.set(entry.ownerId, bucket);
		}
		if (this.hasDuplicate(bucket, entry)) {
			return { ok: true, status: 'duplicate' };
		}
		if (bucket.length >= MAX_QUEUE_PER_ENTITY) {
			const dropped = bucket.shift();
			console.warn('[GameplayIntentQueue] Dropping oldest intent for', entry.ownerId, 'due to queue pressure.', dropped);
		}
		bucket.push(entry);
		if (!this.enqueued.has(entry.ownerId)) {
			this.insertOwner(entry.ownerId, bucket[0]!);
			this.enqueued.add(entry.ownerId);
		}
		return { ok: true, status: 'queued' };
	}

	public next(): GameplayIntent | null {
		while (this.order.length > 0) {
			const { ownerId } = this.order.shift()!;
			this.enqueued.delete(ownerId);
			const bucket = this.perEntity.get(ownerId);
			if (!bucket || bucket.length === 0) {
				this.perEntity.delete(ownerId);
				continue;
			}
			const intent = bucket.shift()!;
			if (bucket.length > 0) {
				this.order.push({ ownerId, key: this.makeKey(bucket[0]!) });
				this.enqueued.add(ownerId);
			}
			else {
				this.perEntity.delete(ownerId);
			}
			return intent;
		}
		return null;
	}

	public clear(): void {
		this.perEntity.clear();
		this.order.length = 0;
		this.enqueued.clear();
	}

	public pendingCount(): number {
		let total = 0;
		for (const bucket of this.perEntity.values()) total += bucket.length;
		return total;
	}

	private hasDuplicate(bucket: GameplayIntent[], candidate: GameplayIntent): boolean {
		for (const existing of bucket) {
			if (existing.frame !== candidate.frame) continue;
			if (existing.abilityId !== candidate.abilityId) continue;
			if (!this.payloadEquals(existing.payload, candidate.payload)) continue;
			if (existing.source !== candidate.source) continue;
			return true;
		}
		return false;
	}

	private payloadEquals(a?: Record<string, unknown>, b?: Record<string, unknown>): boolean {
		if (a === b) return true;
		if (!a || !b) return false;
		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b);
		if (aKeys.length !== bKeys.length) return false;
		for (const key of aKeys) {
			if (a[key] !== b[key]) return false;
		}
		return true;
	}

	private insertOwner(ownerId: Identifier, head: GameplayIntent): void {
		const key = this.makeKey(head);
		let idx = 0;
		while (idx < this.order.length && this.order[idx]!.key <= key) idx++;
		this.order.splice(idx, 0, { ownerId, key });
	}

	private makeKey(intent: GameplayIntent): string {
		const frameKey = intent.frame.toString().padStart(10, '0');
		const seqKey = intent.sequence.toString().padStart(6, '0');
		return `${frameKey}|${intent.ownerId}|${seqKey}`;
	}
}
