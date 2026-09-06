import type { ResourceIdentity } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModelSnapshot } from '../../../editor/model/text_model';
import { getTextSnapshot } from '../../../editor/text/source_text';
import { resolveRuntimeLuaSource, type RuntimeSourceState } from '../../../runtime/sources';
import { readWorkspaceLuaSourceText } from '../../../workspace/files';

export type LuaTextModelSourceSnapshot = ResourceIdentity & EditorTextModelSnapshot;

export type CurrentLuaSourceSnapshot = {
	readonly source: string;
	readonly revision: number;
};

/** Reads the retained document, including source-only tests, or its workspace record. */
export function captureCurrentLuaSource(sources: RuntimeSourceState, resource: ResourceIdentity): CurrentLuaSourceSnapshot {
	const model = editorTextModelService.get(resource);
	if (model !== undefined) {
		return { source: getTextSnapshot(model.buffer), revision: model.version };
	}
	const match = resolveRuntimeLuaSource(sources, resource)!;
	return {
		source: readWorkspaceLuaSourceText(match.registry, match.record),
		revision: match.record.update_timestamp,
	};
}

/** Pins all retained program documents before asynchronous workspace/build work. */
export function captureLuaTextModelSources(sources: RuntimeSourceState): LuaTextModelSourceSnapshot[] {
	const snapshots: LuaTextModelSourceSnapshot[] = [];
	for (const model of editorTextModelService.models) {
		if (model.mode !== 'lua' || model.readOnly || !resolveRuntimeLuaSource(sources, model.resource)!.record.program_module) {
			continue;
		}
		snapshots.push({ ...model.createSnapshot(), domain: model.resource.domain, path: model.resource.path });
	}
	return snapshots;
}
