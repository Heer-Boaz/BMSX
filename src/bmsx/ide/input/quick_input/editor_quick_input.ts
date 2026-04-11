import { ide_state } from '../../core/ide_state';
export { handleSymbolSearchInput } from './editor_symbol_search_input';
export { handleResourceSearchInput } from './editor_resource_search_input';
export { handleSearchInput } from './editor_search_input';
export { handleLineJumpInput } from './editor_line_jump_input';

export function isInlineFieldFocused(): boolean {
	return ide_state.search.active
		|| ide_state.symbolSearch.active
		|| ide_state.resourceSearch.active
		|| ide_state.lineJump.active
		|| ide_state.createResource.active
		|| ide_state.renameController.isActive();
}
