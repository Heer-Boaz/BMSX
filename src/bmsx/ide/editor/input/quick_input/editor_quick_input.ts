import { renameController } from '../../contrib/rename/rename_controller';
import { editorFeatureState } from '../../common/editor_feature_state';
export { handleSymbolSearchInput } from './editor_symbol_search_input';
export { handleResourceSearchInput } from './editor_resource_search_input';
export { handleSearchInput } from './editor_search_input';
export { handleLineJumpInput } from './editor_line_jump_input';

export function isInlineFieldFocused(): boolean {
	return editorFeatureState.search.active
		|| editorFeatureState.symbolSearch.active
		|| editorFeatureState.resourceSearch.active
		|| editorFeatureState.lineJump.active
		|| editorFeatureState.createResource.active
		|| renameController.isActive();
}
