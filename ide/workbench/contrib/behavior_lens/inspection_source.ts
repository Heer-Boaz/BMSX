import { editorTextModelService } from '../../../editor/model/model_service';
import { resourceSourceForChunk } from '../../../runtime/lua_pipeline';
import { resolveRuntimeResource, type RuntimeSourceState } from '../../../runtime/sources';
import { getTextFileRuntimeSourceStatus } from '../../services/working_copy/runtime_source_status';
import type { BehaviorInspectionProperty } from './inspection';

/** Runtime callbacks navigate only while the source corresponds to their installed addresses. */
export function canOpenBehaviorInspectionSource(sources: RuntimeSourceState, detail: BehaviorInspectionProperty): boolean {
	const source = detail.source;
	if (source === undefined) return false;
	if (source.installedSource === undefined) return true;
	const model = editorTextModelService.get(source.resource);
	// The suspended lifetime ends before installation. Reuse the working-copy
	// owner's versioned correspondence, rather than compare whole files on paint.
	if (model !== undefined) return getTextFileRuntimeSourceStatus(sources, model) === 'applied';
	return resourceSourceForChunk(sources, resolveRuntimeResource(sources, source.resource)!) === source.installedSource;
}
