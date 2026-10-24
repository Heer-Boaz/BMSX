import { formatHexDumpRow, formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import { describeBlua32InstructionAtPc } from '../../../../toolchain/ts/rompack/disassembler';
import * as colors from '../../../common/constants';
import { measureText } from '../../../editor/common/text/layout';
import { api } from '../../../runtime/overlay_api';
import type { RomInspectorContentModel } from './content_model';
import type { RomInspectorInput } from './editor_input';

const HEX_WIDTH_SAMPLE = new Uint8Array(16);
const INSTRUCTION_FORMAT = { pcRadix: 16 } as const;
const HEX_COLUMNS = [16, 8, 4, 2, 1] as const;

/** Only visible rows are formatted; the document owns captured bytes and instruction addresses. */
export class RomInspectorContentPresentation {
	public readonly lines: string[] = [];
	public firstLine = 0;
	public byteColumns = 8;
	public contentWidth = 0;
	private readonly rowWidths: number[] = [];
	private byteWidth = 0;
	private font: BFont | undefined;
	private formattedFont: BFont | undefined;
	private rangeRevision = -1;
	private columns = -1;
	private endLine = -1;

	public layout(font: BFont, width: number): void {
		if (this.font !== font) {
			this.font = font;
			for (let index = 0; index < HEX_COLUMNS.length; index++) {
				const columns = HEX_COLUMNS[index];
				this.rowWidths[index] = measureText(formatHexDumpRow(HEX_WIDTH_SAMPLE, 0, columns, columns)) + 8;
			}
		}
		let index = 0;
		while (index < HEX_COLUMNS.length - 1 && this.rowWidths[index] > width) index++;
		this.byteColumns = HEX_COLUMNS[index]; this.byteWidth = this.rowWidths[index];
	}

	public lineCount(document: RomInspectorContentModel): number {
		if (document.subject?.kind === 'function') return document.instructions.length;
		const range = document.selectedRange;
		return range === undefined ? 0 : Math.trunc((range.end - range.start + this.byteColumns - 1) / this.byteColumns);
	}

	public update(input: RomInspectorInput, font: BFont): void {
		const document = input.reader, view = input.readerBytes;
		const first = Math.max(0, Math.trunc(view.scrollTop / font.lineHeight));
		const end = Math.min(this.lineCount(document), Math.trunc((view.scrollTop + view.height + font.lineHeight - 1) / font.lineHeight));
		const columns = document.subject?.kind === 'function' ? 1 : this.byteColumns;
		const changed = this.rangeRevision !== document.rangeRevision || this.formattedFont !== font || this.columns !== columns;
		if (!changed && first === this.firstLine && end === this.endLine) return;
		if (changed) this.contentWidth = document.subject?.kind === 'function' ? 0 : this.byteWidth;
		this.lines.length = 0;
		const subject = document.subject;
		if (subject?.kind === 'function') {
			const instructions = document.instructions;
			for (let index = first; index < end; index++) {
				const address = instructions[index];
				const instruction = describeBlua32InstructionAtPc(subject.image.layout, subject.image.symbols, address, INSTRUCTION_FORMAT);
				const line = `${formatNumberAsHex(address, 8)}  ${instruction.instructionText}`;
				this.lines.push(line);
				this.contentWidth = Math.max(this.contentWidth, measureText(line) + 8);
			}
		} else {
			const range = document.selectedRange;
			if (range !== undefined) for (let index = first; index < end; index++)
				this.lines.push(formatHexDumpRow(document.snapshot.rom, range.start + index * this.byteColumns, range.end, this.byteColumns));
		}
		this.firstLine = first; this.endLine = end;
		this.rangeRevision = document.rangeRevision; this.formattedFont = font; this.columns = columns;
	}
}

/** One expanded reader surface: pixels or the retained byte/instruction rows, never both. */
export function drawRomInspectorContent(input: RomInspectorInput, presentation: RomInspectorContentPresentation, font: BFont): void {
	const document = input.reader, color = colors.COLOR_RESOURCE_VIEWER_TEXT;
	if (document.view === 'preview') {
		const view = document.imageView, bounds = view.bounds, bitmap = document.preview!;
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		api.pushTransform(view.transform);
		api.drawBitmap(bitmap, 0, 0, bitmap.image.width, bitmap.image.height);
		if (document.showCollision && document.collision !== undefined) {
			const box = document.collision.bounds;
			api.outlinedRect(box.left, box.top, box.right, box.bottom, 0);
			for (const path of document.collisionPaths) api.outlinedPolyline(path, 0, 0, 0);
		}
		api.popTransform(); api.popClipRect();
		view.vertical.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
		view.horizontal.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	} else {
		const view = input.readerBytes;
		api.pushClipRect(view.bounds.left, view.bounds.top, view.bounds.right, view.bounds.bottom);
		const left = view.bounds.left + 4 - Math.round(input.readerHorizontal.getScroll());
		for (let index = 0; index < presentation.lines.length; index++) api.blit_text_inline_with_font(presentation.lines[index], left,
			view.offsetTop + (presentation.firstLine + index) * font.lineHeight, 0, color, font);
		api.popClipRect();
		view.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
		input.readerHorizontal.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	}
}
