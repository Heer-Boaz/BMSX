import { resourceIdentityKey, type ResourceIdentity } from '../../../../common/resource';
import type { CodeEditorPane } from '../editor_pane';
import { showEditorMessage } from '../../../../common/feedback_state';
import { resolveReferenceLookup } from '../../../../editor/contrib/references/lookup';
import { buildReferenceSources, type ReferenceSource } from '../../../../editor/contrib/references/sources';
import { sourcePositionInRange } from '../../../../../toolchain/ts/lua/semantic/source_range';
import { definitionLocationFromSourceRange } from '../../../../editor/navigation/source_range';
import { subscribeToLuaModelChanges } from '../../../../editor/contrib/intellisense/model_lifetime';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { navigateToLuaDefinition } from '../../../ui/code_tab/activation';
import { TextQuickPickProvider } from '../../../services/quick_input/text_provider';
import type { QuickPickItem } from '../../../services/quick_input/provider';

export type ReferenceQuickPickItem = QuickPickItem & { readonly source: ReferenceSource };

export function createReferenceQuickPickProvider(
	sources: readonly ReferenceSource[], identity: ResourceIdentity, line: number, column: number,
): TextQuickPickProvider<ReferenceQuickPickItem> {
	let initialItemIndex = 0;
	const items = sources.map((source, index) => {
		const range = source.range;
		if (range.path === resourceIdentityKey(identity) && sourcePositionInRange(line, column, range)) initialItemIndex = index;
		return { source, label: source.lineText, description: source.resource.path,
			detail: `${source.kind === 'definition' ? 'DEF' : 'REF'} ${range.start.line}:${range.start.column}` };
	});
	return new TextQuickPickProvider(items, initialItemIndex);
}

export function openReferenceSearch(pane: CodeEditorPane): void {
	const input = pane.input, { model, view } = input.context;
	const { resource } = model;
	const row = view.cursorRow, column = view.cursorColumn;
	const result = resolveReferenceLookup(pane.sources.catalog, { buffer: model.buffer, cursorRow: row, cursorColumn: column, identity: resource });
	if (result.kind === 'error') {
		showEditorMessage(result.message, 'warning', result.duration);
		return;
	}
	const references = buildReferenceSources(result.info);
	if (references.length === 0) {
		showEditorMessage('No references found', 'warning', 1.6);
		return;
	}
	pane.code.references.clear();
	pane.editor.quickInput.pick(`REFERENCES: ${result.info.expression}`, 'Type to filter references', (_origin, lifetime) => {
		pane.code.references.apply(result.info, result.initialIndex);
		lifetime.add({ dispose: () => pane.code.references.clear() });
		lifetime.add(subscribeToLuaModelChanges(editorTextModelService, pane.sources.catalog, resource.contextId, () => pane.editor.quickInput.hide()));
		return createReferenceQuickPickProvider(references, resource, row + 1, column + 1);
	}, item => navigateToLuaDefinition(pane, item.source.resource, definitionLocationFromSourceRange(item.source.range)),
		lifetime => lifetime.add({ dispose: input.onWillDispose(() => pane.editor.quickInput.hide()) }));
}
