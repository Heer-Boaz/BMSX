import type { EditorCommandRunner } from '../../../common/commands';
import { InputFocusScope, inputFocus, type InputFocusTarget } from '../../../input/focus';
import { InputInteraction } from '../../../input/interaction';
import { pointerCapture } from '../../../input/pointer/capture';
import { beginNavigationCapture, captureNavigation, completeNavigation, navigationState, withNavigationCaptureSuspended } from '../../../navigation/navigation_history';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { EditorTabGroupModel, type EditorOpenOptions } from '../../ui/tab/group_model';
import { EditorTabStrip } from '../../ui/tab/control';
import type { EditorTabId } from '../../ui/tab/id';
import type { EditorInput } from '../../ui/tab/model';
import { EditorPanes, type EditorPaneFactories, type EditorPaneOpenOptions } from './editor_panes';
import type { EditorPaneSelection } from './editor_selection';
import type { CloseEditors } from './editor_close';
import type { WorkbenchSurface } from '../windows/model';
import type { WorkbenchSurfaceService } from '../windows/service';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { copy_rect_bounds, create_rect_bounds, write_rect_bounds, point_in_rect, rects_intersect } from '../../../../machine/ts/common/rect';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { isCtrlDown, isMetaDown } from '../../../input/keyboard/key_input';
import type { EditorTabStripRenderContext } from '../../render/tab_bar';
import { drawEditorGroupWatermark } from '../../render/editor_group_watermark';
import { RuntimeTimelineControl } from '../../ui/runtime_timeline_control';
import type { ContextMenuController } from '../context_menu/controller';
import { editorViewState } from '../../../editor/ui/view/state';
import { editorRuntimeState } from '../../../editor/common/runtime_state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { KeyModifier } from '../../../../hosts/common/input/text';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH } from '../../ui/action_bar';
import { ELLIPSIS } from '../../../common/text';
import { TAB_BUTTON_PADDING_X, TAB_CLOSE_BUTTON_PADDING_X, TAB_CLOSE_BUTTON_SYMBOL, TAB_DIRTY_LEFT_MARGIN, TAB_DIRTY_RIGHT_MARGIN } from '../../../common/constants';

/** The container supplies ancestry and allowable popup extent before controls are constructed. */
export type EditorGroupPresentation = {
	readonly surfaces: WorkbenchSurfaceService;
	readonly owner: WorkbenchSurface;
	readonly focusScope: InputFocusScope;
	readonly workArea: Readonly<RectBounds>;
	readonly renderContext: EditorTabStripRenderContext;
	readonly contextMenu: ContextMenuController;
	layout(group: EditorGroupView): void;
};

const groupsByScope = new WeakMap<InputFocusScope, EditorGroupView | null>();

/** Actions retain their invoking group; null denotes a retired editor origin. */
export function findEditorGroup(target: InputFocusTarget | null): EditorGroupView | null | undefined {
	for (let scope = target?.commandContext.scope; scope !== undefined && scope !== null; scope = scope.commandParent) {
		const group = groupsByScope.get(scope);
		if (group !== undefined) return group;
	}
	return undefined;
}

export type EditorTabOpenOptions = EditorOpenOptions & EditorPaneOpenOptions;
export type EditorInputOpenResult = { readonly generation: number; readonly activated: boolean };
export type EditorMoveEvent = { readonly input: EditorInput; readonly destination: EditorGroupView; readonly replacement: EditorInput };

