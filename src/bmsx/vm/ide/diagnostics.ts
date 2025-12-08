import type { VMLuaBuiltinDescriptor, VMLuaSymbolEntry, VMResourceDescriptor } from '../types';
import type { EditorDiagnostic } from './types';
import { BmsxVMRuntime } from '../vm_runtime';
import { computeLuaDiagnostics, getApiCompletionData } from './intellisense';
import { parseLuaChunkWithRecovery } from './lua_parse';
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
		const lines = ctx.lines;
		const cacheEntry = chunkName ? BmsxVMRuntime.instance.chunkSemanticCache.get(chunkName) : null;
		const cachedMatch = cacheEntry && cacheEntry.source === source ? cacheEntry : null;
		if (source.length === 0) continue;
		const baseLines = lines ?? cachedMatch?.lines ?? source.split('\n');
		const parsed = cachedMatch?.parsed ?? (chunkName ? parseLuaChunkWithRecovery(source, chunkName, baseLines) : null);
		if (chunkName) {
			const model = cachedMatch ? cachedMatch.model : null;
			const definitions = cachedMatch ? cachedMatch.definitions : [];
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
