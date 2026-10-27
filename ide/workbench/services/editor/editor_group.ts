import type { EditorCommandRunner } from '../../../common/commands';
import { InputFocusScope, inputFocus, type InputFocusTarget } from '../../../input/focus';
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
	public readonly focusScope = new InputFocusScope(this.captureScope, inputFocus.workbenchScope);
	public readonly tabScope = Symbol('editor-tabs');
	public readonly tabFocusTarget = inputFocus.createTarget(null, new InputFocusScope(this.tabScope, this.focusScope));
	public readonly panes: EditorPanes;
	public readonly tabStrip: EditorTabStrip;
	private readonly unbindFocus: () => void;
	private readonly disposeListeners = new Set<() => void>();

	public constructor(factories: EditorPaneFactories, commands: EditorCommandRunner, private readonly closeEditors: CloseEditors) {
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
	}

	public onWillDispose(listener: () => void): () => void {
		this.disposeListeners.add(listener);
		return () => this.disposeListeners.delete(listener);
	}

	public openEditor(input: EditorInput, options: EditorTabOpenOptions = {}): boolean {
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
			if (generation !== this.panes.openGeneration) { input.dispose(); return undefined; }
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
	public removeEditor(input: EditorInput): void {
		if (this.tabStrip.drag.state?.tabId === input.id) this.tabStrip.cancelDrag();
		const index = this.model.indexOf(input);
		if (this.model.activeTab === input) {
			const tabs = this.model.tabs;
			if (tabs.length > 1) this.doActivate(index > 0 ? tabs[index - 1] : tabs[index + 1],
				undefined, undefined, navigationState.activeGroup !== this);
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
		pointerCapture.cancelScope(this.captureScope);
		pointerCapture.cancelScope(this.tabScope);
		this.model.clear();
	}
}
