import type { RuntimeSourceState } from '../../../runtime/sources';
import type { CartEditor } from '../../../cart_editor';
import type { CodeTabContext } from './model';
import { activeCodeEditor } from '../../../editor/ui/code_editor_state';
import { editorDiagnosticsState } from '../../../editor/contrib/diagnostics/state';
import { editorViewState } from '../../../editor/ui/view/state';
import { syncRuntimeErrorOverlayFromContext } from '../../../runtime_error/navigation';
import type { LuaDefinitionLocation } from '../../../../toolchain/ts/lua/semantic_contracts';
import { ensureCursorVisible, updateDesiredColumn } from '../../../editor/ui/view/caret/caret';
import { refreshActiveDiagnostics } from '../../contrib/code_editor/diagnostics/controller';
import { markDiagnosticsDirty } from '../../../editor/contrib/diagnostics/state';
import { clearGotoHoverHighlight, clearReferenceHighlights, requestSemanticRefresh } from '../../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../../editor/contrib/hover/controller';
import { resetBlink } from '../../../editor/render/caret';
import { getTextSnapshot } from '../../../editor/text/source_text';
import { editorPointerState } from '../../../input/pointer/state';
import { runtimeErrorState } from '../../../editor/contrib/runtime_error/state';
import { setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import {
	resolveRuntimeLuaSource,
} from '../../../runtime/sources';
import {
	SYSTEM_RESOURCE_DOMAIN,
	type ResourceDomain,
	type ResourceIdentity,
} from '../../../common/resource';
import type { CodeEditorTabDescriptor } from '../tab/model';
import { readWorkspaceLuaSourceText } from '../../../workspace/files';
import { editorTextModelService } from '../../../editor/model/model_service';

export type CodeTabSelection = {
	row: number;
	startColumn: number;
	endColumn: number;
};

export type LuaTextModelSourceSnapshot = {
	version: number;
	domain: ResourceDomain;
	path: string;
	source: string;
};

export type CurrentLuaSourceSnapshot = {
	readonly source: string;
	readonly revision: number;
};

/** Reads the current editor generation when open, otherwise the workspace-backed source record. */
export function captureCurrentLuaSource(
	sources: RuntimeSourceState,
	resource: ResourceIdentity,
): CurrentLuaSourceSnapshot {
	const model = editorTextModelService.get(resource);
	if (model !== undefined) {
		return {
			source: getTextSnapshot(model.buffer),
			revision: model.version,
		};
	}
	const match = resolveRuntimeLuaSource(sources, resource)!;
	return {
		source: readWorkspaceLuaSourceText(match.registry, match.record),
		revision: match.record.update_timestamp,
	};
}

function setCodeTabDiagnosticsState(context: CodeTabContext): void {
	const model = context.model;
	switch (model.mode) {
		case 'lua': {
			const cached = editorDiagnosticsState.diagnosticsCache.get(context.id);
			const path = model.resource.path;
			if (!cached || cached.version !== model.version || cached.path !== path) {
				markDiagnosticsDirty(context.id);
			}
			return;
		}
		case 'aem':
			editorDiagnosticsState.dirtyDiagnosticContexts.delete(context.id);
			editorDiagnosticsState.diagnosticsCache.set(context.id, {
				contextId: context.id,
				path: model.resource.path,
				diagnostics: [],
				version: model.version,
				source: getTextSnapshot(model.buffer),
			});
			return;
	}
}

export function storeCodeTabContext(context: CodeTabContext): void {
	context.runtimeErrorOverlay = runtimeErrorState.activeOverlay;
	context.executionStopRow = runtimeErrorState.executionStopRow;
}

export function capturePendingLuaTextModelSources(sources: RuntimeSourceState): LuaTextModelSourceSnapshot[] {
	const snapshots: LuaTextModelSourceSnapshot[] = [];
	for (const model of editorTextModelService.models) {
		switch (model.mode) {
			case 'lua':
				break;
			case 'aem':
				continue;
		}
		const source = getTextSnapshot(model.buffer);
		const match = resolveRuntimeLuaSource(sources, model.resource)!;
		if (!match.record.program_module) {
			continue;
		}
		const installedSources = match.domain === SYSTEM_RESOURCE_DOMAIN
			? sources.systemInstalledBlua32Sources
			: sources.cartridgeSlots[match.domain]!.installedBlua32Sources;
		if (model.version === model.appliedVersion
			&& source === installedSources.get(match.record.module_path)) {
			continue;
		}
		snapshots.push({
			version: model.version,
			domain: model.resource.domain,
			path: model.resource.path,
			source,
		});
	}
	return snapshots;
}

export function markLuaTextModelsAppliedToRuntime(snapshots: ReadonlyArray<LuaTextModelSourceSnapshot>): void {
	for (let index = 0; index < snapshots.length; index += 1) {
		const snapshot = snapshots[index];
		const model = editorTextModelService.get(snapshot)!;
		model.markApplied(snapshot.version);
		model.setRuntimeSyncState(
			model.version === snapshot.version ? 'synced' : 'runtime_update_pending',
			null,
		);
	}
}

export function applyActiveCodeTabSelection(selection: CodeTabSelection): void {
	setSingleCursorPosition(activeCodeEditor.view, selection.row, selection.startColumn);
	setSingleCursorSelectionAnchor(activeCodeEditor.view, selection.row, selection.endColumn);
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = false;
	ensureCursorVisible();
	resetBlink();
	activeCodeEditor.emitCursorMoved();
}

export function activateCodeEditorTab(tab: CodeEditorTabDescriptor, selection?: CodeTabSelection): void {
	const context = tab.context;
	activeCodeEditor.attach(context.model, context.view);
	editorViewState.maxLineLengthDirty = true;
	editorViewState.layout.setDocumentMode(context.model.mode);
	editorViewState.layout.markVisualLinesDirty();
	editorViewState.layout.invalidateAllHighlights();
	setCodeTabDiagnosticsState(context);
	syncRuntimeErrorOverlayFromContext(context);
	requestSemanticRefresh();
	updateDesiredColumn();
	resetBlink();
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = false;
	if (selection) {
		applyActiveCodeTabSelection(selection);
	}
	refreshActiveDiagnostics();
}

export function navigateToLuaDefinition(
	editor: CartEditor,
	definition: LuaDefinitionLocation,
): void {
	clearReferenceHighlights();
	const activeDomain = activeCodeEditor.model.resource.domain;
	editor.navigation.focusChunkSourceForContext(
		activeDomain,
		definition.path,
		{
			row: definition.range.startLine - 1,
			startColumn: definition.range.startColumn - 1,
			endColumn: definition.range.startColumn - 1,
		},
	);
	clearHoverTooltip();
	clearGotoHoverHighlight();
}
