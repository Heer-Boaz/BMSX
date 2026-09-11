import assert from 'node:assert/strict';
import test from 'node:test';
import type { LuaSymbolEntry } from '../../toolchain/ts/lua/semantic_contracts';
import { buildSymbolQuickPickItems } from '../../ide/workbench/contrib/code_editor/symbols/quick_access';
import { SymbolQuickPickProvider } from '../../ide/workbench/contrib/code_editor/symbols/quick_pick_provider';
import { QuickPickHighlightSet } from '../../ide/workbench/services/quick_input/highlight_set';
import type { QuickPickHighlight, QuickPickProjection } from '../../ide/workbench/services/quick_input/provider';

function fixture(scope: 'file' | 'workspace', declarations: [string, string][]) {
	const symbols: LuaSymbolEntry[] = declarations.map(([path, source], index) => ({ name: path, path, kind: 'function',
		location: { path: source, range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: path.length + 1 } } }));
	const items = buildSymbolQuickPickItems(symbols, scope);
	return { symbols, items, provider: new SymbolQuickPickProvider(items, scope) };
}

function ranges(picks: QuickPickProjection, row = 0): QuickPickHighlight[] {
	const match = picks.matches[row], result: QuickPickHighlight[] = [];
	for (let index = match.highlightStart; index < match.highlightEnd; index += 1) result.push({ ...picks.highlights.peek(index) });
	return result;
}

test('document symbol queries score qualified names, not incidental kind/line metadata', () => {
	const { items, provider } = fixture('file', [['actor.spawn_enemy', 'actors.lua'], ['spawn_enemy', 'actors.lua'], ['other_action', 'actors.lua']]);
	const projection = provider.getPicks('spwn');
	assert.equal(projection.matches.length, 2); assert.equal(projection.matches[0].item, items[1]);
	assert.deepEqual(ranges(projection), [{ field: 'label', start: 0, end: 2 }, { field: 'label', start: 3, end: 5 }]);
	assert.equal(provider.getPicks('actor spawn').matches[0].item, items[0], 'the whole normalized query can match a qualified symbol');
	assert.equal(provider.getPicks('FUNC').matches.length, 0);
	assert.equal(provider.getPicks('spwn actors.lua').matches.length, 0, 'document mode has no hidden file qualifier field');
});

test('workspace symbols accept all source-path qualifiers and keep original same-name declarations', () => {
	const { items, provider } = fixture('workspace', [['spawn_enemy', 'controller/actors.lua'], ['spawn_enemy', 'other/actors.lua'], ['other_action', 'controller/actors.lua']]);
	let picks = provider.getPicks('spwn cntr actors cntr');
	assert.equal(picks.matches.length, 1); assert.equal(picks.matches[0].item, items[0]);
	const fields = ranges(picks);
	assert.ok(fields.some(range => range.field === 'label'));
	const fileRanges = fields.filter(range => range.field === 'description');
	assert.ok(fileRanges.length > 0);
	for (let index = 1; index < fileRanges.length; index += 1) assert.ok(fileRanges[index - 1].end < fileRanges[index].start, 'path ranges are a nonoverlapping union');
	assert.ok(fileRanges.some(range => items[0].description.slice(range.start, range.end).includes('actors')));
	picks = provider.getPicks('SPWN other');
	assert.equal(picks.matches[0].item, items[1]);
	picks = provider.getPicks('spwn missing');
	assert.equal(picks.matches.length, 0); assert.equal(picks.highlights.length, 0);
	picks = provider.getPicks('spwn');
	assert.deepEqual(picks.matches.map(match => match.item), items.slice(0, 2));
	for (let row = 0; row < 2; row += 1) assert.ok(ranges(picks, row).every(range => range.field === 'label'), 'old path ranges are not retained on the next query');
});

test('zero/negative symbol scores remain selectable and projection storage survives query changes', () => {
	const { provider, items } = fixture('file', [['__foo', 'source.lua'], ['a'.repeat(160) + 'Z', 'source.lua']]);
	const picks = provider.getPicks(''), rows = picks.matches, entries = [...rows], highlights = picks.highlights;
	assert.deepEqual(rows.map(row => row.item), items);
	assert.equal(provider.getPicks('f').matches[0].item, items[0]); // score 0
	assert.equal(provider.getPicks('aZ').matches[0].item, items[1]); // negative score
	assert.deepEqual(ranges(picks), [{ field: 'label', start: 0, end: 1 }, { field: 'label', start: 160, end: 161 }]);
	for (const query of ['a'.repeat(150), 'unknown', '', 'f']) {
		assert.equal(provider.getPicks(query), picks); assert.equal(picks.matches, rows); assert.equal(picks.highlights, highlights);
		for (const row of rows) assert.equal(row, entries[row.itemIndex]);
	}
	assert.equal(provider.getPicks('missing').selectionIndex, -1);
	assert.equal(provider.getPicks('').selectionIndex, 0);
	assert.equal(new SymbolQuickPickProvider([], 'workspace').getPicks('').selectionIndex, -1);
});

test('symbol and source-path highlights retain original UTF-16 positions across expanded case folds', () => {
	const { provider } = fixture('workspace', [['İ.owner_source', 'İ🦉/controller.lua']]);
	let picks = provider.getPicks('İos');
	assert.deepEqual(ranges(picks), [{ field: 'label', start: 0, end: 1 }, { field: 'label', start: 2, end: 3 }, { field: 'label', start: 8, end: 9 }]);
	picks = provider.getPicks('os ctrl');
	const item = picks.matches[0].item;
	assert.equal(ranges(picks).filter(range => range.field === 'description').map(range => item.description.slice(range.start, range.end)).join(''), 'ctrl');
});

test('shared highlight normalization unions only the same field and retains its candidate/output arrays', () => {
	const set = new QuickPickHighlightSet();
	for (const range of [
		{ field: 'label' as const, start: 5, end: 8 }, { field: 'description' as const, start: 0, end: 4 },
		{ field: 'label' as const, start: 0, end: 6 }, { field: 'description' as const, start: 1, end: 3 },
		{ field: 'detail' as const, start: 2, end: 4 }, { field: 'label' as const, start: 8, end: 9 },
	]) Object.assign(set.ranges.get(set.ranges.length), range);
	const result = set.normalize();
	assert.deepEqual(result, [{ field: 'description', start: 0, end: 4 }, { field: 'detail', start: 2, end: 4 }, { field: 'label', start: 0, end: 9 }]);
	assert.equal(set.normalize(), result);
	set.ranges.clear();
	assert.equal(set.normalize(), result); assert.equal(result.length, 0);
	Object.assign(set.ranges.get(0), { field: 'label', start: 3, end: 4 });
	assert.deepEqual(set.normalize(), [{ field: 'label', start: 3, end: 4 }]);
});
