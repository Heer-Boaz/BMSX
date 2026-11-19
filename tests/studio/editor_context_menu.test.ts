import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeContextMenuItems } from '../../ide/workbench/contrib/code_editor/context_menu';
import type { EditorContextToken } from '../../ide/common/models';
import { WORKBENCH_MENUS } from '../../ide/workbench/ui/menu/registry';

test('source context menu does not classify identifiers by builtin spelling', () => {
	for (const expression of ['os', 'os.clock', 'table', 'string', 'load', 'print', 'lua_compiler', 'actor']) {
		const token: EditorContextToken = {
			kind: 'identifier', text: expression, expression,
			row: 0, column: 0, startColumn: 0, endColumn: expression.length,
		};
		assert.equal(codeContextMenuItems(token), WORKBENCH_MENUS['code.symbol.context'], expression);
	}
	assert.equal(codeContextMenuItems(null), WORKBENCH_MENUS['code.context']);
});
