import type { TextBuffer } from './text_buffer';

export const NEWLINE = '\n';

export function textFromLines(lines: readonly string[]): string {
	return lines.join(NEWLINE);
}

export function splitText(text: string): string[] {
	return text.split(NEWLINE);
}

let cachedBuffer: TextBuffer | null = null;
let cachedVersion = -1;
let cachedSource = '';

export function getTextSnapshot(buffer: TextBuffer): string {
	if (cachedBuffer === buffer && cachedVersion === buffer.version) {
		return cachedSource;
	}
	cachedBuffer = buffer;
	cachedVersion = buffer.version;
	cachedSource = buffer.getText();
	return cachedSource;
}
