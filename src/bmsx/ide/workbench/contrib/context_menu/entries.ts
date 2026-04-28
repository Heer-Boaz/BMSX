import { DEFAULT_LUA_BUILTIN_NAMES } from '../../../../machine/firmware/builtin_descriptors';
import { resolveLuaIdentifierChainRoot } from '../../../language/lua/identifier_chain';
import type { EditorContextMenuEntry, EditorContextToken } from '../../../common/models';
import type { Runtime } from '../../../../machine/runtime/runtime';

export function buildEditorContextMenuEntries(runtime: Runtime, token: EditorContextToken, editable: boolean): EditorContextMenuEntry[] {
	if (token.kind !== 'identifier' || !token.expression || token.expression.length === 0) {
		return [];
	}
	if (isBuiltinContextExpression(runtime, token.expression)) {
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

function isBuiltinContextExpression(runtime: Runtime, expression: string): boolean {
	const root = resolveLuaIdentifierChainRoot(expression);
	if (root.length === 0) {
		return false;
	}
	const name = root.trim();
	if (runtime.luaBuiltinMetadata.has(name)) {
		return true;
	}
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_NAMES.length; index += 1) {
		if (DEFAULT_LUA_BUILTIN_NAMES[index] === name) {
			return true;
		}
	}
	return false;
}
