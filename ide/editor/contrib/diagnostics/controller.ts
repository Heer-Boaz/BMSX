import { clamp } from '../../../../machine/ts/common/clamp';
import type { HostClock, TimerHandle } from '../../../../machine/ts/platform/platform';
import { computeAggregatedEditorDiagnostics, markDiagnosticsDirty, type DiagnosticContextInput } from './analysis';
import type { EditorDiagnostic, CodeTabContext } from '../../../common/models';
import { getLinesSnapshot, getTextSnapshot } from '../../text/source_text';
import { enqueueBackgroundTask } from '../../../common/background_tasks';
import {
	findCodeTabContext,
	getActiveCodeTabContext,
	getActiveCodeTabContextId,
	getCodeTabContextById,
	getCodeTabContexts,
	hasCodeTabContext,
} from '../../../workbench/ui/code_tab/contexts';
import { getOrCreateSemanticWorkspace } from '../intellisense/semantic/workspace/state';
import type { LuaDefinitionInfo } from '../../../../machine/ts/lua/syntax/ast/index';
import type { ModuleAliasEntry } from '../../../../machine/ts/lua/semantic/model';
import { diagnosticsDebounceMs, editorDiagnosticsState, EMPTY_DIAGNOSTICS } from './state';
import { editorDocumentState } from '../../editing/document_state';
import { editorViewState } from '../../ui/view/state';
import { problemsPanel } from '../../../workbench/contrib/problems/panel/controller';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';

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
	editorDiagnosticsState.diagnosticsComputationScheduled = false;
}

export function processDiagnosticsQueue(
	bridge: RuntimeLuaTooling,
	clock: HostClock,
	now: number,
): void {
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
	scheduleDiagnosticsComputation(bridge, clock);
}

export function scheduleDiagnosticsComputation(bridge: RuntimeLuaTooling, clock: HostClock): void {
	const now = clock.now();
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
	diagnosticsTimer = clock.scheduleOnce(delay, () => {
		diagnosticsTimer = null;
		diagnosticsScheduledForMs = 0;
		editorDiagnosticsState.diagnosticsComputationScheduled = false;
		executeDiagnosticsComputation(bridge, clock);
	});
}

export function executeDiagnosticsComputation(bridge: RuntimeLuaTooling, clock: HostClock): void {
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
		scheduleDiagnosticsComputation(bridge, clock);
		return;
	}
	const now = clock.now();
	if (editorDiagnosticsState.diagnosticsDueAtMs === null) {
		editorDiagnosticsState.diagnosticsDueAtMs = now + diagnosticsDebounceMs;
		scheduleDiagnosticsComputation(bridge, clock);
		return;
	}
	if (now < editorDiagnosticsState.diagnosticsDueAtMs) {
		scheduleDiagnosticsComputation(bridge, clock);
		return;
	}
	const batch = collectDiagnosticsBatch();
	if (batch.length === 0) {
		editorDiagnosticsState.diagnosticsDirty = false;
		editorDiagnosticsState.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	enqueueDiagnosticsJob(bridge, clock, batch);
}

export function enqueueDiagnosticsJob(
	bridge: RuntimeLuaTooling,
	clock: HostClock,
	contextIds: readonly string[],
): void {
	if (contextIds.length === 0) {
		return;
	}
	editorDiagnosticsState.diagnosticsTaskPending = true;
	enqueueBackgroundTask(() => {
		runDiagnosticsForContexts(bridge, contextIds);
		editorDiagnosticsState.diagnosticsTaskPending = false;
		lastDiagnosticsRunMs = clock.now();
		if (editorDiagnosticsState.dirtyDiagnosticContexts.size === 0) {
			editorDiagnosticsState.diagnosticsDirty = false;
			editorDiagnosticsState.diagnosticsDueAtMs = null;
			cancelDiagnosticsTimer();
		} else {
			const now = clock.now();
			editorDiagnosticsState.diagnosticsDueAtMs = now + diagnosticsDebounceMs;
			processDiagnosticsQueue(bridge, clock, now);
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

export function runDiagnosticsForContexts(bridge: RuntimeLuaTooling, contextIds: readonly string[]): void {
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
				path: context.resource.path,
				diagnostics: [],
				version: contextId === activeId ? editorDocumentState.buffer.version : context.buffer.version,
				source,
			});
			editorDiagnosticsState.dirtyDiagnosticContexts.delete(contextId);
			continue;
		}
		const path = context.resource.path;
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
			domain: context.resource.domain,
			path,
			source,
			lines: getLinesSnapshot(buffer),
			version,
		};
		inputs.push(input);
	}
	if (inputs.length === 0) {
		updateDiagnosticsAggregates();
		return;
	}
	const diagnostics = computeAggregatedEditorDiagnostics(bridge, inputs);
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
	return editorViewState.layout.getSemanticDefinitions(
		editorDocumentState.buffer,
		editorDocumentState.textVersion,
		context.resource,
	);
}

export function getLuaModuleAliases(path: string): Map<string, ModuleAliasEntry> {
	const activeContext = getActiveCodeTabContext();
	const targetChunk = path || activeContext.resource.path;
	editorViewState.layout.getSemanticDefinitions(
		editorDocumentState.buffer,
		editorDocumentState.textVersion,
		{ domain: activeContext.resource.domain, path: targetChunk },
	);
	const data = getOrCreateSemanticWorkspace(activeContext.resource.domain)
		.getSnapshot()
		.getFileData(targetChunk);
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
	return findCodeTabContext({
		domain: getActiveCodeTabContext().resource.domain,
		path,
	});
}

export function getDiagnosticsForRow(row: number): readonly EditorDiagnostic[] {
	const bucket = editorDiagnosticsState.diagnosticsByRow.get(row);
	return bucket ?? EMPTY_DIAGNOSTICS;
}
