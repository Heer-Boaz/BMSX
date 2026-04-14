import * as constants from '../../../common/constants';
import { showEditorMessage } from '../../../workbench/common/feedback_state';
import type { ReferenceMatchInfo } from './reference_state';
import type { CodeTabContext } from '../../../common/types';
import { symbolSearchPageSize } from '../../ui/editor_view';
import { getTextSnapshot, splitText } from '../../text/source_text';
import { editorDocumentState } from '../../editing/editor_document_state';
import { editorSessionState } from '../../ui/editor_session_state';
import { symbolSearchState } from '../symbols/symbol_search_state';
import { referenceState } from './reference_state';
import {
	buildReferenceCatalogForExpression as buildProjectReferenceCatalog,
	filterReferenceCatalog,
	type ProjectReferenceEnvironment,
	type ReferenceCatalogEntry,
} from './reference_sources';
import { getOrCreateSemanticWorkspace } from '../intellisense/semantic_workspace_sync';

export function buildReferenceSearchCatalog(info: ReferenceMatchInfo, context: CodeTabContext): ReferenceCatalogEntry[] {
	const path = context.descriptor.path;
	const activeLines = splitText(getTextSnapshot(editorDocumentState.buffer));
	const environment: ProjectReferenceEnvironment = {
		activeContext: context,
		activeLines,
		codeTabContexts: editorSessionState.codeTabContexts.values(),
	};
	return buildProjectReferenceCatalog({
		workspace: getOrCreateSemanticWorkspace(),
		info,
		lines: activeLines,
		path,
		environment,
	});
}

export function updateReferenceSearchMatches(): void {
	const { matches, selectionIndex, displayOffset } = filterReferenceCatalog({
		catalog: symbolSearchState.referenceCatalog,
		query: symbolSearchState.query,
		state: referenceState,
		pageSize: symbolSearchPageSize(),
	});
	symbolSearchState.matches = matches;
	symbolSearchState.selectionIndex = selectionIndex;
	symbolSearchState.displayOffset = displayOffset;
	symbolSearchState.hoverIndex = -1;
}

export function showReferenceSearchStatusMessage(): void {
	const matches = referenceState.getMatches();
	const activeIndex = referenceState.getActiveIndex();
	if (matches.length === 0 || activeIndex < 0) {
		return;
	}
	const label = referenceState.getExpression() ?? '';
	showEditorMessage(`Reference ${activeIndex + 1}/${matches.length} for ${label}`, constants.COLOR_STATUS_SUCCESS, 1.6);
}
