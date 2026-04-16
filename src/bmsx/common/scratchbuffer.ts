// Reusable scratch buffer for mutable record slots.
//
// Use this when a hot path needs a stable backing store and wants to mutate
// a small active window in place without allocating fresh objects.
export class ScratchBuffer<T> implements Iterable<T> {
	private items: T[] = [];
	private _size = 0;

	constructor(private readonly createItem: () => T, initialCapacity = 0) {
		this.reserve(initialCapacity);
	}

	get size(): number {
		return this._size;
	}

	get length(): number {
		return this._size;
	}

	clear(): void {
		this._size = 0;
	}

	reserve(capacity: number): void {
		while (this.items.length < capacity) {
			this.items.push(this.createItem());
		}
	}

	get(index: number): T {
		if (index >= this.items.length) {
			this.reserve(index + 1);
		}
		if (index >= this._size) {
			this._size = index + 1;
		}
		return this.items[index];
	}

	peek(index: number): T {
		return this.items[index];
	}

	set(index: number, value: T): void {
		if (index >= this.items.length) {
			this.reserve(index + 1);
		}
		this.items[index] = value;
		if (index >= this._size) {
			this._size = index + 1;
		}
	}

	push(value: T): void {
		if (this._size >= this.items.length) {
			this.items.push(value);
		} else {
			this.items[this._size] = value;
		}
		this._size += 1;
	}

	replaceInto(target: T[], startIndex: number, deleteCount: number): void {
		const insertCount = this._size;
		const oldLength = target.length;
		const shift = insertCount - deleteCount;
		const newLength = oldLength + shift;
		if (shift > 0) {
			target.length = newLength;
			for (let index = oldLength; index-- > startIndex + deleteCount; ) {
				target[index + shift] = target[index];
			}
		} else if (shift < 0) {
			for (let index = startIndex + deleteCount; index < oldLength; index += 1) {
				target[index + shift] = target[index];
			}
			target.length = newLength;
		}
		for (let index = 0; index < insertCount; index += 1) {
			target[startIndex + index] = this.items[index];
		}
	}

	[Symbol.iterator](): Iterator<T> {
		let index = 0;
		const size = this._size;
		const items = this.items;
		return {
			next(): IteratorResult<T> {
				if (index < size) {
					return { value: items[index++], done: false };
				}
				return { value: undefined as T, done: true };
			},
		};
	}
}
