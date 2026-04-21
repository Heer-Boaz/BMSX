import { ScratchBuffer } from './scratchbuffer';

export class ScratchArrayStack<T> {
	private readonly scratch = new ScratchBuffer<T[]>(() => []);
	private index = 0;

	acquire(): T[] {
		const values = this.scratch.get(this.index);
		this.index += 1;
		values.length = 0;
		return values;
	}

	release(values: T[]): void {
		values.length = 0;
		this.index -= 1;
	}
}

export class ScratchMapStack<K, V> {
	private readonly scratch = new ScratchBuffer<Map<K, V>>(() => new Map<K, V>());
	private index = 0;

	acquire(): Map<K, V> {
		const values = this.scratch.get(this.index);
		this.index += 1;
		values.clear();
		return values;
	}

	release(values: Map<K, V>): void {
		values.clear();
		this.index -= 1;
	}
}
