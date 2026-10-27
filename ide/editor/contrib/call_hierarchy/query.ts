import { getOrCreateSemanticProject } from '../intellisense/semantic/workspace/state';
import { editorTextModelService } from '../../model/model_service';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { buildEditorSemanticSnapshot, createEditorSemanticFrontend } from '../intellisense/frontend';
import { CallHierarchyModel } from './model';
import type { CodeEditorControl } from '../../ui/code_editor_control';
import { resourceIdentityKey } from '../../../common/resource';

export type CallHierarchyQueryResult =
	| { kind: 'success'; model: CallHierarchyModel; }
	| { kind: 'missing_definition'; };

export function resolveCallHierarchyAt(code: CodeEditorControl, catalog: WorkspaceSourceCatalog, row: number, column: number): CallHierarchyQueryResult {
	const resource = code.model.resource;
	const path = resourceIdentityKey(resource);
	const snapshot = buildEditorSemanticSnapshot(catalog, resource, code.model.buffer);
	const frontend = createEditorSemanticFrontend(snapshot, catalog.getContext(resource.contextId).programDomain);
	const symbols = frontend.findSymbolsByPosition(path, row + 1, column + 1);
	if (!symbols) {
		return { kind: 'missing_definition' };
	}
	const rootReadOnly = !!resource.source.generated;
	const allowedContexts = new Set(catalog.getSourceContexts(resource.contextId).map(context => context.id));
	const allowedPaths = new Set<string>();
	for (const candidate of catalog.luaResources) {
		if (allowedContexts.has(candidate.contextId) && !!candidate.source.generated === rootReadOnly) {
			allowedPaths.add(resourceIdentityKey(candidate));
		}
	}
	allowedPaths.add(path);
	const rootSymbolIds = new Array(symbols.targets.length);
	for (let index = 0; index < symbols.targets.length; index += 1) {
		rootSymbolIds[index] = symbols.targets[index].id;
	}
	const model = new CallHierarchyModel(frontend, rootSymbolIds, symbols.label, getOrCreateSemanticProject(editorTextModelService, resource.contextId), allowedPaths);
	return { kind: 'success', model };
}
