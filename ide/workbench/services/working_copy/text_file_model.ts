import type { ResourceIdentity, RuntimeResource } from '../../../common/resource';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { EditorDocumentMode, EditorTextModel } from '../../../editor/model/text_model';
import { resolveRuntimeLuaSource, resolveRuntimeResource, runtimeSourceProjectRootPath, type RuntimeSourceState } from '../../../runtime/sources';
import { loadWorkspaceSourceFile, readWorkspaceLuaSourceText } from '../../../workspace/files';
import { resolveWorkspacePath } from '../../../workspace/path';
import { getTextSnapshotFingerprint, type TextSnapshotFingerprint } from '../../../editor/text/source_text';
import { workspaceCanonicalSourceCache } from '../../../workspace/cache';

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
	models: EditorTextModelService, sources: RuntimeSourceState, snapshot: TextFileModelSnapshot,
): Promise<{ model: EditorTextModel; sameSource: boolean }> {
	const resource = resolveRuntimeResource(sources, snapshot.resource);
	if (!resource) {
		throw new Error(`Workspace resource '${snapshot.resource.path}' is not installed for domain '${snapshot.resource.domain}'.`);
	}
	const model = await resolveTextFileModel(models, sources, resource);
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

/** Lua's effective compilation source and persisted baseline remain distinct in its working copy. */
export function resolveLuaTextFileModel(
	models: EditorTextModelService,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): EditorTextModel {
	const source = resolveRuntimeLuaSource(sources, resource);
	if (!source) throw new Error(`Missing Lua source for '${resource.path}'.`);
	const canonical = workspaceCanonicalSourceCache.get(source.record.normalized_source_path);
	const savedSource = canonical === undefined ? source.record.base_src : canonical.contents;
	return models.retain(resource, 'lua', readWorkspaceLuaSourceText(source.registry, source.record), savedSource,
		canonical === undefined ? null : canonical.contents);
}

/** Source admission for editable source formats; no view/group side effects. */
export function resolveTextFileModel(
	models: EditorTextModelService,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): EditorTextModel | Promise<EditorTextModel> {
	const mode = textFileMode(resource);
	switch (mode) {
		case 'lua':
			return resolveLuaTextFileModel(models, sources, resource);
		case 'yaml':
		case 'aem': {
			// Data stays in its authored YAML; never reconstruct it from cooked assets.
			return models.resolve(resource, mode, async () => {
				const root = runtimeSourceProjectRootPath(sources, resource.domain);
				const source = await loadWorkspaceSourceFile(resolveWorkspacePath(resource.path, root));
				// A workspace file overlays the packaged authored base, just as for Lua.
				// IO errors propagate; they never select another source authority.
				if (source !== null) return { source: source.contents, persistedBaseline: source.contents };
				if (resource.source.sourcemeta !== undefined) return { source: resource.source.sourcemeta.text, persistedBaseline: null };
				throw new Error(`Source for '${resource.path}' is unavailable.`);
			});
		}
	}
	throw new Error(`Resource '${resource.path}' has no editable text format.`);
}
