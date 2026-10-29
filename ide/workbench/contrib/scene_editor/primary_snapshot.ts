import type { TrackedTextRange } from '../../../editor/text/text_change';
import type { TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import type { MainWorkspaceRegionId } from '../../common/main_workspace_client';
import type { SceneSelectionRequest } from './authoring_context';
import type { ScenePrimaryViewState } from './primary_view';
import { captureSceneReading, restoreSceneReading, type SceneReadingSnapshot } from './reading_snapshot';

export type ScenePrimaryViewSnapshot = SceneReadingSnapshot & { readonly preferredRegion: MainWorkspaceRegionId };
/** Plain source identity and independent region reading state; no native controls or document placement. */
export type ScenePrimarySnapshot = {
	readonly source: TextFileModelSnapshot;
	readonly subject: { readonly range: TrackedTextRange; readonly availability: 'available' | 'unavailable' };
	readonly view: ScenePrimaryViewSnapshot;
};
export function captureScenePrimary(view: ScenePrimaryViewState): ScenePrimarySnapshot {
	const reference = view.authoring.captureSourceReference();
	return { source: reference.source, subject: reference.subject!,
		view: { ...captureSceneReading(view, reference), preferredRegion: view.preferredRegion } };
}
export function restoreScenePrimaryView(view: ScenePrimaryViewState, snapshot: ScenePrimaryViewSnapshot,
	request: SceneSelectionRequest = view.authoring.captureSelectionRequest()): void {
	if (restoreSceneReading(view, snapshot, request)) view.preferredRegion = snapshot.preferredRegion;
}
