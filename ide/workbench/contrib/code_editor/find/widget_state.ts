import type { LineJumpState, SearchState } from '../../../../common/models';
import { TextField } from '../../../../editor/ui/inline/text_field_model';
import { activeCodeEditor } from '../../../../editor/ui/code_editor_state';

export const editorSearchState: SearchState = {
	field: new TextField(activeCodeEditor.focusTarget, { allowSpace: true, singleLine: true }),
	visible: false,
	query: '',
	matches: [],
	currentIndex: -1,
	job: null,
	displayOffset: 0,
	hoverIndex: -1,
	scope: 'local',
	globalMatches: [],
	globalJob: null,
};

export const lineJumpState: LineJumpState = {
	field: new TextField(activeCodeEditor.focusTarget, { allowSpace: false, singleLine: true, characterFilter: value => value >= '0' && value <= '9', maxLength: 6 }),
	visible: false,
	value: '',
};
