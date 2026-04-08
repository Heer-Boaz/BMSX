import { clamp } from '../../../../utils/clamp';
import type { TimerHandle } from '../../../../platform/platform';
import { computeAggregatedEditorDiagnostics, markDiagnosticsDirty, type DiagnosticContextInput, type DiagnosticProviders } from './diagnostics';
import { ide_state, diagnosticsDebounceMs, EMPTY_DIAGNOSTICS } from '../../ide_state';
import type { EditorDiagnostic, CodeTabContext } from '../../types';
import { listLuaSymbols, listGlobalLuaSymbols, listLuaBuiltinFunctions } from '../../intellisense';
import { getTextSnapshot, splitText } from '../../text/source_text';
import { enqueueBackgroundTask, scheduleIdeOnce } from '../../background_tasks';
import { getActiveCodeTabContext, findCodeTabContext, setActiveTab, isCodeTabActive, activateCodeTab } from '../../browser/editor_tabs';
import { setCursorPosition, ensureCursorVisible } from '../../browser/caret';
import * as TextEditing from '../../text_editing_and_selection';
import { getOrCreateSemanticWorkspace } from '../../semantic_workspace_sync';
import type { LuaDefinitionInfo } from '../../../../lua/syntax/lua_ast';
import type { ModuleAliasEntry } from '../../semantic_model';
import { beginNavigationCapture, completeNavigation } from '../../navigation_history';

const diagnosticsMinIntervalMs = 600;
let diagnosticsTimer: TimerHandle | null = null;
let diagnosticsScheduledForMs = 0;
let lastDiagnosticsRunMs = 0;

function cancelDiagnosticsTimer(): void {
	if (diagnosticsTimer) {
		diagnosticsTimer.cancel();
		diagnosticsTimer = null;
	}
	diagnosticsScheduledForMs = 0;
	ide_state.diagnosticsComputationScheduled = false;
}

