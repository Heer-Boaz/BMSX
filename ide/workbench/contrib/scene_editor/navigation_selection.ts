import { EditorPaneSelection } from '../../services/editor/editor_selection';
import type { SceneViewState } from './scene_view';
import type { SceneSelectionRequest } from './authoring_context';
import { captureSceneEditorView, restoreSceneEditorView, type SceneEditorViewSnapshot } from './view_snapshot';
import { mapSceneReading } from './reading_snapshot';

/** Track the member's containing registration as well as its authored field. */
export class SceneEditorNavigationSelection extends EditorPaneSelection {
	public readonly snapshot: SceneEditorViewSnapshot;

	public constructor(input: SceneViewState, snapshot = captureSceneEditorView(input), private readonly request?: SceneSelectionRequest) {
		super();
		const selected = snapshot.selected;
		this.snapshot = { ...snapshot,
			selected: selected === undefined ? undefined : { ...selected, span: { ...selected.span }, root: { ...selected.root } },
			collapsed: snapshot.collapsed.map(span => ({ ...span })) };
		this.add({ dispose: input.authoring.workingCopy.onDidChangeContent(event => mapSceneReading(this.snapshot, event.changes)) });
	}

	public matches(other: SceneEditorNavigationSelection): boolean {
		const a = this.snapshot.selected, b = other.snapshot.selected;
		return a === undefined || b === undefined ? a === b : a.kind === b.kind
			&& a.span.start === b.span.start && a.span.end === b.span.end && a.root.start === b.root.start && a.root.end === b.root.end;
	}

	public restore(input: SceneViewState): void {
		restoreSceneEditorView(input, this.snapshot, this.request);
	}
}
