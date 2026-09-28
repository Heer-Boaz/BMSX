import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkdownDocument, TextStyle } from '../../ide/common/markdown/model';
import { MarkdownLayout, type StyledMeasure } from '../../ide/common/markdown/layout';

const measure: StyledMeasure = (text, start, end) => [...text.slice(start, end)].length;
function render(source: string, width = 80) {
	const document = new MarkdownDocument(); document.append(source);
	const layout = new MarkdownLayout(width, measure);
	return { document, rows: document.blocks.flatMap(block => [...layout.layout(block)]) };
}

test('Markdown parses nested styles, code and escapes without displaying delimiters', () => {
	const { rows } = render('Plain *italic* **bold** ***both*** `x < y` ~~gone~~ \\*literal\\* &amp; &#233;.');
	assert.equal(rows[0].text, 'Plain italic bold both x < y gone *literal* & é.');
	for (const [text, style] of [['italic', TextStyle.Italic], ['bold', TextStyle.Bold], ['both', TextStyle.Bold | TextStyle.Italic],
		['x < y', TextStyle.Code], ['gone', TextStyle.Strike]] as const) {
		assert.equal(rows[0].runs.find(run => run.text === text)!.style, style);
	}
});

test('shared word wrap measures styles without splitting normal words at span boundaries', () => {
	const { rows } = render('alpha **beta** gamma delta', 13);
	assert.deepEqual(rows.map(row => row.text), ['alpha beta', 'gamma delta']);
	const styledMeasure: StyledMeasure = (_text, start, end, style) => (end - start) * (style & TextStyle.Bold ? 2 : 1);
	const { document } = render('alpha **beta** gamma');
	const layout = new MarkdownLayout(12, styledMeasure);
	assert.deepEqual(layout.layout(document.blocks[0]).map(row => row.text), ['alpha', 'beta', 'gamma']);
	const split = render('a**bc**defghi', 5).rows;
	assert.deepEqual(split.map(row => row.text), ['abcde', 'fghi']);
	assert.deepEqual(split[0].runs.map(run => run.x), [0, 1, 3]);
});

test('code blocks retain indentation, empty lines, literal syntax and the language label', () => {
	const { rows } = render('```lua\n  local x = "*raw*"\n\n\treturn x\n```', 80);
	assert.deepEqual(rows.map(row => row.text), ['lua', '  local x = "*raw*"', '', '\treturn x']);
	assert.ok(rows.every(row => row.code));
	assert.equal(rows[1].runs[0].style, TextStyle.Code);
	assert.deepEqual(render('```\n  abcdef\n```', 4).rows.map(row => row.text), ['  ab', 'cdef']);
});

test('headings, paragraph gaps, nested lists, tasks, quotes and tables have structured rows', () => {
	const { rows } = render('# Heading\n\nParagraph.\n\n- first\n  - nested\n- [x] done\n\n> quoted\n\n| Name | Value |\n| --- | --- |\n| A | `7` |');
	assert.equal(rows[0].runs[0].style, TextStyle.Bold);
	assert.ok(rows.some(row => row.text === ''));
	assert.deepEqual(rows.find(row => row.text === 'nested')!.runs.map(run => run.text), ['- ', 'nested']);
	assert.ok(rows.find(row => row.text === 'nested')!.runs[0].x > rows.find(row => row.text === 'first')!.runs[0].x);
	assert.equal(rows.find(row => row.text === 'done')!.runs[0].text, '[x] ');
	assert.equal(rows.find(row => row.text === 'quoted')!.runs[0].text, '| ');
	assert.equal(rows.find(row => row.text === 'quoted')!.runs[1].x, 2);
	assert.ok(rows.some(row => row.text === 'Name | Value'));
	assert.equal(rows.at(-1)!.text, 'A | 7');
});

test('lists hang continuation paragraphs, code and nested quotes under the content, not the marker', () => {
	const { rows } = render('10. first words wrap here\n\n    second paragraph\n\n    ```lua\n    return 7\n    ```\n\n    > quoted words wrap here', 20);
	for (const text of ['first words wrap', 'here', 'second paragraph', 'lua', 'return 7']) {
		const row = rows.find(row => row.text === text)!;
		assert.equal(row.inset, 4, text);
		assert.equal(row.runs.at(-1)!.x, 4, text);
	}
	assert.equal(rows[0].runs[0].text, '10. ');
	const quoted = rows.find(row => row.text === 'quoted words')!;
	assert.equal(quoted.runs[0].text, '| '); assert.equal(quoted.runs[0].x, 4);
	assert.equal(quoted.inset, 6);
	assert.equal(rows.at(-1)!.runs[0].text, '| ', 'quote bar repeats across soft wrapping');
});

