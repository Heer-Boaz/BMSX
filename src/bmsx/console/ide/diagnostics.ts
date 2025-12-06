import type { ConsoleLuaBuiltinDescriptor, ConsoleLuaSymbolEntry, ConsoleResourceDescriptor } from '../types';
import type { EditorDiagnostic } from './types';
import { BmsxConsoleRuntime } from '../runtime';
import { computeLuaDiagnostics, getApiCompletionData, collectLuaModuleAliases, type LuaDiagnostic } from './intellisense';
import { buildLuaFileSemanticData } from './semantic_model';
import { ide_state, diagnosticsDebounceMs } from './ide_state';

export type DiagnosticContextInput = {
	id: string;
	title: string;
	descriptor: ConsoleResourceDescriptor;
	chunkName: string;
	source: string;
};

export type DiagnosticProviders = {
	listLocalSymbols(chunkName: string): ConsoleLuaSymbolEntry[];
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
	const globalSymbolsByKey = groupGlobalSymbolsByKey(globalSymbols);

	const aggregated: EditorDiagnostic[] = [];
	for (let i = 0; i < contexts.length; i += 1) {
		const ctx = contexts[i];
		const chunkName = resolveChunkName(ctx);
		const source = ctx.source ?? '';
		if (source.length === 0) continue;
		let localSymbols: ConsoleLuaSymbolEntry[] = [];
		try { localSymbols = providers.listLocalSymbols(chunkName); } catch { localSymbols = []; }
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
				chunkName,
			});
		}
		const requireDiagnostics = computeMissingRequireDiagnostics(ctx, chunkName, source, globalSymbolsByKey);
		for (let index = 0; index < requireDiagnostics.length; index += 1) {
			aggregated.push(requireDiagnostics[index]);
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
	return ctx.title ;
}

function groupGlobalSymbolsByKey(symbols: readonly ConsoleLuaSymbolEntry[]): Map<string, ConsoleLuaSymbolEntry[]> {
	const map = new Map<string, ConsoleLuaSymbolEntry[]>();
	for (let index = 0; index < symbols.length; index += 1) {
		const entry = symbols[index];
		const key = entry.path && entry.path.length > 0 ? entry.path : entry.name;
		let bucket = map.get(key);
		if (!bucket) {
			bucket = [];
			map.set(key, bucket);
		}
		bucket.push(entry);
	}
	return map;
}

function computeMissingRequireDiagnostics(
	context: DiagnosticContextInput,
	chunkName: string,
	source: string,
	globalSymbolsByKey: Map<string, ConsoleLuaSymbolEntry[]>,
): EditorDiagnostic[] {
	const runtime = BmsxConsoleRuntime.instance;
	runtime.ensureLuaModuleIndex();
	const semantic = buildLuaFileSemanticData(source, chunkName);
	const requiredChunks = new Set<string>();
	requiredChunks.add(chunkName);
	const moduleAliases = collectLuaModuleAliases({ source, chunkName });
	for (const moduleName of moduleAliases.values()) {
		const record = runtime.luaModuleAliases.get(moduleName);
		if (record) {
			requiredChunks.add(record.chunkName);
		}
	}
	const localSymbols = new Set<string>();
	for (let i = 0; i < semantic.decls.length; i += 1) {
		localSymbols.add(semantic.decls[i].symbolKey);
	}
	const seen = new Set<string>();
	const diagnostics: EditorDiagnostic[] = [];
	for (let i = 0; i < semantic.refs.length; i += 1) {
		const ref = semantic.refs[i];
		const key = ref.symbolKey;
		if (!key || localSymbols.has(key)) {
			continue;
		}
		const candidates = globalSymbolsByKey.get(key);
		if (!candidates || candidates.length === 0) {
			continue;
		}
		let target: ConsoleLuaSymbolEntry = null;
		for (let j = 0; j < candidates.length; j += 1) {
			const candidate = candidates[j];
			if (candidate.location.chunkName === chunkName) {
				continue;
			}
			if (requiredChunks.has(candidate.location.chunkName)) {
				target = null;
				break;
			}
			if (!target) {
				target = candidate;
			}
		}
		if (!target) {
			continue;
		}
		const dedupeKey = `${ref.range.start.line}:${ref.range.start.column}:${key}`;
		if (seen.has(dedupeKey)) {
			continue;
		}
		seen.add(dedupeKey);
		const row = ref.range.start.line > 0 ? ref.range.start.line - 1 : 0;
		const startColumn = ref.range.start.column > 0 ? ref.range.start.column - 1 : 0;
		const endColumn = ref.range.end.column > startColumn ? ref.range.end.column - 1 : startColumn + key.length;
		const sourceLabel = target.location.path ?? target.location.chunkName ?? '<module>';
		diagnostics.push({
			row,
			startColumn,
			endColumn,
			message: `'${key}' comes from '${sourceLabel}', but this chunk never requires that module.`,
			severity: 'warning',
			contextId: context.id,
			sourceLabel: chunkName,
			chunkName,
		});
	}
	return diagnostics;
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
