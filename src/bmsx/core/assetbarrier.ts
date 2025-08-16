import { GateCategory, TaskGate, taskGate } from './taskgate';

/**
 * A function that performs an asynchronous load and resolves with the loaded value.
 *
 * @template T - Type of the value produced by the loader.
 * @returns A Promise that resolves to the loaded value.
 */
type LoaderFn<T> = () => Promise<T>;

/**
 * Function used to dispose an asset when it's no longer needed.
 *
 * @template T - Type of the value to dispose.
 * @param val - The value to be disposed.
 */
type Disposer<T> = (val: T) => void;

interface Entry<T> {
    refCount: number;
    value?: T;            // huidig bruikbaar object (kan fallback zijn)
    promise?: Promise<T>; // in-flight load
    gen: number;          // generation voor late-resolve protectie
    blocking: boolean;    // of deze load gate-blocking was aangevraagd
    category: GateCategory;
    tag?: string;
}

/**
 * Options passed to AssetBarrier.acquire to control fallback, gating and disposal.
 *
 * @template T - Type of the asset being acquired.
 * @property fallback - Optional immediate value usable for rendering until the real asset is ready.
 * @property block_render - When true the load begins as a blocking scope on the TaskGate.
 * @property category - Optional category used for TaskGate telemetry/grouping.
 * @property tag - Optional free-form tag for debugging.
 * @property disposer - Optional disposer called for late-resolves or when values are released/cleared.
 * @property warnIfLongerMs - Optional threshold (ms) to log a warning if the load takes too long.
 */
export interface AcquireOptions<T> {
    /** Fallback die direct renderbaar is totdat de echte klaar is (non-blocking). */
    fallback?: T;
    /** Gate-configuratie: standaard non-blocking. */
    block_render?: boolean;
    category?: GateCategory;
    tag?: string;
    /** Disposer voor late-resolves die we weggooien, of bij release/clear. */
    disposer?: Disposer<T>;
    /** Optioneel: leak-detectie (log waarschuwing als load > N ms duurt). */
    warnIfLongerMs?: number;
}

/**
 * AssetBarrier<T>
 *
 * Generic asset load/deduplication barrier with reference counting and safe
 * late-resolve handling.
 *
 * @template T - Type of the managed asset values.
 *
 * @remarks
 * AssetBarrier provides:
 * - Deduplication of concurrent loads by key (concurrent callers share the same Promise).
 * - Optional immediate fallback values usable for rendering while the definitive asset loads.
 * - Reference counting (acquire/addRef/release) to manage lifetime and disposal.
 * - Generation tokens to ignore late/obsolete Promise resolutions (avoids races).
 * - Integration with a TaskGate to mark loads as blocking or non-blocking for readiness telemetry.
 *
 * @example
 * ```ts
 * const barrier = new AssetBarrier<ImageBitmap>();
 * const imgPromise = barrier.acquire('hero', () => fetchImage('hero.png'), { fallback: placeholderImg, block_render: true });
 * const current = barrier.get('hero'); // may return fallback until load resolves
 * ```
 */
export class AssetBarrier<T> {
    private map = new Map<string, Entry<T>>();
    private gate: TaskGate;

    /**
     * Create a new AssetBarrier.
     *
     * @param gate - Optional TaskGate instance to use for blocking/non-blocking scopes.
     *               Defaults to the shared taskGate.
     */
    constructor(gate: TaskGate = taskGate) {
        this.gate = gate;
    }

    /**
     * Acquire or reuse an asset for the given key.
     *
     * If a load is already in-flight for the same key, that Promise is returned.
     * If a fallback is provided, it will be available immediately from get(key)
     * while the returned Promise resolves to the definitive value.
     *
     * @param key - Unique key identifying the asset.
     * @param loader - Loader function that returns a Promise for the asset.
     * @param opts - Optional AcquireOptions controlling fallback, gating and disposal.
     * @returns Promise that resolves to the acquired asset value.
     */
    acquire(key: string, loader: LoaderFn<T>, opts: AcquireOptions<T> = {}): Promise<T> {
        const entry = this.ensureEntry(key, opts);
        if (!entry.promise) {
            const token = this.gate.begin({ blocking: !!opts.block_render, category: entry.category, tag: opts.tag ?? entry.tag });
            const genAtStart = entry.gen;
            const startedAt = performance.now();

            if (opts.warnIfLongerMs && opts.warnIfLongerMs > 0) {
                // simpele leak/langzame-load waarschuwing
                setTimeout(() => {
                    if (this.map.get(key)?.promise && this.map.get(key)?.gen === genAtStart) {
                        console.warn(`[AssetBarrier] Slow load > ${opts.warnIfLongerMs}ms for key="${key}"`);
                    }
                }, opts.warnIfLongerMs);
            }

            entry.promise = loader()
                .then(val => {
                    // generation check: is deze entry nog dezelfde?
                    const current = this.map.get(key);
                    if (!current || current.gen !== genAtStart) {
                        // weggegooid / overschreven → dispose dit resultaat
                        opts.disposer?.(val);
                        console.debug(`[AssetBarrier] Disposed late resolve for key="${key}"`);
                        return current?.value as T; // retourneer huidige waarde voor consistentie
                    }
                    console.debug(`[AssetBarrier] Loaded cached ${key} with value`, val);
                    current.value = val;  // vervang fallback/oud
                    return val;
                })
                .finally(() => {
                    // einde scope voor gate – alleen als de generatie nog klopt
                    const still = this.map.get(key);
                    if (still && still.gen === genAtStart) {
                        still.promise = undefined;
                    }
                    this.gate.end(token);
                    const dt = performance.now() - startedAt;
                    // (optioneel) debug log
                    console.debug(`[AssetBarrier] Loaded ${key} in ${dt.toFixed(1)}ms`);
                });
        } else {
            // al in-flight; niets te doen
        }
        return entry.promise!;
    }

