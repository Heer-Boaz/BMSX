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
import { point_in_rect } from '../../../../machine/ts/common/rect';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { isCtrlDown, isMetaDown } from '../../../input/keyboard/key_input';
import type { EditorTabStripRenderContext } from '../../render/tab_bar';
import { drawEditorGroupWatermark } from '../../render/editor_group_watermark';

/** The container supplies ancestry and allowable popup extent before controls are constructed. */
export type EditorGroupPresentation = {
	readonly surfaces: WorkbenchSurfaceService;
	readonly owner: WorkbenchSurface;
	readonly focusScope: InputFocusScope;
	readonly workArea: Readonly<RectBounds>;
	readonly renderContext: EditorTabStripRenderContext;
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

/** Concrete input, control and tab-strip lifetimes for one independently arranged editor group. */
export class EditorGroupView {
	public readonly model = new EditorTabGroupModel();
	public readonly captureScope = Symbol('editor-group');
	public readonly focusScope: InputFocusScope;
	public readonly tabScope = Symbol('editor-tabs');
	public readonly tabFocusTarget: InputFocusTarget;
	public readonly panes: EditorPanes;
	public readonly tabStrip: EditorTabStrip;
	public readonly paneSurface: WorkbenchSurface;
	public readonly tabSurface: WorkbenchSurface;
	public readonly workArea: Readonly<RectBounds>;
	private readonly unbindFocus: () => void;
	private openingAdmitted = true;
	private readonly disposeListeners = new Set<() => void>();

	public constructor(factories: EditorPaneFactories, commands: EditorCommandRunner, private readonly closeEditors: CloseEditors,
		presentation: EditorGroupPresentation) {
		this.focusScope = new InputFocusScope(this.captureScope, presentation.focusScope);
		this.tabFocusTarget = inputFocus.createTarget(null, new InputFocusScope(this.tabScope, this.focusScope));
		this.workArea = presentation.workArea;
		this.focusScope.interaction = new InputInteraction();
		groupsByScope.set(this.focusScope, this);
		groupsByScope.set(this.tabFocusTarget.scope, this);
		this.focusScope.commands = commands;
		this.tabFocusTarget.scope.commands = commands;
		this.unbindFocus = inputFocus.onDidChangeTarget(() => {
			if (findEditorGroup(inputFocus.target) === this && navigationState.activeGroup !== this) navigationState.activeGroup = this;
		});
		this.tabFocusTarget.canFocus = () => false;
		this.panes = new EditorPanes(factories, this);
		this.tabStrip = new EditorTabStrip(this.model, commands, this.tabFocusTarget,
			id => this.activate(id), id => { void this.close(id); }, () => this.panes.activePane?.focus());
		this.tabSurface = presentation.surfaces.attach({
			role: 'content', lifetimeOwner: presentation.owner, presentationParent: presentation.owner, captureScope: this.tabScope,
			isVisible: () => true, getBounds: () => this.tabStrip.layoutState.bounds, getClip: () => this.tabStrip.layoutState.bounds,
			draw: () => this.tabStrip.draw(presentation.renderContext),
			handlePointer: (snapshot, now) => this.tabStrip.handlePointer(snapshot, now),
			handleWheel: event => this.tabStrip.handleWheel(event),
			onRetire: () => pointerCapture.cancelScope(this.tabScope),
		});
		this.paneSurface = presentation.surfaces.attach({
			role: 'content', lifetimeOwner: presentation.owner, presentationParent: presentation.owner, captureScope: this.captureScope,
			isVisible: () => true, getBounds: () => this.panes.contentBounds, getClip: () => this.panes.contentBounds,
			draw: () => {
				const pane = this.panes.activePane;
				if (pane === null) drawEditorGroupWatermark(this.panes.contentBounds); else pane.draw();
			},
			handlePointer: (snapshot, now) => this.panes.activePane?.handlePointer(snapshot,
				(snapshot.justPressedButtons & PointerButton.Primary) !== 0,
				(snapshot.justPressedButtons & PointerButton.Secondary) !== 0, now, isCtrlDown(snapshot) || isMetaDown(snapshot)),
			handleWheel: event => {
				const focused = inputFocus.admittedTarget, guest = focused?.guestInput;
				if (guest !== undefined && focused!.scope.surfaceScope === this.captureScope
					&& point_in_rect(event.viewportX, event.viewportY, guest.bounds)) return false;
				this.panes.activePane?.handleWheel(event); return true;
			},
			onRetire: () => pointerCapture.cancelScope(this.captureScope),
		});
	}

	public onWillDispose(listener: () => void): () => void {
		this.disposeListeners.add(listener);
		return () => this.disposeListeners.delete(listener);
	}

	public setOpenAdmission(admitted: boolean): void {
		if (this.openingAdmitted === admitted) return;
		this.openingAdmitted = admitted;
		this.panes.beginOpen();
	}

	public openEditor(input: EditorInput, options: EditorTabOpenOptions = {}): boolean {
		if (!this.openingAdmitted) {
			if (this.model.indexOf(input) < 0) input.dispose();
			return false;
		}
		if (!this.commitPendingEdit()) {
			if (this.model.indexOf(input) < 0) input.dispose();
			return false;
		}
		const admit = () => {
			if (this.model.findById(input.id) === undefined) this.panes.clearEditor();
			const admitted = this.model.add(input, options);
			this.doActivate(admitted, options.selection, options.navigationSelection, options.preserveFocus);
		};
		if (options.preserveFocus) admit();
		else captureNavigation(admit);
		return true;
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
		if (!this.commitPendingEdit()) return false;
		const input = this.model.findById(id)!;
		this.doActivate(input, selection, navigationSelection, preserveFocus);
		return true;
	}

	/** Only the actual attached view may publish its focused control's draft. */
	private commitPendingEdit(): boolean {
		const focused = inputFocus.target;
		if (this.panes.activePane === null || focused?.edit?.pending !== true || findEditorGroup(focused) !== this) return true;
		return focused.edit.commit();
	}

	/** Apply a switch after its caller has settled user admission or owner retirement. */
	private doActivate(input: EditorInput, selection?: EditorTextSelection, navigationSelection?: EditorPaneSelection, preserveFocus = false): void {
		const changing = input !== this.model.activeTab;
		const capture = !preserveFocus && (changing || selection !== undefined || navigationSelection !== undefined);
		const previous = capture ? beginNavigationCapture() : null;
		if (changing) this.panes.clearEditor();
		this.model.activate(input);
		if (!preserveFocus) navigationState.activeGroup = this;
		this.panes.openEditor(input, { selection, navigationSelection, preserveFocus });
		if (capture) completeNavigation(previous);
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
		groupsByScope.set(this.focusScope, null);
		groupsByScope.set(this.tabFocusTarget.scope, null);
		for (const listener of this.disposeListeners) listener();
		this.disposeListeners.clear();
		if (navigationState.activeGroup === this) navigationState.activeGroup = null;
		this.unbindFocus();
		this.panes.dispose();
		this.focusScope.retireContext();
		this.tabFocusTarget.scope.retireContext();
		this.tabStrip.dispose();
		this.paneSurface.dispose(); this.tabSurface.dispose();
		this.model.clear();
	}
}
