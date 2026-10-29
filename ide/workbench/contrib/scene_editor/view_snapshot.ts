import type { SceneEditorViewState, SceneEditorSection } from './view_state';
import type { SceneAuthoredSourceReference, SceneSelectionRequest } from './authoring_context';
import { captureSceneReading, restoreSceneReading, type SceneReadingSnapshot } from './reading_snapshot';

export type SceneEditorViewSnapshot = SceneReadingSnapshot & { readonly section: SceneEditorSection };

export function captureSceneEditorView(input: SceneEditorViewState, reference: SceneAuthoredSourceReference = input.authoring.captureSourceReference()): SceneEditorViewSnapshot {
	return { ...captureSceneReading(input, reference), section: input.section };
}
export function restoreSceneEditorView(input: SceneEditorViewState, snapshot: SceneEditorViewSnapshot,
	request: SceneSelectionRequest = input.authoring.captureSelectionRequest()): void {
	if (restoreSceneReading(input, snapshot, request)) input.section = snapshot.section;
}
