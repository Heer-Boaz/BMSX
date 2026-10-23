import { formatByteSize, formatHexDumpRow, formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import { describeBlua32InstructionAtPc } from '../../../../toolchain/ts/rompack/disassembler';
import * as colors from '../../../common/constants';
import { truncateMeasuredText } from '../../../common/text';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import type { TextField } from '../../../editor/ui/inline/text_field_model';
import type { SingleLineFieldViewport } from '../../../editor/ui/inline/single_line_viewport';
import { drawSingleLineField } from '../../../editor/ui/inline/single_line_render';
import { api } from '../../../runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { RomInspectorInput } from './editor_input';
import { romInspectionSectionColor } from './colors';

/** Bounded, visible-row formatting cache. Paint consumes strings, never reparses ROM data. */
export class RomInspectorPresentation {
	public readonly labels: { index: number; name: string; detail: string; size: string; sizeWidth: number }[] = [];
	public readonly lines: string[] = [];
	public readonly map: { left: number; right: number; color: number }[] = [];
	public firstLine = 0;
	public byteColumns = 8;
	public status = '';
	public contentWidth = 0;
	public title = '';
	public contentTitle = '';
	public selectedSpan: { left: number; right: number } | undefined;
	private revision = -1;
	private contentRevision = -1;
	private listFirst = -1;
	private listEnd = -1;
	private contentFirst = -1;
	private contentEnd = -1;
	public update(input: RomInspectorInput, layoutChanged: boolean, contentLayoutChanged = false): void {
		const { model, layout, list, bytes } = input;
		const changed = this.revision !== model.revision || layoutChanged;
		const contentChanged = changed || this.contentRevision !== input.contentRevision;
		if (contentChanged) this.contentWidth = 0;
		const rowHeight = layout.rowHeight * 2 + 4;
		const first = Math.max(0, Math.trunc(list.scrollTop / rowHeight));
		const end = Math.min(model.rows.length, Math.trunc((list.scrollTop + list.height + rowHeight - 1) / rowHeight));
		if (changed || first !== this.listFirst || end !== this.listEnd) {
			this.labels.length = 0;
			const width = list.bounds.right - list.bounds.left;
			for (let index = first; index < end; index++) {
				const row = model.rows[index], sizeWidth = measureText(row.sizeText);
				this.labels.push({ index, name: truncateMeasuredText(row.label, width - sizeWidth - 12, measureTextRange), size: row.sizeText, sizeWidth,
					detail: truncateMeasuredText(`${row.type}${row.start === undefined ? '' : `  ${formatNumberAsHex(row.start, 8)}`}`, width - 8, measureTextRange) });
			}
			this.listFirst = first; this.listEnd = end;
		}
		const contentFirst = Math.max(0, Math.trunc(bytes.scrollTop / layout.rowHeight));
		const contentEnd = Math.trunc((bytes.scrollTop + bytes.height + layout.rowHeight - 1) / layout.rowHeight);
		if (contentChanged || contentFirst !== this.contentFirst || contentEnd !== this.contentEnd) {
			this.lines.length = 0;
			this.firstLine = contentFirst;
			const range = model.selectedRange;
			if (!input.showingImage && range !== undefined) {
				if (model.mode === 'code') {
					const image = model.code!;
					for (let index = contentFirst; index < Math.min(contentEnd, model.instructions.length); index++) {
						const instruction = describeBlua32InstructionAtPc(image.layout, image.symbols, model.instructions[index], { pcRadix: 16 });
						this.lines.push(`${formatNumberAsHex(model.instructions[index], 8)}  ${instruction.instructionText}`);
					}
				} else {
					for (let index = contentFirst; index < contentEnd; index++) {
						const offset = range.start + index * this.byteColumns;
						if (offset >= range.end) break;
						this.lines.push(formatHexDumpRow(input.snapshot.rom, offset, range.end, this.byteColumns));
					}
				}
			}
			for (const line of this.lines) this.contentWidth = Math.max(this.contentWidth, measureText(line) + 8);
			this.contentFirst = contentFirst; this.contentEnd = contentEnd;
		}
		if (changed) {
			const titleRight = input.actions.items.find(item => item.visible)?.bounds.left ?? layout.right;
			this.title = truncateMeasuredText(input.snapshot.label, titleRight - layout.left - 8, measureTextRange);
			this.status = `${formatByteSize(input.snapshot.rom.byteLength)} | ${model.rows.length} ${model.mode === 'code' ? 'functions' : model.mode} | ROM snapshot`;
			const range = model.selectedRange;
			const map = input.mapBounds, scale = (map.right - map.left) / input.snapshot.rom.byteLength;
			this.selectedSpan = range === undefined ? undefined : { left: map.left + range.start * scale, right: map.left + range.end * scale };
		}
		if (contentChanged || contentLayoutChanged) {
			const titleRight = input.contentActions.items.find(item => item.visible)?.bounds.left ?? bytes.bounds.right;
			const title = input.showingImage ? `IMAGE ${input.preview!.image.width}x${input.preview!.image.height}`
				: model.selectedRange === undefined ? 'NO STORED BYTES' : model.mode === 'code' ? 'DISASSEMBLY' : 'BYTES';
			this.contentTitle = truncateMeasuredText(title, titleRight - bytes.bounds.left - 8, measureTextRange);
		}
		if (layoutChanged) {
			this.map.length = 0;
			const bounds = input.mapBounds, width = bounds.right - bounds.left;
			for (const section of model.inspection.sections) {
				const left = bounds.left + Math.trunc(section.start / input.snapshot.rom.byteLength * width);
				const right = bounds.left + Math.trunc(section.end / input.snapshot.rom.byteLength * width);
				if (right > left) this.map.push({ left, right, color: romInspectionSectionColor(section) });
			}
		}
		this.revision = model.revision;
		this.contentRevision = input.contentRevision;
	}
	public reset(): void { this.revision = -1; this.contentRevision = -1; this.listFirst = -1; this.contentFirst = -1; }
}

export function drawRomInspector(input: RomInspectorInput, view: RomInspectorPresentation, filter: TextField, filterViewport: SingleLineFieldViewport): void {
	const { layout, list, bytes, model } = input, font = layout.font!.renderFont(), color = colors.COLOR_RESOURCE_VIEWER_TEXT;
	api.pushClipRect(layout.left, layout.top, layout.right, layout.bottom);
	api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
	api.blit_text_inline_with_font(view.title, layout.left + 4, layout.top + 3, 0, color, font);
	renderWorkbenchActionBar(input.actions, font);
	api.blit_text_inline_with_font('Filter', layout.left + 4, input.filterBounds.top + 2, 0, color, font);
	api.blit_rect(input.filterBounds.left, input.filterBounds.top, input.filterBounds.right, input.filterBounds.bottom, 0,
		filter.focusTarget.hasFocus ? colors.COLOR_HEADER_BUTTON_ACTIVE_TEXT : colors.COLOR_HEADER_BUTTON_BORDER);
	drawSingleLineField(filter, filterViewport, input.filterBounds, colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT);
	for (const segment of view.map) api.fill_rect(segment.left, input.mapBounds.top, segment.right, input.mapBounds.bottom, 0, segment.color);
	if (view.selectedSpan !== undefined) api.blit_rect(view.selectedSpan.left, input.mapBounds.top - 1,
		Math.max(view.selectedSpan.left + 2, view.selectedSpan.right), input.mapBounds.bottom + 1, 0, colors.COLOR_STATUS_WARNING);
	const rowHeight = layout.rowHeight * 2 + 4;
	api.pushClipRect(list.bounds.left, list.bounds.top, list.bounds.right, list.bounds.bottom);
	for (const label of view.labels) {
		const y = list.offsetTop + label.index * rowHeight, selected = label.index === model.selected;
		if (selected) api.fill_rect(list.bounds.left, y, list.bounds.right, y + rowHeight, 0, colors.COLOR_RESOURCE_PANEL_HIGHLIGHT);
		const textColor = selected ? colors.COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT : color;
		api.blit_text_inline_with_font(label.name, list.bounds.left + 4, y + 2, 0, textColor, font);
		api.blit_text_inline_with_font(label.size, list.bounds.right - label.sizeWidth - 4, y + 2, 0, textColor, font);
		api.blit_text_inline_with_font(label.detail, list.bounds.left + 4, y + 2 + layout.rowHeight, 0, colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM, font);
	}
	if (model.rows.length === 0) api.blit_text_inline_with_font(model.filter === '' ? 'No entries in this image' : 'No matching entries', list.bounds.left + 4, list.bounds.top + 4, 0, color, font);
	api.popClipRect();
	list.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	api.blit_text_inline_with_font(view.contentTitle, bytes.bounds.left + 4, bytes.bounds.top - layout.rowHeight - 3, 0, color, font);
	renderWorkbenchActionBar(input.contentActions, font);
	if (input.showingImage) {
		const imageView = input.imageView, bounds = imageView.bounds, bitmap = input.preview!;
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		api.pushTransform(imageView.transform);
		api.drawBitmap(bitmap, 0, 0, bitmap.image.width, bitmap.image.height);
		if (input.showCollision) {
			const boundingbox = input.collision?.bounds;
			if (boundingbox !== undefined) api.blit_rect(boundingbox.left, boundingbox.top, boundingbox.right, boundingbox.bottom,
				0, colors.COLOR_INSPECTOR_VALUE_CHANGED);
			for (const path of input.collisionPaths) api.polyline(path, 0, 0, 0, 1, colors.COLOR_STATUS_WARNING);
		}
		api.popTransform();
		api.popClipRect();
		imageView.vertical.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
		imageView.horizontal.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	} else {
		api.pushClipRect(bytes.bounds.left, bytes.bounds.top, bytes.bounds.right, bytes.bounds.bottom);
		const textLeft = bytes.bounds.left + 4 - Math.round(input.horizontal.getScroll());
		for (let index = 0; index < view.lines.length; index++) api.blit_text_inline_with_font(view.lines[index], textLeft,
			bytes.offsetTop + (view.firstLine + index) * layout.rowHeight, 0, color, font);
		api.popClipRect();
		bytes.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
		input.horizontal.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	}
	api.popClipRect();
}
