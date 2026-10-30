import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandRunner } from '../../../common/commands';
import type { DisposableStore } from '../../../common/lifecycle';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import type { EditorFont } from '../../../editor/ui/view/font';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import type { WorkbenchViewSizeConstraints } from '../../common/layout';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, type WorkbenchActionBarState } from '../action_bar';
import { WorkbenchActionBarControl } from '../action_bar_control';
import type { WorkbenchMenuPresentation } from '../menu/model';
import { WorkbenchTooltip } from '../tooltip';
import { createWorkbenchViewPanelLayout, layoutWorkbenchViewPanel } from './layout';
import { drawWorkbenchViewPanel } from './render';

export interface WorkbenchViewPanelContent<View> {
	readonly focusTarget: InputFocusTarget;
	readonly canFocus: boolean;
	setView(view: View, bounds: Readonly<RectBounds>): void;
	clearView(): void;
	layout(bounds: Readonly<RectBounds>): void;
	update?(): void;
	draw(): void;
	focus(): boolean;
	setFocusNeighbors(previous: InputFocusTarget, next: InputFocusTarget): void;
	handlePointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean;
	handleWheel(event: WheelInputSnapshot): boolean;
	onPointerLeave?(): void;
	dispose(): void;
}
export type WorkbenchViewPanelOptions<View, Content extends WorkbenchViewPanelContent<View>> = {
	readonly title: string;
	readonly description: string;
	readonly view: View;
	readonly actions: WorkbenchActionBarState;
	readonly contextActions: WorkbenchMenuPresentation;
	readonly commands: EditorCommandRunner;
	readonly contextMenu: ContextMenuController;
	readonly surfaces: WorkbenchSurfaceService;
	readonly surface: WorkbenchSurface;
	readonly workArea: Readonly<RectBounds>;
	readonly scope: InputFocusScope;
	readonly commandTarget: InputFocusTarget;
	readonly focusReturn: InputFocusTarget;
	isPresented(): boolean;
	createControl(scope: InputFocusScope, panelTarget: InputFocusTarget, surface: WorkbenchSurface): Content;
	measureContent(font: EditorFont, target: WorkbenchViewSizeConstraints): void;
	onDidOpenActions?(lifetime: DisposableStore): void;
};

/** A real titled region: chrome, client allocation, focus boundary and attachment lifetime. */
export class WorkbenchViewPanel<View, Content extends WorkbenchViewPanelContent<View>> {
	public readonly scope: InputFocusScope;
	public readonly surface: WorkbenchSurface;
	public readonly commandTarget: InputFocusTarget;
	public readonly control: Content;
	public readonly layoutState = createWorkbenchViewPanelLayout();
	public readonly actionBar: WorkbenchActionBarControl;
	private readonly tooltip = new WorkbenchTooltip();
	private readonly unbindKeyboard: () => void;
	private attachedValue = false;
	private revision = 0;
	private titleHovered = false;
	private focusMembership = -1;
	private headerVisible = true;
	public get attached(): boolean { return this.attachedValue; }
	public get contextActions(): WorkbenchMenuPresentation { return this.options.contextActions; }
	public get description(): string { return this.options.description; }

