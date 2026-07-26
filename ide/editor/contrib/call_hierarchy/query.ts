import { listResources } from '../../../workspace/workspace';
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
	const path = context.descriptor.path;
	const snapshot = buildEditorSemanticSnapshot(bridge, context.descriptor, editorDocumentState.buffer, editorDocumentState.textVersion);
	const frontend = createEditorSemanticFrontend(bridge, snapshot);
	const resolution = frontend.findReferencesByPosition(path, row + 1, column + 1);
	const expression = extractHoverExpression(row, column, path)?.expression;
	if (!resolution || !expression) {
		return { kind: 'missing_definition' };
	}
	const descriptors = listResources(bridge.sources);
	let rootReadOnly = false;
	for (let index = 0; index < descriptors.length; index += 1) {
		const descriptor = descriptors[index];
		if (descriptor.domain === context.descriptor.domain && descriptor.path === path) {
			rootReadOnly = descriptor.readOnly === true;
			break;
		}
	}
	const allowedPaths = new Set<string>();
	for (let index = 0; index < descriptors.length; index += 1) {
		const descriptor = descriptors[index];
		if ((descriptor.domain === context.descriptor.domain
			|| (context.descriptor.domain !== SYSTEM_RESOURCE_DOMAIN
				&& descriptor.domain === SYSTEM_RESOURCE_DOMAIN))
			&& (descriptor.readOnly === true) === rootReadOnly) {
			allowedPaths.add(descriptor.path);
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
