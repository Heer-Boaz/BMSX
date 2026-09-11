import { EditorPaneSelection } from '../../services/editor/editor_selection';
import type { SceneEditorInput } from './editor_input';
import { captureSceneEditorView, mapSceneEditorView, restoreSceneEditorView, type SceneEditorViewSnapshot } from './view_snapshot';

/** Track the member's containing registration as well as its authored field. */
export class SceneEditorNavigationSelection extends EditorPaneSelection {
	public readonly snapshot: SceneEditorViewSnapshot;

	public constructor(input: SceneEditorInput) {
		super();
		this.snapshot = captureSceneEditorView(input);
		this.add({ dispose: input.workingCopy.onDidChangeContent(event => mapSceneEditorView(this.snapshot, event.changes)) });
	}

	public matches(other: SceneEditorNavigationSelection): boolean {
		const a = this.snapshot.selected, b = other.snapshot.selected;
		return a === undefined || b === undefined ? a === b : a.kind === b.kind
			&& a.span.start === b.span.start && a.span.end === b.span.end && a.root.start === b.root.start && a.root.end === b.root.end;
	}

	public restore(input: SceneEditorInput): void {
		restoreSceneEditorView(input, this.snapshot);
	}
}
