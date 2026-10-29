import { CST, Parser } from 'yaml';
import type { TextBuffer } from '../../editor/text/text_buffer';
import type { TrackedTextRange } from '../../editor/text/text_change';

/** The CST distinguishes surviving authored key text from newly inserted edge trivia. */
export function yamlKeyTokenRetainsRange(buffer: TextBuffer, range: Readonly<TrackedTextRange>, start: number, end: number): boolean {
	for (const document of new Parser().parse(buffer.getTextRange(start, end) + ': null')) {
		if (document.type !== 'document' || document.value?.type !== 'block-map') continue;
		for (const item of document.value.items) if (CST.isScalar(item.key)) {
			return start + item.key.offset === range.start && start + item.key.offset + item.key.source.length === range.end;
		}
	}
	return false;
}
