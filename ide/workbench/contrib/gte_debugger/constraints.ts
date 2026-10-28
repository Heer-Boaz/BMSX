import type { EditorPaneConstraints } from '../../services/editor/editor_pane';
import type { EditorFont } from '../../../editor/ui/view/font';
import type { GteDebuggerInput } from './editor_input';
import { SCROLLBAR_WIDTH } from '../../../common/constants';

export function measureGteDebuggerEditor(_input: GteDebuggerInput, font: EditorFont, companionRequested: boolean, target: EditorPaneConstraints): void {
	target.minimumWidth = 0; target.minimumHeight = 0; target.companionWidth = companionRequested ? font.charAdvance * 32 + SCROLLBAR_WIDTH + 12 : undefined;
}
