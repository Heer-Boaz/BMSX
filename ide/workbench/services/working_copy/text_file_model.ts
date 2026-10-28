import type { ResourceIdentity, RuntimeResource } from '../../../common/resource';
import type { EditorTextModelService, ResolvedTextModelSource } from '../../../editor/model/model_service';
import type { EditorDocumentMode, EditorTextModel } from '../../../editor/model/text_model';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { loadWorkspaceSourceFile, readWorkspaceLuaSourceText } from '../../../workspace/files';
import { getTextSnapshot, getTextSnapshotFingerprint, type TextSnapshotFingerprint } from '../../../editor/text/source_text';
import { workspaceCanonicalSourceCache } from '../../../workspace/cache';

export type TextFileModelSnapshot = {
	readonly resource: ResourceIdentity;
	readonly fingerprint: TextSnapshotFingerprint;
};

export type TextFileSourceSnapshot = {
	readonly resource: ResourceIdentity;
	readonly source: string;
};

/** Persist identity/provenance, not a copy of source bytes in every editor input. */
export function captureTextFileModel(model: EditorTextModel): TextFileModelSnapshot {
	return { resource: model.identity, fingerprint: getTextSnapshotFingerprint(model.buffer) };
}

/** Observing authored source does not admit a working copy or acquire an editing consumer. */
export async function captureTextFileSource(models: EditorTextModelService, catalog: WorkspaceSourceCatalog,
	resource: RuntimeResource): Promise<TextFileSourceSnapshot> {
	const retained = models.get(resource);
	if (retained !== undefined) return { resource: retained.identity, source: getTextSnapshot(retained.buffer) };
	let source: string;
	switch (textFileMode(resource)) {
		case 'lua': source = loadLuaTextFileSource(catalog, resource).source; break;
		case 'yaml': case 'aem': source = (await loadAuthoredTextFileSource(resource)).source; break;
		default: throw new Error(`Resource '${resource.path}' has no editable text format.`);
	}
	// File IO can overlap admission or edits in the canonical model owner.
	const admitted = models.get(resource);
	if (admitted !== undefined) return { resource: admitted.identity, source: getTextSnapshot(admitted.buffer) };
	return { resource: { contextId: resource.contextId, path: resource.path }, source };
}

/** Working copies have already admitted any recovered dirty record before views resolve. */
export async function resolveTextFileModelSnapshot(
	models: EditorTextModelService, catalog: WorkspaceSourceCatalog, snapshot: TextFileModelSnapshot,
): Promise<{ model: EditorTextModel; sameSource: boolean }> {
	const resource = catalog.resolveResource(snapshot.resource);
	if (!resource) {
		throw new Error(`Workspace resource '${snapshot.resource.path}' is not admitted in source context '${snapshot.resource.contextId}'.`);
	}
	const model = await resolveTextFileModel(models, catalog, resource);
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
	catalog: WorkspaceSourceCatalog,
	resource: RuntimeResource,
): EditorTextModel {
	const loaded = loadLuaTextFileSource(catalog, resource);
	return models.retain(resource, 'lua', loaded.source, loaded.savedSource, loaded.persistedBaseline);
}

function loadLuaTextFileSource(catalog: WorkspaceSourceCatalog, resource: RuntimeResource): ResolvedTextModelSource & { readonly savedSource: string } {
	const source = catalog.resolveLuaSource(resource);
	if (!source) throw new Error(`Missing Lua source for '${resource.path}'.`);
	const canonical = resource.sourceFilePath === undefined ? undefined : workspaceCanonicalSourceCache.get(resource.sourceFilePath);
	const savedSource = canonical === undefined ? source.record.base_src : canonical.contents;
	return { source: readWorkspaceLuaSourceText(source.registry, source.record), savedSource,
		persistedBaseline: canonical === undefined ? null : canonical.contents };
}

/** Workspace authored bytes overlay packaged authored bytes, independently of their cooked format. */
async function loadAuthoredTextFileSource(resource: RuntimeResource): Promise<ResolvedTextModelSource> {
	const source = await loadWorkspaceSourceFile(resource.sourceFilePath!);
	if (source !== null) return { source: source.contents, persistedBaseline: source.contents };
	if (resource.source.sourcemeta !== undefined) return { source: resource.source.sourcemeta.text, persistedBaseline: null };
	throw new Error(`Source for '${resource.path}' is unavailable.`);
}

/** Source admission for editable source formats; no view/group side effects. */
export function resolveTextFileModel(
	models: EditorTextModelService,
	catalog: WorkspaceSourceCatalog,
	resource: RuntimeResource,
): EditorTextModel | Promise<EditorTextModel> {
	const mode = textFileMode(resource);
	switch (mode) {
		case 'lua':
			return resolveLuaTextFileModel(models, catalog, resource);
		case 'yaml':
		case 'aem': return models.resolve(resource, mode, () => loadAuthoredTextFileSource(resource));
	}
	throw new Error(`Resource '${resource.path}' has no editable text format.`);
}
