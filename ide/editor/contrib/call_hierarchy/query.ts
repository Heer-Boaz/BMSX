import { buildEditorSemanticSnapshot, createEditorSemanticFrontend } from '../intellisense/frontend';
import { extractHoverExpression } from '../intellisense/engine';
import { buildIncomingCallHierarchyView, type CallHierarchyView } from './view';
import { editorDocumentState } from '../../editing/document_state';
import { SYSTEM_RESOURCE_DOMAIN } from '../../../common/resource';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import { definitionLocationFromSourceRange } from '../../navigation/source_range';

export type CallHierarchyQueryResult =
	| { kind: 'success'; view: CallHierarchyView; }
	| { kind: 'missing_definition'; }
	| { kind: 'no_calls'; expression: string; };

export function resolveCallHierarchyViewAt(bridge: RuntimeLuaTooling, row: number, column: number): CallHierarchyQueryResult {
	const resource = editorDocumentState.resource;
	const path = resource.path;
	const snapshot = buildEditorSemanticSnapshot(bridge, resource, editorDocumentState.buffer);
	const frontend = createEditorSemanticFrontend(bridge, snapshot);
	const symbols = frontend.findSymbolsByPosition(path, row + 1, column + 1);
	const expression = extractHoverExpression(row, column, path)?.expression;
	if (!symbols || !expression) {
		return { kind: 'missing_definition' };
	}
	const resources = bridge.sources.luaResources;
	let rootReadOnly = false;
	for (let index = 0; index < resources.length; index += 1) {
		const resource = resources[index];
		if (resource.domain === editorDocumentState.resource.domain && resource.path === path) {
			rootReadOnly = !!resource.source.generated;
			break;
		}
	}
	const allowedPaths = new Set<string>();
	for (let index = 0; index < resources.length; index += 1) {
		const resource = resources[index];
		if ((resource.domain === editorDocumentState.resource.domain
			|| (editorDocumentState.resource.domain !== SYSTEM_RESOURCE_DOMAIN
				&& resource.domain === SYSTEM_RESOURCE_DOMAIN))
			&& !!resource.source.generated === rootReadOnly) {
			allowedPaths.add(resource.path);
		}
	}
	allowedPaths.add(path);
	const view = buildIncomingCallHierarchyView(bridge, {
		snapshot,
		rootSymbolIds: symbols.targets.map(target => target.id),
		rootExpression: expression,
		origin: definitionLocationFromSourceRange(symbols.origin),
		allowedPaths,
	});
	if (!view) {
		return { kind: 'no_calls', expression };
	}
	return { kind: 'success', view };
}
