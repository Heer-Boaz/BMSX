import type { CartEditor } from '../../../cart_editor';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { openAemCodeTab, openLuaCodeTab } from '../../ui/code_tab/io';
import type { ResourcePanelController } from './panel/controller';
import { openResourceViewerTab } from './view_tabs';
import {
	ResourceEditorResolver,
	type ResourceEditorRegistration,
} from '../../services/editor/resource_editor_resolver';

export const WORKBENCH_TEXT_EDITOR_ID = 'workbench.editor.text';
export const WORKBENCH_RESOURCE_VIEWER_ID = 'workbench.editor.resourceViewer';

/** Built-in resource editor contributions, ordered from specific to general. */
export function createResourceEditorResolver(
	storage: KeyValueStorage,
	editor: CartEditor,
	sources: RuntimeSourceState,
	resourcePanel: ResourcePanelController,
): ResourceEditorResolver {
	const registrations: ResourceEditorRegistration[] = [
		{
			id: WORKBENCH_TEXT_EDITOR_ID,
			selector: { kind: 'asset_type', assetType: 'lua' },
			open: (resource, selection) => openLuaCodeTab(
				resourcePanel,
				sources,
				resource,
				selection,
			),
		},
		{
			id: WORKBENCH_TEXT_EDITOR_ID,
			selector: { kind: 'asset_type', assetType: 'aem' },
			open: (resource, selection) => openAemCodeTab(
				storage,
				editor,
				sources,
				resource,
				selection,
			),
		},
		{
			id: WORKBENCH_RESOURCE_VIEWER_ID,
			selector: { kind: 'all' },
			open: resource => openResourceViewerTab(resourcePanel, sources, resource),
		},
	];
	return new ResourceEditorResolver(registrations);
}
