import type { RuntimeSourceState } from '../../../../runtime/sources';
import type { CartEditor } from '../../../../cart_editor';
import { queryDefinitionsAt, type LuaDefinitionTarget } from '../../../../editor/contrib/definitions/query';
import { showEditorMessage } from '../../../../common/feedback_state';
import { semanticSymbolKindToLuaSymbolKind } from '../../../../../toolchain/ts/lua/semantic/common';
import { symbolKindLabel } from '../../../../../toolchain/ts/lua/semantic/model';
import { clearReferenceHighlights } from '../../../../editor/contrib/intellisense/engine';
import { subscribeToLuaModelChanges } from '../../../../editor/contrib/intellisense/model_lifetime';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { getActiveCodeTabContext } from '../../../ui/code_tab/contexts';
import { navigateToLuaDefinition } from '../../../ui/code_tab/activation';
import { TextQuickPickProvider } from '../../../services/quick_input/text_provider';
import type { QuickPickItem } from '../../../services/quick_input/provider';

export type DefinitionQuickPickItem = QuickPickItem & { readonly target: LuaDefinitionTarget };

export function buildDefinitionQuickPickItems(definitions: readonly LuaDefinitionTarget[]): DefinitionQuickPickItem[] {
	return definitions.map(target => ({ target, label: target.namePath.length === 0 ? target.name : target.namePath.join('.'),
		description: target.location.path,
		detail: `${target.kind === 'module' ? 'MOD' : symbolKindLabel(semanticSymbolKindToLuaSymbolKind(target.kind))} ${target.location.range.startLine}:${target.location.range.startColumn}`,
	}));
}

export function openDefinitionSearch(sources: RuntimeSourceState, editor: CartEditor, row: number, column: number): boolean {
	const context = getActiveCodeTabContext(editor.editorGroup);
	const resource = context.model.resource;
	const query = queryDefinitionsAt(sources, context, row, column);
	if (!query) {
		showEditorMessage('Definition not found', 'warning', 1.6);
		return false;
	}
	if (query.definitions.length === 1) {
		navigateToLuaDefinition(editor, resource.domain, query.definitions[0].location);
		return true;
	}
	clearReferenceHighlights();
	editor.quickInput.pick(`DEFINITIONS: ${query.label}`, 'Type to filter definitions', (_origin, lifetime) => {
		lifetime.add(subscribeToLuaModelChanges(editorTextModelService, resource.domain, () => editor.quickInput.hide()));
		return new TextQuickPickProvider(buildDefinitionQuickPickItems(query.definitions));
	}, item => navigateToLuaDefinition(editor, resource.domain, item.target.location));
	return true;
}
