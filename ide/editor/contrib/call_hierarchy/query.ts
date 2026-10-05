import type { RuntimeSourceState } from '../../../runtime/sources';
import { buildEditorSemanticSnapshot, createEditorSemanticFrontend } from '../intellisense/frontend';
import { CallHierarchyModel } from './model';
import { activeCodeEditor } from '../../ui/code_editor_state';
import { SYSTEM_RESOURCE_DOMAIN } from '../../../common/resource';

export type CallHierarchyQueryResult =
	| { kind: 'success'; model: CallHierarchyModel; }
	| { kind: 'missing_definition'; };

export function resolveCallHierarchyAt(sources: RuntimeSourceState, row: number, column: number): CallHierarchyQueryResult {
	const resource = activeCodeEditor.model.resource;
	const path = resource.path;
	const snapshot = buildEditorSemanticSnapshot(sources, resource, activeCodeEditor.model.buffer);
	const frontend = createEditorSemanticFrontend(snapshot);
	const symbols = frontend.findSymbolsByPosition(path, row + 1, column + 1);
	if (!symbols) {
		return { kind: 'missing_definition' };
	}
	const resources = sources.luaResources;
	let rootReadOnly = false;
	for (let index = 0; index < resources.length; index += 1) {
		const resource = resources[index];
		if (resource.domain === activeCodeEditor.model.resource.domain && resource.path === path) {
			rootReadOnly = !!resource.source.generated;
			break;
		}
	}
	const allowedPaths = new Set<string>();
	for (let index = 0; index < resources.length; index += 1) {
		const resource = resources[index];
		if ((resource.domain === activeCodeEditor.model.resource.domain
			|| (activeCodeEditor.model.resource.domain !== SYSTEM_RESOURCE_DOMAIN
				&& resource.domain === SYSTEM_RESOURCE_DOMAIN))
			&& !!resource.source.generated === rootReadOnly) {
			allowedPaths.add(resource.path);
		}
	}
	allowedPaths.add(path);
	const rootSymbolIds = new Array(symbols.targets.length);
	for (let index = 0; index < symbols.targets.length; index += 1) {
		rootSymbolIds[index] = symbols.targets[index].id;
	}
	const model = new CallHierarchyModel(frontend, rootSymbolIds, symbols.label, allowedPaths);
	return { kind: 'success', model };
}
