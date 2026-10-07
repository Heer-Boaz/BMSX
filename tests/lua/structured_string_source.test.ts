import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Scalar } from 'yaml';
import type { EditorTextEdit } from '../../ide/editor/model/text_model';
import { parseStructuredSource } from '../../ide/language/yaml/structured_edits';
import { createStructuredStringEdits, mapStructuredStringSource } from '../../ide/language/yaml/string_source';

function scalar(source: string, path: readonly (string | number)[] = ['value']): Scalar<string> {
	return parseStructuredSource(source, 'yaml').getIn(path, true) as Scalar<string>;
}

function apply(source: string, edits: readonly EditorTextEdit[]): string {
	for (let index = edits.length - 1; index >= 0; index--) {
		const edit = edits[index];
		source = source.slice(0, edit.offset) + edit.text + source.slice(edit.offset + edit.deleteLength);
	}
	return source;
}

test('decoded string edits preserve untouched escape spelling, comments and CRLF bytes', () => {
	const source = '# authored\r\nvalue: "a\\\\\\x6d  \\u007a" # keep\r\nother: \'unchanged\'\r\n';
	const mapping = mapStructuredStringSource(scalar(source))!;
	assert.equal(mapping.value, 'a\\m  z');
	const edits = createStructuredStringEdits(source, [
		{ mapping, start: 4, deleteLength: 1, text: 'm' },
		{ mapping, start: 2, deleteLength: 1, text: ' ' },
	]);
	assert.deepEqual(edits, [
		{ offset: source.indexOf('\\x6d'), deleteLength: 4, text: ' ' },
		{ offset: source.indexOf('  ') + 1, deleteLength: 1, text: 'm' },
	]);
	const next = apply(source, edits);
	assert.equal(next, '# authored\r\nvalue: "a\\\\  m\\u007a" # keep\r\nother: \'unchanged\'\r\n');
	assert.equal(scalar(next).value, 'a\\  mz');
	assert.deepEqual(createStructuredStringEdits(source, [{ mapping, start: 2, deleteLength: 1, text: 'm' }]), []);
});

test('all single-unit YAML escapes map the following decoded character to its exact source span', () => {
	for (const escape of ['0', 'a', 'b', 'e', 'f', 'n', 'r', 't', 'v', 'N', '_', 'L', 'P', ' ', '"', '/', '\\', '\t', 'x6d', 'u006d', 'U0000006d']) {
		const source = `value: "\\${escape}m"\n`;
		const mapping = mapStructuredStringSource(scalar(source))!;
		assert.equal(mapping.value.length, 2, escape);
		assert.deepEqual(mapping.offsets, [8, source.lastIndexOf('m'), source.lastIndexOf('m') + 1], escape);
		const next = apply(source, createStructuredStringEdits(source, [{ mapping, start: 1, deleteLength: 1, text: 'M' }]));
		assert.equal(next, `value: "\\${escape}M"\n`, escape);
	}
});

test('UTF-16 mapping keeps astral code points indivisible across raw and escaped spelling', () => {
	for (const spelling of ['🟠', '\\U0001F7E0', '\\uD83D\\uDFE0']) {
		const source = `value: "${spelling}m"\n`;
		const mapping = mapStructuredStringSource(scalar(source))!;
		assert.equal(mapping.value, '🟠m');
		assert.equal(mapping.offsets[0], 8);
		assert.equal(mapping.offsets[1], undefined);
		assert.equal(mapping.offsets[2], 8 + spelling.length);
		assert.equal(mapping.offsets[3], 9 + spelling.length);
		assert.throws(() => createStructuredStringEdits(source, [{ mapping, start: 0, deleteLength: 1, text: 'x' }]));
		assert.throws(() => createStructuredStringEdits(source, [{ mapping, start: 1, deleteLength: 1, text: 'x' }]));
		assert.equal(apply(source, createStructuredStringEdits(source, [{ mapping, start: 0, deleteLength: 2, text: 'x' }])), 'value: "xm"\n');
	}
});

