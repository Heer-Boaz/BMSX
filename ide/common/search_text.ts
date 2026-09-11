/** Search representation and its mapping back to original UTF-16 text offsets. */
export class CaseFoldedText {
	public readonly lower: string;
	private readonly sourceOffsets: number[] | undefined;

	public constructor(text: string) {
		this.lower = text.toLowerCase();
		if (this.lower.length !== text.length) {
			const offsets: number[] = [];
			for (let index = 0; index < text.length; index += 1) {
				const length = text[index].toLowerCase().length;
				for (let unit = 0; unit < length; unit += 1) offsets.push(index);
			}
			this.sourceOffsets = offsets;
		}
	}

	public sourceStart(offset: number): number { return this.sourceOffsets === undefined ? offset : this.sourceOffsets[offset]; }
	public sourceEnd(offset: number): number { return this.sourceOffsets === undefined ? offset : this.sourceOffsets[offset - 1] + 1; }
}
