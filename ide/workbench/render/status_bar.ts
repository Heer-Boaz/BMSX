import * as colors from '../../common/constants';
import { HOST_FAILURE_STATUS, type WorkbenchStatusLayout } from '../common/layout';
import { api } from '../../runtime/overlay_api';
import { editorViewState } from '../../editor/ui/view/state';
import type { StudioServerConnectionState } from '../common/server_connection';
import { renderServerConnection } from './server_connection';
import { STATUS_ITEM_PADDING, type WorkbenchStatusItemsLayout } from '../ui/status_bar/layout';

/** Paint consumes the arranged status projection, never a document or unformatted domain state. */
export function renderStatusBar(layout: WorkbenchStatusLayout, items: WorkbenchStatusItemsLayout,
	runtimeFaulted: boolean, connection: StudioServerConnectionState): void {
	const bounds = layout.bounds, font = editorViewState.font.renderFont();
	api.fill_rect(0, bounds.top, editorViewState.viewportWidth, bounds.bottom, 0, colors.COLOR_STATUS_BACKGROUND);
	if (runtimeFaulted) {
		const height = Math.max(2, (editorViewState.lineHeight / 6) | 0);
		api.fill_rect(0, bounds.top, editorViewState.viewportWidth, Math.min(bounds.bottom, bounds.top + height), 0, colors.COLOR_STATUS_FAULT_MARKER);
	}
	const normal = runtimeFaulted ? colors.STATUS_MESSAGE_TEXT_COLORS.error : colors.COLOR_STATUS_TEXT;
	if (layout.hostFault.left < layout.hostFault.right) {
		const region = layout.hostFault;
		api.pushClipRect(region.left, region.top, region.right, region.bottom);
		api.blit_text_inline_with_font(HOST_FAILURE_STATUS, region.left + 4, region.top + 2, 0, colors.STATUS_MESSAGE_TEXT_COLORS.error, font);
		api.popClipRect();
	}
	for (let index = 0; index < items.items.length; index++) {
		const entry = items.items.peek(index);
		if (!entry.visible) continue;
		const region = entry.bounds, tone = entry.item!.tone;
		api.pushClipRect(region.left, region.top, region.right, region.bottom);
		api.blit_text_inline_with_font(entry.text, region.left + STATUS_ITEM_PADDING, region.top + 2, 0,
			tone === 'normal' ? normal : colors.STATUS_MESSAGE_TEXT_COLORS[tone], font);
		api.popClipRect();
	}
	if (layout.guestHintText.length !== 0) {
		const region = layout.guestHint;
		api.pushClipRect(region.left, region.top, region.right, region.bottom);
		api.blit_text_inline_with_font(layout.guestHintText, region.left + 4, region.top + 2, 0, colors.COLOR_STATUS_TEXT, font);
		api.popClipRect();
	}
	renderServerConnection(connection, layout.connection.top);
}
