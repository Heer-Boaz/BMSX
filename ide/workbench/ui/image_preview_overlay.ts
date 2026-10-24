import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import type { EditorCommandRunner } from '../../common/commands';
import type { IDisposable } from '../../common/lifecycle';
import * as colors from '../../common/constants';
import { truncateMeasuredText } from '../../common/text';
import { measureTextRange } from '../../editor/common/text/layout';
import { editorViewState } from '../../editor/ui/view/state';
import { InputFocusScope, inputFocus, type InputFocusTarget } from '../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../input/keyboard/key_input';
import { PointerButton } from '../../../hosts/common/input/pointer_event';
import { api } from '../../runtime/overlay_api';
import { drawImagePreview, type ImagePreviewCache } from './image_preview';
import type { WorkbenchSurface } from '../services/windows/model';
import type { WorkbenchSurfaceService } from '../services/windows/service';

/** Local image inspection, not an external URL opener or a DOM overlay over the canvas. */
export class ImagePreviewOverlay {
	private readonly focus = inputFocus.createTarget(null, new InputFocusScope(Symbol('image preview')));
	private readonly bounds = create_rect_bounds();
	private rowHeight = 0;
	private font: BFont | undefined;
	private heading = '';
	private closeHint = '';
	private status = '';
	private statusText: string | undefined;
	private returnFocus: InputFocusTarget | null = null;
	private url: string | undefined;
	private image: IDisposable | undefined;
	public readonly surface: WorkbenchSurface;
	public get origin(): InputFocusTarget | null { return this.returnFocus; }
	public get visible(): boolean { return this.url !== undefined; }
	public constructor(private readonly previews: ImagePreviewCache, private readonly surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, commands: EditorCommandRunner) {
		for (const command of ['tabs.close', 'tabs.next', 'tabs.previous'] as const) {
			this.focus.registerCommand(command, {
				isEnabled: () => commands.isEnabled(command, this.returnFocus),
				run: () => { const origin = this.returnFocus; this.close(); commands.execute(command, origin); },
			});
		}
		this.focus.canFocus = () => this.visible;
		this.focus.bindKeyboard(input => {
			if (isKeyJustPressed('Escape', input) || isKeyJustPressed('Enter', input)) {
				consumeIdeKey('Escape', input); consumeIdeKey('Enter', input); this.close();
			}
		});
		this.surface = surfaces.attach({
			role: 'modal', lifetimeOwner: owner, blockedScope: owner, captureScope: this.focus.scope.surfaceScope,
			getBounds: () => this.bounds, getClip: () => this.bounds, isVisible: () => this.visible,
			draw: () => this.draw(),
			handlePointer: snapshot => {
				if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) this.close();
			},
			onRetire: () => this.close(),
		});
	}
	public open(url: string): void {
		if (!this.visible) this.returnFocus = inputFocus.target;
		this.image?.dispose(); this.image = this.previews.retain(url);
		this.url = url; this.focus.focus();
		this.surfaces.changed();
	}
	public close(): void {
		if (!this.visible) return;
		this.url = undefined;
		this.image!.dispose(); this.image = undefined;
		if (this.focus.hasFocus) inputFocus.setTarget(this.returnFocus);
		this.returnFocus = null;
		this.surfaces.changed();
	}
	public dispose(): void { this.surface.dispose(); }
	public layout(bounds: Readonly<RectBounds>, rowHeight: number): void {
		const font = editorViewState.font.renderFont();
		if (this.bounds.left === bounds.left && this.bounds.top === bounds.top && this.bounds.right === bounds.right
			&& this.bounds.bottom === bounds.bottom && this.rowHeight === rowHeight && this.font === font) return;
		write_rect_bounds(this.bounds, bounds.left, bounds.top, bounds.right, bounds.bottom);
		this.rowHeight = rowHeight;
		this.font = font;
		const width = bounds.right - bounds.left;
		this.heading = truncateMeasuredText('Image preview', width - 16, measureTextRange);
		this.closeHint = truncateMeasuredText('Click/Esc close', width - 16, measureTextRange);
		this.statusText = undefined;
		this.surfaces.changed();
	}
	private draw(): void {
		const { left, top, right, bottom } = this.bounds, rowHeight = this.rowHeight, font = this.font!;
		api.fill_rect(left, top, right, bottom, 0, colors.COLOR_CODE_BACKGROUND);
		api.blit_rect(left + 4, top + 4, right - 4, bottom - 4, 0, colors.COLOR_QUICK_OPEN_OUTLINE);
		api.blit_text_inline_with_font(this.heading, left + 8, top + 8, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		const preview = this.previews.use(this.url!);
		if (preview.bitmap) drawImagePreview(preview.bitmap, left + 8, top + rowHeight + 12, right - 8, bottom - rowHeight - 12);
		else {
			const text = preview.error ?? 'Loading image…';
			if (this.statusText !== text) {
				this.statusText = text;
				this.status = truncateMeasuredText(text, right - left - 20, measureTextRange);
			}
			api.blit_text_inline_with_font(this.status, left + 10, top + rowHeight * 3, 0, colors.COLOR_MARKDOWN_MUTED_TEXT, font);
		}
		api.blit_text_inline_with_font(this.closeHint, left + 8, bottom - rowHeight - 6, 0, colors.COLOR_MARKDOWN_MUTED_TEXT, font);
	}
}