	public constructor(private readonly options: WorkbenchViewPanelOptions<View, Content>) {
		this.scope = new InputFocusScope(Symbol('view panel'), options.scope);
		this.surface = options.surfaces.prepare({ role: 'content', lifetimeOwner: options.surface, presentationParent: options.surface,
			captureScope: this.scope.surfaceScope, isVisible: () => this.attached && options.isPresented(),
			getBounds: () => this.layoutState, getClip: options.surface.getClip,
			draw: () => this.draw(), handlePointer: snapshot => this.handlePointer(snapshot),
			handleWheel: event => { this.handleWheel(event); return true; },
			onRetire: () => this.detach(),
		});
		this.commandTarget = inputFocus.createTarget(options.focusReturn, this.scope);
		this.commandTarget.commandContext = options.commandTarget;
		this.commandTarget.canFocus = () => this.attached && this.layoutState.left < this.layoutState.right && this.layoutState.top < this.layoutState.bottom;
		this.unbindKeyboard = this.commandTarget.bindKeyboard(event => {
			if (!isKeyJustPressed('Escape', event)) return;
			consumeIdeKey('Escape', event); options.focusReturn.focus();
		});
		this.commandTarget.registerCommand('contextMenu', { isEnabled: () => this.attached,
			run: () => this.openContextMenu(this.layoutState.client.left + 4,
				this.headerVisible ? this.layoutState.header.bottom : this.layoutState.client.top, true) });
		this.actionBar = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, options.commands,
			this.commandTarget, () => {
				if (this.control.canFocus) this.control.focus(); else this.commandTarget.focus();
			}, options.contextMenu);
		this.actionBar.focusTarget.registerCommand('contextMenu', { isEnabled: () => this.attached && this.headerVisible,
			run: () => this.openContextMenu(this.layoutState.header.left + 4, this.layoutState.header.bottom, true, this.actionBar.focusTarget) });
		this.actionBar.onDidOpenOverflow = lifetime => {
			this.tooltip.hide(); this.titleHovered = false;
			options.onDidOpenActions?.(lifetime);
		};
		this.control = options.createControl(this.scope, this.commandTarget, this.surface);
		this.tooltip.attach(options.surfaces, this.surface, options.workArea);
	}
	public measure(font: EditorFont, target: WorkbenchViewSizeConstraints): void {
		this.options.measureContent(font, target);
		if (this.headerVisible) {
			target.minimumHeight += font.lineHeight + 4;
			target.minimumWidth = Math.max(target.minimumWidth, WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH + font.advance('…') + 12);
			target.preferredWidth = Math.max(target.minimumWidth, target.preferredWidth);
		}
	}
	/** The container changes chrome allocation without retiring its content attachment. */
	public setHeaderVisible(visible: boolean): void {
		if (this.headerVisible === visible) return;
		this.headerVisible = visible;
		const revision = ++this.revision;
		if (!this.attached) return;
		this.tooltip.hide(); this.titleHovered = false; pointerHover.release(this);
		const focused = this.actionBar.focusTarget.hasFocus;
		if (visible) this.actionBar.setInput(this.options.actions, this.options.commandTarget);
		else this.actionBar.clearInput();
		if (revision !== this.revision) return;
		this.layout(this.layoutState);
		if (revision === this.revision && focused && this.commandTarget.hasFocus) this.focus();
	}
	public attach(bounds: Readonly<RectBounds>): void {
		if (this.attached) { this.layout(bounds); return; }
		const revision = ++this.revision;
		this.attachedValue = true; this.focusMembership = -1;
		this.actionBar.clearInput();
		if (revision !== this.revision) return;
		if (this.headerVisible) this.actionBar.setInput(this.options.actions, this.options.commandTarget);
		if (revision !== this.revision) return;
		layoutWorkbenchViewPanel(this.layoutState, bounds, this.options.title, this.options.actions, this.headerVisible);
		if (this.headerVisible) this.actionBar.update();
		if (revision !== this.revision) return;
		this.control.setView(this.options.view, this.layoutState.client);
		if (revision !== this.revision) return;
		this.bindFocusOrder();
		this.options.surfaces.publish(this.surface);
	}
	public layout(bounds: Readonly<RectBounds>): void {
		if (!this.attached) return;
		const revision = this.revision;
		if (!layoutWorkbenchViewPanel(this.layoutState, bounds, this.options.title, this.options.actions, this.headerVisible)) return;
		if (this.headerVisible) this.actionBar.update();
		if (revision !== this.revision) return;
		this.control.layout(this.layoutState.client);
		if (revision === this.revision) this.bindFocusOrder();
	}
	public update(): void {
		if (!this.attached) return;
		const revision = this.revision;
		if (this.headerVisible) this.actionBar.update();
		if (revision !== this.revision) return;
		if (layoutWorkbenchViewPanel(this.layoutState, this.layoutState, this.options.title, this.options.actions, this.headerVisible)) this.control.layout(this.layoutState.client);
		else this.control.update?.();
		if (revision !== this.revision) return;
		this.bindFocusOrder();
		const hint = this.actionBar.tooltipItem;
		if (hint !== undefined) this.tooltip.show(hint.tooltip, hint.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.options.workArea);
		else if (this.titleHovered) this.tooltip.show(this.options.description, this.layoutState.titleBounds,
			editorViewState.font.renderFont(), measureTextRange, measureText, this.options.workArea);
		else this.tooltip.hide();
	}
	private bindFocusOrder(): void {
		const actions = this.actionBar.focusTarget;
		const body = this.control.canFocus, toolbar = actions.canFocus!();
		const membership = (body ? 1 : 0) | (toolbar ? 2 : 0);
		if (this.focusMembership === membership) return;
		this.focusMembership = membership;
		if (body) {
			if (toolbar) actions.next = this.control.focusTarget;
			const boundary = toolbar ? actions : this.control.focusTarget;
			this.control.setFocusNeighbors(boundary, boundary);
		} else actions.next = actions.previous = actions;
	}
	public draw(): void {
		if (!this.attached) return;
		const b = this.layoutState;
		api.pushClipRect(b.left, b.top, b.right, b.bottom);
		drawWorkbenchViewPanel(b, this.options.actions, inputFocus.target !== null && this.scope.contains(inputFocus.target.scope));
		this.control.draw(); api.popClipRect();
	}
	public focus(): void {
		if (!this.attached) return;
		if (this.control.canFocus) this.control.focus();
		else if (this.actionBar.focusTarget.canFocus!()) this.actionBar.focusTarget.focus();
		else this.commandTarget.focus();
	}
	public handlePointer(snapshot: PointerInputSnapshot): void {
		if (!this.attached) return;
		const interaction = inputFocus.interactionRevision;
		const header = this.headerVisible && snapshot.valid && snapshot.insideViewport
			&& point_in_rect(snapshot.viewportX, snapshot.viewportY, this.layoutState.header);
		// The panel owns its complete header context, including the toolbar's Source and More targets.
		if (header && (snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
			this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
			if (interaction === inputFocus.interactionRevision) this.commandTarget.activate();
			return;
		}
		if (this.headerVisible && this.actionBar.handlePointer(snapshot)) return;
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.layoutState)) return;
		this.titleHovered = header && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.layoutState.titleBounds);
		if (this.titleHovered) pointerHover.visit(this); else pointerHover.release(this);
		if (header) {
			if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) this.focus();
		} else this.control.handlePointer(snapshot, (snapshot.justPressedButtons & PointerButton.Primary) !== 0);
		if (snapshot.justPressedButtons !== 0 && interaction === inputFocus.interactionRevision) this.commandTarget.activate();
	}
	public handleWheel(event: WheelInputSnapshot): void { if (this.attached) this.control.handleWheel(event); }
	public onPointerLeave(): void { this.titleHovered = false; this.tooltip.hide(); this.control.onPointerLeave?.(); }
	private openContextMenu(x: number, y: number, keyboard = false, origin = this.commandTarget): void {
		const revision = this.revision;
		this.tooltip.hide(); this.titleHovered = false;
		this.options.contextMenu.show(x, y, this.options.contextActions, this.options.commands, {
			selectFirst: keyboard, invocationOrigin: origin, returnFocus: origin, commandTarget: this.options.commandTarget,
			onWillShow: lifetime => {
				this.options.onDidOpenActions?.(lifetime);
				if (!this.attached || revision !== this.revision) this.options.contextMenu.hide(false);
			},
		});
	}
	public detach(): void {
		if (!this.attached) return;
		const revision = ++this.revision;
		this.attachedValue = false; this.tooltip.hide(); this.titleHovered = false; pointerHover.release(this);
		this.scope.retireContext();
		if (revision !== this.revision) return;
		pointerCapture.cancelScope(this.scope.surfaceScope);
		if (revision !== this.revision) return;
		this.actionBar.clearInput();
		if (revision !== this.revision) return;
		this.control.clearView();
		if (revision === this.revision) this.commandTarget.release();
	}
	public dispose(): void {
		this.surface.dispose(); this.control.dispose(); this.actionBar.dispose(); this.tooltip.detach(); this.unbindKeyboard();
	}
}
