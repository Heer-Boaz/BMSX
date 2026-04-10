import type { LuaBuiltinDescriptor, LuaSymbolEntry } from '../../../emulator/types';
import type { EditorDiagnostic } from '../../core/types';
import { computeLuaDiagnostics, getApiCompletionData } from '../intellisense/intellisense';
import { getCachedLuaParse } from '../../language/lua/lua_analysis_cache';
import { ide_state, diagnosticsDebounceMs } from '../../core/ide_state';
import { cacheSemanticParseState } from '../intellisense/semantic_workspace_sync';

export type DiagnosticContextInput = {
	id: string;
	path: string;
	source: string;
	lines?: readonly string[];
	version: number;
};

export type DiagnosticProviders = {
	listLocalSymbols(path: string): LuaSymbolEntry[];
	listGlobalSymbols(): LuaSymbolEntry[];
	listBuiltins(): LuaBuiltinDescriptor[];
};

export function computeAggregatedEditorDiagnostics(
	contexts: ReadonlyArray<DiagnosticContextInput>,
	providers: DiagnosticProviders,
): EditorDiagnostic[] {
	if (contexts.length === 0) return [];
	const globalSymbols = providers.listGlobalSymbols();
	const builtinDescriptors = providers.listBuiltins();
	const apiData = getApiCompletionData();

	const aggregated: EditorDiagnostic[] = [];
	for (let i = 0; i < contexts.length; i += 1) {
		const ctx = contexts[i];
		const path = ctx.path;
		const source = ctx.source;
		const parseEntry = getCachedLuaParse({
			path,
			source,
			lines: ctx.lines,
			version: ctx.version,
			canonicalization: ide_state.caseInsensitive ? ide_state.canonicalization : 'none',
		});
		const baseLines = parseEntry.lines;
		const parsed = parseEntry.parsed;
		cacheSemanticParseState(path, source, baseLines, parsed);
		const localSymbols = providers.listLocalSymbols(path);
		const luaDiagnostics = computeLuaDiagnostics({
			source,
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

export function markDiagnosticsDirty(contextId: string): void {
	ide_state.diagnosticsDirty = true;
	ide_state.dirtyDiagnosticContexts.add(contextId);
	ide_state.diagnosticsDueAtMs = ide_state.clockNow() + diagnosticsDebounceMs;
}

export function markAllDiagnosticsDirty(): void {
	const contexts = ide_state.codeTabContexts;
	if (contexts.size === 0) {
		return;
	}
	ide_state.diagnosticsDirty = true;
	for (const contextId of contexts.keys()) {
		ide_state.dirtyDiagnosticContexts.add(contextId);
	}
	ide_state.diagnosticsDueAtMs = ide_state.clockNow() + diagnosticsDebounceMs;
}
