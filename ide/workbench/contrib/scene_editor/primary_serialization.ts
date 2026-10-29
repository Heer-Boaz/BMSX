import type { EditorTextModelService } from '../../../editor/model/model_service';
import { luaSourceRangeMatchesTextRange } from '../../../language/lua/source_edits';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { resolveTextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import type { MainWorkspaceClient } from '../../common/main_workspace_client';
import { createScenePrimaryClient, type ScenePrimaryClientOptions } from './primary_client';
import type { ScenePrimarySnapshot } from './primary_snapshot';
import type { SceneSourceDocuments } from './source_documents';
import { UnavailableScenePrimaryClient } from './unavailable_primary';

/** Recovery rebinds only proved source correspondence; names and current selection are not identity. */
export async function restoreScenePrimaryClient(value: string, models: EditorTextModelService, catalog: WorkspaceSourceCatalog,
	documents: SceneSourceDocuments, options: ScenePrimaryClientOptions, isCurrent: () => boolean): Promise<MainWorkspaceClient | undefined> {
	const snapshot: ScenePrimarySnapshot = JSON.parse(value);
	if (!isCurrent()) return undefined;
	if (catalog.resolveResource(snapshot.source.resource) === undefined) return new UnavailableScenePrimaryClient(snapshot, undefined, options);
	const { model, sameSource } = await resolveTextFileModelSnapshot(models, catalog, snapshot.source);
	if (!isCurrent()) return undefined;
	if (sameSource && snapshot.subject.availability === 'available') {
		const sourceVersion = model.version, document = documents.get(model);
		const scene = document.scenes.find(scene => luaSourceRangeMatchesTextRange(model.buffer, scene.range, snapshot.subject.range));
		if (!isCurrent()) return undefined;
		if (scene !== undefined && model.version === sourceVersion) {
			const client = createScenePrimaryClient(model, documents, { document, sourceVersion, scene }, options, snapshot.view);
			if (client !== undefined) return client;
		}
	}
	return new UnavailableScenePrimaryClient(snapshot, model, options);
}
