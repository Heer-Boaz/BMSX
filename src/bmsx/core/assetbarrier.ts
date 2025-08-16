import { GateCategory, mainRenderGate, RenderGate } from '../render/rendergate';

type LoaderFn<T> = () => Promise<T>;
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
 * Generieke barrier die per key dedupliceert, refcount, fallback ondersteunt
 * en late resolves veilig negeert via een generation-token.
 */
export class AssetBarrier<T> {
    private map = new Map<string, Entry<T>>();
    private gate: RenderGate;

    constructor(gate: RenderGate = mainRenderGate) {
        this.gate = gate;
    }

    /**
     * Vraag (of hergebruik) asset aan.
     * - Non-blocking: levert meteen een renderbare `value` (fallback of vorige) terug via `get()`;
     *   de Promise lost later op voor de definitieve waarde.
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
     * Haal huidige renderbare waarde (kan fallback zijn) zonder te wachten.
     */
    get(key: string): T | undefined {
        return this.map.get(key)?.value;
    }

    /**
     * Refcount +1 zonder opnieuw te laden (bijv. wanneer je een handle deelt).
     */
    addRef(key: string): void {
        const e = this.map.get(key);
        if (e) e.refCount++;
    }

    /**
     * Release; roept disposer als refcount 0 bereikt.
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
     * Invalideer en ververs entry (verhoog gen) zonder refcount te wijzigen.
     * Handig bij asset-wissel waarbij late resolves niet mogen binnenkomen.
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
     * Wis alle entries; dispose waarden; negeer late resolves via gen++.
     */
    clear(disposer?: Disposer<T>): void {
        for (const [key, e] of this.map) {
            e.gen++;
            if (e.value) disposer?.(e.value);
        }
        this.map.clear();
    }

    /**
     * Voor debugging/telemetrie.
     */
    snapshot() {
        const obj: Record<string, { ref: number; hasValue: boolean; loading: boolean; gen: number; blocking: boolean; category: GateCategory; tag?: string }> = {};
        for (const [k, e] of this.map) {
            obj[k] = { ref: e.refCount, hasValue: !!e.value, loading: !!e.promise, gen: e.gen, blocking: e.blocking, category: e.category, tag: e.tag };
        }
        return obj;
    }

    // — intern —
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
