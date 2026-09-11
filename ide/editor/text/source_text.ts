import type { TextBuffer } from './text_buffer';
import { hashText } from '../../../machine/ts/common/byte_hex_string';

/** Non-cryptographic content fingerprint for source-dependent view mementos. */
export type TextSnapshotFingerprint = { readonly length: number; readonly hash: number };

type TextSnapshotCacheEntry = {
	v: number;
	s: string | null;
	lines: readonly string[] | null;
	fingerprint?: TextSnapshotFingerprint;
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
		cached.fingerprint = undefined;
		return cached;
	} else {
		const entry: TextSnapshotCacheEntry = { v, s: null, lines: null };
		textSnapshotCache.set(buffer, entry);
		return entry;
	}
}

/** Computed once per buffer version, shared by every view of the working copy. */
export function getTextSnapshotFingerprint(buffer: TextBuffer): TextSnapshotFingerprint {
	const entry = getSnapshotCacheEntry(buffer);
	if (entry.fingerprint === undefined) {
		const text = getTextSnapshot(buffer);
		entry.fingerprint = { length: text.length, hash: hashText(text) };
	}
	return entry.fingerprint;
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
