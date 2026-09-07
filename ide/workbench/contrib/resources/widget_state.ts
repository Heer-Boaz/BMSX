import type { CreateResourceState, ResourceSearchState } from '../../../common/models';
import { TextField } from '../../../editor/ui/inline/text_field_model';
import { activeCodeEditor } from '../../../editor/ui/code_editor_state';

export const resourceSearchState: ResourceSearchState = {
	field: new TextField(activeCodeEditor.focusTarget),
	visible: false,
	query: '',
	catalog: [],
	matches: [],
	selectionIndex: -1,
	displayOffset: 0,
	hoverIndex: -1,
};

export const createResourceState: CreateResourceState = {
	field: new TextField(activeCodeEditor.focusTarget),
	visible: false,
	path: '',
	error: null,
	working: false,
	lastDirectory: '',
};
