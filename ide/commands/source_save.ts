import type { CartEditor } from '../cart_editor';
import * as constants from '../common/constants';
import { showEditorMessage, showEditorWarningBanner } from '../common/feedback_state';
import type { EditorTextModel } from '../editor/model/text_model';
import { extractErrorMessage } from '../language/lua/interpreter/value';
import type { RuntimeSourceState } from '../runtime/sources';
import { showLuaErrorOverlay } from '../runtime_error/navigation';
import { getTextFileRuntimeSourceStatus } from '../workbench/services/working_copy/runtime_source_status';
import type { TextFileSaveResult, TextFileSaveService } from '../workbench/services/working_copy/text_file_save';

/** Command presentation consumes the save outcome; it does not own storage or runtime mutation. */
export async function saveTextFileFromCommand(
	saves: TextFileSaveService,
	model: EditorTextModel,
	editor: CartEditor,
	sources: RuntimeSourceState,
): Promise<TextFileSaveResult> {
	const result = await saves.save(model);
	const title = model.resource.path;
	if (result.status === 'failed') {
		if (model.mode !== 'lua' || !showLuaErrorOverlay(editor, model.resource, result.error)) {
			showEditorMessage(extractErrorMessage(result.error), constants.COLOR_STATUS_ERROR, 4.0);
		}
	} else if (result.application.status === 'failed') {
		showEditorMessage(`${title} saved, but runtime apply failed`, constants.COLOR_STATUS_WARNING, 4.0);
		showEditorWarningBanner(`Saved, but runtime apply failed: ${extractErrorMessage(result.application.error)}`, 5.0);
	} else if (model.mode === 'yaml') {
		showEditorMessage(`${title} saved (asset rebuild required)`, constants.COLOR_STATUS_WARNING, 4.0);
	} else if (model.mode === 'lua' && getTextFileRuntimeSourceStatus(sources, model) === 'pending') {
		showEditorMessage(`${title} saved (runtime update pending)`, constants.COLOR_STATUS_SUCCESS, 2.5);
	} else {
		showEditorMessage(`${title} saved`, constants.COLOR_STATUS_SUCCESS, 2.5);
	}
	return result;
}
