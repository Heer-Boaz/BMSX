import type { CodeEditorPane } from '../editor_pane';
import type { EditorLuaSymbolEntry } from '../../../../editor/contrib/intellisense/engine';
import { symbolKindLabel } from '../../../../../toolchain/ts/lua/semantic/model';
import { listGlobalLuaSymbols, listLuaSymbols } from '../../../../editor/contrib/intellisense/engine';
import { subscribeToLuaModelChanges } from '../../../../editor/contrib/intellisense/model_lifetime';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { navigateToLuaDefinition } from '../../../ui/code_tab/activation';
import { SymbolQuickPickProvider } from './quick_pick_provider';
import type { QuickPickItem } from '../../../services/quick_input/provider';

export type SymbolQuickPickItem = QuickPickItem & { readonly symbol: EditorLuaSymbolEntry };

export function buildSymbolQuickPickItems(symbols: readonly EditorLuaSymbolEntry[], scope: 'file' | 'workspace'): SymbolQuickPickItem[] {
	return symbols.map(symbol => {
		const kindAndPosition = `${symbolKindLabel(symbol.kind)} ${symbol.location.range.startLine}:${symbol.location.range.startColumn}`;
		return { symbol, label: symbol.path,
			description: scope === 'file' ? kindAndPosition : symbol.resource.path,
			detail: scope === 'file' ? '' : kindAndPosition };
	});
}

export function openSymbolSearch(pane: CodeEditorPane, scope: 'file' | 'workspace'): void {
	const input = pane.input, resource = input.workingCopy.resource;
	pane.code.references.clear();
	pane.part.quickInput.pick(scope === 'file' ? `SYMBOLS: ${resource.path}` : 'GO TO WORKSPACE SYMBOL',
		scope === 'file' ? 'Type a symbol name' : 'Symbol name, then source path', (_origin, lifetime) => {
			const symbols = scope === 'file'
				? listLuaSymbols(pane.sources.catalog, resource.contextId, resource.path)
				: listGlobalLuaSymbols(pane.sources.catalog, resource.contextId);
			lifetime.add(subscribeToLuaModelChanges(editorTextModelService, pane.sources.catalog, resource.contextId, () => pane.part.quickInput.hide()));
			return new SymbolQuickPickProvider(buildSymbolQuickPickItems(symbols, scope), scope);
		}, item => navigateToLuaDefinition(pane, item.symbol.resource, item.symbol.location),
		lifetime => lifetime.add({ dispose: input.onWillDispose(() => pane.part.quickInput.hide()) }));
}
