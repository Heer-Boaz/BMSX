import { excludeclassfromsavegame } from '../serializer/serializationhooks';

/**
 * Generic object pool utility.
 *
 * Goals:
 * - Avoid GC churn in tight loops (particles, bullets, transient FX, math temp objects, etc.)
 * - Provide predictable acquire/release semantics.
 * - Support optional hard capacity (fixed pool) or elastic growth (bounded by maxTotal).
 * - Offer iteration over ACTIVE items without exposing internal storage (for ECS-like update passes).
 *
 * Design:
 * - Client supplies a factory to create new instances (create()).
 * - Optional reset() to reinitialize instance on acquire.
 * - Optional dispose() called if an instance is permanently purged (e.g., on shrink / clear).
 * - Pool stores simple struct { item, active }. Reuse selects first inactive; if none and capacity not reached, create new.
 * - Returned handle is the item itself; pool tracks actives separately.
 */
export interface PoolOptions<T> {
	/** Preallocate this many instances eagerly (warm pool). */
	warm?: number;
	/** Maximum simultaneously ACTIVE instances; extra acquire returns undefined if reached (when fixed=true). */
	maxActive?: number;
	/** Hard cap on total allocated instances (active+inactive). If reached and no free instance, acquire returns undefined. */
	maxTotal?: number;
	/** If true, never grow beyond warm size (or maxTotal if provided). */
	fixed?: boolean;
	/**
	 * Called immediately after a slot flips to active (either reused or newly created), BEFORE onReset.
	 * Gebruik voor zaken die slechts éénmaal per acquire hoeven te gebeuren vóór de state-reset,
	 * bv. detach/exile uit een scene graph, timestamp capture, etc.
	 * Tip: voor PooledWorldObject kun je hier `inst.prepareForReuse()` doen en in onReset het zichtbaar/actief maken.
	 */
	onAcquire?: (obj: T) => void;
	/** Called when an object is (re)acquired before handing to caller. */
	onReset?: (obj: T) => void;
	/** Called when creating a brand new instance. */
	onCreate?: () => T;
	/** Called when an object is permanently discarded (clear, shrink). */
	onDispose?: (obj: T) => void;
}

interface Slot<T> { item: T; active: boolean; }

export class Pool<T> {
	private slots: Slot<T>[] = [];
	private activeCount = 0;
	private opts: Required<Pick<PoolOptions<T>, 'onCreate'>> & PoolOptions<T>;

	constructor(opts: PoolOptions<T> & { onCreate: () => T }) {
		this.opts = opts;
		const warm = opts.warm ?? 0;
		for (let i = 0; i < warm; i++) this.slots.push({ item: opts.onCreate(), active: false });
	}

	/** Acquire an item. Returns undefined if pool limits prevent allocation. */
	acquire(): T {
		// 1. Find inactive slot
		for (const s of this.slots) {
			if (!s.active) {
				if (this.opts.maxActive !== undefined && this.activeCount >= this.opts.maxActive) return undefined;
				s.active = true; this.activeCount++;
				this.opts.onAcquire?.(s.item);
				this.opts.onReset?.(s.item);
				return s.item;
			}
		}
		// 2. Grow if allowed
		if (this.opts.fixed) return undefined;
		if (this.opts.maxTotal !== undefined && this.slots.length >= this.opts.maxTotal) return undefined;
		if (this.opts.maxActive !== undefined && this.activeCount >= this.opts.maxActive) return undefined;
		const item = this.opts.onCreate();
		this.slots.push({ item, active: true });
		this.activeCount++;
		this.opts.onAcquire?.(item);
		this.opts.onReset?.(item);
		return item;
	}

	/** Release an item back to pool. Idempotent. */
	release(obj: T): void {
		for (const s of this.slots) {
			if (s.item === obj) {
				if (s.active) { s.active = false; this.activeCount--; }
				return;
			}
		}
	}

	/** Iterate active items. */
	forEachActive(cb: (obj: T) => void): void { for (const s of this.slots) if (s.active) cb(s.item); }

	/** Number of active items. */
	get sizeActive(): number { return this.activeCount; }
	/** Total allocated (active+inactive). */
	get sizeTotal(): number { return this.slots.length; }

	/** Clear all (calls onDispose for every allocated item). */
	clear(): void { for (const s of this.slots) this.opts.onDispose?.(s.item); this.slots = []; this.activeCount = 0; }

	/** Shrink by releasing & disposing oldest inactive to reach target total. */
	shrinkTo(total: number): void {
		if (total < 0) total = 0;
		if (total >= this.slots.length) return;
		// Collect inactive indices
		const inactiveIdx: number[] = [];
		for (let i = 0; i < this.slots.length; i++) if (!this.slots[i].active) inactiveIdx.push(i);
		// Remove from end of inactive list until size ok
		while (this.slots.length > total && inactiveIdx.length) {
			const idx = inactiveIdx.pop()!;
			const [removed] = this.slots.splice(idx, 1);
			this.opts.onDispose?.(removed.item);
			// Adjust subsequent indices
			for (let j = 0; j < inactiveIdx.length; j++) if (inactiveIdx[j] > idx) inactiveIdx[j]--;
		}
	}

	/** Manually pre-allocate additional inactive instances (lazy warm). */
	warmUp(count: number): void {
		for (let i = 0; i < count; i++) {
			// Respect maxTotal/fixed if specified
			if (this.opts.maxTotal !== undefined && this.slots.length >= this.opts.maxTotal) break;
			if (this.opts.fixed && this.slots.length >= (this.opts.warm ?? this.slots.length)) break;
			this.slots.push({ item: this.opts.onCreate(), active: false });
		}
	}

	/**
	 * Helper om een luie singleton pool te maken mét statistieken.
	 * Voorbeeld:
	 * private static _pool = Pool.createLazy<MyType>({ onCreate: () => new MyType(), lazyWarm: 16 });
	 * private static get pool() { return this._pool.get(); }
	 * static debugStats() { return this._pool.stats(); }
	 */
	static createLazy<T>(opts: PoolOptions<T> & { onCreate: () => T; lazyWarm?: number }): { get: () => Pool<T>; stats: () => { active: number; total: number } } {
		let singleton: Pool<T>;
		return {
			get: () => {
				if (!singleton) {
					const { lazyWarm, ...rest } = opts;
					singleton = new Pool<T>(rest);
					if (lazyWarm && lazyWarm > 0) singleton.warmUp(lazyWarm);
				}
				return singleton;
			},
			stats: () => ({ active: singleton?.sizeActive ?? 0, total: singleton?.sizeTotal ?? 0 })
		};
	}
}

export interface IPool<T> {
	ensure(): T;
	reset(): void;
}

@excludeclassfromsavegame // This class is excluded from savegame serialization
// Growable pool for Float32Array buffers, which avoids frequent allocations and deallocations.
export class Float32ArrayPool implements IPool<Float32Array> {
	private pool: Float32Array[] = [];
	private index: number = 0;

	constructor(private arraySize: number) {
		this.pool.push(new Float32Array(this.arraySize));
	}

	ensure(): Float32Array {
		if (this.index >= this.pool.length) {
			this.pool.push(new Float32Array(this.arraySize));
		}
		return this.pool[this.index++];
	}

	reset(): void {
		this.index = 0;
	}
}
