import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { retainAemCodeEditorInput, retainLuaCodeEditorInput } from '../../ui/code_tab/io';
import { retainResourceViewerInput } from './view_tabs';
import {
	ResourceEditorResolver,
	type ResourceEditorRegistration,
} from '../../services/editor/resource_editor_resolver';

export const WORKBENCH_TEXT_EDITOR_ID = 'workbench.editor.text';
export const WORKBENCH_RESOURCE_VIEWER_ID = 'workbench.editor.resourceViewer';

/** Built-in resource editor contributions, ordered from specific to general. */
export function createResourceEditorResolver(
	storage: KeyValueStorage,
	sources: RuntimeSourceState,
): ResourceEditorResolver {
	const registrations: ResourceEditorRegistration[] = [
		{
			id: WORKBENCH_TEXT_EDITOR_ID,
			selector: { kind: 'asset_type', assetType: 'lua' },
			createEditorInput: resource => retainLuaCodeEditorInput(sources, resource),
		},
		{
			id: WORKBENCH_TEXT_EDITOR_ID,
			selector: { kind: 'asset_type', assetType: 'aem' },
			createEditorInput: resource => retainAemCodeEditorInput(storage, sources, resource),
		},
		{
			id: WORKBENCH_RESOURCE_VIEWER_ID,
			selector: { kind: 'all' },
			createEditorInput: resource => retainResourceViewerInput(sources, resource),
		},
	];
	return new ResourceEditorResolver(registrations);
}