    /**
     * Get the current value (possibly a fallback) for the given key.
     *
     * @param key - The asset key to query.
     * @returns The current value if present, otherwise undefined.
     */
    get(key: string): T | undefined {
        return this.map.get(key)?.value;
    }

    /**
     * Increment the reference count for an existing entry.
     *
     * If the entry does not exist this is a no-op.
     *
     * @param key - The asset key whose reference count should be increased.
     */
    addRef(key: string): void {
        const e = this.map.get(key);
        if (e) e.refCount++;
    }

    /**
     * Release a reference to an asset and dispose/delete the entry when the
     * reference count reaches zero.
     *
     * @param key - The asset key to release.
     * @param disposer - Optional disposer called for the current value when the entry is removed.
     */
    release(key: string, disposer?: Disposer<T>): void {
        const e = this.map.get(key);
        if (!e) return;
        if (--e.refCount <= 0) {
            // Als er nog een late promise terugkomt, negeer die door gen++ (invalidate)
            e.gen++;
            // Dispose huidige waarde
            if (e.value) (disposer ?? (() => { }))(e.value);
            this.map.delete(key);
        }
    }

    /**
     * Invalidate the current entry for a key, disposing the current value if present
     * and clearing any in-flight promise. The entry remains in the map (if present)
     * but its generation is incremented to ignore late resolves.
     *
     * @param key - The asset key to invalidate.
     * @param disposer - Optional disposer called for the current value.
     */
    invalidate(key: string, disposer?: Disposer<T>): void {
        const e = this.map.get(key);
        if (!e) return;
        e.gen++;
        if (e.value) disposer?.(e.value);
        e.value = undefined;
        e.promise = undefined;
    }

    /**
     * Clear all entries from the barrier, disposing any current values and
     * incrementing generation counters to invalidate pending resolves.
     *
     * @param disposer - Optional disposer called for each current value.
     */
    clear(disposer?: Disposer<T>): void {
        for (const [key, e] of this.map) {
            e.gen++;
            if (e.value) disposer?.(e.value);
        }
        this.map.clear();
    }

    /**
     * Take a snapshot of the current internal map for debugging/telemetry.
     *
     * @returns A record keyed by asset key with metadata: ref count, whether a value is present,
     *          whether a load is in-flight, generation, blocking flag, category and optional tag.
     */
    snapshot() {
        const obj: Record<string, { ref: number; hasValue: boolean; loading: boolean; gen: number; blocking: boolean; category: GateCategory; tag?: string }> = {};
        for (const [k, e] of this.map) {
            obj[k] = { ref: e.refCount, hasValue: !!e.value, loading: !!e.promise, gen: e.gen, blocking: e.blocking, category: e.category, tag: e.tag };
        }
        return obj;
    }

    /**
     * Ensure an Entry exists for the given key, creating one if needed, and apply
     * optional metadata overrides (fallback, tag, category, block flag).
     *
     * The returned entry's refCount is incremented for the caller.
     *
     * @param key - The asset key to ensure.
     * @param opts - AcquireOptions that may provide a fallback, tag, category or block flag.
     * @returns The ensured Entry object.
     */
    private ensureEntry(key: string, opts: AcquireOptions<T>): Entry<T> {
        let e = this.map.get(key);
        if (!e) {
            e = {
                refCount: 1,
                value: opts.fallback,
                promise: undefined,
                gen: 1,
                blocking: opts.block_render,
                category: opts.category ?? 'other',
                tag: opts.tag
            };
            this.map.set(key, e);
        } else {
            e.refCount++;
            // upgraden van metadata optioneel
            if (opts.fallback !== undefined && e.value === undefined) e.value = opts.fallback;
            if (opts.tag && !e.tag) e.tag = opts.tag;
        }
        return e;
    }
}
