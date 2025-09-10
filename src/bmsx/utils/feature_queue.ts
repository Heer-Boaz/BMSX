// Generic double-buffered feature queue backed by ScratchBatch for stable capacity
// and no sparse holes. Supports front/back swap per frame.

import { ScratchBatch } from './scratchbatch';

export class FeatureQueue<T> {
    private _front: ScratchBatch<T>;
    private _back: ScratchBatch<T>;
    private _backCapacity: number;

    constructor(initialCapacity = 128) {
        this._front = new ScratchBatch<T>(initialCapacity);
        this._back = new ScratchBatch<T>(initialCapacity);
        this._backCapacity = initialCapacity;
    }

    // Reserve capacity by recreating the back buffer with at least the requested capacity.
    // Front capacity will be adjusted on next swap.
    reserve(minCapacity: number): void {
        if (minCapacity <= 0) return;
        // If current internal array is smaller, replace with a new ScratchBatch
        if (minCapacity > this._backCapacity) { this._back = new ScratchBatch<T>(minCapacity); this._backCapacity = minCapacity; }
    }

    submit(item: T): void { this._back.push(item); }
    sizeBack(): number { return this._back.size; }
    sizeFront(): number { return this._front.size; }

    swap(): void {
        const tmp = this._front; this._front = this._back; this._back = tmp;
        this._back.clear(); // reset active window for next frame submissions
    }

    forEachFront(fn: (item: T, index: number) => void): void { this._front.forEach(fn); }
    sortFront(compare: (a: T, b: T) => number): void { this._front.sort(compare); }

    // Debug-only: return counts without exposing internal storage
    debugCounts(): { front: number; back: number } { return { front: this._front.size, back: this._back.size }; }
}
