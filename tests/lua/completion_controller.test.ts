import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LuaCompletionItem, LuaCompletionKind } from '../../src/bmsx/ide/common/models';
import {
	buildCanonicalCompletionItems,
	filterCompletionItems,
	resolveCompletionWordRange,
} from '../../src/bmsx/ide/editor/contrib/suggest/completion_model';

function completionItem(label: string, kind: LuaCompletionKind, sortKey = `${kind}:${label}`, insertText = label): LuaCompletionItem {
	return {
		label,
		insertText,
		sortKey,
		kind,
		detail: kind,
	};
}

test('completion word range covers the current identifier', () => {
	const line = '\tlocal next_value = sprite_directio_tail';
	const identifierStart = line.indexOf('sprite_directio_tail');
	const cursorColumn = identifierStart + 'sprite_directio'.length;
	const range = resolveCompletionWordRange(line, cursorColumn);
	assert.equal(range.prefix, 'sprite_directio');
	assert.equal(range.replacementText, 'sprite_directio_tail');
	assert.equal(range.replaceFromColumn, identifierStart);
	assert.equal(range.replaceToColumn, identifierStart + 'sprite_directio_tail'.length);
});

test('completion candidates are canonical by label with scoped symbols taking precedence', () => {
	const items = buildCanonicalCompletionItems([
		completionItem('sprite_direction', 'global', 'global:game:sprite_direction'),
		completionItem('sprite_direction', 'local', 'local:000228:sprite_direction'),
		completionItem('print', 'builtin', 'builtin:print'),
		completionItem('print', 'global', 'global:game:print'),
	]);
	assert.deepEqual(items.map(item => item.label), ['print', 'sprite_direction']);
	assert.equal(items.find(item => item.label === 'sprite_direction')!.kind, 'local');
	assert.equal(items.find(item => item.label === 'print')!.kind, 'global');
});

test('completion filtering removes no-op current identifiers without hiding method commits', () => {
	const filtered = filterCompletionItems([
		completionItem('sprite_directio', 'global'),
		completionItem('sprite_direction', 'global'),
	], 'sprite_directio', 'sprite_directio');
	assert.deepEqual(filtered.map(item => item.label), ['sprite_direction']);

	const methodFiltered = filterCompletionItems([
		completionItem('draw_frame', 'api_method'),
	], 'draw_frame', 'draw_frame');
	assert.deepEqual(methodFiltered.map(item => item.label), ['draw_frame']);
});
