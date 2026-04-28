import { listResources } from '../../../workspace/workspace';
import { getActiveCodeTabContext } from '../../../workbench/ui/code_tab/contexts';
import { buildEditorSemanticSnapshot, createEditorSemanticFrontend } from '../intellisense/frontend';
import { extractHoverExpression } from '../intellisense/engine';
import { buildIncomingCallHierarchyView, type CallHierarchyView } from './view';
import { editorDocumentState } from '../../editing/document_state';
import type { Runtime } from '../../../../machine/runtime/runtime';

export type CallHierarchyQueryResult =
	| { kind: 'success'; view: CallHierarchyView; }
	| { kind: 'missing_definition'; }
	| { kind: 'no_calls'; expression: string; };

export function resolveCallHierarchyViewAt(runtime: Runtime, row: number, column: number): CallHierarchyQueryResult {
	const context = getActiveCodeTabContext();
	if (!context) {
		return { kind: 'missing_definition' };
	}
	const path = context.descriptor.path;
	const snapshot = buildEditorSemanticSnapshot(runtime, path, editorDocumentState.buffer, editorDocumentState.textVersion);
	const frontend = createEditorSemanticFrontend(runtime, snapshot);
	const resolution = frontend.findReferencesByPosition(path, row + 1, column + 1);
	const expression = extractHoverExpression(row, column)?.expression;
	if (!resolution || !expression) {
		return { kind: 'missing_definition' };
	}
	const descriptors = listResources(runtime);
	let rootReadOnly = false;
	for (let index = 0; index < descriptors.length; index += 1) {
		const descriptor = descriptors[index];
		if (descriptor.path === path) {
			rootReadOnly = descriptor.readOnly === true;
			break;
		}
	}
	const allowedPaths = new Set<string>();
	for (let index = 0; index < descriptors.length; index += 1) {
		const descriptor = descriptors[index];
		if ((descriptor.readOnly === true) === rootReadOnly) {
			allowedPaths.add(descriptor.path);
		}
	}
	allowedPaths.add(path);
	const view = buildIncomingCallHierarchyView({
		runtime,
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
