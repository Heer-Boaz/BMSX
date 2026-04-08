import { ide_state } from '../ide_state';
export { handleSymbolSearchInput } from './editor_symbol_search_input';
export { handleResourceSearchInput } from './editor_resource_search_input';
export { handleSearchInput } from './editor_search_input';
export { handleLineJumpInput } from './editor_line_jump_input';

export function isInlineFieldFocused(): boolean {
	return ide_state.searchActive
		|| ide_state.symbolSearchActive
		|| ide_state.resourceSearchActive
		|| ide_state.lineJumpActive
		|| ide_state.createResourceActive
		|| ide_state.renameController.isActive();
}
