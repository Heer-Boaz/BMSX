import type { ResourceIdentity, RuntimeResource } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { resourceSourceForChunk } from '../../../runtime/lua_pipeline';
import { resolveRuntimeResource, runtimeSourceProjectRootPath, type RuntimeSourceState } from '../../../runtime/sources';
import { loadWorkspaceSourceFile } from '../../../workspace/files';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import { resolveWorkspacePath } from '../../../workspace/path';
import { getTextSnapshotFingerprint, type TextSnapshotFingerprint } from '../../../editor/text/source_text';

export type TextFileModelSnapshot = {
	readonly resource: ResourceIdentity;
	readonly fingerprint: TextSnapshotFingerprint;
};

/** Persist identity/provenance, not a copy of source bytes in every editor input. */
export function captureTextFileModel(model: EditorTextModel): TextFileModelSnapshot {
	return { resource: { domain: model.resource.domain, path: model.resource.path }, fingerprint: getTextSnapshotFingerprint(model.buffer) };
}

/** Working copies have already admitted any recovered dirty record before views resolve. */
export async function resolveTextFileModelSnapshot(
	storage: KeyValueStorage, sources: RuntimeSourceState, snapshot: TextFileModelSnapshot,
): Promise<{ model: EditorTextModel; sameSource: boolean }> {
	const resource = resolveRuntimeResource(sources, snapshot.resource)!;
	const model = await resolveTextFileModel(storage, sources, resource);
	const fingerprint = getTextSnapshotFingerprint(model.buffer);
	return { model, sameSource: fingerprint.length === snapshot.fingerprint.length && fingerprint.hash === snapshot.fingerprint.hash };
}

/** Source admission for the two editable file formats; no view/group side effects. */
export function resolveTextFileModel(
	storage: KeyValueStorage,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): EditorTextModel | Promise<EditorTextModel> {
	switch (resource.source.type) {
		case 'lua':
			return editorTextModelService.retain(resource, 'lua', resourceSourceForChunk(sources, resource));
		case 'aem':
			return editorTextModelService.resolve(resource, 'aem', async () => {
				const root = runtimeSourceProjectRootPath(sources, resource.domain);
				const source = await loadWorkspaceSourceFile(storage, resolveWorkspacePath(resource.path, root), root);
				if (source === null) throw new Error(`AEM resource '${resource.path}' is unavailable.`);
				return source;
			});
		default:
			throw new Error(`Resource '${resource.path}' has no editable text format.`);
	}
}
