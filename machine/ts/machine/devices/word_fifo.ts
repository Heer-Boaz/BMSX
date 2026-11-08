export class WordFifo {
	private readonly words: Uint32Array;
	private readonly indexMask: number;
	private readIndex = 0;
	private wordCount = 0;

	public constructor(public readonly capacity: number) {
		this.words = new Uint32Array(capacity);
		this.indexMask = capacity - 1;
	}

	public count(): number {
		return this.wordCount;
	}

	public free(): number {
		return this.capacity - this.wordCount;
	}

	public empty(): boolean {
		return this.wordCount === 0;
	}

	public full(): boolean {
		return this.wordCount === this.capacity;
	}

	public reset(): void {
		this.readIndex = 0;
		this.wordCount = 0;
	}

	public writeWord(word: number): void {
		this.words[(this.readIndex + this.wordCount) & this.indexMask] = word >>> 0;
		this.wordCount += 1;
	}

	/** count words fit the available target space. */
	public writeWords(source: Uint32Array, offset: number, count: number): void {
		const writeIndex = this.readIndex + this.wordCount, words = this.words, mask = this.indexMask;
		for (let i = 0; i < count; ++i) words[(writeIndex + i) & mask] = source[offset + i];
		this.wordCount += count;
	}

	public peek(index = 0): number {
		return this.words[(this.readIndex + index) & this.indexMask]!;
	}

	public pop(): number {
		const word = this.words[this.readIndex]!;
		this.readIndex = (this.readIndex + 1) & this.indexMask;
		this.wordCount -= 1;
		return word;
	}

	/** count words are available; target has room for the complete range. */
	public readWords(target: Uint32Array, offset: number, count: number): void {
		const words = this.words, readIndex = this.readIndex, mask = this.indexMask;
		for (let index = 0; index < count; index += 1) {
			target[offset + index] = words[(readIndex + index) & mask];
		}
		this.readIndex = (readIndex + count) & mask;
		this.wordCount -= count;
	}

	/** Distinct FIFOs; count fits the available source words and target space. */
	public transferWords(target: WordFifo, count: number): void {
		const words = this.words, readIndex = this.readIndex, mask = this.indexMask;
		const targetWords = target.words, targetMask = target.indexMask;
		const writeIndex = target.readIndex + target.wordCount;
		for (let index = 0; index < count; index += 1) {
			targetWords[(writeIndex + index) & targetMask] = words[(readIndex + index) & mask];
		}
		this.readIndex = (readIndex + count) & mask;
		this.wordCount -= count;
		target.wordCount += count;
	}

	public captureWords(): number[] {
		const words = new Array<number>(this.wordCount);
		for (let index = 0; index < this.wordCount; index += 1) {
			words[index] = this.peek(index);
		}
		return words;
	}

	public restoreWords(words: ReadonlyArray<number>): void {
		this.reset();
		for (let index = 0; index < words.length; index += 1) {
			this.writeWord(words[index]!);
		}
	}
}
