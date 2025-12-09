import type { VMLuaBuiltinDescriptor, VMLuaSymbolEntry, VMResourceDescriptor } from '../types';
import type { EditorDiagnostic } from './types';
import { BmsxVMRuntime } from '../vm_runtime';
import { computeLuaDiagnostics, getApiCompletionData } from './intellisense';
import { getCachedLuaParse } from './lua_analysis_cache';
import { ide_state, diagnosticsDebounceMs } from './ide_state';

export type DiagnosticContextInput = {
	id: string;
	title: string;
	descriptor: VMResourceDescriptor;
	chunkName: string;
	source: string;
	lines?: readonly string[];
	version: number;
};

export type DiagnosticProviders = {
	listLocalSymbols(chunkName: string): VMLuaSymbolEntry[];
	listGlobalSymbols(): VMLuaSymbolEntry[];
	listBuiltins(): VMLuaBuiltinDescriptor[];
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
		const chunkName = resolveChunkName(ctx);
		const source = ctx.source ?? '';
		if (source.length === 0) continue;
		const parseEntry = getCachedLuaParse({
			chunkName,
			source,
			lines: ctx.lines,
			version: ctx.version,
		});
		const baseLines = parseEntry.lines;
		const parsed = parseEntry.parsed;
		if (chunkName) {
			const cacheEntry = BmsxVMRuntime.instance.chunkSemanticCache.get(chunkName);
			const model = cacheEntry ? cacheEntry.model : null;
			const definitions = cacheEntry ? cacheEntry.definitions : [];
			BmsxVMRuntime.instance.chunkSemanticCache.set(chunkName, {
				source,
				model,
				definitions,
				parsed,
				lines: baseLines,
			});
		}
		const localSymbols = providers.listLocalSymbols(chunkName);
		const luaDiagnostics = computeLuaDiagnostics({
			source,
			chunkName,
			localSymbols,
			globalSymbols,
			builtinDescriptors,
			apiSignatures: apiData.signatures,
			version: ctx.version,
			lines: baseLines,
			parsed: parsed ?? undefined,
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
				sourceLabel: chunkName,
				chunkName,
			});
		}
	}
	return aggregated;
}

function resolveChunkName(ctx: DiagnosticContextInput): string {
	const candidate = ctx.chunkName && ctx.chunkName.length > 0 ? ctx.chunkName : null;
	if (candidate) return candidate;
	const descriptor = ctx.descriptor;
	if (descriptor) {
		if (descriptor.path && descriptor.path.length > 0) return descriptor.path;
	}
	return ctx.title;
}

export function markDiagnosticsDirty(contextId?: string): void {
	const targetId = contextId ?? ide_state.activeCodeTabContextId;
	if (!targetId) {
		return;
	}
	ide_state.diagnosticsDirty = true;
	ide_state.dirtyDiagnosticContexts.add(targetId);
	ide_state.diagnosticsDueAtMs = ide_state.clockNow() + diagnosticsDebounceMs;
}
