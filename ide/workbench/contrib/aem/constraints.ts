import type { EditorPaneConstraints } from '../../services/editor/editor_pane';
import type { EditorFont } from '../../../editor/ui/view/font';
import type { AemEditorInput } from './editor_input';
import { measureWorkbenchPropertyTreeMinimumWidth } from '../../ui/property_tree';

/** Root properties retain a source-name and expression reading column. */
export function measureAemEditor(_input: AemEditorInput, font: EditorFont, companionRequested: boolean, target: EditorPaneConstraints): void {
	target.minimumWidth = 0; target.minimumHeight = 0;
	target.companionWidth = companionRequested ? measureWorkbenchPropertyTreeMinimumWidth(font.renderFont(), 12, 20) + 8 : undefined;
}
