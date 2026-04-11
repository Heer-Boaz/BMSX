import * as constants from '../../core/constants';
import { ide_state } from '../../core/ide_state';
import type { ReferenceMatchInfo } from './reference_state';
import type { CodeTabContext } from '../../core/types';
import { symbolSearchPageSize } from '../../ui/editor_view';
import { getTextSnapshot, splitText } from '../../text/source_text';
import {
	buildReferenceCatalogForExpression as buildProjectReferenceCatalog,
	filterReferenceCatalog,
	type ProjectReferenceEnvironment,
	type ReferenceCatalogEntry,
} from './reference_sources';
import { getOrCreateSemanticWorkspace } from '../intellisense/semantic_workspace_sync';

export function buildReferenceSearchCatalog(info: ReferenceMatchInfo, context: CodeTabContext): ReferenceCatalogEntry[] {
	const path = context.descriptor.path;
	const activeLines = splitText(getTextSnapshot(ide_state.buffer));
	const environment: ProjectReferenceEnvironment = {
		activeContext: context,
		activeLines,
		codeTabContexts: Array.from(ide_state.codeTabContexts.values()),
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
		catalog: ide_state.symbolSearch.referenceCatalog,
		query: ide_state.symbolSearch.query,
		state: ide_state.referenceState,
		pageSize: symbolSearchPageSize(),
	});
	ide_state.symbolSearch.matches = matches;
	ide_state.symbolSearch.selectionIndex = selectionIndex;
	ide_state.symbolSearch.displayOffset = displayOffset;
	ide_state.symbolSearch.hoverIndex = -1;
}

export function showReferenceSearchStatusMessage(): void {
	const matches = ide_state.referenceState.getMatches();
	const activeIndex = ide_state.referenceState.getActiveIndex();
	if (matches.length === 0 || activeIndex < 0) {
		return;
	}
	const label = ide_state.referenceState.getExpression() ?? '';
	ide_state.showMessage(`Reference ${activeIndex + 1}/${matches.length} for ${label}`, constants.COLOR_STATUS_SUCCESS, 1.6);
}
