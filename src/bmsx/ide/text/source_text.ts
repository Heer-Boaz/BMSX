import type { TextBuffer } from './text_buffer';

export const NEWLINE = '\n';

export function textFromLines(lines: string[]): string {
	return lines.join(NEWLINE);
}

export function splitText(text: string): string[] {
	return text.split(NEWLINE);
}

type TextSnapshotCacheEntry = { v: number; s: string };
const textSnapshotCache = new WeakMap<TextBuffer, TextSnapshotCacheEntry>();

export function getTextSnapshot(buffer: TextBuffer): string {
	const v = buffer.version;
	const cached = textSnapshotCache.get(buffer);
	if (cached && cached.v === v) {
		return cached.s;
	}
	const s = buffer.getText();
	if (cached) {
		cached.v = v;
		cached.s = s;
	} else {
		textSnapshotCache.set(buffer, { v, s });
	}
	return s;
}