/** Concrete input, control and tab-strip lifetimes for one independently arranged editor group. */
export class EditorGroupView {
	public readonly model = new EditorTabGroupModel();
	public readonly captureScope = Symbol('editor-group');
	private readonly containerScope: InputFocusScope;
	private readonly surfaceService: WorkbenchSurfaceService;
	public readonly focusScope: InputFocusScope;
	public readonly tabScope = Symbol('editor-tabs');
	public readonly tabFocusTarget: InputFocusTarget;
	public readonly panes: EditorPanes;
	public readonly tabStrip: EditorTabStrip;
	public readonly surface: WorkbenchSurface;
	public readonly paneSurface: WorkbenchSurface;
	public readonly tabSurface: WorkbenchSurface;
	public readonly workArea: Readonly<RectBounds>;
	public readonly focusTarget: InputFocusTarget;
	public readonly timeline: RuntimeTimelineControl;
	public readonly timelineBounds = create_rect_bounds();
	public readonly bounds = create_rect_bounds();
	public readonly clip = create_rect_bounds();
	public presented = true;
	private readonly tabBounds = create_rect_bounds();
	private readonly bodyBounds = create_rect_bounds();
	private readonly focusListeners = new Set<() => boolean>();
	private minimumFont = editorViewState.font;
	private minimumWidthValue = 0;
	private readonly subscriptions: (() => void)[] = [];
	private readonly tabLayoutContext = {
		get font() { return editorViewState.font.renderFont(); },
		get tabBarHeight() { return editorViewState.tabBarHeight; },
		get charAdvance() { return editorViewState.charAdvance; }, measureText, measureTextRange,
	};
	private readonly unbindFocus: () => void;
	private openingAdmittedValue = true;
	public get openingAdmitted(): boolean { return this.openingAdmittedValue; }
	private readonly disposeListeners = new Set<() => void>();
	private readonly moveListeners = new Set<(event: EditorMoveEvent) => void>();

