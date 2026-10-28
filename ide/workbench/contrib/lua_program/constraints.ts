import type { EditorPaneConstraints } from '../../services/editor/editor_pane';
import type { EditorFont } from '../../../editor/ui/view/font';
import type { LuaProgramInput } from './editor_input';
import { measureWorkbenchPropertyTreeMinimumWidth } from '../../ui/property_tree';

export function measureLuaProgramEditor(input: LuaProgramInput, font: EditorFont, companionRequested: boolean, target: EditorPaneConstraints): void {
	target.minimumWidth = 0; target.minimumHeight = 0;
	target.companionWidth = companionRequested ? measureWorkbenchPropertyTreeMinimumWidth(font.renderFont(), 12, input.liveVisible ? 24 : 20) + 8 : undefined;
}
