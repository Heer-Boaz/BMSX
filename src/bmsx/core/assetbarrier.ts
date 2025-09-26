import { type GateCategory, type GateGroup } from './taskgate';

type LoaderFn<T> = () => Promise<T>;
type Disposer<T> = (val: T) => void;

interface Entry<T> {
	refCount: number;
	value?: T;
	promise?: Promise<T>;
	gen: number;
	blocking: boolean;
	category: GateCategory;
	tag?: string;

	disposer?: Disposer<T>;
	isFallback?: boolean;
}

export interface AcquireOptions<T> {
	fallback?: T;
	block_render?: boolean;
	category?: GateCategory;
	tag?: string;
	disposer?: Disposer<T>;
	warnIfLongerMs?: number;
	// future-friendly; not used here but kept for loader implementations that accept it
	signal?: AbortSignal;
}

export class AssetBarrier<T> {
	private map = new Map<string, Entry<T>>();

	constructor(private readonly group: GateGroup) { }

	acquire(key: string, loader: LoaderFn<T>, opts: AcquireOptions<T> = {}): Promise<T> {
		const entry = this.ensureEntry(key, opts);

		// --- Fast path: already loaded, no reload ---
		if (entry.value !== undefined && entry.promise === undefined) {
			if (opts.tag && !entry.tag) entry.tag = opts.tag;
			if (opts.block_render) entry.blocking = true; // persist intent for snapshotting/telemetry
			return Promise.resolve(entry.value);
		}

		// --- In-flight: escalate metadata if needed and return same promise ---
		if (entry.promise) {
			if (opts.block_render && !entry.blocking) {
				entry.blocking = true;
				// Optional: inform group that this in-flight load is now blocking for this acquire
				this.group.track(entry.promise, { blocking: true, category: entry.category, tag: opts.tag ?? entry.tag });
			}
			if (opts.tag && !entry.tag) entry.tag = opts.tag;
			return entry.promise;
		}

		// --- New load ---
		const genAtStart = entry.gen;

		if (opts.warnIfLongerMs && opts.warnIfLongerMs > 0) {
			setTimeout(() => {
				const m = this.map.get(key);
				if (m?.promise && m.gen === genAtStart) {
					console.warn(`[AssetBarrier] Slow load > ${opts.warnIfLongerMs}ms for key="${key}"`);
				}
			}, opts.warnIfLongerMs);
		}

		const tracked = this.group.track(
			loader().then(val => {
				const current = this.map.get(key);
				if (!current || current.gen !== genAtStart) {
					// Late resolve: dispose produced value safely then surface whatever is current (likely undefined).
					try {
						(entry.disposer ?? opts.disposer)?.(val);
					} catch (e) {
						console.error('[AssetBarrier] disposer threw on late resolve', e);
					}
					return current?.value as T;
				}
				current.value = val;
				current.isFallback = false;
				return val;
			}),
			{
				blocking: entry.blocking,
				category: entry.category,
				tag: opts.tag ?? entry.tag,
			}
		);

		entry.promise = tracked;

		tracked.finally(() => {
			const still = this.map.get(key);
			if (still && still.gen === genAtStart) still.promise = undefined;
		});

		return entry.promise;
	}

	get(key: string): T | undefined { return this.map.get(key)?.value; }

	addRef(key: string): void {
		const e = this.map.get(key);
		if (!e) {
			throw new Error(`[AssetBarrier] addRef called for unknown key "${key}".`);
		}
		e.refCount++;
	}

	release(key: string, disposer?: Disposer<T>): void {
		const e = this.map.get(key);
		if (!e) {
			throw new Error(`[AssetBarrier] release called for unknown key "${key}".`);
		}
		e.refCount--;
		if (e.refCount < 0) {
			throw new Error(`[AssetBarrier] refCount underflow for key "${key}".`);
		}
		if (e.refCount <= 0) {
			e.gen++;
			if (e.value !== undefined && !e.isFallback) {
				try { (disposer ?? e.disposer)?.(e.value); } catch (err) { console.error('[AssetBarrier] disposer threw on release', err); }
			}
			this.map.delete(key);
		}
	}

	invalidate(key: string, disposer?: Disposer<T>): void {
		const e = this.map.get(key);
		if (!e) {
			throw new Error(`[AssetBarrier] invalidate called for unknown key "${key}".`);
		}
		e.gen++;
		if (e.value !== undefined && !e.isFallback) {
			try { (disposer ?? e.disposer)?.(e.value); } catch (err) { console.error('[AssetBarrier] disposer threw on invalidate', err); }
		}
		e.value = undefined;
		e.isFallback = false;
		e.promise = undefined;
		// keep entry to preserve refCount and metadata
	}

	clear(disposer?: Disposer<T>): void {
		for (const [k, e] of this.map) {
			e.gen++;
			if (e.value !== undefined && !e.isFallback) {
				try { (disposer ?? e.disposer)?.(e.value); } catch (err) { console.error(`[AssetBarrier] disposer threw on clear for key="${k}"`, err); }
			}
		}
		this.map.clear();
	}

	snapshot() {
		const obj: Record<string, {
			ref: number; hasValue: boolean; loading: boolean; gen: number;
			blocking: boolean; category: GateCategory; tag?: string;
		}> = {};
		for (const [k, e] of this.map) {
			obj[k] = {
				ref: e.refCount,
				hasValue: e.value !== undefined,
				loading: !!e.promise,
				gen: e.gen,
				blocking: e.blocking,
				category: e.category,
				tag: e.tag
			};
		}
		return obj;
	}

	private ensureEntry(key: string, opts: AcquireOptions<T>): Entry<T> {
		let e = this.map.get(key);
		if (!e) {
			e = {
				refCount: 1,
				value: opts.fallback,
				isFallback: opts.fallback !== undefined,
				promise: undefined,
				gen: 1,
				blocking: opts.block_render ?? false,
				category: opts.category ?? 'other',
				tag: opts.tag,
				disposer: opts.disposer,
			};
			this.map.set(key, e);
		} else {
			e.refCount++;
			if (opts.fallback !== undefined && e.value === undefined) {
				e.value = opts.fallback; e.isFallback = true;
			}
			if (opts.tag && !e.tag) e.tag = opts.tag;
			if (opts.block_render) e.blocking = true;
			if (opts.disposer && !e.disposer) e.disposer = opts.disposer;
			if (opts.category && e.category !== opts.category) e.category = opts.category;
		}
		return e;
	}
}
