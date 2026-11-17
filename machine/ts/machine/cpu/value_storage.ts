// Dense slot backing. The value owner supplies tags and raw 32-bit payloads;
// storage never infers numeric types or interprets object references.
export const VALUE_STORAGE_SLOT_BYTES = Uint32Array.BYTES_PER_ELEMENT + Uint8Array.BYTES_PER_ELEMENT;

const emptyBuffer = new ArrayBuffer(0);
const emptyWords = new Uint32Array(emptyBuffer);
const emptyFloats = new Float32Array(emptyBuffer);
const emptyTags = new Uint8Array(emptyBuffer);

export class ValueStorage {
	// Integer reads use words[index] | 0; no extra Int32Array view is needed.
	public words: Uint32Array = emptyWords;
	public floats: Float32Array = emptyFloats;
	public tags: Uint8Array = emptyTags;

	constructor(capacity = 0) {
		this.resize(capacity);
	}

	public get capacity(): number { return this.words.length; }
	public get byteLength(): number { return this.words.buffer.byteLength; }

	// Only resize creates buffers/views. Consumers rebind borrowed planes after
	// growth; copying and clearing existing slots allocate no views or values.
	public resize(capacity: number): void {
		if (capacity === this.capacity) return;
		if (capacity === 0) {
			this.words = emptyWords;
			this.floats = emptyFloats;
			this.tags = emptyTags;
			return;
		}
		const buffer = new ArrayBuffer(capacity * VALUE_STORAGE_SLOT_BYTES);
		const words = new Uint32Array(buffer, 0, capacity);
		const tags = new Uint8Array(buffer, capacity * Uint32Array.BYTES_PER_ELEMENT, capacity);
		const retained = Math.min(this.capacity, capacity);
		for (let i = 0; i < retained; ++i) {
			words[i] = this.words[i];
			tags[i] = this.tags[i];
		}
		this.words = words;
		this.floats = new Float32Array(buffer, 0, capacity);
		this.tags = tags;
	}

	public clear(first: number, count: number): void {
		this.words.fill(0, first, first + count);
		this.tags.fill(0, first, first + count);
	}

	public copyWithin(destination: number, source: number, count: number): void {
		this.words.copyWithin(destination, source, source + count);
		this.tags.copyWithin(destination, source, source + count);
	}

	// Inter-owner copies use disjoint allocations; overlap uses copyWithin.
	public copyFrom(source: ValueStorage, destination: number, first: number, count: number): void {
		for (let i = 0; i < count; ++i) {
			this.words[destination + i] = source.words[first + i];
			this.tags[destination + i] = source.tags[first + i];
		}
	}
}
