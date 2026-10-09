import { editorTextModelService } from '../../../editor/model/model_service';
import { resourceSourceForChunk } from '../../../runtime/lua_pipeline';
import { resolveRuntimeResource, type RuntimeSourceState } from '../../../runtime/sources';
import { getTextSnapshot } from '../../../editor/text/source_text';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { BehaviorInspectionProperty } from './inspection';

const correspondence = new WeakMap<NonNullable<BehaviorInspectionProperty['source']>, {
	model: EditorTextModel; version: number; matches: boolean;
}>();

/** Runtime callbacks navigate only while the source corresponds to their installed addresses. */
export function canOpenBehaviorInspectionSource(sources: RuntimeSourceState, detail: BehaviorInspectionProperty): boolean {
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
	const resource = resolveRuntimeResource(sources, source.resource);
	return resource !== undefined && resourceSourceForChunk(sources, resource) === source.installedSource;
}
