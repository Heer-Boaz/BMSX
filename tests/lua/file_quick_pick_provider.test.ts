import assert from 'node:assert/strict';
import test from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import type { RuntimeResource } from '../../ide/common/resource';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import type { QuickPickProjection } from '../../ide/workbench/services/quick_input/provider';
import { buildResourceQuickPickItems } from '../../ide/workbench/contrib/resources/quick_access';
import { FileQuickPickProvider } from '../../ide/workbench/contrib/resources/quick_pick_provider';

function fixture(paths: string[]) {
	const resources: RuntimeResource[] = paths.map(path => ({ domain: 0, path, source: { resid: path, type: 'lua' } }));
	const items = buildResourceQuickPickItems(resources);
	return { resources, items, provider: new FileQuickPickProvider(items) };
}

function ranges(projection: QuickPickProjection, path: string): [number, number][] {
	const match = projection.matches.find(match => match.item.label === path)!;
	const result: [number, number][] = [];
	for (let index = match.highlightStart; index < match.highlightEnd; index += 1) {
		const range = projection.highlights.peek(index);
		assert.equal(range.field, 'label', 'metadata is context, not another filename');
		result.push([range.start, range.end]);
	}
	return result;
}

test('file queries prefer basename prefixes, then basename abbreviations over directory-only matches', () => {
	const { provider } = fixture(['controller/archive.lua', 'src/controller_extension.lua', 'src/controller.lua', 'src/config_loader.lua']);
	assert.deepEqual(provider.getPicks('controller').matches.map(match => match.item.label),
		['src/controller.lua', 'src/controller_extension.lua', 'controller/archive.lua']);
	const picks = provider.getPicks('cfl');
	assert.equal(picks.matches[0].item.label, 'src/config_loader.lua');
	// Equal separator bonuses use the production recurrence's rightmost tie.
	assert.deepEqual(ranges(picks, 'src/config_loader.lua'), [[4, 5], [7, 8], [18, 19]]);
	assert.equal(provider.getPicks('controller/archive.lua').matches[0].item.label, 'controller/archive.lua');
	assert.equal(provider.getPicks('CONTROLLER\\ARCHIVE.LUA').matches[0].item.label, 'controller/archive.lua');
	assert.equal(provider.getPicks('src/config').matches[0].item.label, 'src/config_loader.lua');
	assert.equal(provider.getPicks('LUA / SLOT 0').matches.length, 0, 'display metadata does not turn unrelated files into matches');
});

test('all query terms must match, and repeated/reordered ranges merge without losing basename offsets', () => {
	const { provider } = fixture(['scene/banana.lua', 'other/banana.lua', 'scene/apple.lua']);
	const picks = provider.getPicks('ANA scene ban ANA');
	assert.deepEqual(picks.matches.map(match => match.item.label), ['scene/banana.lua']);
	assert.deepEqual(ranges(picks, 'scene/banana.lua'), [[0, 5], [6, 12]]);
	provider.getPicks('banana scene');
	assert.deepEqual(ranges(picks, 'scene/banana.lua'), [[0, 5], [6, 12]]);
	provider.getPicks('scene banana absent');
	assert.equal(picks.matches.length, 0); assert.equal(picks.highlights.length, 0);
	provider.getPicks('apple');
	assert.deepEqual(ranges(picks, 'scene/apple.lua'), [[6, 11]], 'rejection cannot leak candidate scratch ranges into the next query');
});

test('file query source ranges account for case-fold expansion both before and inside the basename', () => {
	const path = 'İ🦉/İ_source_index.lua';
	const { provider } = fixture([path]);
	let picks = provider.getPicks('srcidx');
	const marked = ranges(picks, path).map(([start, end]) => path.slice(start, end)).join('');
	assert.equal(marked, 'srcidx');
	picks = provider.getPicks('İ');
	assert.deepEqual(ranges(picks, path), [[4, 5]]);
	picks = provider.getPicks('İ🦉/İ_srcidx');
	assert.equal(ranges(picks, path).map(([start, end]) => path.slice(start, end)).join(''), 'İ🦉/İ_srcidx');
});

test('file queries have no path/pattern cutoff and reuse result records across shrinking and growing queries', () => {
	const path = `deep/${'long_directory/'.repeat(12)}${'a'.repeat(140)}_source.lua`;
	const { provider, items } = fixture(['other.lua', path]);
	const projection = provider.getPicks(''), matches = projection.matches, records = [...matches], highlights = projection.highlights;
	assert.deepEqual(matches.map(match => match.item), items, 'empty query preserves owner catalog order');
	for (const query of ['a'.repeat(130), 'source', path, 'long_directory source', 'absent', '']) {
		assert.equal(provider.getPicks(query), projection); assert.equal(projection.matches, matches); assert.equal(projection.highlights, highlights);
		for (const match of matches) assert.equal(match, records[match.itemIndex]);
		if (query !== 'absent' && query !== '') assert.equal(matches[0].item, items[1]);
		if (query === path) assert.deepEqual(ranges(projection, path), [[0, path.length]]);
	}
	assert.equal(highlights.length, 0);
	assert.equal(provider.getPicks('absent').selectionIndex, -1);
	assert.equal(provider.getPicks('').selectionIndex, 0);
	assert.equal(new FileQuickPickProvider([]).getPicks('').selectionIndex, -1);
});

test('same-path files from two sockets retain distinct original resources through shared picker acceptance', t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const resources: RuntimeResource[] = [0, 1].map(domain => ({ domain: domain as 0 | 1, path: 'shared/source.lua',
		source: { resid: `module_${domain}`, type: 'lua' } }));
	const items = buildResourceQuickPickItems(resources);
	const provider = new FileQuickPickProvider(items);
	const picker = new QuickInputController({ text: '', isSupported: () => false, writeText: async () => {} });
	t.after(() => picker.dispose());
	let accepted: RuntimeResource | undefined;
	picker.pick('FILES', 'query', () => provider, item => { accepted = item.resource; });
	picker.model.filter('src'); picker.update();
	assert.deepEqual(picker.model.list.rows.map(row => row.item), items);
	assert.equal(picker.model.list.rows[1].item.description, 'LUA / SLOT 1');
	picker.model.list.selectionIndex = 1;
	picker.accept();
	assert.equal(accepted, resources[1]); assert.equal(accepted.source, resources[1].source);
	assert.equal(picker.visible, false);
});
