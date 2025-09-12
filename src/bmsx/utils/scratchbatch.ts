// Lightweight, reusable scratch collections for per-frame batching.
//
// Goals:
// - Avoid per-frame allocations by retaining backing storage.
// - Offer a simple, consistent API across systems.
// - Optional pooling for item reuse via Pool<T>.
// - Excluded from savegame serialization.

import { excludeclassfromsavegame } from 'bmsx/serializer/serializationhooks';
import type { Pool } from './pool';

@excludeclassfromsavegame
export class ScratchBatch<T> implements Iterable<T> {
    private items: T[] = [];
    private _size = 0;

    constructor(initialCapacity = 0) {
        if (initialCapacity > 0) this.items.length = initialCapacity;
    }

    get size(): number { return this._size; }

    // For convenience when migrating legacy arrays (read-only length)
    get length(): number { return this._size; }

    clear(): void { this._size = 0; }

    push(v: T): void { this.items[this._size++] = v; }

    get(index: number): T { return this.items[index]; }

    forEach(cb: (item: T, index: number) => void): void {
        for (let i = 0; i < this._size; i++) cb(this.items[i], i);
    }

    // Sort only the active window; avoids copying.
    sort(compareFn: (a: T, b: T) => number): void {
        const prevLen = this.items.length;
        this.items.length = this._size;
        this.items.sort(compareFn);
        this.items.length = prevLen;
    }

    [Symbol.iterator](): Iterator<T> {
        let i = 0;
        const n = this._size;
        const arr = this.items;
        return {
            next(): IteratorResult<T> {
                if (i < n) return { value: arr[i++], done: false };
                return { value: undefined as T, done: true };
            },
        };
    }
}

// Optional pooled variant: acquires item slots from a Pool<T> to avoid per-frame object creation.
@excludeclassfromsavegame
export class ScratchBatchPooled<T> implements Iterable<T> {
    private list = new ScratchBatch<T>();

    constructor(private pool: Pool<T>) { }

    get size(): number { return this.list.size; }
    get length(): number { return this.list.length; }

    // Acquire a slot from the pool and include it in the active window.
    next(): T {
        const slot = this.pool.acquire();
        if (!slot) throw new Error('ScratchBatchPooled: pool exhausted');
        this.list.push(slot);
        return slot;
    }

    get(index: number): T { return this.list.get(index); }

    clear(): void {
        // Release all active items back to the pool (idempotent per item as Pool.release is safe).
        for (const item of this.list) this.pool.release(item);
        this.list.clear();
    }

    forEach(cb: (item: T, index: number) => void): void { this.list.forEach(cb); }
    sort(compareFn: (a: T, b: T) => number): void { this.list.sort(compareFn); }
    [Symbol.iterator](): Iterator<T> { return this.list[Symbol.iterator](); }
}
