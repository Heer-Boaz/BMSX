import type { EditorPaneConstraints } from '../../services/editor/editor_pane';
import type { EditorFont } from '../../../editor/ui/view/font';
import type { HostErrorInput } from './editor_input';
import { measureWorkbenchTextViewMinimumWidth } from '../../ui/text_view/layout';

export function measureHostErrorEditor(_input: HostErrorInput, font: EditorFont, companionRequested: boolean, target: EditorPaneConstraints): void {
	target.minimumWidth = 0; target.minimumHeight = 0; target.companionWidth = companionRequested ? measureWorkbenchTextViewMinimumWidth(font) : undefined;
}