test('literal documents share word wrapping without interpreting source, entities or Markdown', () => {
	const source = '**literal** _G.foo <tag> &amp;\n```lua\n  return 1\n```';
	const document = new MarkdownDocument('text');
	const layout = new MarkdownLayout(80, measure);
	for (const char of source) { document.append(char); document.blocks.forEach(block => layout.layout(block)); }
	const rows = layout.layout(document.blocks[0]);
	assert.deepEqual(rows.map(row => row.text), source.split('\n'));
	assert.ok(rows.every(row => !row.code && row.runs.every(run => run.style === TextStyle.Plain)));
});

test('raw HTML stays inert text and link destinations remain readable', () => {
	const { rows } = render('[guide](https://example.com) <script>alert(1)</script>');
	assert.equal(rows[0].text, 'guide (https://example.com) <script>alert(1)</script>');
	assert.equal(rows[0].runs[0].style, TextStyle.Link);
});

test('long tokens and Unicode wrap on whole codepoints, even below a glyph width', () => {
	assert.deepEqual(render('🐉🐉abc', 2).rows.map(row => row.text), ['🐉🐉', 'ab', 'c']);
	assert.deepEqual(render('🐉x', 0).rows.map(row => row.text), ['🐉', 'x']);
});

for (const source of ['**bold** and *italic*', '```lua\n  return "*raw*"\n```\n\nAfter.',
	'# Heading\n\nOne\n\n- first\n- next', '[guide][id]\n\n[id]: https://example.com',
	'a\r\n\r\nb', '***hello***\n\n> quote\n\n| A | B |\n| --- | --- |\n| 1 | 2 |',
	'1. outer\n   1. inner\n\n      para\n   2. next\n2. end',
	'| Name | Value |\n| :--- | ---: |\n| A | `7` |\n| longer | 123456 |',
	'> | Name | Value |\n> | --- | --- |\n> | **one** | description wraps here |']) {
	test(`every streaming split equals complete Markdown: ${JSON.stringify(source)}`, () => {
		const expected = render(source, 18).rows;
		for (let split = 1; split < source.length; split++) {
			const document = new MarkdownDocument(), layout = new MarkdownLayout(18, measure);
			document.append(source.slice(0, split));
			document.blocks.forEach(block => layout.layout(block));
			document.append(source.slice(split));
			assert.deepEqual(document.blocks.flatMap(block => [...layout.layout(block)]), expected, `split ${split}`);
		}
		const document = new MarkdownDocument(), layout = new MarkdownLayout(18, measure);
		for (const char of source) { document.append(char); document.blocks.forEach(block => layout.layout(block)); }
		assert.deepEqual(document.blocks.flatMap(block => [...layout.layout(block)]), expected, 'character-by-character streaming');
	});
}

test('tables align measured columns, honor alignment, and retain inline styles', () => {
	const { rows } = render('| Name | State | Count |\n| :--- | :---: | ---: |\n| A | **ok** | `7` |\n| longer | ready | 12345 |', 60);
	const header = rows[0], first = rows[2], second = rows[3];
	assert.equal(header.runs.find(run => run.text === 'Name')!.x, first.runs.find(run => run.text === 'A')!.x);
	const a = first.runs.find(run => run.text === '7')!, b = second.runs.find(run => run.text === '12345')!;
	assert.equal(a.x + a.width, b.x + b.width, 'numbers align on the right edge');
	assert.equal(a.style, TextStyle.Code);
	assert.equal(first.runs.find(run => run.text === 'ok')!.style, TextStyle.Bold);
	assert.equal(first.runs.find(run => run.text === 'ok')!.x, second.runs.find(run => run.text === 'ready')!.x + 1, 'center alignment uses the cell width');
	for (const row of rows) for (const run of row.runs) assert.ok(run.x + run.width <= 60);
});

