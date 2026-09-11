import { SYSTEM_RESOURCE_DOMAIN, type ResourceDomain } from '../../../common/resource';
import { DisposableStore } from '../../../common/lifecycle';
import type { EditorTextModelService } from '../../model/model_service';
import type { EditorTextModel } from '../../model/text_model';

/** Lifetime of a result captured from a Lua project's editable source generation. */
export function subscribeToLuaModelChanges(
	models: EditorTextModelService,
	domain: ResourceDomain,
	changed: () => void,
): DisposableStore {
	const lifetime = new DisposableStore();
	const onModel = (model: EditorTextModel) => {
		if (model.mode === 'lua' && (model.resource.domain === domain || model.resource.domain === SYSTEM_RESOURCE_DOMAIN)) changed();
	};
	lifetime.add({ dispose: models.onDidAddModel(onModel) });
	lifetime.add({ dispose: models.onDidChangeContent(onModel) });
	lifetime.add({ dispose: models.onDidRemoveModel(onModel) });
	return lifetime;
}
