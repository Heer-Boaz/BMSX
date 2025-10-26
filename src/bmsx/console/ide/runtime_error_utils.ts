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
	if (line.length === 0) {
		return [''];
	}
	const segments: string[] = [];
	let current = '';
	for (let index = 0; index < line.length; index += 1) {
		const ch = line.charAt(index);
		const candidate = current + ch;
		const candidateWidth = measureText(candidate);
		if (current.length > 0 && candidateWidth > maxWidth) {
			segments.push(current);
			current = ch;
			if (measureText(current) > maxWidth) {
				segments.push(current);
				current = '';
			}
			continue;
		}
		if (current.length === 0 && candidateWidth > maxWidth) {
			segments.push(ch);
			current = '';
			continue;
		}
		current = candidate;
	}
	if (current.length > 0) {
		segments.push(current);
	}
	if (segments.length === 0) {
		segments.push('');
	}
	return segments;
}
