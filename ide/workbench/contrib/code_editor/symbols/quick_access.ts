import type { CartEditor } from '../../../../cart_editor';
import type { RuntimeLuaTooling } from '../../../../runtime/lua_tooling';
import type { LuaSymbolEntry } from '../../../../../toolchain/ts/lua/semantic_contracts';
import { symbolKindLabel } from '../../../../../toolchain/ts/lua/semantic/model';
import { clearReferenceHighlights, listGlobalLuaSymbols, listLuaSymbols } from '../../../../editor/contrib/intellisense/engine';
import { subscribeToLuaModelChanges } from '../../../../editor/contrib/intellisense/model_lifetime';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { navigateToLuaDefinition } from '../../../ui/code_tab/activation';
import { getActiveCodeTabContext } from '../../../ui/code_tab/contexts';
import { TextQuickPickProvider } from '../../../services/quick_input/text_provider';
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

export function openSymbolSearch(editor: CartEditor, bridge: RuntimeLuaTooling, scope: 'file' | 'workspace'): void {
	const resource = getActiveCodeTabContext().model.resource;
	clearReferenceHighlights();
	editor.quickInput.pick(scope === 'file' ? `SYMBOLS: ${resource.path}` : 'GO TO WORKSPACE SYMBOL', 'Type to filter symbols', (_origin, lifetime) => {
		const symbols = scope === 'file'
			? listLuaSymbols(bridge, resource.domain, resource.path)
			: listGlobalLuaSymbols(bridge, resource.domain);
		lifetime.add(subscribeToLuaModelChanges(editorTextModelService, resource.domain, () => editor.quickInput.hide()));
		return new TextQuickPickProvider(buildSymbolQuickPickItems(symbols, scope));
	}, item => navigateToLuaDefinition(editor, resource.domain, item.symbol.location));
}
