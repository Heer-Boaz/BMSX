import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkdownSource } from '../../ide/common/markdown/source';
import { TextStyle } from '../../ide/common/markdown/model';

test('semantic reference overlays compose with source Markdown and can be removed without a source edit', () => {
	const source = new MarkdownSource(), text = '**@cart.lua** and @other.lua';
	source.update(text); const original = source.styles;
	const overlays = [{ from: 2, to: 11, style: TextStyle.Link }, { from: 18, to: 28, style: TextStyle.Link }];
	source.update(text, overlays);
	assert.equal(source.styles.find(span => span.from === 2)!.style, TextStyle.Bold | TextStyle.Link);
	assert.equal(source.styles.map(span => text.slice(span.from, span.to)).join(''), text);
	const styled = source.styles; source.update(text, overlays); assert.equal(source.styles, styled);
	source.update(text); assert.equal(source.styles, original);
});

test('editable Markdown styles content and retains delimiter, escape, entity and UTF-16 source ranges', () => {
	const text = '🐉 **strong** *emphasis* ***both*** `a * b` \\*literal\\* &amp; ~~old~~ [guide](https://example.com)';
	const source = new MarkdownSource(); source.update(text);
	assert.equal(source.styles.map(span => text.slice(span.from, span.to)).join(''), text);
	for (const [word, style] of [['strong', TextStyle.Bold], ['emphasis', TextStyle.Italic], ['both', TextStyle.Bold | TextStyle.Italic],
		['a * b', TextStyle.Code], ['old', TextStyle.Strike], ['guide', TextStyle.Link], ['literal', TextStyle.Plain], ['&amp;', TextStyle.Plain]] as const) {
		const offset = text.indexOf(word), span = source.styles.find(span => span.from <= offset && span.to > offset)!;
		assert.equal(span.style, style);
	}
	const mark = text.indexOf('**');
	assert.equal(source.styles.find(span => span.from <= mark && span.to > mark)!.style, TextStyle.Muted);
});

test('incremental source parsing equals a fresh parse after inserts, deletes, incomplete syntax and CRLF edits', () => {
	const source = new MarkdownSource();
	const text = '# Title\r\n\r\n- **one** and `two`\r\n\r\n```lua\r\n\treturn 7\r\n```\r\n\r\n[guide][id]\r\n\r\n[id]: https://example.com';
	for (const snapshot of [...Array.from({ length: text.length + 1 }, (_, end) => text.slice(0, end)),
		text.replace('**one**', '*one*'), text.replace('```lua', '~~~lua'), text.replace('7', '🐉'),
		...Array.from({ length: text.length + 1 }, (_, removed) => text.slice(0, text.length - removed))]) {
		source.update(snapshot);
		const fresh = new MarkdownSource(); fresh.update(snapshot);
		assert.deepEqual(source.styles, fresh.styles);
		assert.equal(source.styles.map(span => snapshot.slice(span.from, span.to)).join(''), snapshot);
	}
});

test('unchanged draft retains style ranges rather than reparsing during cursor or theme updates', () => {
	const source = new MarkdownSource(), text = '**retained**\n\n```lua\nreturn 7\n```';
	source.update(text); const styles = source.styles;
	for (let index = 0; index < 1000; index++) source.update(text);
	assert.equal(source.styles, styles);
});
