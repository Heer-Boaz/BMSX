import { ERROR_OVERLAY_CONNECTOR_OFFSET, ERROR_OVERLAY_PADDING_X } from './constants';

export function computeRuntimeErrorOverlayMaxWidth(
	viewportWidth: number,
	charAdvance: number,
	gutterWidth: number,
): number {
	const horizontalMargin = gutterWidth + ERROR_OVERLAY_CONNECTOR_OFFSET + ERROR_OVERLAY_PADDING_X * 2 + 2;
	const available = viewportWidth - horizontalMargin;
	if (available <= charAdvance) {
		return charAdvance;
	}
	return available;
}

export function buildRuntimeErrorLines(
	message: string,
	maxWidth: number,
	measureText: (text: string) => number,
): string[] {
	const sanitized = message.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const rawLines = sanitized.split('\n');
	const result: string[] = [];
	for (let i = 0; i < rawLines.length; i += 1) {
		const segments = wrapRuntimeErrorLine(rawLines[i], maxWidth, measureText);
		if (segments.length === 0) {
			result.push('');
			continue;
		}
		for (let s = 0; s < segments.length; s += 1) {
			result.push(segments[s]);
		}
	}
	if (result.length === 0) {
		result.push('');
	}
	return result;
}

export function wrapRuntimeErrorLine(line: string, maxWidth: number, measureText: (text: string) => number): string[] {
	if (line.length === 0) return [''];
	const segments: string[] = [];
	let segmentStart = 0;
	let lastBreak = -1;
	for (let index = 0; index < line.length; index += 1) {
		const ch = line.charAt(index);
		if (ch === ' ' || ch === '\t') {
			lastBreak = index;
		}
		const candidateWidth = measureText(line.slice(segmentStart, index + 1));
		if (candidateWidth <= maxWidth) {
			continue;
		}
		if (lastBreak >= segmentStart) {
			segments.push(line.slice(segmentStart, lastBreak));
			segmentStart = lastBreak + 1;
			lastBreak = -1;
			index = segmentStart - 1;
			continue;
		}
		if (index === segmentStart) {
			segments.push(line.charAt(index));
			segmentStart = index + 1;
		} else {
			segments.push(line.slice(segmentStart, index));
			segmentStart = index;
		}
		lastBreak = -1;
	}
	if (segmentStart < line.length) {
		segments.push(line.slice(segmentStart));
	}
	return segments.length > 0 ? segments : [''];
}
