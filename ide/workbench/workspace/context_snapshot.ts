// disable cross_layer_import_pattern -- workspace snapshots persist document contents and code-editor view state without changing their owners.
import { clamp } from '../../../machine/ts/common/clamp';
import type { CodeEditorViewSnapshot, Position } from '../../common/models';
import { restoreCodeEditorViewSnapshot } from '../../editor/editing/undo_controller';
import type { CodeTabContext } from '../ui/code_tab/model';
import { getActiveCodeTabContextId } from '../ui/code_tab/contexts';
import type { SnapshotMetadata } from './models';

function restoredViewSnapshot(context: CodeTabContext, metadata: SnapshotMetadata): CodeEditorViewSnapshot {
	const buffer = context.model.buffer;
	const lastRow = buffer.getLineCount() - 1;
	const cursorRow = clamp(metadata.cursorRow, 0, lastRow);
	const cursorLen = buffer.getLineEndOffset(cursorRow) - buffer.getLineStartOffset(cursorRow);
	const cursorColumn = clamp(metadata.cursorColumn, 0, cursorLen);
	const anchor = metadata.selectionAnchor;
	let selectionAnchor: Position = null;
	if (anchor !== null) {
		const anchorRow = clamp(anchor.row, 0, lastRow);
		const anchorLen = buffer.getLineEndOffset(anchorRow) - buffer.getLineStartOffset(anchorRow);
		selectionAnchor = {
			row: anchorRow,
			column: clamp(anchor.column, 0, anchorLen),
		};
	}
	return {
		cursorRow,
		cursorColumn,
		scrollRow: clamp(metadata.scrollRow, 0, lastRow),
		scrollColumn: metadata.scrollColumn,
		selectionAnchor,
	};
}

export function restoreWorkspaceCodeEditorView(
	context: CodeTabContext,
	metadata: SnapshotMetadata,
): void {
	const snapshot = restoredViewSnapshot(context, metadata);
	const view = context.view;
	view.cursorRow = snapshot.cursorRow;
	view.cursorColumn = snapshot.cursorColumn;
	view.scrollRow = snapshot.scrollRow;
	view.scrollColumn = snapshot.scrollColumn;
	view.selectionAnchor = snapshot.selectionAnchor;
	if (getActiveCodeTabContextId() === context.id) {
		restoreCodeEditorViewSnapshot(snapshot, { preserveScroll: true });
	}
}

export function captureContextSnapshotMetadata(context: CodeTabContext): SnapshotMetadata {
	const view = context.view;
	return {
		cursorRow: view.cursorRow,
		cursorColumn: view.cursorColumn,
		scrollRow: view.scrollRow,
		scrollColumn: view.scrollColumn,
		selectionAnchor: view.selectionAnchor === null
			? null
			: { row: view.selectionAnchor.row, column: view.selectionAnchor.column },
	};
}
