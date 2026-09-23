import type { ResourceIdentity, RuntimeResource } from '../../../common/resource';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { EditorDocumentMode, EditorTextModel } from '../../../editor/model/text_model';
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
	return { resource: model.identity, fingerprint: getTextSnapshotFingerprint(model.buffer) };
}

/** Working copies have already admitted any recovered dirty record before views resolve. */
export async function resolveTextFileModelSnapshot(
	models: EditorTextModelService, storage: KeyValueStorage, sources: RuntimeSourceState, snapshot: TextFileModelSnapshot,
): Promise<{ model: EditorTextModel; sameSource: boolean }> {
	const resource = resolveRuntimeResource(sources, snapshot.resource);
	if (!resource) {
		throw new Error(`Workspace resource '${snapshot.resource.path}' is not installed for domain '${snapshot.resource.domain}'.`);
	}
	const model = await resolveTextFileModel(models, storage, sources, resource);
	const fingerprint = getTextSnapshotFingerprint(model.buffer);
	return { model, sameSource: fingerprint.length === snapshot.fingerprint.length && fingerprint.hash === snapshot.fingerprint.hash };
}

/** The authored text capability is shared by source admission and resource/tool catalogs. */
export function textFileMode(resource: RuntimeResource): EditorDocumentMode | undefined {
	switch (resource.source.type) {
		case 'lua': return 'lua';
		case 'aem': return 'aem';
		case 'data': return /\.ya?ml$/i.test(resource.path) ? 'yaml' : undefined;
	}
}

/** Source admission for editable source formats; no view/group side effects. */
export function resolveTextFileModel(
	models: EditorTextModelService,
	storage: KeyValueStorage,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): EditorTextModel | Promise<EditorTextModel> {
	const mode = textFileMode(resource);
	switch (mode) {
		case 'lua':
			return models.retain(resource, 'lua', resourceSourceForChunk(sources, resource));
		case 'yaml':
		case 'aem': {
			// Data stays in its authored YAML; never reconstruct it from cooked assets.
			return models.resolve(resource, mode, async () => {
				const root = runtimeSourceProjectRootPath(sources, resource.domain);
				const source = await loadWorkspaceSourceFile(storage, resolveWorkspacePath(resource.path, root), root);
				if (source === null) throw new Error(`Source for '${resource.path}' is unavailable.`);
				return source;
			});
		}
	}
	throw new Error(`Resource '${resource.path}' has no editable text format.`);
}
