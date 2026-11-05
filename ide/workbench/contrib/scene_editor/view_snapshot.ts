import type { SceneViewState } from './scene_view';
import type { SceneAuthoredSourceReference, SceneSelectionRequest } from './authoring_context';
import { captureSceneReading, restoreSceneReading, type SceneReadingSnapshot } from './reading_snapshot';
import type { MainWorkspacePrimaryPartId } from '../../common/main_workspace_client';
import type { WorkbenchViewportCameraState } from '../../ui/viewport_camera';

export type SceneEditorViewSnapshot = SceneReadingSnapshot & {
	readonly preferredPart: MainWorkspacePrimaryPartId; readonly camera: WorkbenchViewportCameraState };

export function captureSceneEditorView(input: SceneViewState, reference: SceneAuthoredSourceReference = input.authoring.captureSourceReference()): SceneEditorViewSnapshot {
	return { ...captureSceneReading(input, reference),
		preferredPart: input.preferredPart, camera: input.viewport.camera.capture() };
}
export function restoreSceneEditorView(input: SceneViewState, snapshot: SceneEditorViewSnapshot,
	request: SceneSelectionRequest = input.authoring.captureSelectionRequest()): void {
	if (restoreSceneReading(input, snapshot, request)) {
		input.preferredPart = snapshot.preferredPart;
		input.viewport.camera.restore(snapshot.camera);
	}
}
