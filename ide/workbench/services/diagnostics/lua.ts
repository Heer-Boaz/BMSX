import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { EditorDiagnostic } from '../../../common/models';
import type { ResourceDomain } from '../../../common/resource';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { createEditorSemanticFrontend } from '../../../editor/contrib/intellisense/frontend';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';

/** One immutable semantic snapshot per domain; model deltas remain owned by the project. */
export function computeResourceDiagnostics(owner: EditorTextModelService, bridge: RuntimeLuaTooling, models: readonly EditorTextModel[]): EditorDiagnostic[] {
	const batches = new Map<ResourceDomain, EditorTextModel[]>();
	for (const model of models) {
		let batch = batches.get(model.identity.domain);
		if (batch === undefined) batches.set(model.identity.domain, batch = []);
		batch.push(model);
	}
	const result: EditorDiagnostic[] = [];
	for (const [domain, batch] of batches) {
		const project = getOrCreateSemanticProject(owner, domain);
		project.synchronizeRuntimeSources(bridge.sources);
		for (const model of batch) project.analyzeDocument(model.identity.path, model.buffer);
		const snapshot = project.getSnapshot();
		const frontend = createEditorSemanticFrontend(bridge, snapshot);
		for (const model of batch) {
			const path = model.identity.path;
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
