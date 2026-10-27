import { CART_MAP_SOURCES, resolveCartMapInput } from '../cart_maps/controller';
import { WORKBENCH_CART_MAP_EDITOR_ID } from '../cart_maps/editor_input';
import { resolveAemEditorInput } from '../aem/controller';
import { WORKBENCH_AEM_EDITOR_ID } from '../aem/editor_input';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { resolveTextCodeEditorInput, resolveLuaCodeEditorInput } from '../../ui/code_tab/io';
import {
	ResourceEditorResolver,
	type ResourceEditorRegistration,
} from '../../services/editor/resource_editor_resolver';

import { WORKBENCH_TEXT_EDITOR_ID } from '../code_editor/editor_input';
import { ResourceViewerInput, WORKBENCH_RESOURCE_VIEWER_ID } from './editor_input';

/** Built-in resource editor contributions, ordered from specific to general. */
export function createResourceEditorResolver(
	catalog: WorkspaceSourceCatalog,
): ResourceEditorResolver {
	const registrations: ResourceEditorRegistration[] = [
		{
			id: WORKBENCH_TEXT_EDITOR_ID,
			selector: { kind: 'asset_type', assetType: 'lua' },
			createEditorInput: resource => resolveLuaCodeEditorInput(catalog, resource),
		},
		{
			id: WORKBENCH_AEM_EDITOR_ID,
			selector: { kind: 'asset_type', assetType: 'aem' },
			createEditorInput: resource => resolveAemEditorInput(catalog, resource),
		},
		{
			id: WORKBENCH_TEXT_EDITOR_ID,
			selector: { kind: 'asset_type', assetType: 'aem' },
			createEditorInput: resource => resolveTextCodeEditorInput(catalog, resource),
		},
		...['.yaml', '.yml'].map(suffix => ({
			id: WORKBENCH_TEXT_EDITOR_ID,
			selector: { kind: 'filename_suffix' as const, suffix, assetType: 'data' as const },
			createEditorInput: resource => resolveTextCodeEditorInput(catalog, resource),
		} satisfies ResourceEditorRegistration)),
		...CART_MAP_SOURCES.map(({ suffix, kind }) => ({
			id: WORKBENCH_CART_MAP_EDITOR_ID,
			selector: { kind: 'filename_suffix' as const, suffix, assetType: 'data' as const },
			createEditorInput: resource => resolveCartMapInput(catalog, resource, kind),
		} satisfies ResourceEditorRegistration)),
		{
			id: WORKBENCH_RESOURCE_VIEWER_ID,
			selector: { kind: 'all' },
			createEditorInput: resource => new ResourceViewerInput(catalog, resource),
		},
	];
	return new ResourceEditorResolver(registrations);
}
