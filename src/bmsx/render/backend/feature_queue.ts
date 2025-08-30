// Generic double-buffered feature queue with reserve/growth

export class FeatureQueue<T> {
    private _front: T[] = [];
    private _back: T[] = [];

    constructor(initialCapacity = 128) {
        // Avoid pre-filling with undefined holes; just create empty arrays.
        // JS arrays grow dynamically; if a reserve is desired later we can use a typed buffer pool.
        this._front = [];
        this._back = [];
    }

    submit(item: T): void { this._back.push(item); }
    sizeBack(): number { return this._back.length; }
    sizeFront(): number { return this._front.length; }

    swap(): void {
        const tmp = this._front; this._front = this._back; this._back = tmp;
        this._back.length = 0; // clear for next frame submissions
    }

    forEachFront(fn: (item: T, index: number) => void): void {
        const f = this._front;
        for (let i = 0; i < f.length; i++) fn(f[i], i);
    }

    frontArray(): T[] { return this._front; }
}
