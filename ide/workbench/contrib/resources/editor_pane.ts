import * as constants from '../../../common/constants';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { ResourceViewerNavigationSelection } from './navigation_selection';
import type { InputFocusScope } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { consumeIdeKey, isKeyDown } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { api } from '../../../runtime/overlay_api';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { editorViewState } from '../../../editor/ui/view/state';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { measureText } from '../../../editor/common/text/layout';
import type { ResourceViewerInput } from './editor_input';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { Scrollbar } from '../../ui/scrollbar';
import { ScrollbarPointerControl } from '../../ui/scrollbar_pointer';
import { layoutResourceViewer, type ResourceViewerLayout } from './viewer';
import type { ResourceViewerContent } from './model';

// Metadata names and values need a reading column even when the image itself can shrink.

export class ResourceViewerEditorPane extends WorkbenchViewEditorPane<ResourceViewerInput> {

	public override getSelection(): ResourceViewerNavigationSelection {
		return new ResourceViewerNavigationSelection(this.input.view.scroll);
	}

	private readonly scrollbar = new Scrollbar('vertical');
	private readonly scrollbarPointer: ScrollbarPointerControl;
	private readonly track = create_rect_bounds();
	private readonly viewBounds = create_rect_bounds();
	private readonly viewerLayout: ResourceViewerLayout = {
		hasImage: false, imageLeft: 0, imageTop: 0, imageWidth: 0, imageHeight: 0, imageBottom: 0,
		imageScale: 1, textTop: 0, textCapacity: 0,
	};
	private projectedContent: ResourceViewerContent | undefined;
	private projectedLineHeight = 0;
	private readonly onDidScroll = (scroll: number): void => { this.input.view.scroll = scroll; };

	public constructor(scope: InputFocusScope) {
		super(scope);
		this.scrollbarPointer = new ScrollbarPointerControl(pointerCapture, scope.surfaceScope);
	}

	protected activate(): void {}

	public override clearInput(): void {
		this.scrollbarPointer.cancelPointer();
		super.clearInput();
	}

	public override dispose(): void {
		this.scrollbarPointer.cancelPointer();
		super.dispose();
	}

	public override setOptions(_selection?: EditorTextSelection, navigationSelection?: ResourceViewerNavigationSelection): void {
		this.input.refreshContent();
		navigationSelection?.restore(this.input.view);
		this.update();
	}

	public override layout(bounds: Readonly<RectBounds>): void {
		super.layout(bounds);
		this.update();
	}

	public override update(): void {
		const view = this.input.view, content = view.content, bounds = this.contentBounds;
		const lineHeight = editorViewState.lineHeight, previous = this.viewBounds;
		if (this.projectedContent !== content || this.projectedLineHeight !== lineHeight
			|| previous.left !== bounds.left || previous.top !== bounds.top || previous.right !== bounds.right || previous.bottom !== bounds.bottom) {
			this.projectedContent = content;
			this.projectedLineHeight = lineHeight;
			write_rect_bounds(previous, bounds.left, bounds.top, bounds.right, bounds.bottom);
			layoutResourceViewer(this.viewerLayout, view, bounds, lineHeight);
			write_rect_bounds(this.track, Math.max(bounds.left, bounds.right - constants.SCROLLBAR_WIDTH), bounds.top, bounds.right, bounds.bottom);
		}
		this.scrollbar.layout(this.track, content.lines.length, this.viewerLayout.textCapacity, view.scroll);
		view.scroll = this.scrollbar.getScroll();
	}

	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.contentBounds)) return false;
		if (point_in_rect(snapshot.viewportX, snapshot.viewportY, this.track)) {
			if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && this.scrollbar.isVisible())
				this.scrollbarPointer.beginDrag(snapshot, this.scrollbar, this.onDidScroll);
			return true;
		}
		if (justPressed) this.focus();
		return true;
	}

	public draw(): void {
		const view = this.input.view, bounds = this.contentBounds, layout = this.viewerLayout;
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_RESOURCE_VIEWER_BACKGROUND);
		api.pushClipRect(bounds.left, bounds.top, this.track.left, bounds.bottom);
		const left = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
		const start = view.scroll | 0, end = Math.min(view.content.lines.length, start + layout.textCapacity);
		if (view.content.lines.length === 0)
			drawEditorText(editorViewState.font, '<empty>', left, layout.textTop, 0, constants.COLOR_RESOURCE_VIEWER_TEXT);
		else for (let index = start; index < end; index++)
			drawEditorText(editorViewState.font, view.content.lines[index], left,
				layout.textTop + (index - start) * this.projectedLineHeight, 0, constants.COLOR_RESOURCE_VIEWER_TEXT);
		api.popClipRect();
		if (this.scrollbar.isVisible()) this.scrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}

	public handleKeyboard(input: KeyInputEvent): void {
		for (const code of SCROLL_KEYS) {
			if (!isKeyDown(code, input)) continue;
			consumeIdeKey(code, input);
			this.scrollbarPointer.cancelPointer();
			const current = this.scrollbar.getScroll(), page = Math.max(1, this.viewerLayout.textCapacity);
			switch (code) {
				case 'ArrowUp': this.scrollbar.setScroll(current - 1); break;
				case 'ArrowDown': this.scrollbar.setScroll(current + 1); break;
				case 'PageUp': this.scrollbar.setScroll(current - page); break;
				case 'PageDown': this.scrollbar.setScroll(current + page); break;
				case 'Home': this.scrollbar.setScroll(0); break;
				case 'End': this.scrollbar.setScroll(this.scrollbar.getMaximumScroll()); break;
			}
			this.input.view.scroll = this.scrollbar.getScroll();
			return;
		}
	}

	public handleWheel(event: WheelInputSnapshot): void {
		if (!event.valid || !event.insideViewport || !point_in_rect(event.viewportX, event.viewportY, this.contentBounds)) return;
		this.scrollbarPointer.cancelPointer();
		this.scrollbar.setScroll(this.scrollbar.getScroll() + event.deltaY);
		this.input.view.scroll = this.scrollbar.getScroll();
	}

	public drawStatusBar(bounds: Readonly<RectBounds>, textColor: number): void {
		const viewer = this.input.view;
		const info = `${viewer.content.resource.source.type.toUpperCase()} ${viewer.content.resource.source.resid}`;
		const detail = viewer.content.resource.path;
		drawEditorText(editorViewState.font, info, bounds.left + 4, bounds.top + 2, 0, textColor);
		if (detail.length > 0) {
			drawEditorText(
				editorViewState.font,
				detail,
				bounds.right - measureText(detail) - 4,
				bounds.top + 2,
				0,
				textColor,
			);
		}
	}
}

const SCROLL_KEYS = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'] as const;
