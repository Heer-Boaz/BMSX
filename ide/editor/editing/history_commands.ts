import { showEditorWarningBanner } from '../../common/feedback_state';
import type { EditorTextModel } from '../model/text_model';
import { EditorHistoryConflict, type EditorHistoryDirection } from '../model/undo_redo_service';

/** Shared command policy: report a blocked compound edit without partially undoing it. */
export function executeTextHistoryCommand(model: EditorTextModel, direction: EditorHistoryDirection): boolean {
	try {
		return model[direction]() !== null;
	} catch (error) {
		if (!(error instanceof EditorHistoryConflict)) throw error;
		showEditorWarningBanner(error.message);
		return false;
	}
}
