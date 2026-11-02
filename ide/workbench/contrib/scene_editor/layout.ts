import type { EditorFont } from '../../../editor/ui/view/font';
import type { EditorPaneConstraints } from '../../services/editor/editor_pane';
import type { SceneEditorInput, UnavailableSceneEditorInput } from './editor_input';

/** The Scene document's viewport is measured as the editor group's content. */
export function measureSceneEditor(_input: SceneEditorInput | UnavailableSceneEditorInput, font: EditorFont,
	_companionRequested: boolean, target: EditorPaneConstraints): void {
	target.minimumWidth = font.charAdvance * 20;
	target.minimumHeight = font.lineHeight * 8;
	target.companionWidth = undefined;
}
