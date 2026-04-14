import type { SymbolSearchState } from '../../../common/types';

export const symbolSearchState: SymbolSearchState = {
	field: undefined!,
	active: false,
	visible: false,
	query: '',
	global: false,
	mode: 'symbols',
	catalog: [],
	referenceCatalog: [],
	catalogContext: null,
	matches: [],
	selectionIndex: -1,
	displayOffset: 0,
	hoverIndex: -1,
};
