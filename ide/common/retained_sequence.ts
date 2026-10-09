/** Fixed-capacity insertion-ordered storage without overflow copies. */
export class RetainedSequence<T> {
	private readonly entries: T[] = [];
	private startIndex = 0;
	private dropped = 0;

	public constructor(private readonly capacity: number) {}

	public get length(): number {
		return this.entries.length;
	}

	public get droppedCount(): number { return this.dropped; }

	public at(index: number): T {
		return this.entries[(this.startIndex + index) % this.entries.length];
	}

	public push(value: T): void {
		if (this.entries.length < this.capacity) {
			this.entries.push(value);
			return;
		}
		this.entries[this.startIndex] = value;
		this.startIndex = (this.startIndex + 1) % this.capacity;
		this.dropped++;
	}
}
