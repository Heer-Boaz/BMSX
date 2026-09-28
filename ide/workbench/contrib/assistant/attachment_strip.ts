import { showEditorMessage } from '../../../common/feedback_state';
import { create_rect_bounds, point_in_rect, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../../common/models';
import * as colors from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../input/pointer/buttons';
import { api } from '../../../runtime/overlay_api';
import { drawImagePreview, type ImagePreviewCache } from '../../ui/image_preview';
import type { AssistantAttachments } from './attachments';

/** One scrollable thumbnail strip, not an ever-growing composer. Pointer and keyboard agree. */
export class AssistantAttachmentStrip {
	public readonly bounds = create_rect_bounds();
	public readonly focusTarget = inputFocus.createTarget();
	public selected = 0;
	private first = 0;
	private columns = 1;
	private tileWidth = 0;
	private rowHeight = 0;
	private readonly labels: string[] = [];
	private attachments: AssistantAttachments | undefined;
	public constructor(private readonly previews: ImagePreviewCache, private readonly open: (url: string) => void) {
		this.focusTarget.bindKeyboard(input => {
			if (isKeyJustPressed('Escape', input)) { consumeIdeKey('Escape', input); this.focusTarget.next?.focus(); return; }
			if (isKeyJustPressed('Delete', input) || isKeyJustPressed('Backspace', input)) {
				consumeIdeKey('Delete', input); consumeIdeKey('Backspace', input);
				if (this.attachments!.images.length > 0) this.removeSelected();
				return;
			}
			if (isKeyJustPressed('Enter', input)) {
				consumeIdeKey('Enter', input);
				if (isCtrlDown(input) || isMetaDown(input)) inputFocus.executeCommand(isShiftDown(input) ? 'assistant.direct' : 'assistant.send');
				else this.openSelected();
				return;
			}
			for (const key of ['ArrowLeft', 'ArrowRight'] as const) if (isKeyJustPressed(key, input)) {
				consumeIdeKey(key, input);
				this.selected = Math.max(0, Math.min(this.attachments!.images.length - 1, this.selected + (key === 'ArrowLeft' ? -1 : 1)));
			}
		});
	}
	public setInput(attachments: AssistantAttachments): void { this.attachments = attachments; this.labels.length = 0; this.selected = 0; this.first = 0; }
	public clearInput(): void { this.focusTarget.release(); this.attachments = undefined; }
	public layout(left: number, top: number, right: number, rowHeight: number): void {
		this.rowHeight = rowHeight;
		const count = this.attachments!.images.length;
		if (this.labels.length !== count) {
			if (count > this.labels.length) this.selected = count - 1;
			this.labels.length = 0;
			for (let index = 0; index < count; index++) this.labels.push(`${index + 1}/${count}`);
		}
		this.columns = Math.max(1, Math.trunc((right - left) / 100));
		this.tileWidth = (right - left) / this.columns;
		this.selected = Math.max(0, Math.min(this.selected, this.attachments!.images.length - 1));
		this.first = Math.max(0, Math.min(this.first, this.selected, count - this.columns));
		if (this.selected >= this.first + this.columns) this.first = this.selected - this.columns + 1;
		write_rect_bounds(this.bounds, left, top, right, top + rowHeight * 5 + 4);
	}
	public draw(): void {
		const { left, top, bottom } = this.bounds;
		const images = this.attachments!.images, font = editorViewState.font.renderFont();
		for (let index = this.first; index < Math.min(images.length, this.first + this.columns); index++) {
			const x = left + (index - this.first) * this.tileWidth, right = x + this.tileWidth - 4;
			const selected = index === this.selected && this.focusTarget.hasFocus;
			api.fill_rect(x, top, right, bottom, 0, colors.COLOR_MARKDOWN_CODE_BACKGROUND);
			api.blit_rect(x, top, right, bottom, 0, selected ? colors.COLOR_STATUS_SUCCESS : colors.COLOR_QUICK_OPEN_OUTLINE);
			const image = images[index], preview = image.state === 'ready' ? this.previews.use(image.url!, image.preview) : undefined;
			if (preview?.bitmap) drawImagePreview(preview.bitmap, x + 3, top + 3, right - 3, bottom - this.rowHeight - 3);
			else api.blit_text_inline_with_font(image.state === 'error' || preview?.error ? 'Unreadable' : 'Loading...', x + 4, top + this.rowHeight * 2, 0, colors.COLOR_MARKDOWN_MUTED_TEXT, font);
			api.blit_text_inline_with_font(this.labels[index], x + 4, bottom - this.rowHeight, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
			// Contextual remove affordance stays away from the image's preview target.
			api.fill_rect(right - this.rowHeight - 2, bottom - this.rowHeight - 1, right - 1, bottom - 1, 0, colors.COLOR_STATUS_BACKGROUND);
			api.blit_text_inline_with_font('x', right - this.rowHeight, bottom - this.rowHeight, 0, colors.COLOR_STATUS_TEXT, font);
		}
	}
	public handlePointer(snapshot: PointerSnapshot): boolean {
		if (!snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.bounds)) return false;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) {
			const index = this.first + Math.trunc((snapshot.viewportX - this.bounds.left) / this.tileWidth);
			if (index >= this.attachments!.images.length) return true;
			this.selected = index; this.focusTarget.focus();
			const right = this.bounds.left + (index - this.first + 1) * this.tileWidth - 4;
			if (snapshot.viewportX >= right - this.rowHeight - 2 && snapshot.viewportY >= this.bounds.bottom - this.rowHeight - 1) this.removeSelected();
			else this.openSelected();
		}
		return true;
	}
	public handleWheel(snapshot: PointerSnapshot, delta: number): boolean {
		if (!point_in_rect(snapshot.viewportX, snapshot.viewportY, this.bounds)) return false;
		this.selected = Math.max(0, Math.min(this.attachments!.images.length - 1, this.selected + delta));
		return true;
	}
	private removeSelected(): void {
		this.attachments!.remove(this.selected);
		this.selected = Math.max(0, Math.min(this.selected, this.attachments!.images.length - 1));
		if (this.attachments!.images.length === 0) this.focusTarget.next!.focus();
	}
	private openSelected(): void {
		const image = this.attachments!.images[this.selected];
		if (image.state === 'ready') this.open(image.url!);
		else if (image.state === 'error') showEditorMessage(image.error!, colors.COLOR_STATUS_ERROR, 5);
	}
}
