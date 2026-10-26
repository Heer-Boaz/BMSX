import type { EditorDiagnostic } from '../../../common/models';

/** Canonical source-row markers; viewport projection belongs to each editor control. */
export type EditorDiagnosticsByRow = ReadonlyMap<number, readonly EditorDiagnostic[]>;

export const EMPTY_DIAGNOSTICS_BY_ROW: EditorDiagnosticsByRow = new Map();
