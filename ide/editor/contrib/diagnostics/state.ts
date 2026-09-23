import type { EditorDiagnostic } from '../../../common/models';
import type { EditorTextModel } from '../../model/text_model';

const EMPTY_DIAGNOSTICS: readonly EditorDiagnostic[] = [];
const diagnosticsByRow = new Map<number, EditorDiagnostic[]>();

/** Active-editor projection only. Resource results and scheduling live in the workbench service. */
export function setActiveDiagnostics(model: EditorTextModel | null, diagnostics: readonly EditorDiagnostic[]): void {
	diagnosticsByRow.clear();
	for (const diagnostic of diagnostics) {
		if (diagnostic.model !== model) continue;
		let bucket = diagnosticsByRow.get(diagnostic.row);
		if (bucket === undefined) diagnosticsByRow.set(diagnostic.row, bucket = []);
		bucket.push(diagnostic);
	}
}

export function getDiagnosticsForRow(row: number): readonly EditorDiagnostic[] {
	return diagnosticsByRow.get(row) ?? EMPTY_DIAGNOSTICS;
}
