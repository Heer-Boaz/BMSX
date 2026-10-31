import type { TrackedTextRange } from '../../../editor/text/text_change';
import type { TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import type { MainWorkspacePrimaryPartId } from '../../common/main_workspace_client';
import type { SceneSelectionRequest } from './authoring_context';
import type { ScenePrimaryViewState } from './primary_view';
import { captureSceneReading, restoreSceneReading, type SceneReadingSnapshot } from './reading_snapshot';
import type { SceneViewportCameraState } from './viewport/camera';

export type ScenePrimaryViewSnapshot = SceneReadingSnapshot & {
	readonly preferredPart: MainWorkspacePrimaryPartId;
	readonly camera: SceneViewportCameraState;
};
/** Plain source identity and independent region reading state; no native controls or document placement. */
export type ScenePrimarySnapshot = {
	readonly source: TextFileModelSnapshot;
	readonly subject: { readonly range: TrackedTextRange; readonly availability: 'available' | 'unavailable' };
	readonly view: ScenePrimaryViewSnapshot;
};
export function captureScenePrimary(view: ScenePrimaryViewState): ScenePrimarySnapshot {
	const reference = view.authoring.captureSourceReference();
	return { source: reference.source, subject: reference.subject!,
		view: { ...captureSceneReading(view, reference), preferredPart: view.preferredPart, camera: view.viewport.camera.capture() } };
}
export function restoreScenePrimaryView(view: ScenePrimaryViewState, snapshot: ScenePrimaryViewSnapshot,
	request: SceneSelectionRequest = view.authoring.captureSelectionRequest()): void {
	if (restoreSceneReading(view, snapshot, request)) {
		view.viewport.camera.restore(snapshot.camera);
		view.preferredPart = snapshot.preferredPart;
	}
}
