export class ImgDecWordFifo {
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

	public reset(): void {
		this.readIndex = 0;
		this.wordCount = 0;
	}

	public writeWord(word: number): void {
		this.words[(this.readIndex + this.wordCount) & this.indexMask] = word >>> 0;
		this.wordCount += 1;
	}

	public writeBusWord(word: number): void {
		if (this.wordCount === this.capacity) {
			return;
		}
		this.writeWord(word);
	}

	public pop(): number {
		const word = this.words[this.readIndex]!;
		this.readIndex = (this.readIndex + 1) & this.indexMask;
		this.wordCount -= 1;
		return word;
	}

	public captureWords(): number[] {
		const words = new Array<number>(this.wordCount);
		for (let index = 0; index < this.wordCount; index += 1) {
			words[index] = this.words[(this.readIndex + index) & this.indexMask]!;
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
