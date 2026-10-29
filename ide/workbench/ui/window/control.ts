import { clamp } from '../../../../machine/ts/common/clamp';
import { copy_rect_bounds, create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { EditorCommandRunner } from '../../../common/commands';
import type { PointerInputSnapshot, PointerSnapshot, WheelInputSnapshot } from '../../../common/models';
import { ELLIPSIS, truncateMeasuredText, type TextRangeMeasure } from '../../../common/text';
import { InputFocusScope, type InputFocusService, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import type { PointerCaptureScope, PointerCaptureService, PointerCaptureTarget } from '../../../input/pointer/capture';
import type { PointerHoverService, PointerHoverTarget } from '../../../input/pointer/hover';
import type { WorkbenchSurface, WorkbenchSurfaceCallbacks } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { WORKBENCH_MENUS, type WorkbenchMenuItem } from '../menu/registry';
import type { WorkbenchMenuPresentation } from '../menu/model';
import { drawWorkbenchWindowPlacement, drawWorkbenchWindow } from '../../render/window';
import { layoutWorkbenchActionBar, measureWorkbenchActionBarMinimumWidth, type WorkbenchActionBarState } from '../action_bar';
import { WorkbenchActionBarControl } from '../action_bar_control';
import { WorkbenchTooltip } from '../tooltip';
import { WindowResizeEdge, WINDOW_HEADER_VERTICAL_PADDING, type WindowPlacement, type WorkbenchWindowModel } from './model';
import { DOUBLE_CLICK_MAX_INTERVAL_MS, POINTER_DRAG_ACTIVATION_THRESHOLD } from '../../../common/constants';

const WINDOW_SNAP_MARGIN = 8;

const windowsByScope = new Map<PointerCaptureScope, WorkbenchFloatingWindow>();

/** The chrome owner for this exact attached native window surface. */
export function workbenchWindowForSurface(surface: WorkbenchSurface): WorkbenchFloatingWindow | undefined {
	return surface.retired ? undefined : windowsByScope.get(surface.captureScope);
}

/** Discover minimized chrome from the same native topology used by drawing and targeting. */
export function minimizedWorkbenchWindowCount(surfaces: WorkbenchSurfaceService): number {
	let count = 0;
	for (const surface of surfaces.windowSurfaces) {
		const window = workbenchWindowForSurface(surface);
		if (window !== undefined && window.isOpen && window.model.minimized) count++;
	}
	return count;
}

/** Resolve the actual native window, including unframed Main, without borrowing a semantic parent. */
export function findWorkbenchWindowSurface(target: InputFocusTarget | null, surfaces: WorkbenchSurfaceService): WorkbenchSurface | null | undefined {
	if (target === null) return undefined;
	const surface = surfaces.findByScope(target.commandContext.scope.surfaceScope);
	if (surface === undefined) return null;
	let window: WorkbenchSurface | undefined;
	for (let current: WorkbenchSurface | null | undefined = surface; current != null; current = current.presentationParent) {
		if (current.retired) return null;
		if (window === undefined && current.role === 'window') window = current;
	}
	return window;
}

export type WorkbenchWindowOptions = {
	readonly model: WorkbenchWindowModel;
	readonly actionBar: WorkbenchActionBarState;
	readonly contextMenu?: WorkbenchMenuPresentation | readonly WorkbenchMenuItem[];
	readonly lifetimeOwner: WorkbenchSurface;
	readonly presentationParent: WorkbenchSurface | null;
	/** Logical command and interaction ancestry, independent of current focus return. */
	readonly focusScope: InputFocusScope;
	/** Current concrete return control, not the window's ownership ancestry. */
	readonly focusReturn: InputFocusTarget;
	/** Borrowed layout extent; its owner updates this same rectangle in place. */
	readonly workArea: Readonly<RectBounds>;
	getTitleTooltip?(): string;
	readonly content: WorkbenchSurfaceCallbacks;
	layoutContent(bounds: Readonly<RectBounds>): void;
	retireContentInput(): void;
	restoreContentInput(): void;
	focusContent(): void;
	requestClose?(): void;
	requestMinimize?(): void;
	onDidHide?(): void;
};

/** In-canvas chrome composes existing controls, surface ordering and pointer capture. */
export class WorkbenchFloatingWindow implements PointerCaptureTarget, PointerHoverTarget {
	public readonly focusTarget: InputFocusTarget;
	public readonly scope: InputFocusScope;
	public readonly clientFocusTarget: InputFocusTarget;
	public readonly actionFocusTarget: InputFocusTarget;
	public readonly clientScope: InputFocusScope;
	public surface: WorkbenchSurface | undefined;
	public clientSurface: WorkbenchSurface | undefined;
	public readonly actions: WorkbenchActionBarControl;
	private readonly unbindKeyboard: () => void;
	private readonly unbindClientKeyboard: () => void;
	private readonly unbindTitleBlur: () => void;
	private readonly startBounds = create_rect_bounds();
	private readonly startRequested = create_rect_bounds();
	private readonly nextRequested = create_rect_bounds();
	private moving = false;
	private geometryPending = false;
	private titleAnchorX = 0;
	private titleAnchorY = 0;
	private pointerX = 0;
	private pointerY = 0;
	private pointerInside = false;
	private pendingPlacement: WindowPlacement | undefined;
	private readonly placementBounds = create_rect_bounds();
	private readonly placementScope = Symbol('window placement preview');
	private resizing = WindowResizeEdge.None;
	private startX = 0;
	private startY = 0;
	private titleClick = false;
	private titlePressTime = 0;
	private lastTitleClickTime: number | undefined;
	private lastTitleClickX = 0;
	private lastTitleClickY = 0;
	private measuredRevision = -1;
	private measuredFont: BFont | undefined;
	private ellipsisWidth = 0;
	private measure: TextRangeMeasure | undefined;
	private measureText: ((text: string) => number) | undefined;
	private readonly tooltip = new WorkbenchTooltip();
	private headerHovered = false;
	private presented = true;
	private clientInputAttached = false;

	public constructor(private readonly focus: InputFocusService, private readonly capture: PointerCaptureService,
		private readonly hover: PointerHoverService, private readonly surfaces: WorkbenchSurfaceService, private readonly commands: EditorCommandRunner,
		private readonly contextMenu: ContextMenuController, private readonly options: WorkbenchWindowOptions) {
		this.scope = new InputFocusScope(Symbol('window'), options.focusScope);
		this.clientScope = new InputFocusScope(Symbol('window client'), this.scope);
		this.focusTarget = focus.createTarget(options.focusReturn, this.scope);
		this.focusTarget.canFocus = () => this.visible;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.unbindTitleBlur = this.focusTarget.onDidBlur(() => {
			this.titleClick = false; this.lastTitleClickTime = undefined;
		});
		this.clientFocusTarget = focus.createTarget(this.focusTarget, this.clientScope);
		this.clientFocusTarget.canFocus = () => this.clientSurface !== undefined && this.clientSurface.visible;
		this.clientFocusTarget.commandContext = this.focusTarget;
		this.unbindClientKeyboard = this.clientFocusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.actions = new WorkbenchActionBarControl(focus, capture, hover, commands, this.focusTarget, () => focus.setTarget(options.focusReturn));
		this.actionFocusTarget = this.actions.focusTarget;
		this.focusTarget.next = this.actions.focusTarget;
		this.focusTarget.previous = this.actions.focusTarget;
		this.actions.focusTarget.next = this.focusTarget;
		this.actions.focusTarget.previous = this.focusTarget;
		this.clientFocusTarget.previous = this.actions.focusTarget;
		this.clientFocusTarget.next = this.focusTarget;
		this.focusTarget.previous = this.actions.focusTarget;
		this.focusTarget.registerCommand('window.minimize', { isEnabled: () => this.visible && options.requestMinimize !== undefined,
			run: () => options.requestMinimize!() });
		this.focusTarget.registerCommand('window.maximize', { isEnabled: () => this.visible, isChecked: () => options.model.placement === 'maximized',
			run: () => this.setPlacement(options.model.placement === 'maximized' ? 'normal' : 'maximized') });
		this.focusTarget.registerCommand('window.snapLeft', { isEnabled: () => this.visible && this.model.canPlace('left', options.workArea),
			isChecked: () => this.model.placement === 'left', run: () => this.setPlacement('left') });
		this.focusTarget.registerCommand('window.snapRight', { isEnabled: () => this.visible && this.model.canPlace('right', options.workArea),
			isChecked: () => this.model.placement === 'right', run: () => this.setPlacement('right') });
		this.focusTarget.registerCommand('window.restore', { isEnabled: () => this.visible && this.model.placement !== 'normal',
			run: () => this.setPlacement('normal') });
		this.focusTarget.registerCommand('window.hide', { isEnabled: () => this.visible,
			run: () => { if (options.requestClose !== undefined) options.requestClose(); else this.hide(); } });
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => this.visible,
			run: () => this.openContextMenu(this.model.header.left, this.model.header.bottom, true) });
		this.actionFocusTarget.registerCommand('contextMenu', this.focusTarget.getCommand('contextMenu')!);
		for (const command of ['contextMenu', 'window.minimize', 'window.maximize', 'window.snapLeft', 'window.snapRight', 'window.restore', 'window.hide'] as const)
			this.clientFocusTarget.registerCommand(command, this.focusTarget.getCommand(command)!);
		this.updateChromeState();
	}

	public get visible(): boolean { return this.surface !== undefined && this.surface.visible; }
	/** Published windows remain discoverable while minimized, unlike provisional construction. */
	public get isOpen(): boolean { return this.presented && this.model.open && this.surface !== undefined && !this.surface.retired; }
	/** Chrome, client and promoted owned popups form one active window family. */
	public get hasFocus(): boolean { return this.containsScope(this.surface, this.focus.target?.scope.surfaceScope); }
	public get model(): WorkbenchWindowModel { return this.options.model; }

	/** Construction can retain a window tree before its owner admits presentation. */
	public setPresented(presented: boolean): void {
		if (this.presented === presented) return;
		this.presented = presented;
		if (this.surface !== undefined) this.surfaces.changed();
	}

	/** Reattaching a pane preserves its input-owned open/minimized/placement model. */
	public attach(): void {
		if (this.surface !== undefined || !this.model.open) return;
		const options = this.options;
		windowsByScope.set(this.scope.surfaceScope, this);
		this.surface = this.surfaces.attach({
			role: 'window', lifetimeOwner: options.lifetimeOwner, presentationParent: options.presentationParent,
			captureScope: this.scope.surfaceScope,
			getBounds: () => options.model.bounds, getClip: () => options.workArea,
			isVisible: () => this.presented && options.model.open && !options.model.minimized,
			draw: () => drawWorkbenchWindow(this.model, options.actionBar, this.hasFocus),
			handlePointer: (snapshot, now) => this.handlePointer(snapshot, now), handleWheel: () => true,
			onRetire: () => {
				windowsByScope.delete(this.scope.surfaceScope);
				const surface = this.surface;
				const ownedFocus = this.focus.target?.scope === this.scope || this.containsScope(surface, this.focus.target?.scope.surfaceScope);
				this.surface = undefined;
				// The window owns return admission. Child cleanup must not first
				// activate a different parent while this attachment is retiring.
				if (ownedFocus) this.focus.setTarget(null);
				this.capture.cancelScope(this.scope.surfaceScope);
				this.cancelPointer();
				this.actions.clearInput();
				this.hover.release(this); this.headerHovered = false; this.tooltip.hide();
				this.retireClientInput();
				this.scope.retireContext();
				if (ownedFocus && (this.focus.target === null || this.focus.target.scope === this.scope
					|| this.containsScope(surface, this.focus.target.scope.surfaceScope))) this.focus.setTarget(options.focusReturn);
			},
		});
		this.updateChromeState();
		this.actions.setInput(options.actionBar, this.focusTarget);
		this.tooltip.attach(this.surfaces, this.surface, options.workArea);
		this.attachClient();
		this.surfaces.attach({ role: 'feedback', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: this.placementScope, getBounds: () => this.placementBounds, getClip: () => options.workArea,
			isVisible: () => this.pendingPlacement !== undefined,
			draw: () => drawWorkbenchWindowPlacement(this.placementBounds),
		});
		this.restoreClientInput();
	}

	public detach(): void {
		this.surface?.dispose();
	}

	public show(focus = true): void {
		this.model.open = true;
		this.model.setMinimized(false);
		this.attach();
		if (this.measuredFont !== undefined) this.layout(this.measuredFont, this.measure!, this.measureText!);
		this.surfaces.changed();
		this.surfaces.raise(this.surface!);
		if (focus) this.focusContent();
	}

	public hide(): void {
		if (!this.model.open) return;
		this.model.open = false;
		this.detach();
		this.options.onDidHide?.();
	}

	public dispose(): void {
		this.detach();
		this.actions.dispose();
		this.unbindKeyboard();
		this.unbindClientKeyboard();
		this.unbindTitleBlur();
	}

	/** Minimize revokes presentation/input, not retained editor or modal lifetimes. */
	public minimize(): void {
		if (this.model.minimized) return;
		const route = this.capture.routeScope;
		if (this.containsScope(this.surface, route)) this.capture.cancelScope(route!);
		this.cancelPointer();
		this.actions.cancelPointer();
		this.hover.release(this.actions);
		this.hover.release(this); this.headerHovered = false; this.tooltip.hide();
		this.model.setMinimized(true);
		this.surfaces.changed();
		if (this.model.minimized && this.hasFocus) this.focus.setTarget(null);
	}

	public setPlacement(placement: WindowPlacement): void {
		if (!this.model.canPlace(placement, this.options.workArea)) return;
		this.lastTitleClickTime = undefined;
		this.capture.cancelTarget(this);
		this.model.setPlacement(placement);
		this.updateChromeState();
		if (this.visible) this.layout(this.measuredFont!, this.measure!, this.measureText!);
	}

	/** Font, producer revisions and work-area changes are the only chrome layout triggers. */
	public layout(font: BFont, measure: TextRangeMeasure, measureText: (text: string) => number): boolean {
		if (!this.visible) return false;
		const model = this.model;
		const fontChanged = this.measuredFont !== font;
		const headerHeight = font.lineHeight + WINDOW_HEADER_VERTICAL_PADDING;
		let chromeMinimumWidth: number | undefined;
		if (fontChanged || this.measuredRevision !== model.revision || this.measureText !== measureText) {
			if (fontChanged || this.measureText !== measureText) this.ellipsisWidth = measureText(ELLIPSIS);
			const actionWidth = measureWorkbenchActionBarMinimumWidth(this.options.actionBar, headerHeight - 4, measureText, font);
			chromeMinimumWidth = this.ellipsisWidth + 8 + (actionWidth === 0 ? 0 : actionWidth + 3);
		}
		const arranged = model.arrange(this.options.workArea, headerHeight, this.geometryPending ? this.nextRequested : undefined, chromeMinimumWidth);
		const previewChanged = this.updatePlacementPreview();
		const dirty = arranged || this.measuredRevision !== model.revision || fontChanged
			|| this.measure !== measure || this.measureText !== measureText;
		if (!dirty && !previewChanged) return false;
		this.measuredFont = model.font = font;
		this.measure = measure;
		this.measureText = measureText;
		this.measuredRevision = model.revision;
		const { header } = model;
		layoutWorkbenchActionBar(this.options.actionBar, header.right - 3, header.top + 2, header.bottom - 2, measureText, font, header.left + 4);
		const firstAction = this.options.actionBar.items.find(item => item.visible);
		model.displayTitle = truncateMeasuredText(model.title, (firstAction === undefined ? header.right : firstAction.bounds.left) - header.left - 8, measure, ELLIPSIS, 'middle');
		const contentChanged = arranged || fontChanged;
		if (contentChanged) this.options.layoutContent(model.client);
		this.updateTooltip();
		this.surfaces.changed();
		return contentChanged;
	}

	public update(): void {
		if (!this.visible) return;
		this.actions.update();
		this.updateTooltip();
	}

	private updateChromeState(): void {
		const minimize = this.options.actionBar.items.find(item => item.command === 'window.minimize');
		if (minimize !== undefined) minimize.visible = this.options.requestMinimize !== undefined;
		const maximize = this.options.actionBar.items.find(item => item.command === 'window.maximize');
		if (maximize !== undefined) maximize.checked = this.model.placement === 'maximized';
	}

	private updateTooltip(): void {
		if (this.titleClick || this.moving || this.resizing !== WindowResizeEdge.None) { this.tooltip.hide(); return; }
		const item = this.actions.tooltipItem;
		if (item !== undefined) this.tooltip.show(item.tooltip, item.bounds, this.measuredFont!, this.measure!, this.measureText!, this.options.workArea);
		else if (this.headerHovered && (this.options.getTitleTooltip !== undefined || this.model.displayTitle !== this.model.title)) {
			this.tooltip.show(this.options.getTitleTooltip?.() ?? this.model.title, this.model.header,
				this.measuredFont!, this.measure!, this.measureText!, this.options.workArea);
		} else this.tooltip.hide();
	}

	public onPointerLeave(): void { this.headerHovered = false; }

	private focusContent(): void {
		this.options.focusContent();
	}

	private openContextMenu(x: number, y: number, keyboard: boolean): void {
		const surface = this.surface!;
		this.surfaces.raise(surface);
		if (this.surface !== surface || !this.visible) return;
		this.focusTarget.focus();
		if (this.surface !== surface || !this.focusTarget.hasFocus) return;
		this.tooltip.hide();
		this.contextMenu.show(x, y, this.options.contextMenu ?? WORKBENCH_MENUS[this.options.requestMinimize === undefined ? 'window.context' : 'window.minimizable.context'], this.commands,
			{ selectFirst: keyboard, invocationOrigin: this.focusTarget, commandTarget: this.focusTarget, returnFocus: this.focusTarget });
	}

	private handleKeyboard(input: KeyInputEvent): void {
		if (input.modifiers !== KeyModifier.none) return;
		if (isKeyJustPressed('Escape', input)) {
			consumeIdeKey('Escape', input);
			this.cancelPointer();
			this.focus.setTarget(this.options.focusReturn);
		} else if (isKeyJustPressed('Enter', input)) {
			consumeIdeKey('Enter', input);
			this.focusContent();
		}
	}

	private handlePointer(snapshot: PointerInputSnapshot, now: number): void {
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.model.bounds)) return;
		const edge = this.model.resizeEdgeAt(snapshot.viewportX, snapshot.viewportY);
		const header = point_in_rect(snapshot.viewportX, snapshot.viewportY, this.model.header);
		const actionRegion = point_in_rect(snapshot.viewportX, snapshot.viewportY, this.options.actionBar.bounds);
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0 && header && !actionRegion && edge === WindowResizeEdge.None) {
			this.openContextMenu(snapshot.viewportX, snapshot.viewportY, false);
			return;
		}
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && !actionRegion && (edge !== WindowResizeEdge.None || header)) {
			// Publish the complete gesture before focus/stack callbacks can revoke it.
			this.startX = snapshot.viewportX; this.startY = snapshot.viewportY;
			this.titleAnchorX = (snapshot.viewportX - this.model.header.left) / (this.model.header.right - this.model.header.left);
			this.titleAnchorY = snapshot.viewportY - this.model.header.top;
			this.titlePressTime = now;
			this.titleClick = edge === WindowResizeEdge.None && snapshot.justPressedButtons === PointerButton.Primary
				&& (snapshot.pressedButtons & ~PointerButton.Primary) === 0;
			copy_rect_bounds(this.startBounds, this.model.bounds);
			copy_rect_bounds(this.startRequested, this.model.requestedBounds);
			this.resizing = edge;
			this.moving = false; this.geometryPending = false;
			this.capture.capture(this);
			this.surfaces.raise(this.surface!);
			if (this.capture.routeScope === this.scope.surfaceScope) this.focusTarget.focus();
			return;
		}
		if (snapshot.justPressedButtons !== 0) {
			this.surfaces.raise(this.surface!);
			if (!this.containsScope(this.surface, this.focus.target?.scope.surfaceScope)) this.focus.setTarget(this.scope.lastFocused ?? this.focusTarget);
			// Focus publication may retire this occurrence, even with a coalesced release.
			if (this.capture.routeScope !== this.scope.surfaceScope) return;
		}
		if (this.actions.handlePointer(snapshot)) {
			if (snapshot.justPressedButtons !== 0) this.lastTitleClickTime = undefined;
			this.hover.release(this); this.headerHovered = false; return;
		}
		this.headerHovered = header;
		if (header) this.hover.visit(this);
		else this.hover.release(this);
		if (snapshot.justPressedButtons !== 0 && (snapshot.justPressedButtons !== PointerButton.Primary || edge !== WindowResizeEdge.None || !header)) {
			this.lastTitleClickTime = undefined;
		}
	}

	private handleWheel(event: WheelInputSnapshot): boolean {
		this.options.content.handleWheel?.(event);
		return true;
	}

	public cancelPointer(): void {
		this.capture.release(this);
		const pending = this.geometryPending;
		this.moving = false; this.geometryPending = false;
		this.resizing = WindowResizeEdge.None;
		this.pendingPlacement = undefined;
		this.titleClick = false; this.lastTitleClickTime = undefined;
		if (pending && this.visible) this.layout(this.measuredFont!, this.measure!, this.measureText!);
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		const start = this.startBounds, requested = this.startRequested, next = this.nextRequested;
		const workArea = this.options.workArea;
		const dx = snapshot.viewportX - this.startX, dy = snapshot.viewportY - this.startY;
		this.pointerX = snapshot.viewportX; this.pointerY = snapshot.viewportY; this.pointerInside = snapshot.insideViewport;
		if ((snapshot.justPressedButtons & ~PointerButton.Primary) !== 0) {
			this.titleClick = false; this.lastTitleClickTime = undefined;
		}
		if (this.resizing === WindowResizeEdge.None && !this.moving) {
			if (Math.max(Math.abs(dx), Math.abs(dy)) < POINTER_DRAG_ACTIVATION_THRESHOLD) return;
			this.moving = true; this.titleClick = false; this.lastTitleClickTime = undefined;
		}
		if (!this.moving && dx === 0 && dy === 0 && !this.geometryPending) return;
		this.geometryPending = true;
		if (this.moving) {
			this.model.writePlacementBounds('normal', workArea, next, requested);
			const width = next.right - next.left, height = next.bottom - next.top;
			const left = clamp(snapshot.viewportX - Math.round(width * this.titleAnchorX), workArea.left, workArea.right - width);
			const top = clamp(snapshot.viewportY - this.titleAnchorY, workArea.top, workArea.bottom - height);
			write_rect_bounds(next, left, top, left + requested.right - requested.left, top + requested.bottom - requested.top);
		} else {
			copy_rect_bounds(next, this.model.placement === 'normal' ? requested : start);
			const minWidth = Math.min(this.model.minimumWidth, workArea.right - workArea.left);
			const minHeight = Math.min(this.model.minimumHeight, workArea.bottom - workArea.top);
			if ((this.resizing & WindowResizeEdge.Left) !== 0) {
				next.left = clamp(start.left + dx, workArea.left, start.right - minWidth); next.right = start.right;
			} else if ((this.resizing & WindowResizeEdge.Right) !== 0) {
				next.left = start.left; next.right = clamp(start.right + dx, start.left + minWidth, workArea.right);
			}
			if ((this.resizing & WindowResizeEdge.Top) !== 0) {
				next.top = clamp(start.top + dy, workArea.top, start.bottom - minHeight); next.bottom = start.bottom;
			} else if ((this.resizing & WindowResizeEdge.Bottom) !== 0) {
				next.top = start.top; next.bottom = clamp(start.bottom + dy, start.top + minHeight, workArea.bottom);
			}
		}
		this.layout(this.measuredFont!, this.measure!, this.measureText!);
	}

	/** Preview and commit consume the same live work area and minimum-size admission. */
	private updatePlacementPreview(): boolean {
		const area = this.options.workArea, x = this.pointerX, y = this.pointerY;
		let placement: WindowPlacement | undefined;
		if (this.moving && this.pointerInside && point_in_rect(x, y, area)) {
			if (y < area.top + WINDOW_SNAP_MARGIN) placement = 'maximized';
			else if (x < area.left + WINDOW_SNAP_MARGIN) placement = 'left';
			else if (x >= area.right - WINDOW_SNAP_MARGIN) placement = 'right';
			if (placement !== undefined && !this.model.canPlace(placement, area)) placement = undefined;
		}
		const changed = this.pendingPlacement !== placement;
		this.pendingPlacement = placement;
		if (placement !== undefined) this.model.writePlacementBounds(placement, area, this.placementBounds);
		return changed;
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		this.handleCapturedPointer(snapshot);
		const click = this.titleClick && snapshot.valid && snapshot.insideViewport
			&& point_in_rect(snapshot.viewportX, snapshot.viewportY, this.model.header)
			&& !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.options.actionBar.bounds)
			&& this.model.resizeEdgeAt(snapshot.viewportX, snapshot.viewportY) === WindowResizeEdge.None;
		const pending = this.geometryPending, placement = this.pendingPlacement;
		this.capture.release(this);
		this.moving = false; this.geometryPending = false; this.pendingPlacement = undefined;
		this.resizing = WindowResizeEdge.None; this.titleClick = false;
		if (pending) {
			this.lastTitleClickTime = undefined;
			if (placement === undefined) this.model.setRequestedBounds(this.nextRequested, 'normal');
			else this.model.setPlacement(placement);
			this.updateChromeState();
			this.layout(this.measuredFont!, this.measure!, this.measureText!);
			return;
		}
		if (!click) { this.lastTitleClickTime = undefined; return; }
		const previous = this.lastTitleClickTime;
		if (previous !== undefined && this.titlePressTime - previous <= DOUBLE_CLICK_MAX_INTERVAL_MS
			&& Math.max(Math.abs(this.startX - this.lastTitleClickX), Math.abs(this.startY - this.lastTitleClickY)) < POINTER_DRAG_ACTIVATION_THRESHOLD) {
			this.lastTitleClickTime = undefined;
			this.setPlacement(this.model.placement === 'maximized' ? 'normal' : 'maximized');
		} else {
			this.lastTitleClickTime = this.titlePressTime;
			this.lastTitleClickX = this.startX; this.lastTitleClickY = this.startY;
		}
	}

	private attachClient(): void {
		const options = this.options;
		this.clientSurface = this.surfaces.attach({
			role: 'content', lifetimeOwner: this.surface!, presentationParent: this.surface!, captureScope: this.clientScope.surfaceScope,
			getBounds: () => this.model.client, getClip: () => this.model.client, isVisible: () => true,
			draw: () => options.content.draw(),
			handlePointer: (snapshot, now) => {
				if (snapshot.justPressedButtons !== 0) {
					this.lastTitleClickTime = undefined;
					this.surfaces.raise(this.surface!);
					if (!this.containsScope(this.surface, this.focus.target?.scope.surfaceScope)) this.focus.setTarget(this.clientScope.lastFocused ?? this.clientFocusTarget);
				}
				options.content.handlePointer?.(snapshot, now);
			},
			handleWheel: event => this.handleWheel(event),
			onRetire: () => {
				this.clientSurface = undefined;
				this.retireClientInput();
				options.content.onRetire?.();
			},
		});
	}

	private restoreClientInput(): void {
		this.clientInputAttached = true;
		this.actions.focusTarget.next = this.clientFocusTarget;
		this.focusTarget.previous = this.clientFocusTarget;
		this.options.restoreContentInput();
	}

	private retireClientInput(): void {
		if (!this.clientInputAttached) return;
		this.clientInputAttached = false;
		this.actions.focusTarget.next = this.focusTarget;
		this.focusTarget.previous = this.actions.focusTarget;
		if (this.containsScope(this.clientSurface, this.capture.routeScope)) this.capture.cancelScope(this.capture.routeScope!);
		this.capture.cancelScope(this.clientScope.surfaceScope);
		this.options.retireContentInput();
		this.clientScope.retireContext();
	}

	private containsScope(surface: WorkbenchSurface | undefined, scope: PointerCaptureScope | undefined): boolean {
		if (surface === undefined || scope === undefined) return false;
		return this.surfaces.isInWindowFamily(scope, surface.captureScope);
	}
}
