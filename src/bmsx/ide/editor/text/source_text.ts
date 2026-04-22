import type { TextBuffer } from './text_buffer';

type TextSnapshotCacheEntry = {
	v: number;
	s: string | null;
	lines: readonly string[] | null;
};

const textSnapshotCache = new WeakMap<TextBuffer, TextSnapshotCacheEntry>();

function getSnapshotCacheEntry(buffer: TextBuffer): TextSnapshotCacheEntry {
	const v = buffer.version;
	const cached = textSnapshotCache.get(buffer);
	if (cached && cached.v === v) {
		return cached;
	}
	if (cached) {
		cached.v = v;
		cached.s = null;
		cached.lines = null;
		return cached;
	} else {
		const entry: TextSnapshotCacheEntry = { v, s: null, lines: null };
		textSnapshotCache.set(buffer, entry);
		return entry;
	}
}

export function getTextSnapshot(buffer: TextBuffer): string {
	const entry = getSnapshotCacheEntry(buffer);
	if (entry.s === null) {
		entry.s = buffer.getText();
	}
	return entry.s;
}

export function getLinesSnapshot(buffer: TextBuffer): readonly string[] {
	const entry = getSnapshotCacheEntry(buffer);
	if (entry.lines === null) {
		const lineCount = buffer.getLineCount();
		const lines = new Array<string>(lineCount);
		for (let index = 0; index < lineCount; index += 1) {
			lines[index] = buffer.getLineContent(index);
		}
		entry.lines = lines;
	}
	return entry.lines;
}
