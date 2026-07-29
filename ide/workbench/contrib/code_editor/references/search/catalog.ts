import * as constants from '../../../../../common/constants';
import { showEditorMessage } from '../../../../../common/feedback_state';
import type { ReferenceMatchInfo } from '../../../../../editor/contrib/references/state';
import type { SymbolCatalogEntry } from '../../../../../common/models';
import type { CodeTabContext } from '../../../../ui/code_tab/model';
import { symbolSearchPageSize } from '../../../../common/layout';
import { getLinesSnapshot, getTextSnapshot } from '../../../../../editor/text/source_text';
import { editorDocumentState } from '../../../../../editor/editing/document_state';
import { getCodeTabContexts } from '../../../../ui/code_tab/contexts';
import { symbolSearchState } from '../../symbols/search/state';
import { referenceState } from '../../../../../editor/contrib/references/state';
import {
	buildReferenceCatalogForExpression as buildProjectReferenceCatalog,
	filterReferenceCatalog,
} from '../../../../../editor/contrib/references/sources';
import { getOrCreateSemanticWorkspace } from '../../../../../editor/contrib/intellisense/semantic/workspace/state';
import type { RuntimeLuaTooling } from '../../../../../runtime/lua_tooling';

export function buildReferenceSearchCatalog(bridge: RuntimeLuaTooling, info: ReferenceMatchInfo, context: CodeTabContext): SymbolCatalogEntry[] {
	const path = context.resource.path;
	const activeSource = getTextSnapshot(editorDocumentState.buffer);
	const activeLines = getLinesSnapshot(editorDocumentState.buffer);
	return buildProjectReferenceCatalog(bridge, {
		workspace: getOrCreateSemanticWorkspace(context.resource.domain),
		info,
		source: activeSource,
		lines: activeLines,
		path,
		activeContext: context,
		codeTabContexts: getCodeTabContexts(),
	});
}

export function updateReferenceSearchMatches(): void {
	const { matches, selectionIndex, displayOffset } = filterReferenceCatalog({
		catalog: symbolSearchState.referenceCatalog,
		query: symbolSearchState.query,
		activeCatalogIndex: referenceState.getActiveIndex(),
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
