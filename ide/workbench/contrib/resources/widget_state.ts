import type { CreateResourceState } from '../../../common/models';
import { TextField } from '../../../editor/ui/inline/text_field_model';
import { activeCodeEditor } from '../../../editor/ui/code_editor_state';

export const createResourceState: CreateResourceState = {
	field: new TextField(activeCodeEditor.focusTarget),
	visible: false,
	path: '',
	error: null,
	working: false,
	lastDirectory: '',
};
