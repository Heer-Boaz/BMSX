import { api } from '../../../runtime/overlay_api';
import { editorViewState } from '../../../editor/ui/view/state';
import { drawEditorText } from '../../../editor/render/text_renderer';
import * as colors from '../../../common/constants';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { drawWorkbenchPropertyTree } from '../../render/property_tree';
import type { AnimationEditorInput } from './editor_input';

export function drawAnimationEditor(input: AnimationEditorInput, bounds: Readonly<RectBounds>, keysFocused: boolean): void {
	const { font } = editorViewState;
	const text = colors.COLOR_RESOURCE_VIEWER_TEXT;
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_CODE_BACKGROUND);
	drawEditorText(font, input.caption, bounds.left + 4, bounds.top + 2, 0, text);
	renderWorkbenchActionBar(input.actionBar, font.renderFont(), text, colors.COLOR_DESCRIPTION_TEXT);
	const list = input.tracks;
	const layout = list.layout;
	const firstRow = list.scroll | 0;
	api.pushClipRect(layout.contentLeft, layout.contentTop, layout.contentRight, layout.contentBottom);
	for (let index = firstRow; index < Math.min(list.rows.length, firstRow + layout.visibleRowCount); index++) {
		const top = layout.contentTop + (index - firstRow) * layout.rowHeight;
		const selected = index === list.selectionIndex;
		if (selected) api.fill_rect(layout.contentLeft, top, layout.contentRight, top + layout.rowHeight, 0, colors.COLOR_RESOURCE_PANEL_HIGHLIGHT);
		drawEditorText(font, list.rows[index].text, layout.contentLeft + 2, top + 2, 0, selected ? colors.COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT : text);
	}
	api.popClipRect();
	const viewport = input.keys, keyBounds = viewport.range.bounds;
	const overview = input.overview.bounds;
	api.pushClipRect(overview.left, overview.top, overview.right, overview.bottom);
	const head = viewport.xAt(viewport.cursor);
	if (viewport.unit !== undefined) api.fill_rect(head, overview.top, head + 1, overview.bottom, 0, colors.COLOR_FOCUS_BORDER);
	for (const geometry of input.overview.lanes) {
		const row = list.rows[geometry.index], top = geometry.top;
		api.fill_rect(overview.left, top + layout.rowHeight - 1, overview.right, top + layout.rowHeight, 0, colors.COLOR_TAB_BORDER);
		if (row.clip !== undefined) {
			const preview = input.clipPreview?.index === geometry.index - input.document!.tracks.length - 1 ? input.clipPreview : undefined;
			const start = preview === undefined ? row.clip.start === undefined ? 0 : row.clip.start.value : preview.start;
			const duration = preview === undefined ? row.clip.duration?.value : preview.duration;
			if (viewport.unit !== 'time_ms' || start === null || duration === undefined || duration === null) {
				drawEditorText(font, 'ms / Source', overview.left + 4, top + 2, 0, colors.COLOR_STATUS_TEXT);
			} else {
				const left = viewport.xAt(start), right = viewport.xAt(start + duration);
				api.fill_rect(Math.min(left, right), top + 3, Math.max(left, right), top + layout.rowHeight - 3, 0, colors.COLOR_RESOURCE_PANEL_HIGHLIGHT);
				api.blit_rect(Math.min(left, right), top + 3, Math.max(left, right), top + layout.rowHeight - 3, 0, colors.COLOR_FOCUS_BORDER);
			}
		}
		if (geometry.label !== '') drawEditorText(font, geometry.label, overview.left + 4, top + 2, 0, colors.COLOR_STATUS_TEXT);
		const middle = top + (layout.rowHeight >> 1);
		for (let cell = 0; cell < geometry.cells.length; cell += 2) {
			if (row.track?.kind === 'tag') api.fill_rect(geometry.cells[cell], middle, geometry.cells[cell + 1], middle + 1, 0, text);
			else api.blit_rect(geometry.cells[cell], top + 3, geometry.cells[cell + 1], top + layout.rowHeight - 3, 0, text);
		}
		let selectedDot = -1;
		for (let dot = 0; dot < geometry.dots.length; dot += 2) {
			if (geometry.index === list.selectionIndex && geometry.dots[dot + 1] === input.keyIndex) { selectedDot = dot; continue; }
			const x = geometry.dots[dot];
			api.fill_rect(x - 2, middle - 3, x + 3, middle + 4, 0, text);
		}
		if (selectedDot >= 0) {
			const x = geometry.dots[selectedDot];
			api.fill_rect(x - 2, middle - 3, x + 3, middle + 4, 0, colors.COLOR_FOCUS_BORDER);
		}
	}
	api.popClipRect();
	drawEditorText(font, viewport.caption, keyBounds.left, keyBounds.top - layout.rowHeight, 0, text);
	if (viewport.unit !== undefined) {
		const middle = Math.round((keyBounds.top + keyBounds.bottom) / 2);
		api.fill_rect(keyBounds.left + 3, middle, keyBounds.right - 3, middle + 1, 0, colors.COLOR_STATUS_TEXT);
		api.pushClipRect(keyBounds.left, keyBounds.top, keyBounds.right, keyBounds.bottom);
		const cursorX = viewport.xAt(viewport.cursor);
		api.fill_rect(cursorX, keyBounds.top, cursorX + 1, keyBounds.bottom, 0, colors.COLOR_FOCUS_BORDER);
		let selectedPixel = -1;
		for (let pixel = 0; pixel < viewport.pixels.length; pixel += 2) {
			if (viewport.pixels[pixel] === viewport.selected) { selectedPixel = pixel; continue; }
			const x = viewport.pixels[pixel + 1];
			api.fill_rect(x - 2, middle - 3, x + 3, middle + 4, 0, text);
		}
		if (selectedPixel >= 0) {
			const x = viewport.pixels[selectedPixel + 1];
			api.fill_rect(x - 2, middle - 3, x + 3, middle + 4, 0, colors.COLOR_RESOURCE_PANEL_HIGHLIGHT);
			api.blit_rect(x - 4, middle - 5, x + 4, middle + 5, 0, colors.COLOR_FOCUS_BORDER);
		}
		api.popClipRect();
		drawEditorText(font, viewport.startLabel, keyBounds.left, keyBounds.bottom + 2, 0, text);
		drawEditorText(font, viewport.endLabel, keyBounds.right - viewport.endLabelWidth, keyBounds.bottom + 2, 0, text);
		drawEditorText(font, viewport.selectionLabel, keyBounds.left + 4, keyBounds.bottom + layout.rowHeight + 2, 0, text);
		if (keysFocused) api.blit_rect(keyBounds.left - 1, keyBounds.top - 1, keyBounds.right, keyBounds.bottom, 0, colors.COLOR_FOCUS_BORDER);
	}
	const curve = viewport.curve;
	if (curve.available) {
		const area = curve.bounds;
		api.pushClipRect(area.left, area.top, area.right, area.bottom);
		drawEditorText(font, curve.maximumLabel, area.left + 4, area.top + 2, 0, colors.COLOR_STATUS_TEXT);
		drawEditorText(font, curve.minimumLabel, area.left + 4, area.bottom - font.lineHeight - 2, 0, colors.COLOR_STATUS_TEXT);
		const zero = curve.yAt(0);
		api.fill_rect(area.left, zero, area.right, zero + 1, 0, colors.COLOR_TAB_BORDER);
		api.fill_rect(head, area.top, head + 1, area.bottom, 0, colors.COLOR_FOCUS_BORDER);
		for (let run = 0; run < curve.pathCount; run++) api.polyline(curve.paths[run], 0, 0, 0, 1, text);
		for (let side = 0; side < 2; side++) {
			const handle = side === 0 ? curve.arriveHandle : curve.leaveHandle;
			if (!handle.length) continue;
			api.polyline(handle, 0, 0, 0, 1, colors.COLOR_STATUS_TEXT);
			api.blit_rect(handle[2] - 3, handle[3] - 3, handle[2] + 4, handle[3] + 4, 0, colors.COLOR_FOCUS_BORDER);
		}
		let selectedMarker = -1;
		for (let marker = 0; marker < curve.markers.length; marker += 3) {
			if (curve.markers[marker] === viewport.selected) { selectedMarker = marker; continue; }
			const x = curve.markers[marker + 1], y = curve.markers[marker + 2];
			api.fill_rect(x - 3, y - 3, x + 4, y + 4, 0, text);
		}
		if (selectedMarker >= 0) {
			const x = curve.markers[selectedMarker + 1], y = curve.markers[selectedMarker + 2];
			api.fill_rect(x - 3, y - 3, x + 4, y + 4, 0, colors.COLOR_FOCUS_BORDER);
		}
		api.popClipRect();
		api.blit_rect(area.left, area.top, area.right, area.bottom, 0, keysFocused ? colors.COLOR_FOCUS_BORDER : colors.COLOR_TAB_BORDER);
	}
	const preview = input.framePreview;
	if (preview.label !== '') {
		const area = curve.bounds;
		api.pushClipRect(area.left, area.top, area.right, area.bottom);
		drawEditorText(font, preview.label, area.left + 4, area.top + 2, 0, text);
		api.popClipRect();
		if (preview.bitmap !== undefined) {
			const view = preview.view, imageBounds = view.bounds;
			api.pushClipRect(imageBounds.left, imageBounds.top, imageBounds.right, imageBounds.bottom);
			api.pushTransform(view.transform);
			api.drawBitmap(preview.bitmap, 0, 0, preview.bitmap.image.width, preview.bitmap.image.height);
			api.popTransform(); api.popClipRect();
			view.horizontal.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
			view.vertical.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
		}
	}
	drawWorkbenchPropertyTree(input.details);
}
