import type { RectBounds } from '../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../common/models';
import * as colors from '../../common/constants';
import { truncateMeasuredText } from '../../common/text';
import { measureTextRange } from '../../editor/common/text/layout';
import { editorViewState } from '../../editor/ui/view/state';
import { inputFocus, type InputFocusTarget } from '../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../input/keyboard/key_input';
import { PointerButton } from '../../input/pointer/buttons';
import { api } from '../../runtime/overlay_api';
import { drawImagePreview, type ImagePreviewCache } from './image_preview';

/** Local image inspection, not an external URL opener or a DOM overlay over the canvas. */
export class ImagePreviewOverlay {
	private readonly focus = inputFocus.createTarget();
	private returnFocus: InputFocusTarget | null = null;
	private url: string | undefined;
	public get visible(): boolean { return this.url !== undefined; }
	public constructor(private readonly previews: ImagePreviewCache) {
		this.focus.bindKeyboard(input => {
			if (isKeyJustPressed('Escape', input) || isKeyJustPressed('Enter', input)) {
				consumeIdeKey('Escape', input); consumeIdeKey('Enter', input); this.close();
			}
		});
	}
	public open(url: string): void {
		this.returnFocus = inputFocus.target; this.url = url; this.focus.focus();
	}
	public close(): void {
		this.url = undefined;
		if (this.focus.hasFocus) inputFocus.setTarget(this.returnFocus);
		this.returnFocus = null;
	}
	public handlePointer(snapshot: PointerSnapshot): boolean {
		if (!this.visible) return false;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) this.close();
		return true;
	}
	public draw(bounds: RectBounds, rowHeight: number): void {
		if (this.url === undefined) return;
		const { left, top, right, bottom } = bounds, font = editorViewState.font.renderFont();
		api.fill_rect(left, top, right, bottom, 0, colors.COLOR_CODE_BACKGROUND);
		api.blit_rect(left + 4, top + 4, right - 4, bottom - 4, 0, colors.COLOR_QUICK_OPEN_OUTLINE);
		api.blit_text_inline_with_font('Image preview', left + 8, top + 8, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		const preview = this.previews.use(this.url);
		if (preview.bitmap) drawImagePreview(preview.bitmap, left + 8, top + rowHeight + 12, right - 8, bottom - rowHeight - 12);
		else api.blit_text_inline_with_font(truncateMeasuredText(preview.error ?? 'Loading image...', right - left - 20, measureTextRange), left + 10, top + rowHeight * 3, 0, colors.COLOR_MARKDOWN_MUTED_TEXT, font);
		api.blit_text_inline_with_font('Click or Esc to close', left + 8, bottom - rowHeight - 6, 0, colors.COLOR_MARKDOWN_MUTED_TEXT, font);
	}
}
