import { STATUS_PRIORITY_CONTENT, type WorkbenchStatusItem } from '../../common/status_bar';
import * as constants from '../../../common/constants';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import { KeyModifier } from '../../../../hosts/common/input/text';
import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { ResourceViewerNavigationSelection } from './navigation_selection';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { consumeIdeKey, isKeyDown } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { api } from '../../../runtime/overlay_api';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { EditorCommandRunner } from '../../../common/commands';
import { editorViewState } from '../../../editor/ui/view/state';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { measureText } from '../../../editor/common/text/layout';
import type { ResourceImagePreview, ResourceViewerInput } from './editor_input';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { Scrollbar } from '../../ui/scrollbar';
import { ScrollbarPointerControl } from '../../ui/scrollbar_pointer';
import { WorkbenchImageControl } from '../../ui/image_control';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { ResourceViewerContent, ResourceViewerContentView } from './model';

/** One resource view: full-client image interaction or its independently retained information reader. */
export class ResourceViewerEditorPane extends WorkbenchViewEditorPane<ResourceViewerInput> {
	public readonly statusItems: readonly WorkbenchStatusItem[] = [
		{ text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' },
	];
	private readonly scrollbar = new Scrollbar('vertical');
	private readonly horizontal = new Scrollbar('horizontal');
	private readonly scrollbarPointer: ScrollbarPointerControl;
	private readonly image: WorkbenchImageControl;
	private readonly track = create_rect_bounds();
	private readonly horizontalTrack = create_rect_bounds();
	private readonly viewBounds = create_rect_bounds();
	private projectedContent: ResourceViewerContent | undefined;
	private projectedFont: typeof editorViewState.font | undefined;
	private textTop = 0;
	private textCapacity = 0;
	private textWidth = 0;
	private attachedImage: ResourceImagePreview | undefined;
	private statusType: string | undefined;
	private statusImageWidth: number | undefined;
	private statusImageHeight: number | undefined;
	private statusScale: number | undefined;
	private statusImageMode: ResourceImagePreview['view']['mode'] | undefined;
	private statusImageAttached = false;
	private readonly onDidScroll = (scroll: number): void => { this.input.view.scroll = scroll; };
	private readonly onDidScrollLeft = (scroll: number): void => { this.input.view.scrollLeft = scroll; };

	public constructor(scope: InputFocusScope, private readonly commands: EditorCommandRunner, private readonly contextMenu: ContextMenuController) {
		super(scope);
		this.scrollbarPointer = new ScrollbarPointerControl(pointerCapture, scope.surfaceScope);
		this.image = new WorkbenchImageControl(inputFocus, pointerCapture, this.focusTarget, scope.surfaceScope);
		this.image.focusTarget.commandContext = this.focusTarget;
		for (const target of [this.focusTarget, this.image.focusTarget]) {
			for (const [command, view] of [['resourceViewer.preview', 'preview'], ['resourceViewer.info', 'info']] as const) target.registerCommand(command, {
				isEnabled: () => this.hasInput && this.input.view.content.image !== undefined
					&& (view === 'info' || this.input.view.content.image.rom !== null),
				isChecked: () => this.hasInput && this.input.view.contentView === view,
				run: () => this.showContentView(view),
			});
			target.registerCommand('contextMenu', { isEnabled: () => this.hasInput, run: () => {
				const bounds = this.contentBounds;
				this.openContextMenu((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2, true);
			} });
		}
	}

	public override get commandTarget(): InputFocusTarget { return this.attachedImage === undefined ? this.focusTarget : this.image.focusTarget; }
	public override getSelection(): ResourceViewerNavigationSelection { return new ResourceViewerNavigationSelection(this.input); }
	protected activate(): void {}

	public override clearInput(): void {
		const scope = this.focusTarget.scope, context = scope.contextGeneration;
		this.scrollbarPointer.cancelPointer();
		this.attachedImage = undefined;
		this.image.clearInput();
		if (scope.contextGeneration !== context) return;
		super.clearInput();
	}

	public override dispose(): void {
		this.scrollbarPointer.cancelPointer();
		this.image.dispose();
		super.dispose();
	}

	public override setOptions(_selection?: EditorTextSelection, navigationSelection?: ResourceViewerNavigationSelection): void {
		this.input.refreshContent();
		navigationSelection?.restore(this.input);
		this.update();
	}

	public override layout(bounds: Readonly<RectBounds>): void { super.layout(bounds); this.update(); }

	public override update(): void {
		const input = this.input, view = input.view, content = view.content, bounds = this.contentBounds;
		const scope = this.focusTarget.scope, context = scope.contextGeneration;
		let preview: ResourceImagePreview | undefined;
		if (view.contentView === 'preview' && content.image !== undefined && content.image.rom !== null) {
			preview = input.preparePreview(content.image.asset, content.image.rom);
			preview.view.layout(bounds.left, bounds.top, bounds.right, bounds.bottom);
			if (input.imagePosition !== undefined) {
				preview.view.restoreState(input.imagePosition);
				input.imagePosition = undefined;
			}
		} else {
			const font = editorViewState.font, previous = this.viewBounds;
			const contentChanged = this.projectedContent !== content || this.projectedFont !== font;
			if (contentChanged) {
				this.projectedContent = content; this.projectedFont = font; this.textWidth = 0;
				for (const line of content.lines) this.textWidth = Math.max(this.textWidth, measureText(line) + constants.RESOURCE_PANEL_PADDING_X * 2);
			}
			if (contentChanged || previous.left !== bounds.left || previous.top !== bounds.top || previous.right !== bounds.right || previous.bottom !== bounds.bottom) {
				write_rect_bounds(previous, bounds.left, bounds.top, bounds.right, bounds.bottom);
				const right = Math.max(bounds.left, bounds.right - constants.SCROLLBAR_WIDTH);
				const bottom = Math.max(bounds.top, bounds.bottom - constants.SCROLLBAR_WIDTH);
				write_rect_bounds(this.track, right, bounds.top, bounds.right, bottom);
				write_rect_bounds(this.horizontalTrack, bounds.left, bottom, right, bounds.bottom);
				this.textTop = bounds.top + 2;
				this.textCapacity = Math.max(0, Math.trunc((bottom - this.textTop) / font.lineHeight));
			}
			this.scrollbar.layout(this.track, content.lines.length, this.textCapacity, view.scroll);
			this.horizontal.layout(this.horizontalTrack, this.textWidth, this.track.left - bounds.left, view.scrollLeft);
			view.scroll = this.scrollbar.getScroll(); view.scrollLeft = this.horizontal.getScroll();
		}
		if (preview !== this.attachedImage) {
			this.scrollbarPointer.cancelPointer();
			this.attachedImage = preview;
			this.image.clearInput();
			if (scope.contextGeneration !== context) return;
			if (preview !== undefined) this.image.setInput(preview.view);
		}
	}

	private showContentView(view: ResourceViewerContentView): void {
		const scope = this.focusTarget.scope, context = scope.contextGeneration, revision = inputFocus.revision;
		const origin = inputFocus.admittedTarget;
		this.input.view.contentView = view;
		this.update();
		if (scope.contextGeneration === context && inputFocus.revision === revision && origin !== null && scope.contains(origin.scope)) this.focus();
	}

	private openContextMenu(x: number, y: number, keyboard = false): void {
		this.contextMenu.show(x, y, WORKBENCH_MENUS['resourceViewer.context'], this.commands, {
			selectFirst: keyboard, invocationOrigin: this.commandTarget, returnFocus: this.commandTarget, commandTarget: this.commandTarget,
		});
	}

	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.contentBounds)) return false;
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
			if (this.focusInput(this.input)) this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
			return true;
		}
		if (this.attachedImage !== undefined) return this.image.handlePointer(snapshot);
		if (point_in_rect(snapshot.viewportX, snapshot.viewportY, this.track)) {
			if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && this.scrollbar.isVisible()) this.scrollbarPointer.beginDrag(snapshot, this.scrollbar, this.onDidScroll);
			return true;
		}
		if (point_in_rect(snapshot.viewportX, snapshot.viewportY, this.horizontalTrack)) {
			if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && this.horizontal.isVisible()) this.scrollbarPointer.beginDrag(snapshot, this.horizontal, this.onDidScrollLeft);
			return true;
		}
		if (justPressed) this.focus();
		return true;
	}

	public draw(): void {
		const view = this.input.view, bounds = this.contentBounds, preview = this.attachedImage;
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_RESOURCE_VIEWER_BACKGROUND);
		if (preview !== undefined) {
			const image = preview.view, clip = image.bounds, bitmap = preview.bitmap;
			api.pushClipRect(clip.left, clip.top, clip.right, clip.bottom);
			api.pushTransform(image.transform);
			api.drawBitmap(bitmap, 0, 0, bitmap.image.width, bitmap.image.height);
			api.popTransform(); api.popClipRect();
			image.horizontal.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
			image.vertical.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
			return;
		}
		api.pushClipRect(bounds.left, bounds.top, this.track.left, this.horizontalTrack.top);
		const left = bounds.left + constants.RESOURCE_PANEL_PADDING_X - view.scrollLeft;
		const start = view.scroll | 0, end = Math.min(view.content.lines.length, start + this.textCapacity);
		for (let index = start; index < end; index++) drawEditorText(editorViewState.font, view.content.lines[index], left,
			this.textTop + (index - start) * this.projectedFont!.lineHeight, 0, constants.COLOR_RESOURCE_VIEWER_TEXT);
		api.popClipRect();
		this.scrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
		this.horizontal.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}

	public handleKeyboard(input: KeyInputEvent): void {
		for (const code of SCROLL_KEYS) {
			if (!isKeyDown(code, input)) continue;
			consumeIdeKey(code, input); this.scrollbarPointer.cancelPointer();
			const current = this.scrollbar.getScroll(), page = Math.max(1, this.textCapacity);
			switch (code) {
				case 'ArrowLeft': this.horizontal.setScroll(this.horizontal.getScroll() - 16); break;
				case 'ArrowRight': this.horizontal.setScroll(this.horizontal.getScroll() + 16); break;
				case 'ArrowUp': this.scrollbar.setScroll(current - 1); break;
				case 'ArrowDown': this.scrollbar.setScroll(current + 1); break;
				case 'PageUp': this.scrollbar.setScroll(current - page); break;
				case 'PageDown': this.scrollbar.setScroll(current + page); break;
				case 'Home': this.scrollbar.setScroll(0); this.horizontal.setScroll(0); break;
				case 'End': this.scrollbar.setScroll(this.scrollbar.getMaximumScroll()); break;
			}
			this.input.view.scroll = this.scrollbar.getScroll(); this.input.view.scrollLeft = this.horizontal.getScroll();
			return;
		}
	}

	public handleWheel(event: WheelInputSnapshot): void {
		if (this.attachedImage !== undefined) { this.image.handleWheel(event); return; }
		if (!event.valid || !event.insideViewport || !point_in_rect(event.viewportX, event.viewportY, this.contentBounds)) return;
		this.scrollbarPointer.cancelPointer();
		if ((event.modifiers & KeyModifier.shift) !== 0 && event.deltaX === 0) this.horizontal.setScroll(this.horizontal.getScroll() + event.deltaY * 16);
		else {
			this.scrollbar.setScroll(this.scrollbar.getScroll() + event.deltaY);
			this.horizontal.setScroll(this.horizontal.getScroll() + event.deltaX * 16);
		}
		this.input.view.scroll = this.scrollbar.getScroll(); this.input.view.scrollLeft = this.horizontal.getScroll();
	}

	public updateStatus(): void {
		const preview = this.input.preview;
		const type = this.input.resource.source.type, width = preview?.bitmap.image.width, height = preview?.bitmap.image.height;
		const scale = preview?.view.scale, mode = preview?.view.mode, attached = this.attachedImage !== undefined;
		if (type === this.statusType && width === this.statusImageWidth && height === this.statusImageHeight
			&& scale === this.statusScale && mode === this.statusImageMode && attached === this.statusImageAttached) return;
		this.statusType = type; this.statusImageWidth = width; this.statusImageHeight = height;
		this.statusScale = scale; this.statusImageMode = mode; this.statusImageAttached = attached;
		this.statusItems[0].text = preview === undefined ? type.toUpperCase()
			: `${width} x ${height} / ${!attached ? 'Info' : `${Math.round(scale! * 100)}%${mode === 'fit' ? ' Fit' : ''}`}`;
	}
}

const SCROLL_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'] as const;
