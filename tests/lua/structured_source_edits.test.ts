import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMap, isSeq, type Node } from 'yaml';
import { parseStructuredSource, createStructuredInsertionEdit, createStructuredRemovalEdit, createStructuredValueEdit, type StructuredCollection } from '../../ide/language/yaml/structured_edits';
import type { EditorTextEdit } from '../../ide/editor/model/text_model';
import { parseStructuredTextDocument } from '../../toolchain/ts/rompack/aem';

test('structured source uses the cooker core schema instead of directive-selected scalar semantics', () => {
	for (const directive of ['', '%YAML 1.1\n---\n', '%YAML 1.2\n---\n']) {
		const source = directive + 'x: 012\ny: yes\non: off\ndate: 2020-01-01\nvalues: [0x10, 0o10, .inf, .NaN, true, null]\nbase: &base {x: 1}\nobject: {<<: *base}\n';
		assert.deepEqual(parseStructuredSource(source, 'yaml').toJS(), parseStructuredTextDocument(source, 'yaml', 'fixture'));
	}
	for (const source of ['x: !!timestamp 2020-01-01', 'x: !!binary YQ==', 'x: !!set {one: null}']) {
		assert.throws(() => parseStructuredTextDocument(source, 'yaml', 'fixture'));
		assert.throws(() => parseStructuredSource(source, 'yaml'));
	}
});

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

test('first block-member removal retains remaining indentation, nested values and trivia', () => {
	for (const newline of ['\n', '\r\n']) for (const count of [2, 3]) {
		for (const between of ['', '  # next member\n', '\n  # next member\n', '# next member\n']) {
			for (const members of [
				['  first:\n    rules: []\n', '  second:\n    rules: []\n', '  third:\n    rules: []\n'],
				['  - go:\n      audio_id: first\n', '  - go:\n      audio_id: second\n', '  - go:\n      audio_id: third\n'],
			]) {
				const rest = between + members.slice(1, count).join('') + 'retained: "unchanged" # sibling\n';
				const source = ('members:\n' + members[0] + rest).replaceAll('\n', newline);
				const next = apply(source, createStructuredRemovalEdit(source, collection(source, ['members']), 0));
				assert.equal(next, ('members:\n' + rest).replaceAll('\n', newline));
				assert.deepEqual(parseStructuredSource(next, 'yaml').toJS(), parseStructuredTextDocument(next, 'yaml', 'events.aem.yaml'));
			}
		}
	}
});

test('first compact block-member removal retains its containing sequence indicator', () => {
	for (const newline of ['\n', '\r\n']) for (const count of [2, 3]) {
		for (const members of [
			['first: 1\n', '  second:\n    value: 2\n', '  third: 3\n'],
			['- first\n', '  - second\n', '  - third\n'],
		]) {
			const rest = members.slice(1, count).join('');
			const source = ('- ' + members[0] + rest).replaceAll('\n', newline);
			const next = apply(source, createStructuredRemovalEdit(source, collection(source, [0]), 0));
			assert.equal(next, ('- ' + rest.slice(2)).replaceAll('\n', newline));
			assert.deepEqual(parseStructuredSource(next, 'yaml').toJS(), parseStructuredTextDocument(next, 'yaml', 'events.aem.yaml'));
		}
	}
});

test('collection edits use token origins before first-key properties rather than AST value ranges', () => {
	for (const newline of ['\n', '\r\n']) for (const prefix of ['&key ', '!!str ']) {
		for (const header of ['root:\n  ', 'root:\n  - ']) for (const count of [1, 2, 3]) {
			const indent = header.endsWith('- ') ? '    ' : '  ';
			const members = [prefix + 'first: 1\n', indent + 'second: 2\n', indent + 'third: 3\n'].slice(0, count);
			const tail = 'retained: "unchanged" # sibling\n';
			const source = (header + members.join('') + tail).replaceAll('\n', newline);
			const path = header.endsWith('- ') ? ['root', 0] : ['root'];
			const target = collection(source, path);
			const added = apply(source, createStructuredInsertionEdit(source, 'yaml', target, '4', 'fourth'));
			assert.equal(added, (header + members.join('') + indent + 'fourth: 4\n' + tail).replaceAll('\n', newline));
			assert.deepEqual(parseStructuredSource(added, 'yaml').toJS(), parseStructuredTextDocument(added, 'yaml', 'events.aem.yaml'));
			for (let index = 0; index < count; index++) {
				const remaining = members.filter((_member, memberIndex) => memberIndex !== index).join('');
				const body = remaining === '' ? '{}\n' : index === 0 ? remaining.slice(indent.length) : remaining;
				const removed = apply(source, createStructuredRemovalEdit(source, target, index));
				assert.equal(removed, (header + body + tail).replaceAll('\n', newline));
				assert.deepEqual(parseStructuredSource(removed, 'yaml').toJS(), parseStructuredTextDocument(removed, 'yaml', 'events.aem.yaml'));
			}
		}
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

test('JSON insertion emits JSON string escapes for keys and nested values without folding', () => {
	const value = '\u0000\u0001\u0007\u000b\u001b' + 'long string '.repeat(12) + '\nnext line';
	const name = 'game.\u001beffect';
	for (const newline of ['\n', '\r\n']) {
		const source = ['{', '  "events": {},', '  "retained": "\\u0061"', '}'].join(newline);
		const fragment = { nested: [{ [name]: value }], value };
		const added = apply(source, createStructuredInsertionEdit(source, 'json', collection(source, ['events'], 'json'), JSON.stringify(fragment), name));
		const expected = { events: { [name]: fragment }, retained: 'a' };
		assert.deepEqual(JSON.parse(added), expected);
		assert.deepEqual(parseStructuredTextDocument(added, 'json', 'events.aem.json'), expected);
		assert.ok(added.endsWith(source.slice(source.indexOf('},') + 1)));
		if (newline === '\r\n') assert.equal(added.replaceAll('\r\n', '').includes('\n'), false);
	}
	const source = '{"values": ["retained"]}';
	const added = apply(source, createStructuredInsertionEdit(source, 'json', collection(source, ['values'], 'json'), JSON.stringify(value)));
	assert.deepEqual(parseStructuredTextDocument(added, 'json', 'events.aem.json'), { values: ['retained', value] });
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
