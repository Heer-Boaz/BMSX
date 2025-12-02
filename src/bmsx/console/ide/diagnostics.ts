import type { ConsoleLuaBuiltinDescriptor, ConsoleLuaSymbolEntry, ConsoleResourceDescriptor } from '../types';
import type { EditorDiagnostic } from './types';
import { computeLuaDiagnostics, getApiCompletionData, type LuaDiagnostic } from './intellisense';
import { ide_state, diagnosticsDebounceMs } from './ide_state';

export type DiagnosticContextInput = {
	id: string;
	title: string;
	descriptor: ConsoleResourceDescriptor;
	asset_id: string;
	chunkName: string;
	source: string;
};

export type DiagnosticProviders = {
	listLocalSymbols(asset_id: string, chunkName: string): ConsoleLuaSymbolEntry[];
	listGlobalSymbols(): ConsoleLuaSymbolEntry[];
	listBuiltins(): ConsoleLuaBuiltinDescriptor[];
};

export function computeAggregatedEditorDiagnostics(
	contexts: ReadonlyArray<DiagnosticContextInput>,
	providers: DiagnosticProviders,
): EditorDiagnostic[] {
	if (!Array.isArray(contexts) || contexts.length === 0) return [];
	let globalSymbols: ConsoleLuaSymbolEntry[];
	let builtinDescriptors: ConsoleLuaBuiltinDescriptor[];
	try { globalSymbols = providers.listGlobalSymbols(); } catch { globalSymbols = []; }
	try { builtinDescriptors = providers.listBuiltins(); } catch { builtinDescriptors = []; }
	const apiData = getApiCompletionData();

	const aggregated: EditorDiagnostic[] = [];
	for (let i = 0; i < contexts.length; i += 1) {
		const ctx = contexts[i];
		const chunkName = resolveChunkName(ctx);
		const source = ctx.source ?? '';
		if (source.length === 0) continue;
		let localSymbols: ConsoleLuaSymbolEntry[] = [];
		try { localSymbols = providers.listLocalSymbols(ctx.asset_id, chunkName); } catch { localSymbols = []; }
		let luaDiagnostics: LuaDiagnostic[];
		try {
			luaDiagnostics = computeLuaDiagnostics({
				source,
				chunkName: chunkName ?? ctx.title ?? 'lua',
				localSymbols,
				globalSymbols,
				builtinDescriptors,
				apiSignatures: apiData.signatures,
			});
		} catch {
			luaDiagnostics = [];
		}
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
				asset_id: ctx.asset_id,
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
		if (descriptor.asset_id && descriptor.asset_id.length > 0) return descriptor.asset_id;
	}
	return ctx.title ;
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

