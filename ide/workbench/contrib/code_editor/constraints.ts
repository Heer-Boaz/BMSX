import type { EditorPaneConstraints } from '../../services/editor/editor_pane';
import type { EditorFont } from '../../../editor/ui/view/font';
import type { CodeEditorInput } from './editor_input';
import { CODE_LINE_LEADING, SCROLLBAR_WIDTH } from '../../../common/constants';
import { measureCodeEditorWidth } from '../../../editor/ui/view/view';

const SOURCE_READING_COLUMNS = 48;

/** Input measurement excludes another attachment's inline prompts and group timeline. */
export function measureSourceEditor(input: CodeEditorInput, font: EditorFont, companionRequested: boolean, target: EditorPaneConstraints): void {
	target.minimumWidth = measureCodeEditorWidth(input.workingCopy, font);
	target.minimumHeight = font.lineHeight + CODE_LINE_LEADING + (input.context.view.wordWrapEnabled ? 0 : SCROLLBAR_WIDTH);
	target.companionWidth = companionRequested ? measureCodeEditorWidth(input.workingCopy, font, SOURCE_READING_COLUMNS + 1) : undefined;
}
