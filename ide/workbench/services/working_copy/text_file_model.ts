import type { RuntimeResource } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { resourceSourceForChunk } from '../../../runtime/lua_pipeline';
import { runtimeSourceProjectRootPath, type RuntimeSourceState } from '../../../runtime/sources';
import { loadWorkspaceSourceFile } from '../../../workspace/files';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import { resolveWorkspacePath } from '../../../workspace/path';

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
