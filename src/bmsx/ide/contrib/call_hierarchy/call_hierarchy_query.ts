import { listResources } from '../../../emulator/workspace';
import { ide_state } from '../../core/ide_state';
import { getActiveCodeTabContext } from '../../ui/editor_tabs';
import { buildEditorSemanticSnapshot, createEditorSemanticFrontend } from '../intellisense/editor_semantic_frontend';
import { extractHoverExpression } from '../intellisense/intellisense';
import { buildIncomingCallHierarchyView, type CallHierarchyView } from './call_hierarchy_view';

export type CallHierarchyQueryResult =
	| { kind: 'success'; view: CallHierarchyView; }
	| { kind: 'missing_definition'; }
	| { kind: 'no_calls'; expression: string; };

export function resolveCallHierarchyViewAt(row: number, column: number): CallHierarchyQueryResult {
	const context = getActiveCodeTabContext();
	if (!context) {
		return { kind: 'missing_definition' };
	}
	const path = context.descriptor.path;
	const snapshot = buildEditorSemanticSnapshot(path, ide_state.buffer, ide_state.textVersion);
	const frontend = createEditorSemanticFrontend(snapshot);
	const resolution = frontend.findReferencesByPosition(path, row + 1, column + 1);
	const expression = extractHoverExpression(row, column)?.expression;
	if (!resolution || !expression) {
		return { kind: 'missing_definition' };
	}
	const descriptors = listResources();
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
