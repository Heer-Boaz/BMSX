import * as constants from './constants';
import type { ConsoleLuaHoverResult } from '../types';

function truncateLine(text: string): string {
	if (text.length <= constants.HOVER_TOOLTIP_MAX_LINE_LENGTH) return text;
	return text.slice(0, constants.HOVER_TOOLTIP_MAX_LINE_LENGTH - 3) + '...';
}

export function buildHoverContentLines(result: ConsoleLuaHoverResult): string[] {
	const lines: string[] = [];
	const push = (value: string) => { lines.push(truncateLine(value)); };
	if (result.state === 'not_defined') {
		push(`${result.expression} = not defined`);
		return lines;
	}
	const valueLines = result.lines.length > 0 ? result.lines : [''];
	if (valueLines.length === 1) {
		const suffix = result.valueType && result.valueType !== 'unknown' ? ` (${result.valueType})` : '';
		push(`${result.expression} = ${valueLines[0]}${suffix}`);
		return lines;
	}
	const suffix = result.valueType && result.valueType !== 'unknown' ? ` (${result.valueType})` : '';
	push(`${result.expression}${suffix}`);
	for (const line of valueLines) push(`  ${line}`);
	return lines;
}
