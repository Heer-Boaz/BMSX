import type { CodeEditorPane } from '../editor_pane';
import { queryDefinitionsAt, type LuaDefinitionTarget } from '../../../../editor/contrib/definitions/query';
import { showEditorMessage } from '../../../../common/feedback_state';
import { semanticSymbolKindToLuaSymbolKind } from '../../../../../toolchain/ts/lua/semantic/common';
import { symbolKindLabel } from '../../../../../toolchain/ts/lua/semantic/model';
import { subscribeToLuaModelChanges } from '../../../../editor/contrib/intellisense/model_lifetime';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { navigateToLuaDefinition } from '../../../ui/code_tab/activation';
import { TextQuickPickProvider } from '../../../services/quick_input/text_provider';
import type { QuickPickItem } from '../../../services/quick_input/provider';

export type DefinitionQuickPickItem = QuickPickItem & { readonly target: LuaDefinitionTarget };

export function buildDefinitionQuickPickItems(definitions: readonly LuaDefinitionTarget[]): DefinitionQuickPickItem[] {
	return definitions.map(target => ({ target, label: target.namePath.length === 0 ? target.name : target.namePath.join('.'),
		description: target.resource.path,
		detail: `${target.kind === 'module' ? 'MOD' : symbolKindLabel(semanticSymbolKindToLuaSymbolKind(target.kind))} ${target.location.range.startLine}:${target.location.range.startColumn}`,
	}));
}

export function openDefinitionSearch(pane: CodeEditorPane, row: number, column: number): boolean {
	const input = pane.input, context = input.context;
	const resource = context.model.resource;
	const query = queryDefinitionsAt(pane.sources.catalog, context, row, column);
	if (!query) {
		showEditorMessage('Definition not found', 'warning', 1.6);
		return false;
	}
	if (query.definitions.length === 1) {
		navigateToLuaDefinition(pane, query.definitions[0].resource, query.definitions[0].location);
		return true;
	}
	pane.code.references.clear();
	pane.part.quickInput.pick(`DEFINITIONS: ${query.label}`, 'Type to filter definitions', (_origin, lifetime) => {
		lifetime.add(subscribeToLuaModelChanges(editorTextModelService, pane.sources.catalog, resource.contextId, () => pane.part.quickInput.hide()));
		return new TextQuickPickProvider(buildDefinitionQuickPickItems(query.definitions));
	}, item => navigateToLuaDefinition(pane, item.target.resource, item.target.location),
		lifetime => lifetime.add({ dispose: input.onWillDispose(() => pane.part.quickInput.hide()) }));
	return true;
}
