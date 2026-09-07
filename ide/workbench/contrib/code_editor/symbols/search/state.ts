import type { SymbolSearchState } from '../../../../../common/models';
import { TextField } from '../../../../../editor/ui/inline/text_field_model';
import { activeCodeEditor } from '../../../../../editor/ui/code_editor_state';

export const symbolSearchState: SymbolSearchState = {
	field: new TextField(activeCodeEditor.focusTarget),
	visible: false,
	query: '',
	global: false,
	mode: 'symbols',
	catalog: [],
	locationCatalog: [],
	catalogContext: null,
	matches: [],
	selectionIndex: -1,
	displayOffset: 0,
	hoverIndex: -1,
};
