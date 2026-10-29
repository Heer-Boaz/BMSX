import type { CartEditor } from '../cart_editor';
import { showEditorMessage } from '../common/feedback_state';
import type { EditorTextModel } from '../editor/model/text_model';
import { extractErrorMessage } from '../common/errors';
import { computeSourceLabel } from '../common/paths';
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
	const result = await saves.save(model).completion;
	const title = computeSourceLabel(model.resource.path);
	if (result.status === 'failed') {
		if (model.mode !== 'lua' || !showLuaErrorOverlay(editor, model.resource, result.error)) {
			showEditorMessage(extractErrorMessage(result.error), 'error', 4.0);
		}
		return result;
	}
	const saved = `${title} saved${result.persistence.status === 'browser' ? ' (browser)' : ''}`;
	if (model.mode === 'yaml') {
		const status = getTextFileRuntimeSourceStatus(sources, model);
		if (status === 'applied') {
			showEditorMessage(saved, 'success', 2.5);
		} else {
			showEditorMessage(`${saved}; ${status === 'pending' ? 'rebuild needed' : 'asset source unknown'}`, 'warning', 4.0);
		}
	} else if (model.mode === 'lua' && getTextFileRuntimeSourceStatus(sources, model) === 'pending') {
		showEditorMessage(`${saved}; update pending`, 'success', 2.5);
	} else {
		showEditorMessage(saved, 'success', 2.5);
	}
	return result;
}

/** One workspace outcome, without per-file navigation or competing success messages. */
export async function saveAllTextFilesFromCommand(saves: TextFileSaveService): Promise<readonly TextFileSaveResult[]> {
	const entries = saves.saveAll();
	const results = await Promise.all(entries.map(entry => entry.operation.completion));
	if (entries.length === 0 || !saves.acceptingSaves) return results;
	let saved = 0, browser = 0;
	const failures: string[] = [];
	for (let index = 0; index < results.length; index++) {
		const result = results[index], model = entries[index].model;
		if (result.status === 'failed') failures.push(`${model.resource.contextLabel}: ${model.identity.path}: ${extractErrorMessage(result.error)}`);
		else {
			saved++;
			if (result.persistence.status === 'browser') browser++;
		}
	}
	const summary = `Saved files: ${saved}/${entries.length}${browser === 0 ? '' : ` (${browser} in browser)`}`;
	if (failures.length !== 0) showEditorMessage(`${summary}. Failed: ${failures.join('; ')}`, 'error', 6.0);
	else showEditorMessage(`${summary}; runtime unchanged`, 'success', 2.5);
	return results;
}
