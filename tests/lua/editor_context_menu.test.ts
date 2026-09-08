import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEditorContextMenuEntries } from '../../ide/workbench/contrib/context_menu/entries';
import type { EditorContextToken } from '../../ide/common/models';

test('source context menu does not classify identifiers by builtin spelling', () => {
	for (const expression of ['os', 'os.clock', 'table', 'string', 'load', 'print', 'lua_compiler', 'actor']) {
		const token: EditorContextToken = {
			kind: 'identifier', text: expression, expression,
			row: 0, column: 0, startColumn: 0, endColumn: expression.length,
		};
		assert.deepEqual(buildEditorContextMenuEntries(token, true).map(entry => entry.action),
			['goToDefinition', 'referenceSearch', 'callHierarchy', 'rename'], expression);
		assert.deepEqual(buildEditorContextMenuEntries(token, false).map(entry => entry.action),
			['goToDefinition', 'referenceSearch', 'callHierarchy'], `readonly ${expression}`);
	}
});
