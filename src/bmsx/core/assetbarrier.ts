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
}

export interface AcquireOptions<T> {
    fallback?: T;
    block_render?: boolean;
    category?: GateCategory;
    tag?: string;
    disposer?: Disposer<T>;
    warnIfLongerMs?: number;
}

export class AssetBarrier<T> {
    private map = new Map<string, Entry<T>>();

    constructor(private readonly group: GateGroup) { }

    acquire(key: string, loader: LoaderFn<T>, opts: AcquireOptions<T> = {}): Promise<T> {
        const entry = this.ensureEntry(key, opts);
        if (!entry.promise) {
            const genAtStart = entry.gen;

            if (opts.warnIfLongerMs && opts.warnIfLongerMs > 0) {
                setTimeout(() => {
                    const m = this.map.get(key);
                    if (m?.promise && m.gen === genAtStart) {
                        console.warn(`[AssetBarrier] Slow load > ${opts.warnIfLongerMs}ms for key="${key}"`);
                    }
                }, opts.warnIfLongerMs);
            }

            entry.promise = this.group
                .track(
                    loader().then(val => {
                        const current = this.map.get(key);
                        if (!current || current.gen !== genAtStart) {
                            opts.disposer?.(val); // late resolve → weggooien
                            return current?.value as T;
                        }
                        current.value = val;
                        return val;
                    }),
                    { blocking: !!opts.block_render, category: entry.category, tag: opts.tag ?? entry.tag }
                )
                .finally(() => {
                    const still = this.map.get(key);
                    if (still && still.gen === genAtStart) still.promise = undefined;
                });
        }
        return entry.promise!;
    }

    get(key: string): T | undefined { return this.map.get(key)?.value; }
    addRef(key: string): void { const e = this.map.get(key); if (e) e.refCount++; }

    release(key: string, disposer?: Disposer<T>): void {
        const e = this.map.get(key);
        if (!e) return;
        if (--e.refCount <= 0) {
            e.gen++;
            if (e.value) (disposer ?? (() => { }))(e.value);
            this.map.delete(key);
        }
    }

    invalidate(key: string, disposer?: Disposer<T>): void {
        const e = this.map.get(key); if (!e) return;
        e.gen++; if (e.value) disposer?.(e.value);
        e.value = undefined; e.promise = undefined;
    }

    clear(disposer?: Disposer<T>): void {
        for (const [_k, e] of this.map) { e.gen++; if (e.value) disposer?.(e.value); }
        this.map.clear();
    }

    snapshot() {
        const obj: Record<string, { ref: number; hasValue: boolean; loading: boolean; gen: number; blocking: boolean; category: GateCategory; tag?: string }> = {};
        for (const [k, e] of this.map) {
            obj[k] = { ref: e.refCount, hasValue: !!e.value, loading: !!e.promise, gen: e.gen, blocking: e.blocking, category: e.category, tag: e.tag };
        }
        return obj;
    }

    private ensureEntry(key: string, opts: AcquireOptions<T>): Entry<T> {
        let e = this.map.get(key);
        if (!e) {
            e = {
                refCount: 1, value: opts.fallback, promise: undefined, gen: 1,
                blocking: opts.block_render ?? false, category: opts.category ?? 'other', tag: opts.tag
            };
            this.map.set(key, e);
        } else {
            e.refCount++;
            if (opts.fallback !== undefined && e.value === undefined) e.value = opts.fallback;
            if (opts.tag && !e.tag) e.tag = opts.tag;
        }
        return e;
    }
}
