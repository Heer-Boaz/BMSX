import type { CreateResourceState, ResourceSearchState } from '../../../common/types';

export const resourceSearchState: ResourceSearchState = {
	field: undefined!,
	active: false,
	visible: false,
	query: '',
	catalog: [],
	matches: [],
	selectionIndex: -1,
	displayOffset: 0,
	hoverIndex: -1,
};

export const createResourceState: CreateResourceState = {
	field: undefined!,
	active: false,
	visible: false,
	path: '',
	error: null,
	working: false,
	lastDirectory: '',
};
