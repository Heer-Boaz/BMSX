import { clamp } from '../../../../machine/ts/common/clamp';
import { copy_rect_bounds, create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { EditorCommandRunner } from '../../../common/commands';
import type { PointerInputSnapshot, PointerSnapshot, WheelInputSnapshot } from '../../../common/models';
import { truncateMeasuredText, type TextRangeMeasure } from '../../../common/text';
import { InputFocusScope, type InputFocusService, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import type { PointerCaptureService, PointerCaptureTarget } from '../../../input/pointer/capture';
import type { PointerHoverService } from '../../../input/pointer/hover';
import type { WorkbenchSurface, WorkbenchSurfaceCallbacks } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { drawWorkbenchWindow } from '../../render/window';
import { layoutWorkbenchActionBar, type WorkbenchActionBarState } from '../action_bar';
import { WorkbenchActionBarControl } from '../action_bar_control';
import { WindowResizeEdge, type WorkbenchWindowModel } from './model';

export type WorkbenchWindowOptions = {
	readonly model: WorkbenchWindowModel;
	readonly actionBar: WorkbenchActionBarState;
	readonly lifetimeOwner: WorkbenchSurface;
	readonly presentationParent?: WorkbenchSurface;
	readonly focusReturn: InputFocusTarget;
	getWorkArea(): Readonly<RectBounds>;
	readonly content: WorkbenchSurfaceCallbacks;
	layoutContent(bounds: Readonly<RectBounds>): void;
	retireContentInput(): void;
	restoreContentInput(): void;
	focusContent(): void;
	onDidHide?(): void;
};

/** In-canvas chrome composes existing controls, surface ordering and pointer capture. */
export class WorkbenchFloatingWindow implements PointerCaptureTarget {
	public readonly focusTarget: InputFocusTarget;
	public readonly scope = new InputFocusScope(Symbol('window'));
	public readonly clientFocusTarget: InputFocusTarget;
	public readonly actionFocusTarget: InputFocusTarget;
	public readonly clientScope = new InputFocusScope(Symbol('window client'));
	public surface: WorkbenchSurface | undefined;
	public clientSurface: WorkbenchSurface | undefined;
	private readonly actions: WorkbenchActionBarControl;
	private readonly unbindKeyboard: () => void;
	private readonly unbindClientKeyboard: () => void;
	private readonly startBounds = create_rect_bounds();
	private readonly startRequested = create_rect_bounds();
	private readonly nextRequested = create_rect_bounds();
	private moving = false;
	private resizing = WindowResizeEdge.None;
	private startX = 0;
	private startY = 0;
	private measuredRevision = -1;
	private measuredFont: BFont | undefined;
	private measure: TextRangeMeasure | undefined;
	private measureText: ((text: string) => number) | undefined;

	public constructor(private readonly focus: InputFocusService, private readonly capture: PointerCaptureService,
		hover: PointerHoverService, private readonly surfaces: WorkbenchSurfaceService, commands: EditorCommandRunner,
		private readonly options: WorkbenchWindowOptions) {
		this.focusTarget = focus.createTarget(options.focusReturn, this.scope);
		this.focusTarget.canFocus = () => this.visible;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
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
		this.focusTarget.registerCommand('window.collapse', { isEnabled: () => this.visible, run: () => this.setCollapsed(!options.model.collapsed) });
		this.focusTarget.registerCommand('window.hide', { isEnabled: () => this.visible, run: () => this.hide() });
		this.updateCollapseLabel();
	}

	public get visible(): boolean { return this.surface !== undefined && this.surface.visible; }
	public get model(): WorkbenchWindowModel { return this.options.model; }

	/** Reattaching a pane preserves its input-owned open/collapse/placement model. */
	public attach(): void {
		if (this.surface !== undefined || !this.model.open) return;
		const options = this.options;
		this.surface = this.surfaces.attach({
			role: 'window', lifetimeOwner: options.lifetimeOwner, presentationParent: options.presentationParent,
			captureScope: this.scope.surfaceScope,
			getBounds: () => options.model.bounds, getClip: () => options.getWorkArea(),
			isVisible: () => options.model.open,
			draw: () => drawWorkbenchWindow(this.model, options.actionBar, this.focusedIn(this.surface)),
			handlePointer: snapshot => this.handlePointer(snapshot), handleWheel: () => true,
			onRetire: () => {
				const ownedFocus = this.focus.target?.scope === this.scope || this.focusedIn(this.surface);
				this.surface = undefined;
				this.capture.cancelScope(this.scope.surfaceScope);
				this.cancelPointer();
				this.actions.clearInput();
				if (ownedFocus) this.focus.setTarget(options.focusReturn);
			},
		});
		this.actions.setInput(options.actionBar, this.focusTarget);
		if (!this.model.collapsed) this.attachClient();
	}

	public detach(): void {
		this.surface?.dispose();
	}

	public show(focus = true): void {
		this.model.open = true;
		this.attach();
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
	}

	public setCollapsed(collapsed: boolean): void {
		if (this.model.collapsed === collapsed) return;
		const clientHadFocus = this.focusedIn(this.clientSurface);
		if (this.resizing !== WindowResizeEdge.None) this.cancelPointer();
		this.model.setCollapsed(collapsed);
		this.updateCollapseLabel();
		if (collapsed) {
			this.clientSurface?.dispose();
			if (clientHadFocus) {
				this.options.actionBar.focusedIndex = this.options.actionBar.items.findIndex(item => item.command === 'window.collapse');
				this.actions.focusTarget.focus();
			}
		} else if (this.visible) this.attachClient();
		if (this.visible) this.layout(this.measuredFont!, this.measure!, this.measureText!);
	}

	/** Font, producer revisions and work-area changes are the only chrome layout triggers. */
	public layout(font: BFont, measure: TextRangeMeasure, measureText: (text: string) => number): void {
		if (!this.visible) return;
		const model = this.model;
		const arranged = model.arrange(this.options.getWorkArea(), font.lineHeight + 8);
		const fontChanged = this.measuredFont !== font;
		const dirty = arranged || this.measuredRevision !== model.revision || fontChanged
			|| this.measure !== measure || this.measureText !== measureText;
		if (!dirty) return;
		this.measuredFont = model.font = font;
		this.measure = measure;
		this.measureText = measureText;
		this.measuredRevision = model.revision;
		const { header } = model;
		layoutWorkbenchActionBar(this.options.actionBar, header.right - 4, header.top + 3, header.bottom - 3, measureText, font);
		const firstAction = this.options.actionBar.items.find(item => item.visible);
		model.displayTitle = truncateMeasuredText(model.title, (firstAction === undefined ? header.right : firstAction.bounds.left) - header.left - 8, measure, '...', 'middle');
		if (!model.collapsed && (arranged || fontChanged)) this.options.layoutContent(model.client);
		this.surfaces.changed();
	}

	public update(): void { if (this.visible) this.actions.update(); }

	private updateCollapseLabel(): void {
		this.options.actionBar.items.find(item => item.command === 'window.collapse')!.label = this.model.collapsed ? '+' : '-';
	}

	private focusContent(): void {
		if (this.model.collapsed) this.focusTarget.focus();
		else this.options.focusContent();
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

	private handlePointer(snapshot: PointerInputSnapshot): void {
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.model.bounds)) return;
		if (snapshot.justPressedButtons !== 0) {
			this.surfaces.raise(this.surface!);
			if (!this.focusedIn(this.surface)) this.focus.setTarget(this.scope.lastFocused ?? this.focusTarget);
		}
		if (this.actions.handlePointer(snapshot)) return;
		const edge = this.model.resizeEdgeAt(snapshot.viewportX, snapshot.viewportY);
		const header = point_in_rect(snapshot.viewportX, snapshot.viewportY, this.model.header);
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && (edge !== WindowResizeEdge.None || header)) {
			this.focusTarget.focus();
			this.startX = snapshot.viewportX; this.startY = snapshot.viewportY;
			copy_rect_bounds(this.startBounds, this.model.bounds);
			copy_rect_bounds(this.startRequested, this.model.requestedBounds);
			this.resizing = edge;
			this.moving = edge === WindowResizeEdge.None;
			this.capture.capture(this);
			return;
		}
	}

	private handleWheel(event: WheelInputSnapshot): boolean {
		this.options.content.handleWheel?.(event);
		return true;
	}

	public cancelPointer(): void {
		this.capture.release(this);
		this.moving = false;
		this.resizing = WindowResizeEdge.None;
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		const start = this.startBounds, requested = this.startRequested, next = this.nextRequested;
		const workArea = this.options.getWorkArea();
		const dx = snapshot.viewportX - this.startX, dy = snapshot.viewportY - this.startY;
		copy_rect_bounds(next, requested);
		if (this.moving) {
			const left = clamp(start.left + dx, workArea.left, workArea.right - (start.right - start.left));
			const top = clamp(start.top + dy, workArea.top, workArea.bottom - (start.bottom - start.top));
			write_rect_bounds(next, left, top, left + requested.right - requested.left, top + requested.bottom - requested.top);
		} else {
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
		this.model.setRequestedBounds(next);
		this.layout(this.measuredFont!, this.measure!, this.measureText!);
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		this.handleCapturedPointer(snapshot);
		this.cancelPointer();
	}

	private attachClient(): void {
		const options = this.options;
		this.actions.focusTarget.next = this.clientFocusTarget;
		this.focusTarget.previous = this.clientFocusTarget;
		this.clientSurface = this.surfaces.attach({
			role: 'content', lifetimeOwner: this.surface!, presentationParent: this.surface!, captureScope: this.clientScope.surfaceScope,
			getBounds: () => this.model.client, getClip: () => this.model.client, isVisible: () => !this.model.collapsed,
			draw: () => options.content.draw(),
			handlePointer: (snapshot, now) => {
				if (snapshot.justPressedButtons !== 0) {
					this.surfaces.raise(this.surface!);
					if (!this.focusedIn(this.surface)) this.focus.setTarget(this.clientScope.lastFocused ?? this.clientFocusTarget);
				}
				options.content.handlePointer?.(snapshot, now);
			},
			handleWheel: event => this.handleWheel(event),
			onRetire: () => {
				this.clientSurface = undefined;
				this.actions.focusTarget.next = this.focusTarget;
				this.focusTarget.previous = this.actions.focusTarget;
				this.capture.cancelScope(this.clientScope.surfaceScope);
				options.retireContentInput();
				options.content.onRetire?.();
			},
		});
		options.restoreContentInput();
	}

	private focusedIn(surface: WorkbenchSurface | undefined): boolean {
		if (surface === undefined || this.focus.target === null) return false;
		for (let current = this.surfaces.findByScope(this.focus.target.scope.surfaceScope); current !== undefined; current = current.lifetimeOwner) {
			if (current === surface) return true;
		}
		return false;
	}
}
