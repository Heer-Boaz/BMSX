import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import type { EditorCommandRunner } from '../../common/commands';
import type { IDisposable } from '../../common/lifecycle';
import * as colors from '../../common/constants';
import { truncateMeasuredText, writeWrappedMeasuredText } from '../../common/text';
import { measureTextRange } from '../../editor/common/text/layout';
import { editorViewState } from '../../editor/ui/view/state';
import { InputFocusScope, inputFocus, type InputFocusTarget } from '../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../input/keyboard/key_input';
import { PointerButton } from '../../../hosts/common/input/pointer_event';
import { pointerCapture } from '../../input/pointer/capture';
import { api } from '../../runtime/overlay_api';
import { drawImagePreview, type ImagePreview, type ImagePreviewCache } from './image_preview';
import { WorkbenchScrollViewport } from './scroll_viewport';
import { WorkbenchScrollControl } from './scroll_control';
import type { WorkbenchSurface } from '../services/windows/model';
import type { WorkbenchSurfaceService } from '../services/windows/service';

/** Local image inspection, not an external URL opener or a DOM overlay over the canvas. */
export class ImagePreviewOverlay {
	private readonly context = inputFocus.createTarget(null, new InputFocusScope(Symbol('image preview')));
	private readonly viewport = new WorkbenchScrollViewport();
	private readonly scroll: WorkbenchScrollControl;
	private readonly bounds = create_rect_bounds();
	private readonly bodyBounds = create_rect_bounds();
	private rowHeight = 0;
	private font: BFont | undefined;
	private heading = '';
	private closeHint = '';
	private readonly statusLines: string[] = [];
	private statusText: string | undefined;
	private statusWidth = -1;
	private statusFont: BFont | undefined;
	private statusEdge: 'start' | 'end' | undefined;
	private returnFocus: InputFocusTarget | null = null;
	private url: string | undefined;
	private image: IDisposable | undefined;
	public readonly surface: WorkbenchSurface;
	public get origin(): InputFocusTarget | null { return this.returnFocus; }
	public get visible(): boolean { return this.url !== undefined; }
	public constructor(private readonly previews: ImagePreviewCache, private readonly surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, commands: EditorCommandRunner) {
		this.scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.context, input => {
			if (!isKeyJustPressed('Escape', input) && !isKeyJustPressed('Enter', input)) {
				this.layoutBody(this.previews.use(this.url!)); return false;
			}
			consumeIdeKey('Escape', input); consumeIdeKey('Enter', input); this.close(); return true;
		}, this.context.scope);
		this.scroll.setInput(this.viewport);
		this.scroll.focusTarget.canFocus = () => this.visible;
		this.scroll.onWillScroll = edge => { this.statusEdge = edge; };
		for (const command of ['tabs.close', 'tabs.next', 'tabs.previous'] as const) {
			this.scroll.focusTarget.registerCommand(command, {
				isEnabled: () => commands.isEnabled(command, this.returnFocus),
				run: () => { const origin = this.returnFocus; this.close(); commands.execute(command, origin); },
			});
		}
		this.surface = surfaces.attach({
			role: 'modal', lifetimeOwner: owner, blockedScope: owner, presentationParent: owner, captureScope: this.context.scope.surfaceScope,
			getBounds: () => this.bounds, getClip: () => this.bounds, isVisible: () => this.visible,
			draw: () => this.draw(),
			handlePointer: snapshot => {
				this.layoutBody(this.previews.use(this.url!));
				if (this.viewport.scrollbar.isVisible() && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.viewport.scrollbar.getTrack())) {
					this.scroll.handlePointer(snapshot); return;
				}
				if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) this.close();
			},
			handleWheel: event => {
				this.layoutBody(this.previews.use(this.url!));
				return this.scroll.handleWheel(event, event.deltaY * this.scroll.lineStep);
			},
			onRetire: () => this.close(),
		});
	}
	public open(url: string): void {
		this.scroll.cancelPointer();
		if (!this.visible) {
			this.returnFocus = inputFocus.target;
			this.context.scope.interactionOrigin = this.returnFocus?.scope;
		}
		this.image?.dispose(); this.image = this.previews.retain(url);
		this.url = url;
		this.statusEdge = 'start';
		this.layoutBody(this.previews.use(url));
		this.viewport.scrollbar.setScroll(0);
		inputFocus.setTarget(this.scroll.focusTarget, this.publishVisibility);
	}
	public close(): void {
		if (!this.visible) return;
		this.scroll.cancelPointer();
		this.url = undefined;
		this.context.scope.interactionOrigin = undefined;
		this.image!.dispose(); this.image = undefined;
		const origin = this.returnFocus;
		this.returnFocus = null;
		this.surfaces.changed();
		if (this.scroll.focusTarget.hasFocus) inputFocus.setTarget(origin);
	}
	public dispose(): void { this.surface.dispose(); this.scroll.dispose(); }
	private readonly publishVisibility = (): void => { this.surfaces.changed(); };
	public layout(bounds: Readonly<RectBounds>, rowHeight: number): void {
		const font = editorViewState.font.renderFont();
		if (this.bounds.left === bounds.left && this.bounds.top === bounds.top && this.bounds.right === bounds.right
			&& this.bounds.bottom === bounds.bottom && this.rowHeight === rowHeight && this.font === font) return;
		const width = bounds.right - bounds.left;
		const textChanged = this.bounds.right - this.bounds.left !== width || this.font !== font;
		write_rect_bounds(this.bounds, bounds.left, bounds.top, bounds.right, bounds.bottom);
		this.rowHeight = rowHeight;
		this.font = font;
		if (textChanged) {
			this.heading = truncateMeasuredText('Image preview', width - 16, measureTextRange);
			this.closeHint = truncateMeasuredText('Click/Esc close', width - 16, measureTextRange);
		}
		const bodyLeft = bounds.left + 8, bodyTop = bounds.top + rowHeight + 12;
		write_rect_bounds(this.bodyBounds, bodyLeft, bodyTop, Math.max(bodyLeft, bounds.right - 8), Math.max(bodyTop, bounds.bottom - rowHeight - 12));
		if (this.visible) this.layoutBody(this.previews.use(this.url!));
		this.surfaces.changed();
	}
	/** Text owns a complete document; geometry only projects the existing scroll range. */
	private layoutBody(preview: ImagePreview): void {
		const body = this.bodyBounds, font = this.font!, text = preview.error ?? 'Loading image…';
		const width = body.right - body.left - colors.SCROLLBAR_WIDTH - 4;
		if (!preview.bitmap && (this.statusText !== text || this.statusWidth !== width || this.statusFont !== font)) {
			if (this.statusText !== text) this.statusEdge = 'start';
			this.statusText = text; this.statusWidth = width; this.statusFont = font;
			writeWrappedMeasuredText(this.statusLines, text, width, width, text.length + 1, measureTextRange);
		}
		this.viewport.layout(body.left, body.top, body.right, body.bottom, preview.bitmap ? 0 : this.statusLines.length * font.lineHeight);
		if (this.statusEdge === 'start') this.viewport.scrollbar.setScroll(0);
		else if (this.statusEdge === 'end') this.viewport.scrollbar.setScroll(this.viewport.contentHeight);
		this.scroll.lineStep = font.lineHeight;
	}
	private draw(): void {
		const { left, top, right, bottom } = this.bounds, rowHeight = this.rowHeight, font = this.font!;
		api.fill_rect(left, top, right, bottom, 0, colors.COLOR_CODE_BACKGROUND);
		api.blit_rect(left + 4, top + 4, right - 4, bottom - 4, 0, colors.COLOR_QUICK_OPEN_OUTLINE);
		api.blit_text_inline_with_font(this.heading, left + 8, top + 8, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		const preview = this.previews.use(this.url!);
		this.layoutBody(preview);
		const body = this.bodyBounds;
		if (preview.bitmap) {
			api.pushClipRect(body.left, body.top, body.right, body.bottom);
			drawImagePreview(preview.bitmap, body.left, body.top, body.right, body.bottom);
			api.popClipRect();
		}
		else {
			const viewport = this.viewport;
			api.pushClipRect(viewport.bounds.left, viewport.bounds.top, viewport.bounds.right, viewport.bounds.bottom);
			for (let index = Math.trunc(viewport.scrollTop / font.lineHeight), top = viewport.offsetTop + index * font.lineHeight;
				index < this.statusLines.length && top < viewport.bounds.bottom; index++, top += font.lineHeight) {
				api.blit_text_inline_with_font(this.statusLines[index], viewport.bounds.left + 2, top, 0, colors.COLOR_MARKDOWN_MUTED_TEXT, font);
			}
			api.popClipRect();
			viewport.scrollbar.draw(colors.COLOR_CODE_BACKGROUND, colors.COLOR_RESOURCE_VIEWER_TEXT);
		}
		api.blit_text_inline_with_font(this.closeHint, left + 8, bottom - rowHeight - 6, 0, colors.COLOR_MARKDOWN_MUTED_TEXT, font);
	}
}