test('tables wrap cells independently and do not repeat shorter cells on continuation lines', () => {
	const { rows } = render('| Key | Description |\n| --- | --- |\n| A | first second third fourth fifth |\n| | last |', 24);
	const body = rows.slice(2);
	assert.equal(body.flatMap(row => row.runs).filter(run => run.text === 'A').length, 1);
	assert.ok(body.length > 2);
	const x = body[0].runs.find(run => run.text.startsWith('first'))!.x;
	for (const row of body) {
		assert.equal(row.runs.find(run => run.style !== TextStyle.Muted && run.text !== 'A')!.x, x);
		for (const run of row.runs) assert.ok(run.x + run.width <= 24);
	}
});

test('narrow tables become labelled records without losing values, styles or quote indentation', () => {
	const source = '> | Property | Value |\n> | --- | --- |\n> | velocity_x_q8 | `-768` |\n> | position_x_q8 | **1024** |';
	const { rows } = render(source, 20);
	assert.ok(rows.some(row => row.text.startsWith('Property:')));
	assert.ok(rows.some(row => row.text === 'Value: -768'));
	assert.equal(rows.find(row => row.text === 'Value: -768')!.runs.at(-1)!.style, TextStyle.Code);
	for (const row of rows) {
		assert.equal(row.runs[0].text, '| ');
		for (const run of row.runs) assert.ok(run.x + run.width <= 20);
	}
	const headerOnly = render('| Longer header | Other heading |\n| --- | --- |', 12).rows;
	assert.equal(headerOnly.map(row => row.text).join(' '), 'Longer header Other heading');
});

test('streamed tables reuse stable rows and do no idle measurements', () => {
	const document = new MarkdownDocument(); document.append('| Name | Value |\n| --- | --- |\n| retained | 123456789 |\n| next | 1');
	let measured = 0;
	const layout = new MarkdownLayout(40, (text, from, to, style) => { measured += to - from; return measure(text, from, to, style); });
	const first = layout.layout(document.blocks[0])[2];
	document.append('2');
	assert.equal(layout.layout(document.blocks[0])[2], first, 'a changed value does not reallocate completed rows when columns keep their width');
	const before = measured;
	for (let frame = 0; frame < 1000; frame++) document.blocks.forEach(block => layout.layout(block));
	assert.equal(measured, before);
});

test('a completed code listing is not reparsed while its following explanation streams', () => {
	const document = new MarkdownDocument(); document.append('```lua\n' + '  local x = 7\n'.repeat(1000) + '```\n\nExplanation');
	const code = document.blocks[0], revision = code.revision;
	for (let chunk = 0; chunk < 200; chunk++) document.append(' **formatted** words.');
	assert.equal(document.blocks[0], code);
	assert.equal(code.revision, revision);
});

test('streaming retains committed blocks, plain wrapped prefixes and idle layout without remeasurement', () => {
	const document = new MarkdownDocument(); document.append('**Committed**\n\nword ');
	let measured = 0;
	const layout = new MarkdownLayout(20, (text, from, to, style) => { measured += to - from; return measure(text, from, to, style); });
	const committed = document.blocks[0], first = layout.layout(committed);
	for (let index = 0; index < 2000; index++) { document.append('word '); document.blocks.forEach(block => layout.layout(block)); }
	assert.equal(document.blocks[0], committed); assert.equal(layout.layout(committed), first);
	assert.ok(measured < 150000, `tail-only measurement, measured ${measured}`);
	const before = measured;
	for (let frame = 0; frame < 1000; frame++) document.blocks.forEach(block => layout.layout(block));
	assert.equal(measured, before);
	const plain = document.blocks[1], row = layout.layout(plain)[1];
	document.append('\n🐉 next');
	assert.equal(layout.layout(document.blocks[1])[1], row);
});

test('unfinished fenced code retains parsed line layout instead of remeasuring all prior code', () => {
	const document = new MarkdownDocument(); document.append('```lua\n' + '  local x = 7\n'.repeat(1000) + 'return ');
	let measured = 0;
	const layout = new MarkdownLayout(40, (text, from, to, style) => { measured += to - from; return measure(text, from, to, style); });
	const first = layout.layout(document.blocks[0])[1];
	measured = 0;
	for (let chunk = 0; chunk < 200; chunk++) { document.append('x'); layout.layout(document.blocks[0]); }
	assert.equal(layout.layout(document.blocks[0])[1], first);
	assert.ok(measured < 20000, `only the final code row is remeasured, got ${measured}`);
	document.append('\n```\n\nDone.');
	assert.equal(layout.layout(document.blocks[0])[1], first);
});