export function processDiagnosticsQueue(now: number): void {
	if (!ide_state.diagnosticsDirty) {
		return;
	}
	const activeId = ide_state.activeCodeTabContextId;
	if (activeId && !ide_state.dirtyDiagnosticContexts.has(activeId)) {
		return;
	}
	if (ide_state.dirtyDiagnosticContexts.size === 0) {
		ide_state.diagnosticsDirty = false;
		ide_state.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	if (ide_state.diagnosticsTaskPending) {
		return;
	}
	if (ide_state.diagnosticsDueAtMs === null) {
		ide_state.diagnosticsDueAtMs = now + diagnosticsDebounceMs;
	}
	scheduleDiagnosticsComputation();
}

export function scheduleDiagnosticsComputation(): void {
	const now = ide_state.clockNow();
	const dueAt = ide_state.diagnosticsDueAtMs ?? now + diagnosticsDebounceMs;
	const spacedDueAt = Math.max(dueAt, lastDiagnosticsRunMs + diagnosticsMinIntervalMs);
	ide_state.diagnosticsDueAtMs = spacedDueAt;
	if (diagnosticsTimer && diagnosticsTimer.isActive() && diagnosticsScheduledForMs >= spacedDueAt) {
		return;
	}
	cancelDiagnosticsTimer();
	const delay = clamp(spacedDueAt - now, 0, diagnosticsMinIntervalMs + diagnosticsDebounceMs);
	diagnosticsScheduledForMs = spacedDueAt;
	ide_state.diagnosticsComputationScheduled = true;
	diagnosticsTimer = scheduleIdeOnce(delay, () => {
		diagnosticsTimer = null;
		diagnosticsScheduledForMs = 0;
		ide_state.diagnosticsComputationScheduled = false;
		executeDiagnosticsComputation();
	});
}

export function executeDiagnosticsComputation(): void {
	if (!ide_state.diagnosticsDirty) {
		ide_state.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	const activeId = ide_state.activeCodeTabContextId;
	if (activeId && !ide_state.dirtyDiagnosticContexts.has(activeId)) {
		ide_state.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	if (ide_state.dirtyDiagnosticContexts.size === 0) {
		ide_state.diagnosticsDirty = false;
		ide_state.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	if (ide_state.diagnosticsTaskPending) {
		scheduleDiagnosticsComputation();
		return;
	}
	const now = ide_state.clockNow();
	if (ide_state.diagnosticsDueAtMs === null) {
		ide_state.diagnosticsDueAtMs = now + diagnosticsDebounceMs;
		scheduleDiagnosticsComputation();
		return;
	}
	if (now < ide_state.diagnosticsDueAtMs) {
		scheduleDiagnosticsComputation();
		return;
	}
	const batch = collectDiagnosticsBatch();
	if (batch.length === 0) {
		ide_state.diagnosticsDirty = false;
		ide_state.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	enqueueDiagnosticsJob(batch);
}

export function enqueueDiagnosticsJob(contextIds: readonly string[]): void {
	if (contextIds.length === 0) {
		return;
	}
	ide_state.diagnosticsTaskPending = true;
	const batch = [...contextIds];
	enqueueBackgroundTask(() => {
		runDiagnosticsForContexts(batch);
		ide_state.diagnosticsTaskPending = false;
		lastDiagnosticsRunMs = ide_state.clockNow();
		if (ide_state.dirtyDiagnosticContexts.size === 0) {
			ide_state.diagnosticsDirty = false;
			ide_state.diagnosticsDueAtMs = null;
			cancelDiagnosticsTimer();
		} else {
			const now = ide_state.clockNow();
			ide_state.diagnosticsDueAtMs = now + diagnosticsDebounceMs;
			processDiagnosticsQueue(now);
		}
		return false;
	});
}

export function collectDiagnosticsBatch(): string[] {
	const activeId = ide_state.activeCodeTabContextId;
	if (activeId && ide_state.dirtyDiagnosticContexts.has(activeId)) {
		return [activeId];
	}
	return [];
}

export function runDiagnosticsForContexts(contextIds: readonly string[]): void {
	if (contextIds.length === 0) {
		return;
	}
	const providers = createDiagnosticProviders();
	const activeId = ide_state.activeCodeTabContextId;
	const inputs: DiagnosticContextInput[] = [];
	const inputLookup = new Map<string, DiagnosticContextInput>();
	const metadata: Array<{ id: string; path: string }> = [];
	for (let index = 0; index < contextIds.length; index += 1) {
		const contextId = contextIds[index];
		const context = ide_state.codeTabContexts.get(contextId);
		if (!context) {
			ide_state.diagnosticsCache.delete(contextId);
			ide_state.dirtyDiagnosticContexts.delete(contextId);
			continue;
		}
		if (context.mode !== 'lua') {
			const source = contextId === activeId ? getTextSnapshot(ide_state.buffer) : getTextSnapshot(context.buffer);
			ide_state.diagnosticsCache.set(context.id, {
				contextId: context.id,
				path: context.descriptor.path,
				diagnostics: [],
				version: contextId === activeId ? ide_state.buffer.version : context.buffer.version,
				source,
			});
			ide_state.dirtyDiagnosticContexts.delete(contextId);
			continue;
		}
		const path = context.descriptor.path;
		const isActive = activeId && contextId === activeId;
		const cached = ide_state.diagnosticsCache.get(contextId);
		const buffer = isActive ? ide_state.buffer : context.buffer;
		const version = buffer.version;
		if (cached && cached.path === path && cached.version === version) {
			ide_state.dirtyDiagnosticContexts.delete(contextId);
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
		inputLookup.set(context.id, input);
		metadata.push({ id: context.id, path });
	}
	if (inputs.length === 0) {
		updateDiagnosticsAggregates();
		return;
	}
	const diagnostics = computeAggregatedEditorDiagnostics(inputs, providers);
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
	for (let index = 0; index < metadata.length; index += 1) {
		const meta = metadata[index];
		const diagList = byContext.get(meta.id) ?? [];
		const input = inputLookup.get(meta.id)!;
		ide_state.diagnosticsCache.set(meta.id, {
			contextId: meta.id,
			path: meta.path,
			diagnostics: diagList,
			version: input.version,
			source: input.source,
		});
		ide_state.dirtyDiagnosticContexts.delete(meta.id);
	}
	updateDiagnosticsAggregates();
}

export function createDiagnosticProviders(): DiagnosticProviders {
	return {
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
}

export function updateDiagnosticsAggregates(): void {
	const aggregate: EditorDiagnostic[] = [];
	for (const context of ide_state.codeTabContexts.values()) {
		const entry = ide_state.diagnosticsCache.get(context.id);
		if (entry) {
			for (let index = 0; index < entry.diagnostics.length; index += 1) {
				aggregate.push(entry.diagnostics[index]);
			}
		}
	}
	for (const [contextId, entry] of ide_state.diagnosticsCache) {
		if (ide_state.codeTabContexts.has(contextId)) {
			continue;
		}
		for (let index = 0; index < entry.diagnostics.length; index += 1) {
			aggregate.push(entry.diagnostics[index]);
		}
	}
	ide_state.diagnostics = aggregate;
	refreshActiveDiagnostics();
	ide_state.problemsPanel.setDiagnostics(ide_state.diagnostics);
}

export function refreshActiveDiagnostics(): void {
	ide_state.diagnosticsByRow.clear();
	const activeId = ide_state.activeCodeTabContextId;
	if (!activeId) {
		return;
	}
	const entry = ide_state.diagnosticsCache.get(activeId);
	if (!entry) {
		return;
	}
	for (let index = 0; index < entry.diagnostics.length; index += 1) {
		const diag = entry.diagnostics[index];
		let bucket = ide_state.diagnosticsByRow.get(diag.row);
		if (!bucket) {
			bucket = [];
			ide_state.diagnosticsByRow.set(diag.row, bucket);
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
	return ide_state.layout.getSemanticDefinitions(ide_state.buffer, ide_state.textVersion, path);
}

export function getLuaModuleAliases(path: string): Map<string, ModuleAliasEntry> {
	const activeContext = getActiveCodeTabContext();
	const targetChunk = path || activeContext.descriptor.path;
	ide_state.layout.getSemanticDefinitions(ide_state.buffer, ide_state.textVersion, targetChunk);
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
	for (const context of ide_state.codeTabContexts.values()) {
		const descriptor = context.descriptor;
		if (descriptor) {
			continue;
		}
		const aliases: string[] = ['__entry__'];
		for (let index = 0; index < aliases.length; index += 1) {
			const alias = aliases[index];
			if (alias === path) {
				return context;
			}
		}
	}
	return null;
}

export function getDiagnosticsForRow(row: number): readonly EditorDiagnostic[] {
	const bucket = ide_state.diagnosticsByRow.get(row);
	return bucket ?? EMPTY_DIAGNOSTICS;
}

export function gotoDiagnostic(diagnostic: EditorDiagnostic): void {
	const navigationCheckpoint = beginNavigationCapture();
	// Switch to the originating tab if provided
	if (diagnostic.contextId && diagnostic.contextId.length > 0 && diagnostic.contextId !== ide_state.activeCodeTabContextId) {
		setActiveTab(diagnostic.contextId);
	}
	if (!isCodeTabActive()) {
		activateCodeTab();
	}
	if (!isCodeTabActive()) {
		return;
	}
	const targetRow = clamp(diagnostic.row, 0, Math.max(0, ide_state.buffer.getLineCount() - 1));
	const line = ide_state.buffer.getLineContent(targetRow);
	const targetColumn = clamp(diagnostic.startColumn, 0, line.length);
	setCursorPosition(targetRow, targetColumn);
	TextEditing.clearSelection();
	ide_state.cursorRevealSuspended = false;
	ensureCursorVisible();
	completeNavigation(navigationCheckpoint);
}
