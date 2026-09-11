import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { resolveAemCodeEditorInput, resolveLuaCodeEditorInput } from '../../ui/code_tab/io';
import { resolveResourceViewerInput } from './view_tabs';
import {
	ResourceEditorResolver,
	type ResourceEditorRegistration,
} from '../../services/editor/resource_editor_resolver';

import { WORKBENCH_TEXT_EDITOR_ID } from '../code_editor/editor_input';
import { WORKBENCH_RESOURCE_VIEWER_ID } from './editor_input';

/** Built-in resource editor contributions, ordered from specific to general. */
export function createResourceEditorResolver(
	storage: KeyValueStorage,
	sources: RuntimeSourceState,
): ResourceEditorResolver {
	const registrations: ResourceEditorRegistration[] = [
		{
			id: WORKBENCH_TEXT_EDITOR_ID,
			selector: { kind: 'asset_type', assetType: 'lua' },
			createEditorInput: resource => resolveLuaCodeEditorInput(sources, resource),
		},
		{
			id: WORKBENCH_TEXT_EDITOR_ID,
			selector: { kind: 'asset_type', assetType: 'aem' },
			createEditorInput: resource => resolveAemCodeEditorInput(storage, sources, resource),
		},
		{
			id: WORKBENCH_RESOURCE_VIEWER_ID,
			selector: { kind: 'all' },
			createEditorInput: resource => resolveResourceViewerInput(sources, resource),
		},
	];
	return new ResourceEditorResolver(registrations);
}
