import { editorTextModelService } from '../../../editor/model/model_service';
import { readWorkspaceLuaSourceText } from '../../../workspace/files';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { getTextSnapshot } from '../../../editor/text/source_text';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { BehaviorInspectionProperty } from './inspection';

const correspondence = new WeakMap<NonNullable<BehaviorInspectionProperty['source']>, {
	model: EditorTextModel; version: number; matches: boolean;
}>();

/** Runtime callbacks navigate only while the source corresponds to their installed addresses. */
export function canOpenBehaviorInspectionSource(catalog: WorkspaceSourceCatalog, detail: BehaviorInspectionProperty): boolean {
	const source = detail.source;
	if (source === undefined) return false;
	if (source.installedSource === undefined) return true;
	const model = editorTextModelService.get(source.resource);
	if (model !== undefined) {
		let match = correspondence.get(source);
		if (match === undefined || match.model !== model) {
			match = { model, version: model.version, matches: getTextSnapshot(model.buffer) === source.installedSource };
			correspondence.set(source, match);
		} else if (match.version !== model.version) {
			match.version = model.version; match.matches = getTextSnapshot(model.buffer) === source.installedSource;
		}
		return match.matches;
	}
	const resource = catalog.resolveResource(source.resource);
	if (resource === undefined) return false;
	const authored = catalog.resolveLuaSource(resource)!;
	return readWorkspaceLuaSourceText(authored.registry, authored.record) === source.installedSource;
}
