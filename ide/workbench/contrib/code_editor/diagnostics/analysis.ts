import type { EditorDiagnostic } from '../../../../common/models';
import {
	computeLuaDiagnostics,
	getApiCompletionData,
	listGlobalLuaSymbols,
	listLuaBuiltinFunctions,
	listLuaSymbols,
} from '../../../../editor/contrib/intellisense/engine';
import { getCachedLuaParse } from '../../../../../machine/ts/lua/analysis/cache';
import { editorRuntimeState } from '../../../../editor/common/runtime_state';
import { diagnosticsDebounceMs, editorDiagnosticsState } from '../../../../editor/contrib/diagnostics/state';
import { cacheRuntimeSemanticParseState } from '../../../../editor/contrib/intellisense/semantic/workspace/runtime';
import { getCodeTabContexts } from '../../../ui/code_tab/contexts';
import type { ResourceDomain } from '../../../../common/resource';
import type { RuntimeLuaTooling } from '../../../../runtime/lua_tooling';

export type DiagnosticContextInput = {
	id: string;
	domain: ResourceDomain;
	path: string;
	source: string;
	lines?: readonly string[];
	version: number;
};

export function computeAggregatedEditorDiagnostics(
	bridge: RuntimeLuaTooling,
	contexts: ReadonlyArray<DiagnosticContextInput>,
): EditorDiagnostic[] {
	if (contexts.length === 0) return [];
	const builtinDescriptors = listLuaBuiltinFunctions();
	const apiData = getApiCompletionData();

	const aggregated: EditorDiagnostic[] = [];
	for (let i = 0; i < contexts.length; i += 1) {
		const ctx = contexts[i];
		const path = ctx.path;
		const source = ctx.source;
		const globalSymbols = listGlobalLuaSymbols(bridge, ctx.domain);
		const parseEntry = getCachedLuaParse({
			path,
			source,
			lines: ctx.lines,
			version: ctx.version,
		});
		const baseLines = parseEntry.lines;
		const parsed = parseEntry.parsed;
		cacheRuntimeSemanticParseState(ctx.domain, path, source, baseLines, parsed);
		const localSymbols = listLuaSymbols(bridge, ctx.domain, path);
		const luaDiagnostics = computeLuaDiagnostics(bridge, {
			source,
			domain: ctx.domain,
			path,
			localSymbols,
			globalSymbols,
			builtinDescriptors,
			apiSignatures: apiData.signatures,
			version: ctx.version,
			lines: baseLines,
			parsed,
		});
		for (let j = 0; j < luaDiagnostics.length; j += 1) {
			const d = luaDiagnostics[j];
			const startColumn = d.startColumn > 0 ? d.startColumn : 0;
			const adjustedEnd = d.endColumn > startColumn ? d.endColumn : startColumn + 1;
			aggregated.push({
				row: d.row,
				startColumn,
				endColumn: adjustedEnd,
				message: d.message,
				severity: d.severity,
				contextId: ctx.id,
				sourceLabel: path,
				path,
			});
		}
	}
	return aggregated;
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
