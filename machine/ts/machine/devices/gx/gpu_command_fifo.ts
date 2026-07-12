export const GX_GPU_COMMAND_FIFO_WORD_CAPACITY = 16;
export const GX_GPU_COMMAND_FIFO_STORAGE_WORD_CAPACITY = 32;

export class GxGpuCommandFifo {
	private readonly words = new Uint32Array(GX_GPU_COMMAND_FIFO_STORAGE_WORD_CAPACITY);
	private readIndex = 0;
	private wordCount = 0;

	public count(): number {
		return this.wordCount;
	}

	public empty(): boolean {
		return this.wordCount === 0;
	}

	public reset(): void {
		this.readIndex = 0;
		this.wordCount = 0;
	}

	public push(word: number): void {
		this.words[(this.readIndex + this.wordCount) & (GX_GPU_COMMAND_FIFO_STORAGE_WORD_CAPACITY - 1)] = word;
		this.wordCount += 1;
	}

	public peek(index = 0): number {
		return this.words[(this.readIndex + index) & (GX_GPU_COMMAND_FIFO_STORAGE_WORD_CAPACITY - 1)]!;
	}

	public pop(): number {
		const word = this.words[this.readIndex]!;
		this.readIndex = (this.readIndex + 1) & (GX_GPU_COMMAND_FIFO_STORAGE_WORD_CAPACITY - 1);
		this.wordCount -= 1;
		return word;
	}
}
