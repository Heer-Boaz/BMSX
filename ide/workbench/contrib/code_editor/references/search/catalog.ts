import * as constants from '../../../../../common/constants';
import { showEditorMessage } from '../../../../../common/feedback_state';
import type { ReferenceMatchInfo } from '../../../../../editor/contrib/references/state';
import type { SymbolCatalogEntry } from '../../../../../common/models';
import type { CodeTabContext } from '../../../../ui/code_tab/model';
import { getLinesSnapshot } from '../../../../../editor/text/source_text';
import { editorDocumentState } from '../../../../../editor/editing/document_state';
import { referenceState } from '../../../../../editor/contrib/references/state';
import {
	buildReferenceCatalog,
} from '../../../../../editor/contrib/references/sources';

export function buildReferenceSearchCatalog(info: ReferenceMatchInfo, context: CodeTabContext): SymbolCatalogEntry[] {
	const path = context.resource.path;
	const activeLines = getLinesSnapshot(editorDocumentState.buffer);
	return buildReferenceCatalog({
		info,
		lines: activeLines,
		path,
	});
}

export function showReferenceSearchStatusMessage(): void {
	const matches = referenceState.getMatches();
	const activeIndex = referenceState.getActiveIndex();
	if (matches.length === 0 || activeIndex < 0) {
		return;
	}
	const label = referenceState.getExpression();
	showEditorMessage(`Reference ${activeIndex + 1}/${matches.length} for ${label}`, constants.COLOR_STATUS_SUCCESS, 1.6);
}
