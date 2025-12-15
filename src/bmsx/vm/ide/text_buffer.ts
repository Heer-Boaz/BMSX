export type MutableTextPosition = {
	row: number;
	column: number;
};

export interface TextBuffer {
	readonly version: number;
	readonly length: number;

	insert(offset: number, text: string): void;
	delete(offset: number, length: number): void;
	replace(offset: number, length: number, text: string): void;

	getLineCount(): number;
	getLineStartOffset(row: number): number;
	getLineEndOffset(row: number): number;
	getLineContent(row: number): string;

	offsetAt(row: number, column: number): number;
	positionAt(offset: number, out: MutableTextPosition): void;

	getTextRange(start: number, end: number): string;
	getText(): string;
}

