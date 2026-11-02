import { DisposableStore } from '../../../common/lifecycle';
import { luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import { withNavigationCaptureSuspended, type NavigationLocation } from '../../../navigation/navigation_history';
import type { EditorInput } from '../../common/editor_inputs';
import type { EditorGroupView, EditorMoveEvent } from '../../services/editor/editor_group';
import type { SceneEditorController } from './controller';
import { SceneEditorInput } from './editor_input';
import { SceneEditorNavigationSelection } from './navigation_selection';
import { SceneBookmark } from './scene_bookmark';

/** An inert occurrence and reading, opened through its actual document group. */
export class SceneNavigationLocation extends DisposableStore implements NavigationLocation {
	private readonly bookmark: SceneBookmark;
	private readonly retirementListeners = new Set<() => void>();
	private group: EditorGroupView;
	private input: EditorInput | undefined;
	private unbindGroup: () => void;
	private unbindMove: () => void;
	private unbindGroupMove: () => void;
	private unbindInput: (() => void) | undefined;

	public constructor(input: SceneEditorInput, group: EditorGroupView, private readonly controller: SceneEditorController) {
		super();
		this.bookmark = new SceneBookmark(input.view.authoring, input.view);
		this.group = group; this.input = input;
		this.unbindGroup = group.onWillDispose(this.retire);
		this.unbindMove = group.onDidMoveEditor(this.followMove);
		this.unbindGroupMove = group.onDidMoveGroup(this.followGroup);
		this.unbindInput = input.onWillDispose(() => { this.input = undefined; this.unbindInput = undefined; });
		this.add(this.bookmark);
		if (this.bookmark.isDisposed) this.retire();
		else this.add({ dispose: this.bookmark.onDidRetire(this.retire) });
	}

	public matches(other: NavigationLocation): boolean {
		return other instanceof SceneNavigationLocation && this.group === other.group && this.bookmark.matches(other.bookmark);
	}
	public onDidRetire(listener: () => void): () => void {
		if (this.isDisposed) listener(); else this.retirementListeners.add(listener);
		return () => this.retirementListeners.delete(listener);
	}
	public async restore(options: { readonly isCurrent: () => boolean; readonly preserveFocus: boolean }): Promise<boolean> {
		if (this.isDisposed || !options.isCurrent()) return false;
		const subject = this.bookmark.resolve(this.controller.documents);
		if (subject === undefined || this.isDisposed || !options.isCurrent()) return false;
		const model = this.bookmark.model, range = luaSourceRangeToTextRange(model.buffer, subject.scene.range), group = this.group;
		const input = withNavigationCaptureSuspended(() => group.openPreparedEditor(() => {
			const prepared = this.controller.prepareDefinition(group, model, range, options.isCurrent);
			if (prepared === undefined) return;
			const selection = new SceneEditorNavigationSelection(prepared.input.view, this.bookmark.view);
			return { input: prepared.input, options: { navigationSelection: selection }, dispose: () => selection.dispose() };
		}, { isCurrent: options.isCurrent, preserveFocus: options.preserveFocus }));
		return input !== undefined && group.model.activeTab === input && group.panes.activePane?.input === input;
	}

	private readonly followMove = (event: EditorMoveEvent): void => {
		if (this.input !== event.input && (this.input !== undefined || !(event.input instanceof SceneEditorInput)
			|| !this.bookmark.matchesSubject(event.input.view.authoring))) return;
		this.unbindInput?.(); this.followGroup(event.destination); this.input = event.replacement;
		this.unbindInput = event.replacement.onWillDispose(() => { this.input = undefined; this.unbindInput = undefined; });
	};
	private readonly followGroup = (destination: EditorGroupView): void => {
		this.unbindMove(); this.unbindGroupMove(); this.unbindGroup();
		this.group = destination;
		this.unbindGroup = destination.onWillDispose(this.retire);
		this.unbindMove = destination.onDidMoveEditor(this.followMove);
		this.unbindGroupMove = destination.onDidMoveGroup(this.followGroup);
	};
	private readonly retire = (): void => {
		if (this.isDisposed) return;
		const listeners = [...this.retirementListeners];
		this.dispose();
		for (const listener of listeners) listener();
	};
	public override dispose(): void {
		if (this.isDisposed) return;
		this.unbindInput?.(); this.unbindMove(); this.unbindGroupMove(); this.unbindGroup();
		super.dispose(); this.retirementListeners.clear();
	}
}
