import type { CodeEditorPane } from '../editor_pane';
import type { LuaSymbolEntry } from '../../../../../toolchain/ts/lua/semantic_contracts';
import { symbolKindLabel } from '../../../../../toolchain/ts/lua/semantic/model';
import { listGlobalLuaSymbols, listLuaSymbols } from '../../../../editor/contrib/intellisense/engine';
import { subscribeToLuaModelChanges } from '../../../../editor/contrib/intellisense/model_lifetime';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { navigateToLuaDefinition } from '../../../ui/code_tab/activation';
import { SymbolQuickPickProvider } from './quick_pick_provider';
import type { QuickPickItem } from '../../../services/quick_input/provider';

export type SymbolQuickPickItem = QuickPickItem & { readonly symbol: LuaSymbolEntry };

export function buildSymbolQuickPickItems(symbols: readonly LuaSymbolEntry[], scope: 'file' | 'workspace'): SymbolQuickPickItem[] {
	return symbols.map(symbol => {
		const kindAndPosition = `${symbolKindLabel(symbol.kind)} ${symbol.location.range.startLine}:${symbol.location.range.startColumn}`;
		return { symbol, label: symbol.path,
			description: scope === 'file' ? kindAndPosition : symbol.location.path,
			detail: scope === 'file' ? '' : kindAndPosition };
	});
}

export function openSymbolSearch(pane: CodeEditorPane, scope: 'file' | 'workspace'): void {
	const input = pane.input, resource = input.workingCopy.resource;
	pane.code.references.clear();
	pane.editor.quickInput.pick(scope === 'file' ? `SYMBOLS: ${resource.path}` : 'GO TO WORKSPACE SYMBOL',
		scope === 'file' ? 'Type a symbol name' : 'Symbol name, then source path', (_origin, lifetime) => {
			const symbols = scope === 'file'
				? listLuaSymbols(pane.sources, resource.domain, resource.path)
				: listGlobalLuaSymbols(pane.sources, resource.domain);
			lifetime.add(subscribeToLuaModelChanges(editorTextModelService, resource.domain, () => pane.editor.quickInput.hide()));
			return new SymbolQuickPickProvider(buildSymbolQuickPickItems(symbols, scope), scope);
		}, item => navigateToLuaDefinition(pane, resource.domain, item.symbol.location),
		lifetime => lifetime.add({ dispose: input.onWillDispose(() => pane.editor.quickInput.hide()) }));
}
