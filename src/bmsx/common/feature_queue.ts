
import { ScratchBatch } from './scratchbatch';

// Generic double-buffered feature queue backed by ScratchBatch for stable capacity
// and no sparse holes. Supports front/back swap per frame.
export class FeatureQueue<T> {
	private _front: ScratchBatch<T>;
	private _back: ScratchBatch<T>;

	constructor(initialCapacity = 128) {
		this._front = new ScratchBatch<T>(initialCapacity);
		this._back = new ScratchBatch<T>(initialCapacity);
	}

	sizeBack(): number { return this._back.size; }
	sizeFront(): number { return this._front.size; }

	swap(): void {
		const tmp = this._front; this._front = this._back; this._back = tmp;
		this._back.clear(); // reset active window for next frame submissions
	}

	forEachFront(fn: (item: T, index: number) => void): void { this._front.forEach(fn); }
	forEachBack(fn: (item: T, index: number) => void): void { this._back.forEach(fn); }
	clearBack(): void { this._back.clear(); }
	clearAll(): void {
		this._front.clear();
		this._back.clear();
	}
}
