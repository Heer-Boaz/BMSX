import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { DisposableStore } from '../../../common/lifecycle';
import type { EditorTextModelService } from '../../model/model_service';
import type { EditorTextModel } from '../../model/text_model';

/** Lifetime of a result captured from a Lua project's editable source generation. */
export function subscribeToLuaModelChanges(
	models: EditorTextModelService,
	catalog: WorkspaceSourceCatalog,
	contextId: string,
	changed: () => void,
): DisposableStore {
	const lifetime = new DisposableStore();
	const contexts = new Set(catalog.getSourceContexts(contextId).map(context => context.id));
	const onModel = (model: EditorTextModel) => {
		if (model.mode === 'lua' && contexts.has(model.resource.contextId)) changed();
	};
	lifetime.add({ dispose: models.onDidAddModel(onModel) });
	lifetime.add({ dispose: models.onDidChangeContent(onModel) });
	lifetime.add({ dispose: models.onDidRemoveModel(onModel) });
	return lifetime;
}
