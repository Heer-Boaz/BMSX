import * as constants from '../../../common/constants';
import { showEditorMessage } from '../../../workbench/common/feedback_state';
import type { ReferenceMatchInfo } from './state';
import type { CodeTabContext } from '../../../common/models';
import { symbolSearchPageSize } from '../../ui/view';
import { getTextSnapshot, splitText } from '../../text/source_text';
import { editorDocumentState } from '../../editing/document_state';
import { getCodeTabContexts } from '../../../workbench/ui/code_tab/contexts';
import { symbolSearchState } from '../symbols/search_state';
import { referenceState } from './state';
import {
	buildReferenceCatalogForExpression as buildProjectReferenceCatalog,
	filterReferenceCatalog,
	type ProjectReferenceEnvironment,
	type ReferenceCatalogEntry,
} from './sources';
import { getOrCreateSemanticWorkspace } from '../intellisense/semantic_workspace_sync';

export function buildReferenceSearchCatalog(info: ReferenceMatchInfo, context: CodeTabContext): ReferenceCatalogEntry[] {
	const path = context.descriptor.path;
	const activeLines = splitText(getTextSnapshot(editorDocumentState.buffer));
	const environment: ProjectReferenceEnvironment = {
		activeContext: context,
		activeLines,
		codeTabContexts: getCodeTabContexts(),
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
