import type { TrackedTextRange } from '../../../editor/text/text_change';
import type { TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import type { SceneEditorViewState } from './view_state';
import { captureSceneEditorView, type SceneEditorViewSnapshot } from './view_snapshot';

/** Plain contribution state; the workspace stores no Scene controls, AST or duplicate source bytes. */
export type ScenePrimarySnapshot = {
	readonly source: TextFileModelSnapshot;
	readonly subject: { readonly range: TrackedTextRange; readonly availability: 'available' | 'unavailable' };
	readonly view: SceneEditorViewSnapshot;
};

export function captureScenePrimary(view: SceneEditorViewState): ScenePrimarySnapshot {
	const reference = view.authoring.captureSourceReference();
	return { source: reference.source, subject: reference.subject!, view: captureSceneEditorView(view, reference) };
}