test('single-quoted and plain scalar edits retain their authored style', () => {
	const single = "value: 'a''m z' # keep\n";
	const mapping = mapStructuredStringSource(scalar(single))!;
	assert.equal(mapping.value, "a'm z");
	assert.deepEqual(mapping.offsets, [8, 9, 11, 12, 13, 14]);
	assert.equal(apply(single, createStructuredStringEdits(single, [{ mapping, start: 2, deleteLength: 1, text: "'" }])), "value: 'a'''' z' # keep\n");
	const plain = 'value: a m z # keep\n';
	assert.equal(apply(plain, createStructuredStringEdits(plain, [{ mapping: mapStructuredStringSource(scalar(plain))!, start: 2, deleteLength: 1, text: 'M' }])), 'value: a M z # keep\n');
});

test('plain edits reject lexical/type changes in their block or flow context', () => {
	for (const text of ['11', 'null', 'true', '# comment', 'a: b', ' a', 'a ', '', '[a]', '&anchor a', '*alias']) {
		const source = 'value: am # keep\n';
		const mapping = mapStructuredStringSource(scalar(source))!;
		assert.throws(() => createStructuredStringEdits(source, [{ mapping, start: 0, deleteLength: 2, text }]), text);
	}
	const flow = 'value: [amb, other]\n';
	assert.throws(() => createStructuredStringEdits(flow, [{ mapping: mapStructuredStringSource(scalar(flow, ['value', 0]), true)!, start: 1, deleteLength: 1, text: ',' }]));
	const block = 'value: amb\n';
	assert.equal(apply(block, createStructuredStringEdits(block, [{ mapping: mapStructuredStringSource(scalar(block))!, start: 1, deleteLength: 1, text: ',' }])), 'value: a,b\n');
});

test('multiline, folded, anchored and tagged scalar syntax is explicitly source-only', () => {
	for (const source of [
		'value: |\n  a m\n', 'value: >\n  a m\n', 'value: a\n  m\n',
		"value: 'a\n  m'\n", 'value: "a\n  m"\n', 'value: "a\\\n  m"\n',
		'value: &row "a m"\n', 'value: !!str "a m"\n',
	]) assert.equal(mapStructuredStringSource(scalar(source)), undefined, source);
});

test('new double-quoted fragments encode only their own escapes', () => {
	const source = 'value: "\\x61m\\u007a" # keep\n';
	const mapping = mapStructuredStringSource(scalar(source))!;
	const next = apply(source, createStructuredStringEdits(source, [{ mapping, start: 1, deleteLength: 1, text: '"\\\n' }]));
	assert.equal(next, 'value: "\\x61\\"\\\\\\n\\u007a" # keep\n');
	assert.equal(scalar(next).value, 'a"\\\nz');
});

test('canonical Nemesis rows map all cells and a move changes only the two authored cell spans', () => {
	const source = readFileSync('carts/nemesis_s/res/data/nemesis_s_stage.yaml', 'utf8');
	const document = parseStructuredSource(source, 'yaml');
	const rows = document.get('map_rows') as { items: Scalar<string>[] };
	const mappings = rows.items.map(row => mapStructuredStringSource(row)!);
	assert.ok(mappings.every(mapping => mapping !== undefined));
	for (const mapping of mappings) {
		for (let column = 0; column < mapping.value.length; column++) {
			const spelling = source.slice(mapping.offsets[column]!, mapping.offsets[column + 1]!);
			assert.equal(JSON.parse(`"${spelling}"`), mapping.value[column]);
		}
	}
	const row = mappings.find(mapping => mapping.value.indexOf('m', mapping.value.indexOf('\\') + 1) !== -1 && mapping.value.includes('\\'))!;
	const from = row.value.indexOf('m', row.value.indexOf('\\') + 1), to = from + 1;
	assert.equal(row.value[to], ' ');
	const edits = createStructuredStringEdits(source, [
		{ mapping: row, start: from, deleteLength: 1, text: ' ' },
		{ mapping: row, start: to, deleteLength: 1, text: 'm' },
	]);
	assert.deepEqual(edits, [
		{ offset: row.offsets[from], deleteLength: 1, text: ' ' },
		{ offset: row.offsets[to], deleteLength: 1, text: 'm' },
	]);
	const next = apply(source, edits);
	const start = row.offsets[from]!, end = row.offsets[to + 1]!;
	assert.equal(next, source.slice(0, start) + ' m' + source.slice(end));
	const expected = document.toJS();
	expected.map_rows[mappings.indexOf(row)] = row.value.slice(0, from) + ' m' + row.value.slice(to + 1);
	assert.deepEqual(parseStructuredSource(next, 'yaml').toJS(), expected);
});
