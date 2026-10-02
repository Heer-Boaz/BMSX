import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMap, isSeq, type Node } from 'yaml';
import { parseStructuredSource, createStructuredInsertionEdit, createStructuredRemovalEdit, createStructuredValueEdit, type StructuredCollection } from '../../ide/language/yaml/structured_edits';
import type { EditorTextEdit } from '../../ide/editor/model/text_model';

function apply(source: string, edit: EditorTextEdit): string { return source.slice(0, edit.offset) + edit.text + source.slice(edit.offset + edit.deleteLength); }
function collection(source: string, path: readonly (string | number)[] = [], format: 'yaml' | 'json' = 'yaml'): StructuredCollection {
	const doc = parseStructuredSource(source, format);
	const node = doc.getIn(path, true) as Node;
	assert.ok(isMap(node) || isSeq(node));
	return node as StructuredCollection;
}

test('structured insertion edits only the owning collection and retains sibling bytes', () => {
	for (const newline of ['\n', '\r\n']) {
		const source = ['# authored', 'events:', '  first:', '    channel: "sfx" # keep quote/comment', '    rules: []', '  second: {rules: []} # sibling', 'metadata: \'unchanged\'', ''].join(newline);
		const target = collection(source, ['events', 'first']);
		const next = apply(source, createStructuredInsertionEdit(source, 'yaml', target, '"queue"', 'policy'));
		assert.deepEqual(parseStructuredSource(next, 'yaml').toJS(), { events: { first: { channel: 'sfx', rules: [], policy: 'queue' }, second: { rules: [] } }, metadata: 'unchanged' });
		assert.ok(next.startsWith(source.slice(0, target.range![0])));
		assert.ok(next.endsWith(source.slice(target.range![1])));
		assert.ok(next.includes('channel: "sfx" # keep quote/comment'));
		if (newline === '\r\n') assert.equal(next.replaceAll('\r\n', '').includes('\n'), false);
	}
});

test('flow additions and removals retain authored ordering, comments and valid punctuation', () => {
	for (const source of ['{a: 1, b: 2}', '{a: 1, b: 2,}', '{a: 1, b: 2, # end\n}', '{}']) {
		const added = apply(source, createStructuredInsertionEdit(source, 'yaml', collection(source), '3', 'c'));
		const data = parseStructuredSource(added, 'yaml').toJS();
		assert.deepEqual(data, { ...(source === '{}' ? {} : { a: 1, b: 2 }), c: 3 });
		const target = collection(added);
		for (let i = 0; i < target.items.length; i++) {
			const removed = apply(added, createStructuredRemovalEdit(added, target, i));
			const expected = { ...data }; delete expected[Object.keys(data)[i]];
			assert.deepEqual(parseStructuredSource(removed, 'yaml').toJS(), expected);
		}
	}
});

test('sequence additions and empty removal work for block and flow source', () => {
	for (const source of ['actions:\n  - {audio_id: beep}\nnext: untouched\n', 'actions:\r\n  - {audio_id: beep}\r\nnext: untouched\r\n', 'actions: [{audio_id: beep}]\nnext: untouched\n']) {
		const target = collection(source, ['actions']);
		const removed = apply(source, createStructuredRemovalEdit(source, target, 0));
		assert.deepEqual(parseStructuredSource(removed, 'yaml').toJS(), { actions: [], next: 'untouched' });
		if (source.includes('\r\n')) assert.equal(removed.replaceAll('\r\n', '').includes('\n'), false);
		const added = apply(source, createStructuredInsertionEdit(source, 'yaml', target, '{audio_id: other, priority: 3}'));
		assert.deepEqual(parseStructuredSource(added, 'yaml').toJS(), { actions: [{ audio_id: 'beep' }, { audio_id: 'other', priority: 3 }], next: 'untouched' });
	}
});

test('new authored fragments retain their quotes and comments; JSON stays JSON', () => {
	const source = 'events: {}\n';
	const added = apply(source, createStructuredInsertionEdit(source, 'yaml', collection(source, ['events']), '{channel: \'sfx\', rules: []} # new event', 'game.effect'));
	assert.deepEqual(parseStructuredSource(added, 'yaml').toJS(), { events: { 'game.effect': { channel: 'sfx', rules: [] } } });
	assert.ok(added.includes("'sfx'"));
	assert.ok(added.includes('# new event'));
	const json = '{"events": {}}';
	const jsonAdded = apply(json, createStructuredInsertionEdit(json, 'json', collection(json, ['events'], 'json'), '{"channel":"sfx","rules":[]}', 'game.effect'));
	assert.deepEqual(JSON.parse(jsonAdded), { events: { 'game.effect': { channel: 'sfx', rules: [] } } });
});

test('value replacement rejects invalid lexical boundaries without modifying source', () => {
	const source = 'value: 3 # retained\nother: 4\n';
	const node = parseStructuredSource(source, 'yaml').get('value', true) as Node;
	assert.deepEqual(parseStructuredSource(apply(source, createStructuredValueEdit(source, 'yaml', node, '5')), 'yaml').toJS(), { value: 5, other: 4 });
	assert.throws(() => createStructuredValueEdit(source, 'yaml', node, '{'));
	assert.throws(() => createStructuredInsertionEdit(source, 'yaml', collection('value: {}'), '', 'missing'));
	const json = '{"value": 1, "other": 2}';
	const jsonNode = parseStructuredSource(json, 'json').get('value', true) as Node;
	assert.throws(() => createStructuredValueEdit(json, 'json', jsonNode, '3 // eat the comma'));
});
