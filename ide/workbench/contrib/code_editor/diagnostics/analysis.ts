import type { EditorDiagnostic } from '../../../../common/models';
import { createEditorSemanticFrontend } from '../../../../editor/contrib/intellisense/frontend';
import { getOrCreateSemanticProject } from '../../../../editor/contrib/intellisense/semantic/workspace/state';
import type { LuaStaticDiagnostic } from '../../../../../toolchain/ts/lua/semantic/diagnostics';
import { editorRuntimeState } from '../../../../editor/common/runtime_state';
import { diagnosticsDebounceMs, editorDiagnosticsState } from '../../../../editor/contrib/diagnostics/state';
import { getCodeTabContexts } from '../../../ui/code_tab/contexts';
import type { ResourceDomain } from '../../../../common/resource';
import type { RuntimeLuaTooling } from '../../../../runtime/lua_tooling';
import type { CodeEditorInputId } from '../../../../common/editor_context';

export type DiagnosticContextInput = {
	id: CodeEditorInputId;
	domain: ResourceDomain;
	path: string;
	source: string;
	version: number;
};

export function computeAggregatedEditorDiagnostics(
	bridge: RuntimeLuaTooling,
	contexts: ReadonlyArray<DiagnosticContextInput>,
): EditorDiagnostic[] {
	if (contexts.length === 0) return [];
	const batches = new Map<ResourceDomain, DiagnosticContextInput[]>();
	for (let index = 0; index < contexts.length; index += 1) {
		const context = contexts[index];
		let batch = batches.get(context.domain);
		if (!batch) {
			batch = [];
			batches.set(context.domain, batch);
		}
		batch.push(context);
	}
	const aggregated: EditorDiagnostic[] = [];
	for (const [domain, batch] of batches) {
		const project = getOrCreateSemanticProject(domain);
		project.synchronizeRuntimeSources(bridge.sources);
		project.updateDocuments(batch);
		const snapshot = project.getSnapshot();
		const frontend = createEditorSemanticFrontend(bridge, snapshot);
		for (let contextIndex = 0; contextIndex < batch.length; contextIndex += 1) {
			const context = batch[contextIndex];
			const syntaxError = snapshot.getFileData(context.path)!.syntaxError;
			if (syntaxError) {
				appendEditorDiagnostic(aggregated, context, {
					row: syntaxError.line - 1,
					startColumn: syntaxError.column - 1,
					endColumn: syntaxError.column,
					message: syntaxError.message,
					severity: 'error',
				});
				continue;
			}
			const diagnostics = frontend.getFile(context.path).diagnostics;
			for (let diagnosticIndex = 0; diagnosticIndex < diagnostics.length; diagnosticIndex += 1) {
				appendEditorDiagnostic(aggregated, context, diagnostics[diagnosticIndex]);
			}
		}
	}
	return aggregated;
}

function appendEditorDiagnostic(
	output: EditorDiagnostic[],
	context: DiagnosticContextInput,
	diagnostic: LuaStaticDiagnostic,
): void {
	output.push({
		row: diagnostic.row,
		startColumn: diagnostic.startColumn,
		endColumn: diagnostic.endColumn,
		message: diagnostic.message,
		severity: diagnostic.severity,
		contextId: context.id,
		path: context.path,
	});
}

export function markAllDiagnosticsDirty(): void {
	const contextIds: CodeEditorInputId[] = [];
	for (const context of getCodeTabContexts()) {
		contextIds.push(context.id);
	}
	if (contextIds.length === 0) {
		return;
	}
	editorDiagnosticsState.diagnosticsDirty = true;
	for (let index = 0; index < contextIds.length; index += 1) {
		const contextId = contextIds[index];
		editorDiagnosticsState.dirtyDiagnosticContexts.add(contextId);
	}
	editorDiagnosticsState.diagnosticsDueAtMs = editorRuntimeState.currentTimeMs + diagnosticsDebounceMs;
}
