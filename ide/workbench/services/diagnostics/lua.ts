import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { EditorDiagnostic } from '../../../common/models';
import { resourceIdentityKey } from '../../../common/resource';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { createEditorSemanticFrontend } from '../../../editor/contrib/intellisense/frontend';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';

/** One immutable semantic snapshot per contextId; model deltas remain owned by the project. */
export function computeResourceDiagnostics(owner: EditorTextModelService, catalog: WorkspaceSourceCatalog, models: readonly EditorTextModel[]): EditorDiagnostic[] {
	const batches = new Map<string, EditorTextModel[]>();
	for (const model of models) {
		let batch = batches.get(model.identity.contextId);
		if (batch === undefined) batches.set(model.identity.contextId, batch = []);
		batch.push(model);
	}
	const result: EditorDiagnostic[] = [];
	for (const [contextId, batch] of batches) {
		const project = getOrCreateSemanticProject(owner, contextId);
		project.synchronizeSources(catalog);
		for (const model of batch) project.analyzeDocument(model.identity, model.buffer);
		const snapshot = project.getSnapshot();
		const frontend = createEditorSemanticFrontend(snapshot, catalog.getContext(contextId).programDomain);
		for (const model of batch) {
			const path = resourceIdentityKey(model.identity);
			const syntaxError = snapshot.getFileData(path)!.syntaxError;
			if (syntaxError !== null) {
				result.push({ model, version: model.version, row: syntaxError.line - 1,
					startColumn: syntaxError.column - 1, endColumn: syntaxError.column,
					message: syntaxError.message, severity: 'error' });
			} else for (const diagnostic of frontend.getFile(path).diagnostics) {
				result.push({ ...diagnostic, model, version: model.version });
			}
		}
	}
	return result;
}
