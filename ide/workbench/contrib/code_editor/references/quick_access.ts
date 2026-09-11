import type { CartEditor } from '../../../../cart_editor';
import type { RuntimeLuaTooling } from '../../../../runtime/lua_tooling';
import { showEditorMessage } from '../../../../common/feedback_state';
import { COLOR_STATUS_WARNING } from '../../../../common/constants';
import { referenceState } from '../../../../editor/contrib/references/state';
import { resolveReferenceLookup } from '../../../../editor/contrib/references/lookup';
import { buildReferenceSources, type ReferenceSource } from '../../../../editor/contrib/references/sources';
import { sourcePositionInRange } from '../../../../../toolchain/ts/lua/semantic/source_range';
import { definitionLocationFromSourceRange } from '../../../../editor/navigation/source_range';
import { clearReferenceHighlights } from '../../../../editor/contrib/intellisense/engine';
import { subscribeToLuaModelChanges } from '../../../../editor/contrib/intellisense/model_lifetime';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { getActiveCodeTabContext } from '../../../ui/code_tab/contexts';
import { navigateToLuaDefinition } from '../../../ui/code_tab/activation';
import { TextQuickPickProvider } from '../../../services/quick_input/text_provider';
import type { QuickPickItem } from '../../../services/quick_input/provider';

export type ReferenceQuickPickItem = QuickPickItem & { readonly source: ReferenceSource };

export function createReferenceQuickPickProvider(
	sources: readonly ReferenceSource[], path: string, line: number, column: number,
): TextQuickPickProvider<ReferenceQuickPickItem> {
	let initialItemIndex = 0;
	const items = sources.map((source, index) => {
		const range = source.range;
		if (range.path === path && sourcePositionInRange(line, column, range)) initialItemIndex = index;
		return { source, label: source.lineText, description: range.path,
			detail: `${source.kind === 'definition' ? 'DEF' : 'REF'} ${range.start.line}:${range.start.column}` };
	});
	return new TextQuickPickProvider(items, initialItemIndex);
}

export function openReferenceSearch(editor: CartEditor, bridge: RuntimeLuaTooling): void {
	const { model, view } = getActiveCodeTabContext();
	const { resource } = model;
	const row = view.cursorRow, column = view.cursorColumn;
	const result = resolveReferenceLookup(bridge, { buffer: model.buffer, cursorRow: row, cursorColumn: column, identity: resource });
	if (result.kind === 'error') {
		showEditorMessage(result.message, COLOR_STATUS_WARNING, result.duration);
		return;
	}
	const sources = buildReferenceSources(result.info);
	if (sources.length === 0) {
		showEditorMessage('No references found', COLOR_STATUS_WARNING, 1.6);
		return;
	}
	clearReferenceHighlights();
	editor.quickInput.pick(`REFERENCES: ${result.info.expression}`, 'Type to filter references', (_origin, lifetime) => {
		referenceState.apply(result.info, result.initialIndex);
		lifetime.add({ dispose: () => referenceState.clear() });
		lifetime.add(subscribeToLuaModelChanges(editorTextModelService, resource.domain, () => editor.quickInput.hide()));
		return createReferenceQuickPickProvider(sources, resource.path, row + 1, column + 1);
	}, item => navigateToLuaDefinition(editor, resource.domain, definitionLocationFromSourceRange(item.source.range)));
}