	public constructor(factories: EditorPaneFactories, commands: EditorCommandRunner, private readonly closeEditors: CloseEditors,
		presentation: EditorGroupPresentation) {
		this.surfaceService = presentation.surfaces;
		this.containerScope = new InputFocusScope(Symbol('editor group'), presentation.focusScope);
		this.focusScope = new InputFocusScope(this.captureScope, this.containerScope);
		this.tabFocusTarget = inputFocus.createTarget(null, new InputFocusScope(this.tabScope, this.containerScope));
		this.workArea = presentation.workArea;
		copy_rect_bounds(this.clip, presentation.workArea);
		this.focusTarget = inputFocus.createTarget(null, this.focusScope);
		this.focusTarget.canFocus = () => this.presented;
		this.subscriptions.push(this.focusTarget.bindKeyboard(input => {
			if (input.modifiers !== KeyModifier.none) return;
			if (isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); commands.execute('home', this.focusTarget); }
			else if (isKeyJustPressed('Escape', input)) { consumeIdeKey('Escape', input); commands.execute('resources.focus', this.focusTarget); }
		}));
		this.focusScope.interaction = new InputInteraction();
		groupsByScope.set(this.containerScope, this);
		groupsByScope.set(this.focusScope, this);
		groupsByScope.set(this.tabFocusTarget.scope, this);
		this.containerScope.commands = commands;
		this.focusScope.commands = commands;
		this.tabFocusTarget.scope.commands = commands;
		this.unbindFocus = inputFocus.onDidChangeTarget(() => {
			if (findEditorGroup(inputFocus.target) === this && navigationState.activeGroup !== this) navigationState.activeGroup = this;
		});
		this.tabFocusTarget.canFocus = () => false;
		this.surface = presentation.surfaces.attach({ role: 'content', lifetimeOwner: presentation.owner, presentationParent: presentation.owner,
			captureScope: this.containerScope.surfaceScope, isVisible: () => this.presented,
			getBounds: () => this.bounds, getClip: () => this.clip, draw() {},
			handlePointer: snapshot => { if (snapshot.justPressedButtons !== 0) this.focus(); },
		});
		this.panes = new EditorPanes(factories, this);
		this.tabStrip = new EditorTabStrip(this.model, this.tabLayoutContext, commands, this.tabFocusTarget,
			id => this.activate(id), id => { void this.close(id); }, () => this.panes.activePane?.focus());
		this.tabSurface = presentation.surfaces.attach({
			role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface, captureScope: this.tabScope,
			isVisible: () => this.presented, getBounds: () => this.tabStrip.layoutState.bounds, getClip: () => this.clip,
			draw: () => this.tabStrip.draw(presentation.renderContext),
			handlePointer: (snapshot, now) => this.tabStrip.handlePointer(snapshot, now),
			handleWheel: event => this.tabStrip.handleWheel(event),
			onRetire: () => pointerCapture.cancelScope(this.tabScope),
		});
		this.paneSurface = presentation.surfaces.attach({
			role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface, captureScope: this.captureScope,
			isVisible: () => this.presented, getBounds: () => this.panes.contentBounds, getClip: () => this.clip,
			draw: () => {
				const pane = this.panes.activePane;
				if (pane === null) drawEditorGroupWatermark(this.panes.contentBounds); else pane.draw();
			},
			handlePointer: (snapshot, now) => {
				const pane = this.panes.activePane;
				if (pane === null) { if (snapshot.justPressedButtons !== 0) this.focus(); return; }
				pane.handlePointer(snapshot, (snapshot.justPressedButtons & PointerButton.Primary) !== 0,
					(snapshot.justPressedButtons & PointerButton.Secondary) !== 0, now, isCtrlDown(snapshot) || isMetaDown(snapshot));
			},
			handleWheel: event => {
				const focused = inputFocus.admittedTarget, guest = focused?.guestInput;
				if (guest !== undefined && focused!.scope.surfaceScope === this.captureScope
					&& point_in_rect(event.viewportX, event.viewportY, guest.bounds)) return false;
				this.panes.activePane?.handleWheel(event); return true;
			},
			onRetire: () => pointerCapture.cancelScope(this.captureScope),
		});
		this.timeline = new RuntimeTimelineControl(commands, () => this.focus(), this.focusTarget, this.timelineBounds,
			() => presentation.layout(this));
		this.timeline.attach(presentation.surfaces, this.surface, this.workArea, presentation.contextMenu);
		presentation.surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: this.timeline.focusScope.surfaceScope, isVisible: () => this.presented && this.timeline.visible,
			getBounds: () => this.timelineBounds, getClip: () => this.clip, draw: () => this.timeline.draw(),
			handlePointer: snapshot => { this.timeline.handlePointer(snapshot); }, handleWheel: () => true,
			onRetire: () => pointerCapture.cancelScope(this.timeline.focusScope.surfaceScope),
		});
		this.subscriptions.push(inputFocus.onDidActivateInteraction(target => {
			if (findEditorGroup(target) === this) {
				const runtime = target.scope.runtimeOwner?.runtime;
				if (runtime !== undefined) this.timeline.setContext(runtime);
			}
		}));
	}

	public onWillFocus(listener: () => boolean): () => void { this.focusListeners.add(listener); return () => this.focusListeners.delete(listener); }
	public focus(): boolean {
		if (!this.openingAdmitted) return false;
		const generation = this.panes.openGeneration, focusRevision = inputFocus.revision;
		for (const listener of this.focusListeners) {
			if (!listener() || generation !== this.panes.openGeneration || inputFocus.revision !== focusRevision && inputFocus.target !== null) return false;
		}
		const pane = this.panes.activePane;
		if (pane === null) this.focusTarget.focus(); else pane.focus();
		return inputFocus.target !== null && this.focusScope.contains(inputFocus.target.scope);
	}
	public get minimumWidth(): number {
		if (this.minimumFont !== editorViewState.font || this.minimumWidthValue === 0) {
			this.minimumFont = editorViewState.font;
			const buttonWidth = Math.max(WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, editorViewState.tabBarHeight);
			this.minimumWidthValue = buttonWidth * this.tabStrip.actions.items.length + editorViewState.font.advance(ELLIPSIS)
				+ measureText(TAB_CLOSE_BUTTON_SYMBOL) + TAB_CLOSE_BUTTON_PADDING_X * 2 + TAB_BUTTON_PADDING_X * 2
				+ TAB_DIRTY_LEFT_MARGIN + TAB_DIRTY_RIGHT_MARGIN;
		}
		return Math.max(this.minimumWidthValue, this.panes.activePane?.minimumClientWidth ?? 0);
	}
	public get minimumHeight(): number { return this.tabStrip.minimumHeight + Math.max(editorViewState.lineHeight, this.panes.activePane?.minimumClientHeight ?? 0) + this.timeline.height + 2; }
	public layout(bounds: Readonly<RectBounds>, clip: Readonly<RectBounds>, presented = true): void {
		this.presented = presented; copy_rect_bounds(this.bounds, bounds); copy_rect_bounds(this.clip, clip);
		const timelineTop = Math.max(bounds.top, bounds.bottom - this.timeline.height);
		write_rect_bounds(this.tabBounds, bounds.left, bounds.top, bounds.right, bounds.top);
		this.tabStrip.layout(this.tabBounds);
		write_rect_bounds(this.timelineBounds, bounds.left, timelineTop, bounds.right, bounds.bottom);
		write_rect_bounds(this.bodyBounds, bounds.left, Math.min(timelineTop, bounds.top + this.tabStrip.layoutState.totalHeight + 2), bounds.right, timelineTop);
		this.panes.layout(this.bodyBounds, this.clip);
		if (!this.presented || !rects_intersect(this.bodyBounds, this.clip)) pointerCapture.cancelScope(this.captureScope);
		if (!this.presented || !rects_intersect(this.tabStrip.layoutState.bounds, this.clip)) pointerCapture.cancelScope(this.tabScope);
		if (!this.presented || !rects_intersect(this.timelineBounds, this.clip)) pointerCapture.cancelScope(this.timeline.focusScope.surfaceScope);
		const focused = inputFocus.target;
		// Logical overflow is retained; actual unavailable controls must publish blur.
		if (focused !== null && this.surfaceService.isInContext(focused.scope.surfaceScope, this.surface.captureScope) && inputFocus.admittedTarget === null) inputFocus.setTarget(null);

	}
	public update(deltaSeconds: number): void {
		this.tabStrip.update(editorRuntimeState.currentTimeMs); this.timeline.update(); this.panes.activePane?.update(deltaSeconds);
	}

	public onWillDispose(listener: () => void): () => void {
		this.disposeListeners.add(listener);
		return () => this.disposeListeners.delete(listener);
	}

	public onDidMoveEditor(listener: (event: EditorMoveEvent) => void): () => void {
		this.moveListeners.add(listener);
		return () => this.moveListeners.delete(listener);
	}

	/** Membership is final; history can follow the retained view before any coalesced source retires. */
	public publishMovedEditor(input: EditorInput, destination: EditorGroupView, replacement: EditorInput): void {
		const event: EditorMoveEvent = { input, destination, replacement };
		for (const listener of this.moveListeners) listener(event);
	}

	public setOpenAdmission(admitted: boolean): void {
		if (this.openingAdmitted === admitted) return;
		this.openingAdmittedValue = admitted;
		this.panes.beginOpen();
	}

	public openEditor(input: EditorInput, options: EditorTabOpenOptions = {}): boolean {
		if (!this.openingAdmitted) {
			if (this.model.indexOf(input) < 0) input.dispose();
			return false;
		}
		let generation = this.panes.openGeneration;
		if (!this.commitPendingEdit() || this.panes.openGeneration !== generation) {
			if (this.model.indexOf(input) < 0) input.dispose();
			return false;
		}
		generation = this.panes.beginOpen();
		const admit = () => {
			if (this.model.findById(input.id) === undefined) {
				generation = this.panes.clearEditor();
				if (this.panes.openGeneration !== generation) {
					if (this.model.indexOf(input) < 0) input.dispose();
					return false;
				}
			}
			const admitted = this.model.add(input, options);
			if (this.panes.openGeneration !== generation) return false;
			return this.doActivate(admitted, options.selection, options.navigationSelection, options.preserveFocus);
		};
		return options.preserveFocus ? admit() : captureNavigation(admit);
	}

	/** Own asynchronous candidate admission and departure capture before storage can yield. */
	public async openResolvedEditor(candidate: EditorInput | Promise<EditorInput>, options: EditorTabOpenOptions = {}): Promise<EditorInputOpenResult | undefined> {
		const generation = this.panes.beginOpen(), focusRevision = inputFocus.revision;
		let departure = options.preserveFocus ? null : beginNavigationCapture();
		try {
			const input = await candidate;
			if (!this.openingAdmitted || generation !== this.panes.openGeneration) { input.dispose(); return undefined; }
			const preserveFocus = options.preserveFocus || focusRevision !== inputFocus.revision;
			if (!withNavigationCaptureSuspended(() => this.openEditor(input, { ...options, preserveFocus }))) return undefined;
			if (!preserveFocus) {
				const previous = departure;
				departure = null;
				completeNavigation(previous);
			}
			return { generation: this.panes.openGeneration, activated: !preserveFocus };
		} finally {
			departure?.dispose();
		}
	}

	public activate(id: EditorTabId, selection?: EditorTextSelection, navigationSelection?: EditorPaneSelection, preserveFocus = false): boolean {
		if (!this.openingAdmitted) return false;
		const generation = this.panes.openGeneration;
		if (!this.commitPendingEdit() || this.panes.openGeneration !== generation) return false;
		const input = this.model.findById(id)!;
		return this.doActivate(input, selection, navigationSelection, preserveFocus);
	}

	/** Only the actual attached view may publish its focused control's draft. */
	public commitPendingEdit(): boolean {
		const focused = inputFocus.target;
		if (this.panes.activePane === null || focused?.edit?.pending !== true || findEditorGroup(focused) !== this) return true;
		return focused.edit.commit();
	}

	/** Retire the departing attachment, never the input that is about to acquire another owner. */
	public detachEditorForMove(input: EditorInput): void {
		if (this.tabStrip.drag.state?.tabId === input.id) this.tabStrip.cancelDrag();
		if (this.model.activeTab === input) this.panes.clearEditor('move');
		else this.panes.beginOpen();
	}

	/** The transfer model already selected this exact member; only its new control is attached here. */
	public attachTransferredEditor(input: EditorInput, selection?: EditorPaneSelection, preserveFocus = false): void {
		if (!preserveFocus) navigationState.activeGroup = this;
		this.panes.openEditor(input, { navigationSelection: selection, preserveFocus });
	}

	/** Apply a switch after its caller has settled user admission or owner retirement. */
	private doActivate(input: EditorInput, selection?: EditorTextSelection, navigationSelection?: EditorPaneSelection, preserveFocus = false): boolean {
		const changing = input !== this.model.activeTab;
		const capture = !preserveFocus && (changing || selection !== undefined || navigationSelection !== undefined);
		const previous = capture ? beginNavigationCapture() : null;
		const generation = changing ? this.panes.clearEditor() : this.panes.beginOpen();
		if (this.panes.openGeneration !== generation) { previous?.dispose(); return false; }
		this.model.activate(input);
		if (this.panes.openGeneration !== generation) { previous?.dispose(); return false; }
		if (!preserveFocus) navigationState.activeGroup = this;
		this.panes.openEditor(input, { selection, navigationSelection, preserveFocus });
		if (capture) completeNavigation(previous);
		return this.model.activeTab === input && this.panes.activePane?.input === input;
	}

	public close(id: EditorTabId, origin: InputFocusTarget | null = inputFocus.target): Promise<boolean> {
		const input = this.model.findById(id)!;
		if (!input.closable) return Promise.resolve(false);
		return this.closeEditors([{ group: this, input }], origin);
	}

	/** Commit an admitted close or explicit owner retirement for this known member. */
	public removeEditor(input: EditorInput, closing?: ReadonlySet<EditorInput>): void {
		if (this.tabStrip.drag.state?.tabId === input.id) this.tabStrip.cancelDrag();
		const index = this.model.indexOf(input);
		if (this.model.activeTab === input) {
			const tabs = this.model.tabs;
			// A bulk close selects a surviving view once, never a doomed lazy pane.
			let successor: EditorInput | undefined;
			for (let position = index - 1; position >= 0; position--) if (!closing?.has(tabs[position])) {
				successor = tabs[position]; break;
			}
			if (successor === undefined) for (let position = index + 1; position < tabs.length; position++) if (!closing?.has(tabs[position])) {
				successor = tabs[position]; break;
			}
			if (successor !== undefined) this.doActivate(successor, undefined, undefined, navigationState.activeGroup !== this);
			else this.panes.clearEditor();
		}
		this.model.removeAt(index);
	}

	public cycle(direction: number): void {
		const tabs = this.model.tabs, count = tabs.length;
		if (count <= 1 || direction === 0) return;
		const current = this.model.indexOf(this.model.activeTab);
		const next = ((current + direction) % count + count) % count;
		if (next !== current) this.activate(tabs[next].id);
	}

	public clear(): void {
		this.panes.clearEditor();
		this.tabStrip.clear();
		this.model.clear();
	}

	public dispose(): void {
		this.setOpenAdmission(false);
		groupsByScope.set(this.containerScope, null);
		groupsByScope.set(this.focusScope, null);
		groupsByScope.set(this.tabFocusTarget.scope, null);
		for (const listener of this.disposeListeners) listener();
		this.disposeListeners.clear();
		this.moveListeners.clear();
		if (navigationState.activeGroup === this) navigationState.activeGroup = null;
		this.unbindFocus();
		for (const unbind of this.subscriptions) unbind();
		this.focusListeners.clear(); this.focusTarget.release(); this.timeline.dispose();
		this.panes.dispose();
		this.containerScope.retireContext();
		this.tabStrip.dispose();
		this.surface.dispose();
		this.model.clear();
	}
}
