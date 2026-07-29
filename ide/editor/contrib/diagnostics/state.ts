import type { EditorDiagnostic, DiagnosticsCacheEntry } from '../../../common/models';
import { editorRuntimeState } from '../../common/runtime_state';

export const EMPTY_DIAGNOSTICS: EditorDiagnostic[] = [];

export const diagnosticsDebounceMs = 200;

type EditorDiagnosticsState = {
	diagnostics: EditorDiagnostic[];
	diagnosticsByRow: Map<number, EditorDiagnostic[]>;
	diagnosticsDirty: boolean;
	diagnosticsCache: Map<string, DiagnosticsCacheEntry>;
	dirtyDiagnosticContexts: Set<string>;
	diagnosticsDueAtMs: number;
	diagnosticsComputationScheduled: boolean;
	diagnosticsTaskPending: boolean;
};

export const editorDiagnosticsState: EditorDiagnosticsState = {
	diagnostics: [],
	diagnosticsByRow: new Map<number, EditorDiagnostic[]>(),
	diagnosticsDirty: true,
	diagnosticsCache: new Map<string, DiagnosticsCacheEntry>(),
	dirtyDiagnosticContexts: new Set<string>(),
	diagnosticsDueAtMs: null,
	diagnosticsComputationScheduled: false,
	diagnosticsTaskPending: false,
};

export function markDiagnosticsDirty(contextId: string): void {
	editorDiagnosticsState.diagnosticsDirty = true;
	editorDiagnosticsState.dirtyDiagnosticContexts.add(contextId);
	editorDiagnosticsState.diagnosticsDueAtMs = editorRuntimeState.currentTimeMs + diagnosticsDebounceMs;
}

export function getDiagnosticsForRow(row: number): readonly EditorDiagnostic[] {
	const bucket = editorDiagnosticsState.diagnosticsByRow.get(row);
	return bucket ?? EMPTY_DIAGNOSTICS;
}
