import { DEFAULT_LUA_BUILTIN_NAMES } from '../../../../emulator/lua_builtin_descriptors';
import { Runtime } from '../../../../emulator/runtime';
import { resolveLuaIdentifierChainRoot } from '../../../language/lua/lua_identifier_chain';
import type { EditorContextMenuEntry, EditorContextToken } from '../../../common/types';

export function buildEditorContextMenuEntries(token: EditorContextToken, editable: boolean): EditorContextMenuEntry[] {
	if (token.kind !== 'identifier' || !token.expression || token.expression.length === 0) {
		return [];
	}
	if (isBuiltinContextExpression(token.expression)) {
		return [];
	}
	const entries: EditorContextMenuEntry[] = [
		{ action: 'goToDefinition', label: 'Go to Definition', enabled: true },
		{ action: 'referenceSearch', label: 'Go to References', enabled: true },
		{ action: 'callHierarchy', label: 'Show Call Hierarchy', enabled: true },
	];
	if (editable) {
		entries.push({ action: 'rename', label: 'Rename Symbol', enabled: true });
	}
	return entries;
}

function isBuiltinContextExpression(expression: string): boolean {
	const root = resolveLuaIdentifierChainRoot(expression);
	if (root.length === 0) {
		return false;
	}
	const name = root.trim();
	if (Runtime.instance.luaBuiltinMetadata.has(name)) {
		return true;
	}
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_NAMES.length; index += 1) {
		if (DEFAULT_LUA_BUILTIN_NAMES[index] === name) {
			return true;
		}
	}
	return false;
}
