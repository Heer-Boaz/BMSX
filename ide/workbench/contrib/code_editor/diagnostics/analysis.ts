import type { EditorDiagnostic } from '../../../../common/models';
import { createEditorSemanticFrontend } from '../../../../editor/contrib/intellisense/frontend';
import { getOrCreateSemanticProject } from '../../../../editor/contrib/intellisense/semantic/workspace/state';
import type { SemanticDocumentInput } from '../../../../editor/contrib/intellisense/semantic/workspace/project';
import { getCachedLuaParse } from '../../../../../toolchain/ts/lua/analysis/cache';
import type { LuaSyntaxError } from '../../../../../toolchain/ts/lua/errors';
import type { LuaStaticDiagnostic } from '../../../../../toolchain/ts/lua/semantic/diagnostics';
import { editorRuntimeState } from '../../../../editor/common/runtime_state';
import { diagnosticsDebounceMs, editorDiagnosticsState } from '../../../../editor/contrib/diagnostics/state';
import { getCodeTabContexts } from '../../../ui/code_tab/contexts';
import type { ResourceDomain } from '../../../../common/resource';
import type { RuntimeLuaTooling } from '../../../../runtime/lua_tooling';

export type DiagnosticContextInput = {
	id: string;
	domain: ResourceDomain;
	path: string;
	source: string;
	version: number;
};

type PreparedDiagnosticContext = {
	context: DiagnosticContextInput;
	syntaxError: LuaSyntaxError | null;
};

type DomainDiagnosticBatch = {
	inputs: SemanticDocumentInput[];
	contexts: PreparedDiagnosticContext[];
};

export function computeAggregatedEditorDiagnostics(
	bridge: RuntimeLuaTooling,
	contexts: ReadonlyArray<DiagnosticContextInput>,
): EditorDiagnostic[] {
	if (contexts.length === 0) return [];
	const batches = new Map<ResourceDomain, DomainDiagnosticBatch>();
	for (let index = 0; index < contexts.length; index += 1) {
		const context = contexts[index];
		const parseEntry = getCachedLuaParse({
			path: context.path,
			source: context.source,
		});
		let batch = batches.get(context.domain);
		if (!batch) {
			batch = { inputs: [], contexts: [] };
			batches.set(context.domain, batch);
		}
		batch.inputs.push({
			path: context.path,
			source: parseEntry.source,
			parsed: parseEntry.parsed,
		});
		batch.contexts.push({
			context,
			syntaxError: parseEntry.syntaxError,
		});
	}
	const aggregated: EditorDiagnostic[] = [];
	for (const [domain, batch] of batches) {
		const project = getOrCreateSemanticProject(domain);
		project.synchronizeRuntimeSources(bridge.sources);
		project.updateDocuments(batch.inputs);
		const frontend = createEditorSemanticFrontend(bridge, project.getSnapshot());
		for (let contextIndex = 0; contextIndex < batch.contexts.length; contextIndex += 1) {
			const prepared = batch.contexts[contextIndex];
			const context = prepared.context;
			if (prepared.syntaxError) {
				appendEditorDiagnostic(aggregated, context, {
					row: prepared.syntaxError.line - 1,
					startColumn: prepared.syntaxError.column - 1,
					endColumn: prepared.syntaxError.column,
					message: prepared.syntaxError.message,
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
		sourceLabel: context.path,
		path: context.path,
	});
}

export function markAllDiagnosticsDirty(): void {
	const contextIds: string[] = [];
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
