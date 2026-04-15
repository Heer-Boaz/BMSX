import { clamp } from '../../../../utils/clamp';
import type { TimerHandle } from '../../../../platform/platform';
import { computeAggregatedEditorDiagnostics, markDiagnosticsDirty, type DiagnosticContextInput, type DiagnosticProviders } from './diagnostics';
import { editorRuntimeState } from '../../common/editor_runtime_state';
import type { EditorDiagnostic, CodeTabContext } from '../../../common/types';
import { listLuaSymbols, listGlobalLuaSymbols, listLuaBuiltinFunctions } from '../intellisense/intellisense';
import { getTextSnapshot, splitText } from '../../text/source_text';
import { enqueueBackgroundTask, scheduleIdeOnce } from '../../../common/background_tasks';
import {
	findCodeTabContext,
	getActiveCodeTabContext,
	getActiveCodeTabContextId,
	getCodeTabContextById,
	getCodeTabContexts,
	hasCodeTabContext,
} from '../../../workbench/ui/code_tab_contexts';
import { getOrCreateSemanticWorkspace } from '../intellisense/semantic_workspace_sync';
import type { LuaDefinitionInfo } from '../../../../lua/syntax/lua_ast';
import type { ModuleAliasEntry } from '../intellisense/semantic_model';
import { diagnosticsDebounceMs, editorDiagnosticsState, EMPTY_DIAGNOSTICS } from './diagnostics_state';
import { editorDocumentState } from '../../editing/editor_document_state';
import { editorViewState } from '../../ui/editor_view_state';
import { problemsPanel } from '../../../workbench/contrib/problems/problems_panel';

const diagnosticsMinIntervalMs = 600;
let diagnosticsTimer: TimerHandle | null = null;
let diagnosticsScheduledForMs = 0;
let lastDiagnosticsRunMs = 0;
const DIAGNOSTIC_PROVIDERS: DiagnosticProviders = {
	listLocalSymbols: (path) => {
		return listLuaSymbols(path);
	},
	listGlobalSymbols: () => {
		return listGlobalLuaSymbols();
	},
	listBuiltins: () => {
		return listLuaBuiltinFunctions();
	},
};

function cancelDiagnosticsTimer(): void {
	if (diagnosticsTimer) {
		diagnosticsTimer.cancel();
		diagnosticsTimer = null;
	}
	diagnosticsScheduledForMs = 0;
	editorDiagnosticsState.diagnosticsComputationScheduled = false;
}

