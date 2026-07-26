import { getActiveCodeTabContext } from '../../../workbench/ui/code_tab/contexts';
import { buildEditorSemanticSnapshot, createEditorSemanticFrontend } from '../intellisense/frontend';
import { extractHoverExpression } from '../intellisense/engine';
import { buildIncomingCallHierarchyView, type CallHierarchyView } from './view';
import { editorDocumentState } from '../../editing/document_state';
import { SYSTEM_RESOURCE_DOMAIN } from '../../../common/resource';
import type { RuntimeNativeBridge } from '../../../runtime/native_bridge';

export type CallHierarchyQueryResult =
	| { kind: 'success'; view: CallHierarchyView; }
	| { kind: 'missing_definition'; }
	| { kind: 'no_calls'; expression: string; };

export function resolveCallHierarchyViewAt(bridge: RuntimeNativeBridge, row: number, column: number): CallHierarchyQueryResult {
	const context = getActiveCodeTabContext();
	const path = context.resource.path;
	const snapshot = buildEditorSemanticSnapshot(bridge, context.resource, editorDocumentState.buffer, editorDocumentState.textVersion);
	const frontend = createEditorSemanticFrontend(bridge, snapshot);
	const resolution = frontend.findReferencesByPosition(path, row + 1, column + 1);
	const expression = extractHoverExpression(row, column, path)?.expression;
	if (!resolution || !expression) {
		return { kind: 'missing_definition' };
	}
	const resources = bridge.sources.luaResources;
	let rootReadOnly = false;
	for (let index = 0; index < resources.length; index += 1) {
		const resource = resources[index];
		if (resource.domain === context.resource.domain && resource.path === path) {
			rootReadOnly = !!resource.source.generated;
			break;
		}
	}
	const allowedPaths = new Set<string>();
	for (let index = 0; index < resources.length; index += 1) {
		const resource = resources[index];
		if ((resource.domain === context.resource.domain
			|| (context.resource.domain !== SYSTEM_RESOURCE_DOMAIN
				&& resource.domain === SYSTEM_RESOURCE_DOMAIN))
			&& !!resource.source.generated === rootReadOnly) {
			allowedPaths.add(resource.path);
		}
	}
	allowedPaths.add(path);
	const view = buildIncomingCallHierarchyView(bridge, {
		snapshot,
		rootSymbolId: resolution.id,
		rootExpression: expression,
		allowedPaths,
	});
	if (!view) {
		return { kind: 'no_calls', expression };
	}
	return { kind: 'success', view };
}
