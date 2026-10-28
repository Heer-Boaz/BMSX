import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import { clamp } from '../../../../machine/ts/common/clamp';
import { SCROLLBAR_WIDTH, TAB_SPACES } from '../../../common/constants';
import { expandTabs, forEachWrappedMeasuredRange } from '../../../common/text';
import type { EditorFont } from '../../../editor/ui/view/font';

export const TEXT_VIEW_PADDING = 4;

/** Read diagnostics as short source lines, not stacks of wrapped word fragments. */
export function measureWorkbenchTextViewMinimumWidth(font: EditorFont): number { return font.charAdvance * 48 + SCROLLBAR_WIDTH + TEXT_VIEW_PADDING * 2; }

export type WorkbenchTextViewLine = {
	start: number;
	end: number;
	breakEnd: number;
	display: string;
	readonly sourceToDisplay: number[];
	readonly displayToSource: number[];
	readonly advances: number[];
	firstRow: number;
	lastRow: number;
};

export type WorkbenchTextViewRow = {
	line: WorkbenchTextViewLine;
	start: number;
	end: number;
	sourceStart: number;
	sourceEnd: number;
	/** A wrap may start inside the visual cells of one original tab. */
	bias: number;
};

/** The plain-text producer owns glyph mappings, including non-source tab cells and CRLF breaks. */
export class WorkbenchTextViewLayout {
	public readonly rows: WorkbenchTextViewRow[] = [];
	public readonly lines: WorkbenchTextViewLine[] = [];
	private readonly lineSlots = new ScratchBuffer<WorkbenchTextViewLine>(() => ({ start: 0, end: 0, breakEnd: 0,
		display: '', sourceToDisplay: [], displayToSource: [], advances: [], firstRow: 0, lastRow: 0 }));
	private readonly rowSlots = new ScratchBuffer<WorkbenchTextViewRow>(() => ({ line: null!, start: 0, end: 0, sourceStart: 0, sourceEnd: 0, bias: 0 }));
	private source = '';
	private sourceChanged = true;
	private font: EditorFont | undefined;
	private width = -1;
	private wrappingLine!: WorkbenchTextViewLine;
	private readonly measure = (_text: string, start: number, end: number) => this.wrappingLine.advances[end] - this.wrappingLine.advances[start];
	private readonly emit = (start: number, end: number) => {
		const line = this.wrappingLine, row = this.rowSlots.get(this.rows.length);
		row.line = line; row.start = start; row.end = end;
		row.sourceStart = line.displayToSource[start]; row.sourceEnd = line.displayToSource[end];
		row.bias = start - line.sourceToDisplay[row.sourceStart - line.start];
		this.rows.push(row);
	};

	public setText(text: string): void {
		if (!this.sourceChanged && text === this.source) return;
		this.source = text; this.sourceChanged = true;
	}

	public update(font: EditorFont, width: number): boolean {
		if (!this.sourceChanged && this.font === font && this.width === width) return false;
		const measure = this.sourceChanged || this.font !== font;
		if (this.sourceChanged) {
			this.lines.length = 0;
			let start = 0;
			for (let index = 0; index <= this.source.length; index++) {
				const code = this.source.charCodeAt(index);
				if (index !== this.source.length && code !== 10 && code !== 13) continue;
				const line = this.lineSlots.get(this.lines.length);
				line.start = start; line.end = index;
				line.breakEnd = index === this.source.length ? index : index + (code === 13 && this.source.charCodeAt(index + 1) === 10 ? 2 : 1);
				line.display = expandTabs(this.source.slice(start, index));
				const columns = line.sourceToDisplay, offsets = line.displayToSource;
				columns.length = index - start + 1; offsets.length = line.display.length + 1;
				let display = 0;
				for (let offset = start; offset < index;) {
					const step = this.source.codePointAt(offset)! > 0xffff ? 2 : 1;
					const count = this.source.charCodeAt(offset) === 9 ? TAB_SPACES : step;
					for (let unit = 0; unit < step; unit++) columns[offset - start + unit] = display;
					for (let unit = 0; unit < count; unit++) offsets[display + unit] = offset;
					display += count; offset += step;
				}
				columns[index - start] = display; offsets[display] = index;
				this.lines.push(line); start = line.breakEnd; index = line.breakEnd - 1;
				if (line.breakEnd === line.end) break;
			}
		}
		this.rows.length = 0;
		for (const line of this.lines) {
			if (measure) {
				const advances = line.advances; advances.length = line.display.length + 1; advances[0] = 0;
				for (let index = 0; index < line.display.length;) {
					const step = line.display.codePointAt(index)! > 0xffff ? 2 : 1;
					if (step === 2) advances[index + 1] = advances[index];
					advances[index + step] = advances[index] + font.advance(line.display.slice(index, index + step));
					index += step;
				}
			}
			line.firstRow = this.rows.length; this.wrappingLine = line;
			forEachWrappedMeasuredRange(line.display, width, this.measure, this.emit, true);
			line.lastRow = this.rows.length - 1;
		}
		this.font = font; this.width = width; this.sourceChanged = false;
		return true;
	}

	public lineAt(offset: number): WorkbenchTextViewLine {
		let low = 0, high = this.lines.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (this.lines[middle].start <= offset) low = middle + 1; else high = middle;
		}
		return this.lines[low - 1];
	}

	public displayAt(line: WorkbenchTextViewLine, offset: number): number {
		return line.sourceToDisplay[clamp(offset - line.start, 0, line.end - line.start)];
	}

	public rowAtOffset(offset: number, bias = 0): number {
		const line = this.lineAt(offset), display = this.displayAt(line, offset) + bias;
		let low = line.firstRow, high = line.lastRow;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (this.rows[middle].end <= display) low = middle + 1; else high = middle;
		}
		return low;
	}

	public offsetAt(rowIndex: number, x: number): number {
		const row = this.rows[clamp(rowIndex, 0, this.rows.length - 1)], line = row.line;
		const target = x + line.advances[row.start];
		let low = row.start, high = row.end;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (line.advances[middle] < target) low = middle + 1; else high = middle;
		}
		let end = low;
		while (end < row.end && line.displayToSource[end] === line.displayToSource[end + 1]) end++;
		let start = end;
		if (start > row.start) {
			start--;
			while (start > row.start && line.displayToSource[start] === line.displayToSource[start - 1]) start--;
		}
		return line.displayToSource[target < (line.advances[start] + line.advances[end]) / 2 ? start : end];
	}
}