export function processDiagnosticsQueue(now: number): void {
	if (!editorDiagnosticsState.diagnosticsDirty) {
		return;
	}
	const activeId = getActiveCodeTabContextId();
	if (activeId && !editorDiagnosticsState.dirtyDiagnosticContexts.has(activeId)) {
		return;
	}
	if (editorDiagnosticsState.dirtyDiagnosticContexts.size === 0) {
		editorDiagnosticsState.diagnosticsDirty = false;
		editorDiagnosticsState.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	if (editorDiagnosticsState.diagnosticsTaskPending) {
		return;
	}
	if (editorDiagnosticsState.diagnosticsDueAtMs === null) {
		editorDiagnosticsState.diagnosticsDueAtMs = now + diagnosticsDebounceMs;
	}
	scheduleDiagnosticsComputation();
}

export function scheduleDiagnosticsComputation(): void {
	const now = editorRuntimeState.clockNow();
	const dueAt = editorDiagnosticsState.diagnosticsDueAtMs ?? now + diagnosticsDebounceMs;
	const spacedDueAt = Math.max(dueAt, lastDiagnosticsRunMs + diagnosticsMinIntervalMs);
	editorDiagnosticsState.diagnosticsDueAtMs = spacedDueAt;
	if (diagnosticsTimer && diagnosticsTimer.isActive() && diagnosticsScheduledForMs >= spacedDueAt) {
		return;
	}
	cancelDiagnosticsTimer();
	const delay = clamp(spacedDueAt - now, 0, diagnosticsMinIntervalMs + diagnosticsDebounceMs);
	diagnosticsScheduledForMs = spacedDueAt;
	editorDiagnosticsState.diagnosticsComputationScheduled = true;
	diagnosticsTimer = scheduleIdeOnce(delay, () => {
		diagnosticsTimer = null;
		diagnosticsScheduledForMs = 0;
		editorDiagnosticsState.diagnosticsComputationScheduled = false;
		executeDiagnosticsComputation();
	});
}

export function executeDiagnosticsComputation(): void {
	if (!editorDiagnosticsState.diagnosticsDirty) {
		editorDiagnosticsState.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	const activeId = getActiveCodeTabContextId();
	if (activeId && !editorDiagnosticsState.dirtyDiagnosticContexts.has(activeId)) {
		editorDiagnosticsState.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	if (editorDiagnosticsState.dirtyDiagnosticContexts.size === 0) {
		editorDiagnosticsState.diagnosticsDirty = false;
		editorDiagnosticsState.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	if (editorDiagnosticsState.diagnosticsTaskPending) {
		scheduleDiagnosticsComputation();
		return;
	}
	const now = editorRuntimeState.clockNow();
	if (editorDiagnosticsState.diagnosticsDueAtMs === null) {
		editorDiagnosticsState.diagnosticsDueAtMs = now + diagnosticsDebounceMs;
		scheduleDiagnosticsComputation();
		return;
	}
	if (now < editorDiagnosticsState.diagnosticsDueAtMs) {
		scheduleDiagnosticsComputation();
		return;
	}
	const batch = collectDiagnosticsBatch();
	if (batch.length === 0) {
		editorDiagnosticsState.diagnosticsDirty = false;
		editorDiagnosticsState.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	enqueueDiagnosticsJob(batch);
}

export function enqueueDiagnosticsJob(contextIds: readonly string[]): void {
	if (contextIds.length === 0) {
		return;
	}
	editorDiagnosticsState.diagnosticsTaskPending = true;
	enqueueBackgroundTask(() => {
		runDiagnosticsForContexts(contextIds);
		editorDiagnosticsState.diagnosticsTaskPending = false;
		lastDiagnosticsRunMs = editorRuntimeState.clockNow();
		if (editorDiagnosticsState.dirtyDiagnosticContexts.size === 0) {
			editorDiagnosticsState.diagnosticsDirty = false;
			editorDiagnosticsState.diagnosticsDueAtMs = null;
			cancelDiagnosticsTimer();
		} else {
			const now = editorRuntimeState.clockNow();
			editorDiagnosticsState.diagnosticsDueAtMs = now + diagnosticsDebounceMs;
			processDiagnosticsQueue(now);
		}
		return false;
	});
}

export function collectDiagnosticsBatch(): string[] {
	const activeId = getActiveCodeTabContextId();
	if (activeId && editorDiagnosticsState.dirtyDiagnosticContexts.has(activeId)) {
		return [activeId];
	}
	return [];
}

export function runDiagnosticsForContexts(contextIds: readonly string[]): void {
	if (contextIds.length === 0) {
		return;
	}
	const activeId = getActiveCodeTabContextId();
	const inputs: DiagnosticContextInput[] = [];
	for (let index = 0; index < contextIds.length; index += 1) {
		const contextId = contextIds[index];
		const context = getCodeTabContextById(contextId);
		if (!context) {
			editorDiagnosticsState.diagnosticsCache.delete(contextId);
			editorDiagnosticsState.dirtyDiagnosticContexts.delete(contextId);
			continue;
		}
		if (context.mode !== 'lua') {
			const source = contextId === activeId ? getTextSnapshot(editorDocumentState.buffer) : getTextSnapshot(context.buffer);
			editorDiagnosticsState.diagnosticsCache.set(context.id, {
				contextId: context.id,
				path: context.descriptor.path,
				diagnostics: [],
				version: contextId === activeId ? editorDocumentState.buffer.version : context.buffer.version,
				source,
			});
			editorDiagnosticsState.dirtyDiagnosticContexts.delete(contextId);
			continue;
		}
		const path = context.descriptor.path;
		const isActive = activeId && contextId === activeId;
		const cached = editorDiagnosticsState.diagnosticsCache.get(contextId);
		const buffer = isActive ? editorDocumentState.buffer : context.buffer;
		const version = buffer.version;
		if (cached && cached.path === path && cached.version === version) {
			editorDiagnosticsState.dirtyDiagnosticContexts.delete(contextId);
			continue;
		}
		const source = getTextSnapshot(buffer);
		const input: DiagnosticContextInput = {
			id: context.id,
			path,
			source,
			lines: splitText(source),
			version,
		};
		inputs.push(input);
	}
	if (inputs.length === 0) {
		updateDiagnosticsAggregates();
		return;
	}
	const diagnostics = computeAggregatedEditorDiagnostics(inputs, DIAGNOSTIC_PROVIDERS);
	const byContext = new Map<string, EditorDiagnostic[]>();
	for (let index = 0; index < diagnostics.length; index += 1) {
		const diag = diagnostics[index];
		const key = diag.contextId ?? '';
		let bucket = byContext.get(key);
		if (!bucket) {
			bucket = [];
			byContext.set(key, bucket);
		}
		bucket.push(diag);
	}
	for (let index = 0; index < inputs.length; index += 1) {
		const input = inputs[index];
		const diagList = byContext.get(input.id) ?? [];
		editorDiagnosticsState.diagnosticsCache.set(input.id, {
			contextId: input.id,
			path: input.path,
			diagnostics: diagList,
			version: input.version,
			source: input.source,
		});
		editorDiagnosticsState.dirtyDiagnosticContexts.delete(input.id);
	}
	updateDiagnosticsAggregates();
}

export function createDiagnosticProviders(): DiagnosticProviders {
	return DIAGNOSTIC_PROVIDERS;
}

export function updateDiagnosticsAggregates(): void {
	const aggregate: EditorDiagnostic[] = [];
	for (const context of getCodeTabContexts()) {
		const entry = editorDiagnosticsState.diagnosticsCache.get(context.id);
		if (entry) {
			for (let index = 0; index < entry.diagnostics.length; index += 1) {
				aggregate.push(entry.diagnostics[index]);
			}
		}
	}
	for (const [contextId, entry] of editorDiagnosticsState.diagnosticsCache) {
		if (hasCodeTabContext(contextId)) {
			continue;
		}
		for (let index = 0; index < entry.diagnostics.length; index += 1) {
			aggregate.push(entry.diagnostics[index]);
		}
	}
	editorDiagnosticsState.diagnostics = aggregate;
	refreshActiveDiagnostics();
	problemsPanel.setDiagnostics(editorDiagnosticsState.diagnostics);
}

export function refreshActiveDiagnostics(): void {
	editorDiagnosticsState.diagnosticsByRow.clear();
	const activeId = getActiveCodeTabContextId();
	if (!activeId) {
		return;
	}
	const entry = editorDiagnosticsState.diagnosticsCache.get(activeId);
	if (!entry) {
		return;
	}
	for (let index = 0; index < entry.diagnostics.length; index += 1) {
		const diag = entry.diagnostics[index];
		let bucket = editorDiagnosticsState.diagnosticsByRow.get(diag.row);
		if (!bucket) {
			bucket = [];
			editorDiagnosticsState.diagnosticsByRow.set(diag.row, bucket);
		}
		bucket.push(diag);
	}
}

export function markDiagnosticsDirtyForChunk(path: string): void {
	const context = findContextByChunk(path);
	if (!context) {
		return;
	}
	markDiagnosticsDirty(context.id);
}

export function getActiveSemanticDefinitions(): readonly LuaDefinitionInfo[] {
	const context = getActiveCodeTabContext();
	const path = context.descriptor.path;
	return editorViewState.layout.getSemanticDefinitions(editorDocumentState.buffer, editorDocumentState.textVersion, path);
}

export function getLuaModuleAliases(path: string): Map<string, ModuleAliasEntry> {
	const activeContext = getActiveCodeTabContext();
	const targetChunk = path || activeContext.descriptor.path;
	editorViewState.layout.getSemanticDefinitions(editorDocumentState.buffer, editorDocumentState.textVersion, targetChunk);
	const data = getOrCreateSemanticWorkspace().getSnapshot().getFileData(targetChunk);
	if (!data || data.moduleAliases.length === 0) {
		return new Map();
	}
	const aliases = new Map<string, ModuleAliasEntry>();
	for (let index = 0; index < data.moduleAliases.length; index += 1) {
		const entry = data.moduleAliases[index]!;
		aliases.set(entry.alias, entry);
	}
	return aliases;
}

export function findContextByChunk(path: string): CodeTabContext {
	const byChunk = findCodeTabContext(path);
	if (byChunk) {
		return byChunk;
	}
	for (const context of getCodeTabContexts()) {
		const descriptor = context.descriptor;
		if (descriptor) {
			continue;
		}
		if (path === '__entry__') {
			return context;
		}
	}
	return null;
}

export function getDiagnosticsForRow(row: number): readonly EditorDiagnostic[] {
	const bucket = editorDiagnosticsState.diagnosticsByRow.get(row);
	return bucket ?? EMPTY_DIAGNOSTICS;
}
