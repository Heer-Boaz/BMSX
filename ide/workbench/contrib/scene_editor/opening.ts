import type { CartEditor } from '../../../cart_editor';
import { editorTextModelService } from '../../../editor/model/model_service';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { resolveLuaTextFileModel } from '../../services/working_copy/text_file_model';
import type { ProjectContentEntry, ProjectContentIndex } from '../resources/content_index';

/** Scene activation selects the authored Main subject, independently of document placement. */
export function openProjectScene(editor: CartEditor, index: ProjectContentIndex,
	entry: Extract<ProjectContentEntry, { kind: 'scene' }>, origin: InputFocusTarget | null): Promise<boolean> {
	const scope = origin?.scope, generation = scope?.contextGeneration;
	return editor.openSceneInMain(() => {
		const sourceContext = index.catalog.contexts.get(entry.ownerResource.contextId);
		const current = () => !editor.isClosing && index.acceptingQueries && inputFocus.admittedTarget === origin
			&& scope?.contextGeneration === generation && index.catalog.contexts.get(entry.ownerResource.contextId) === sourceContext;
		if (!index.isCurrent(entry) || !current()) return;
		const model = resolveLuaTextFileModel(editorTextModelService, index.catalog, entry.ownerResource);
		if (!index.isCurrent(entry) || !current()) return;
		return { model, subject: { document: entry.document, sourceVersion: model.version, scene: entry.definition } };
	}, origin);
}
