import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { AssistantEntry } from '../../services/assistant/transcript';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { PointerSnapshot } from '../../../common/models';
import type { InputFocusTarget } from '../../../input/focus';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { PointerButton } from '../../../input/pointer/buttons';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import { api } from '../../../runtime/overlay_api';
import * as colors from '../../../common/constants';
import { drawMarkdownRow } from '../../../editor/render/markdown';
import { editorViewState } from '../../../editor/ui/view/state';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import type { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { drawImagePreview, type ImagePreviewCache } from '../../ui/image_preview';
import type { ImagePreviewOverlay } from '../../ui/image_preview_overlay';
import { TRANSCRIPT_IMAGE_ROWS, type AssistantTranscriptProjection } from './projection';

export type TranscriptViewInput = { conversation: { readonly entries: readonly AssistantEntry[] }; selectedEntry: number;
	viewport: WorkbenchScrollViewport; transcript: AssistantTranscriptProjection; layout: FullWidthWorkbenchLayout };

/** Shared Markdown transcript interaction, rendering and clipboard focus; no chat composer or agent controls. */
export class AssistantTranscriptControl {
	public readonly scroll: WorkbenchScrollControl;
	private input: TranscriptViewInput;
	public constructor(parent: InputFocusTarget, private readonly previews: ImagePreviewCache, private readonly preview: ImagePreviewOverlay,
		private readonly openSelected?: () => void) {
		this.scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, parent, input => this.handleKeyboard(input));
		this.scroll.focusTarget.commandContext = parent;
		this.scroll.focusTarget.clipboard = { copy: () => this.input.selectedEntry >= 0 ? this.input.conversation.entries[this.input.selectedEntry].text.getText() : null };
	}
	public setInput(input: TranscriptViewInput): void { this.input = input; this.scroll.setInput(input.viewport); }
	public clearInput(): void { this.scroll.clearInput(); }
	public dispose(): void { this.scroll.dispose(); }
	public draw(): void {
		const input = this.input, { viewport, layout } = input;
		const font = editorViewState.font.renderFont(), textColor = colors.COLOR_RESOURCE_VIEWER_TEXT;

		api.pushClipRect(viewport.bounds.left, viewport.bounds.top, viewport.bounds.right, viewport.bounds.bottom);
		for (let index = Math.trunc(viewport.scrollTop / layout.rowHeight), top = viewport.offsetTop + index * layout.rowHeight;
			index < input.transcript.rowCount && top < viewport.bounds.bottom; index++, top += layout.rowHeight) {
			const row = input.transcript.rowAt(index)!;
			const entry = input.conversation.entries[row.entry];
			const selected = row.entry === input.selectedEntry;
			if (entry.kind === 'user' && !row.heading && !row.image) {
				api.fill_rect(4, top, viewport.bounds.right, top + layout.rowHeight, 0, colors.HIGHLIGHT_OVERLAY);
				api.fill_rect(4, top, 5, top + layout.rowHeight, 0, colors.COLOR_STATUS_SUCCESS);
			}
			if (selected && !row.image) api.fill_rect(4, top, viewport.bounds.right, top + layout.rowHeight, 0, colors.SELECTION_OVERLAY);
			if (row.image) {
				if (row.image.line === 0 || index === Math.trunc(viewport.scrollTop / layout.rowHeight)) {
					const imageTop = top - row.image.line * layout.rowHeight;
					const imageBottom = imageTop + TRANSCRIPT_IMAGE_ROWS * layout.rowHeight - 2;
					const right = Math.min(viewport.bounds.right - 12, viewport.bounds.left + 180);
					const preview = this.previews.use(row.image.url);
					api.fill_rect(8, imageTop + 2, right, imageBottom, 0, colors.COLOR_MARKDOWN_CODE_BACKGROUND);
					if (preview.bitmap) drawImagePreview(preview.bitmap, 10, imageTop + 4, right - 2, imageBottom - layout.rowHeight);
					else api.blit_text_inline_with_font(preview.error ? 'Image unavailable' : 'Loading image...', 12, imageTop + 8, 0, colors.COLOR_MARKDOWN_MUTED_TEXT, font);
					api.blit_text_inline_with_font(row.image.label, 12, imageBottom - layout.rowHeight, 0, colors.COLOR_MARKDOWN_MUTED_TEXT, font);
				}
				continue;
			}
			drawMarkdownRow(row, viewport.bounds.left + 4, top, viewport.bounds.right - 12, selected ? colors.COLOR_SELECTION_TEXT
				: entry.kind === 'status' ? colors.COLOR_MARKDOWN_MUTED_TEXT : textColor, selected);
		}
		api.popClipRect(); viewport.scrollbar.draw(colors.COLOR_CODE_BACKGROUND, textColor);
	}
	public handleSelection(snapshot: PointerSnapshot): boolean {
		const { viewport, transcript, layout } = this.input;
		const pressed = snapshot.insideViewport && (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
		if (pressed && !(viewport.scrollbar.isVisible() && point_in_rect(snapshot.viewportX, snapshot.viewportY, viewport.scrollbar.getTrack()))) {
			this.input.selectedEntry = -1;
			if (point_in_rect(snapshot.viewportX, snapshot.viewportY, viewport.bounds)) {
				const row = transcript.rowAt(Math.trunc((snapshot.viewportY - viewport.offsetTop) / layout.rowHeight));
				const x = snapshot.viewportX - viewport.bounds.left - 4;
				if (row?.image && x >= 0 && x < 172) { this.preview.open(row.image.url); return true; }
				if (row !== undefined) for (const run of row.runs) {
					if (x >= run.x && x < run.x + run.width) { this.input.selectedEntry = row.entry; break; }
				}
			}
		}
		return false;
	}

	private handleKeyboard(input: PlayerInput): boolean {
		if (this.input.selectedEntry >= 0 && isKeyJustPressed('Escape', input)) {
			consumeIdeKey('Escape', input); this.input.selectedEntry = -1; return true;
		}

		if (this.openSelected && isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); this.openSelected(); return true; }
		for (const key of ['ArrowUp', 'ArrowDown'] as const) {
			if (!shouldRepeatKeyFromPlayer(key, input)) continue;
			consumeIdeKey(key, input);
			const { conversation, transcript, viewport, layout } = this.input;
			this.input.selectedEntry = Math.max(-1, Math.min(conversation.entries.length - 1,
				Math.max(0, this.input.selectedEntry + (key === 'ArrowUp' ? -1 : 1))));
			const row = this.input.selectedEntry < 0 ? -1 : transcript.entryTop(this.input.selectedEntry);
			if (row >= 0) {
				const top = row * layout.rowHeight;
				if (top < viewport.scrollTop) viewport.scrollbar.setScroll(top);
				else if (top + layout.rowHeight > viewport.scrollTop + viewport.height) viewport.scrollbar.setScroll(top + layout.rowHeight - viewport.height);
			}
			return true;
		}
		return false;
	}
}
