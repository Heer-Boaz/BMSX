import { formatByteSize, formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import * as colors from '../../../common/constants';
import { truncateMeasuredText } from '../../../common/text';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import type { TextField } from '../../../editor/ui/inline/text_field_model';
import type { SingleLineFieldViewport } from '../../../editor/ui/inline/single_line_viewport';
import { drawSingleLineField } from '../../../editor/ui/inline/single_line_render';
import { api } from '../../../runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { RomInspectorInput } from './editor_input';
import { romInspectionSectionCategory } from './colors';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';

/** Bounded, visible-row formatting cache. Paint consumes strings, never reparses ROM data. */
export class RomInspectorPresentation {
	public readonly labels: { index: number; name: string; detail: string; categoryColor: number; size: string; sizeWidth: number }[] = [];
	public readonly map: { left: number; right: number; color: number }[] = [];
	public status = '';
	public title = '';
	public readonly selectedSpans: { left: number; right: number }[] = [];
	private revision = -1;
	private listFirst = -1;
	private listEnd = -1;
	public update(input: RomInspectorInput, layoutChanged: boolean): void {
		const { model, layout, list } = input;
		const changed = this.revision !== model.revision || layoutChanged;
		const rowHeight = layout.rowHeight * 2 + 4;
		const first = Math.max(0, Math.trunc(list.scrollTop / rowHeight));
		const end = Math.min(model.rows.length, Math.trunc((list.scrollTop + list.height + rowHeight - 1) / rowHeight));
		if (changed || first !== this.listFirst || end !== this.listEnd) {
			this.labels.length = 0;
			const width = list.bounds.right - list.bounds.left;
			for (let index = first; index < end; index++) {
				const row = model.rows[index], sizeWidth = measureText(row.sizeText);
				this.labels.push({ index, name: truncateMeasuredText(row.label, width - sizeWidth - 12, measureTextRange), size: row.sizeText, sizeWidth,
					categoryColor: row.category.color,
					detail: truncateMeasuredText(`${row.kind === 'function' ? 'Function' : row.category.label}${row.start === undefined ? '' : `  ${formatNumberAsHex(row.start, 8)}`}`, width - WORKBENCH_ICON_SIZE - 12, measureTextRange) });
			}
			this.listFirst = first; this.listEnd = end;
		}
		if (changed) {
			const titleRight = input.actions.bounds.left;
			this.title = truncateMeasuredText(input.snapshot.label, titleRight - layout.left - 8, measureTextRange);
			this.status = `${formatByteSize(input.snapshot.rom.byteLength)} | ${model.rows.length} ${model.mode === 'code' ? 'functions' : model.mode === 'assets' ? 'assets' : 'sections'}`;
			const map = input.mapBounds, scale = (map.right - map.left) / input.snapshot.rom.byteLength;
			this.selectedSpans.length = 0;
			if (model.selection !== undefined) for (const range of model.selection.ranges)
				this.selectedSpans.push({ left: map.left + range.start * scale, right: map.left + range.end * scale });
		}
		if (layoutChanged) {
			this.map.length = 0;
			const bounds = input.mapBounds, width = bounds.right - bounds.left;
			for (const section of model.inspection.sections) {
				const left = bounds.left + Math.trunc(section.start / input.snapshot.rom.byteLength * width);
				const right = bounds.left + Math.trunc(section.end / input.snapshot.rom.byteLength * width);
				if (right > left) this.map.push({ left, right, color: romInspectionSectionCategory(section).color });
			}
		}
		this.revision = model.revision;
	}
	public reset(): void { this.revision = -1; this.listFirst = -1; }
}

export function drawRomInspector(input: RomInspectorInput, view: RomInspectorPresentation, filter: TextField, filterViewport: SingleLineFieldViewport, listFocused: boolean): void {
	const { layout, list, model } = input, font = layout.font!.renderFont(), color = colors.COLOR_RESOURCE_VIEWER_TEXT;
	api.pushClipRect(layout.left, layout.top, layout.right, layout.bottom);
	api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
	api.blit_text_inline_with_font(view.title, layout.left + 4, layout.top + 3, 0, color, font);
	renderWorkbenchActionBar(input.actions, font, color, colors.COLOR_DESCRIPTION_TEXT);
	api.blit_text_inline_with_font('Filter', layout.left + 4, input.filterBounds.top + 2, 0, color, font);
	api.fill_rect(input.filterBounds.left, input.filterBounds.top, input.filterBounds.right, input.filterBounds.bottom, 0, colors.COLOR_INPUT_BACKGROUND);
	api.blit_rect(input.filterBounds.left, input.filterBounds.top, input.filterBounds.right, input.filterBounds.bottom, 0,
		filter.focusTarget.hasFocus ? colors.COLOR_FOCUS_BORDER : colors.COLOR_INPUT_OUTLINE);
	drawSingleLineField(filter, filterViewport, input.filterBounds, colors.COLOR_INPUT_TEXT);
	for (const segment of view.map) api.fill_rect(segment.left, input.mapBounds.top, segment.right, input.mapBounds.bottom, 0, segment.color);
	for (const span of view.selectedSpans) api.blit_rect(span.left, input.mapBounds.top - 1,
		Math.max(span.left + 2, span.right), input.mapBounds.bottom + 1, 0, colors.COLOR_STATUS_WARNING);
	const rowHeight = layout.rowHeight * 2 + 4;
	api.pushClipRect(list.bounds.left, list.bounds.top, list.bounds.right, list.bounds.bottom);
	for (const label of view.labels) {
		const y = list.offsetTop + label.index * rowHeight, selected = label.index === model.selected;
		if (selected) api.fill_rect(list.bounds.left, y, list.bounds.right, y + rowHeight, 0,
			listFocused ? colors.SELECTION_OVERLAY : colors.INACTIVE_SELECTION_OVERLAY);
		const textColor = selected ? listFocused ? colors.COLOR_SELECTION_TEXT : colors.COLOR_INACTIVE_SELECTION_TEXT : color;
		api.blit_text_inline_with_font(label.name, list.bounds.left + 4, y + 2, 0, textColor, font);
		api.blit_text_inline_with_font(label.size, list.bounds.right - label.sizeWidth - 4, y + 2, 0, textColor, font);
		const swatchSize = Math.min(WORKBENCH_ICON_SIZE, layout.rowHeight), detailTop = y + 2 + layout.rowHeight;
		api.fill_rect(list.bounds.left + 4, detailTop, list.bounds.left + 4 + swatchSize, detailTop + swatchSize, 0, label.categoryColor);
		api.blit_text_inline_with_font(label.detail, list.bounds.left + WORKBENCH_ICON_SIZE + 8, detailTop, 0,
			selected ? textColor : colors.COLOR_INSPECTOR_LABEL, font);
	}
	if (model.rows.length === 0) api.blit_text_inline_with_font(model.filter === '' ? 'No entries in this image' : 'No matching entries', list.bounds.left + 4, list.bounds.top + 4, 0, color, font);
	api.popClipRect();
	list.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	api.popClipRect();
}
