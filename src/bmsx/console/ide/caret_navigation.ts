import { clamp } from 'bmsx/utils/clamp';
import type { VisualLineSegment } from './types';

export type VisualCursorOverride = {
	row: number;
	column: number;
	visualIndex: number;
	segmentStartColumn: number;
};

export class CaretNavigationState {
	private override: VisualCursorOverride | null = null;

	public clear(): void {
		this.override = null;
	}

	public capture(row: number, column: number, visualIndex: number, segmentStartColumn: number): void {
		this.override = {
			row,
			column,
			visualIndex,
			segmentStartColumn,
		};
	}

	public peek(row: number, column: number): { visualIndex: number; segmentStartColumn: number } | null {
		const current = this.override;
		if (!current) {
			return null;
		}
		if (current.row !== row || current.column !== column) {
			return null;
		}
		return {
			visualIndex: current.visualIndex,
			segmentStartColumn: current.segmentStartColumn,
		};
	}
}

export function resolveIndentAwareHome(line: string, segment: VisualLineSegment, currentColumn: number): number {
	const lineLength = line.length;
	const segmentStart = clamp(segment.startColumn, 0, lineLength);
	const segmentEnd = clamp(Math.max(segment.endColumn, segmentStart), segmentStart, lineLength);
	const preferred = findFirstNonWhitespace(line, segmentStart, segmentEnd);
	const targetColumn = currentColumn === preferred ? segmentStart : preferred;
	return clamp(targetColumn, segmentStart, lineLength);
}

export function resolveSegmentEnd(line: string, segment: VisualLineSegment): number {
	const lineLength = line.length;
	const segmentStart = clamp(segment.startColumn, 0, lineLength);
	const segmentEnd = clamp(Math.max(segment.endColumn, segmentStart), segmentStart, lineLength);
	return segmentEnd;
}

export function findFirstNonWhitespace(line: string, startColumn: number, endColumn: number): number {
	for (let column = startColumn; column < endColumn; column += 1) {
		const ch = line.charAt(column);
		if (ch !== ' ' && ch !== '\t') {
			return column;
		}
	}
	return endColumn;
}
