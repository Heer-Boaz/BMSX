import type { LineJumpState, SearchState } from '../../../common/types';

export const editorSearchState: SearchState = {
	field: undefined!,
	active: false,
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
	field: undefined!,
	active: false,
	visible: false,
	value: '',
};
