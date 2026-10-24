import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import type { AssistantEntry } from '../../services/assistant/transcript';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { PointerSnapshot } from '../../../common/models';
import type { InputFocusTarget } from '../../../input/focus';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../input/keyboard/key_input';
import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { api } from '../../../runtime/overlay_api';
import * as colors from '../../../common/constants';
import { truncateMeasuredText } from '../../../common/text';
import { measureTextRange } from '../../../editor/common/text/layout';
import { drawMarkdownRow } from '../../../editor/render/markdown';
import { editorViewState } from '../../../editor/ui/view/state';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import type { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { drawImagePreview, type ImagePreviewCache } from '../../ui/image_preview';
import type { ImagePreviewOverlay } from '../../ui/image_preview_overlay';
import { TRANSCRIPT_IMAGE_ROWS, type AssistantTranscriptProjection } from './projection';
import type { AssistantTranscriptSelection } from './transcript_selection';

export type TranscriptViewInput = { conversation: { readonly entries: readonly AssistantEntry[] }; selection: AssistantTranscriptSelection;
	viewport: WorkbenchScrollViewport; transcript: AssistantTranscriptProjection; layout: FullWidthWorkbenchLayout };
const IMAGE_MAX_WIDTH = 180;

/** Shared transcript focus, layout and interaction; no chat composer or agent controls. */
export class AssistantTranscriptControl {
	public readonly scroll: WorkbenchScrollControl;
	private input: TranscriptViewInput | undefined;
	private readonly imageBounds = create_rect_bounds();
	private followSelection = false;
	private labelsDirty = true;
	private loadingLabel = '';
	private unavailableLabel = '';
	private unbindSelection: (() => void) | undefined;
	private readonly unbindFocus: () => void;
	public constructor(parent: InputFocusTarget, private readonly previews: ImagePreviewCache, private readonly preview: ImagePreviewOverlay,
		private readonly openSelected?: () => void) {
		this.scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, parent, input => this.handleKeyboard(input));
		this.scroll.focusTarget.commandContext = parent;
		this.scroll.focusTarget.clipboard = { readOnly: true, copy: () => {
			const selection = this.input!.selection;
			return selection.imageIndex === undefined && selection.entry !== undefined ? selection.entry.text.getText() : null;
		} };
		this.unbindFocus = this.scroll.focusTarget.onDidFocus(() => { this.followSelection = true; });
		this.scroll.onWillScroll = () => { this.followSelection = false; };
	}
	public setInput(input: TranscriptViewInput): void {
		this.clearInput(); this.input = input;
		this.unbindSelection = input.selection.onWillChangeTarget(() => {
			if (this.preview.origin === this.scroll.focusTarget) this.preview.close();
			this.followSelection = true;
		});
		this.followSelection = true;
		this.labelsDirty = true;
		this.scroll.setInput(input.viewport);
	}
	public clearInput(): void {
		if (this.preview.origin === this.scroll.focusTarget) this.preview.close();
		this.unbindSelection?.(); this.unbindSelection = undefined;
		this.scroll.clearInput(); this.input = undefined; this.followSelection = false;
	}
	public dispose(): void { this.clearInput(); this.unbindFocus(); this.scroll.dispose(); }

	/** Projection refines the selected target before the viewport publishes its final axis range. */
	public layout(top: number, bottom: number, followEnd: boolean, metricsChanged: boolean): void {
		const { viewport, transcript, layout, selection } = this.input!, row = layout.rowHeight;
		this.scroll.lineStep = row;
		const visible = Math.max(1, (bottom - top) / row);
		let scroll: number;
		if (this.followSelection && (this.scroll.focusTarget.hasFocus || this.preview.origin === this.scroll.focusTarget) && selection.entry !== undefined) {
			scroll = transcript.revealSelection(selection.entry, selection.imageIndex, viewport.scrollTop / row, visible);
		} else scroll = transcript.layout(viewport.scrollTop / row, visible, followEnd);
		viewport.layout(layout.left + 4, top, layout.right, bottom, transcript.rowCount * row);
		viewport.scrollbar.setScroll(scroll * row);
		if (metricsChanged || this.labelsDirty) {
			const bounds = this.layoutImage(0), width = bounds.right - bounds.left - 8;
			this.loadingLabel = truncateMeasuredText('Loading image…', width, measureTextRange);
			this.unavailableLabel = truncateMeasuredText('Image unavailable', width, measureTextRange);
			this.labelsDirty = false;
		}
	}

	/** A single content rectangle owns both the painted tile and its pointer target. */
	private layoutImage(firstRow: number): Readonly<RectBounds> {
		const { viewport, layout } = this.input!;
		const left = viewport.bounds.left + 4, top = viewport.offsetTop + firstRow * layout.rowHeight;
		write_rect_bounds(this.imageBounds, left, top + 2, Math.min(viewport.bounds.right - 4, left + IMAGE_MAX_WIDTH),
			top + TRANSCRIPT_IMAGE_ROWS * layout.rowHeight - 2);
		return this.imageBounds;
	}

	public draw(): void {
		const { viewport, layout, selection, transcript } = this.input!;
		const font = editorViewState.font.renderFont(), textColor = colors.COLOR_RESOURCE_VIEWER_TEXT;
		api.pushClipRect(viewport.bounds.left, viewport.bounds.top, viewport.bounds.right, viewport.bounds.bottom);
		for (let index = Math.trunc(viewport.scrollTop / layout.rowHeight), top = viewport.offsetTop + index * layout.rowHeight;
			index < transcript.rowCount && top < viewport.bounds.bottom; index++, top += layout.rowHeight) {
			const row = transcript.rowAt(index)!, entry = row.entry;
			const selected = entry === selection.entry && selection.imageIndex === undefined;
			if (entry.kind === 'user' && !row.heading && !row.image) {
				api.fill_rect(viewport.bounds.left, top, viewport.bounds.right, top + layout.rowHeight, 0, colors.HIGHLIGHT_OVERLAY);
				api.fill_rect(viewport.bounds.left, top, viewport.bounds.left + 1, top + layout.rowHeight, 0, colors.COLOR_BODY_ACCENT);
			}
			if (selected && !row.image) api.fill_rect(viewport.bounds.left, top, viewport.bounds.right, top + layout.rowHeight, 0, colors.SELECTION_OVERLAY);
			if (row.image) {
				if (row.image.line === 0 || index === Math.trunc(viewport.scrollTop / layout.rowHeight)) {
					const bounds = this.layoutImage(index - row.image.line), preview = this.previews.use(row.image.url);
					api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_MARKDOWN_CODE_BACKGROUND);
					api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
					if (preview.bitmap) drawImagePreview(preview.bitmap, bounds.left + 2, bounds.top + 2, bounds.right - 2, bounds.bottom - layout.rowHeight);
					else api.blit_text_inline_with_font(preview.error ? this.unavailableLabel : this.loadingLabel, bounds.left + 4, bounds.top + 6, 0, colors.COLOR_MARKDOWN_MUTED_TEXT, font);
					api.blit_text_inline_with_font(row.image.label, bounds.left + 4, bounds.bottom - layout.rowHeight, 0, colors.COLOR_MARKDOWN_MUTED_TEXT, font);
					api.popClipRect();
					if (entry === selection.entry && row.image.index === selection.imageIndex) api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0,
						this.scroll.focusTarget.hasFocus ? colors.COLOR_BODY_ACCENT : colors.COLOR_QUICK_OPEN_OUTLINE);
				}
				continue;
			}
			drawMarkdownRow(row, viewport.bounds.left + 4, top, viewport.bounds.right - viewport.bounds.left - 8, selected ? colors.COLOR_SELECTION_TEXT
				: entry.kind === 'status' ? colors.COLOR_MARKDOWN_MUTED_TEXT : textColor, selected);
		}
		api.popClipRect(); viewport.scrollbar.draw(colors.COLOR_CODE_BACKGROUND, textColor);
	}
	public handleSelection(snapshot: PointerSnapshot): boolean {
		const { viewport, transcript, layout, selection } = this.input!;
		if (!snapshot.valid || !snapshot.insideViewport || (snapshot.justPressedButtons & PointerButton.Primary) === 0
			|| !point_in_rect(snapshot.viewportX, snapshot.viewportY, viewport.bounds)) return false;
		const index = Math.trunc((snapshot.viewportY - viewport.offsetTop) / layout.rowHeight), row = transcript.rowAt(index);
		if (row?.image && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.layoutImage(index - row.image.line))) {
			selection.select(row.entry, row.image.index); this.followSelection = true;
			this.scroll.focusTarget.focus(); this.preview.open(row.image.url); return true;
		}
		if (row !== undefined && row.image === undefined) {
			const x = snapshot.viewportX - viewport.bounds.left - 4;
			for (const run of row.runs) if (x >= run.x && x < run.x + run.width) {
				selection.select(row.entry); this.followSelection = true; this.scroll.focusTarget.focus(); return true;
			}
		}
		selection.select(undefined); this.scroll.focusTarget.focus(); return true;
	}

	private handleKeyboard(input: KeyInputEvent): boolean {
		const { selection, conversation } = this.input!;
		if (selection.entry !== undefined && isKeyJustPressed('Escape', input)) {
			consumeIdeKey('Escape', input); selection.select(undefined); return true;
		}
		if (input.modifiers === KeyModifier.none && (isKeyJustPressed('Enter', input) || isKeyJustPressed('Space', input))) {
			if (selection.imageIndex !== undefined) {
				consumeIdeKey(input.code, input); this.followSelection = true; this.preview.open(selection.entry!.images![selection.imageIndex]); return true;
			}
			if (input.code === 'Enter' && selection.proposal !== undefined && this.openSelected !== undefined) {
				consumeIdeKey('Enter', input); this.openSelected(); return true;
			}
		}
		for (const key of ['ArrowUp', 'ArrowDown'] as const) {
			if (!isKeyDown(key, input)) continue;
			consumeIdeKey(key, input); this.scroll.cancelPointer();
			selection.move(key === 'ArrowUp' ? -1 : 1, conversation.entries);
			this.followSelection = true;
			return true;
		}
		return false;
	}
}
