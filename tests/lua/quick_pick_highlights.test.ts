import assert from 'node:assert/strict';
import test from 'node:test';
import { ScratchBuffer } from '../../machine/ts/common/scratchbuffer';
import { CaseFoldedText } from '../../ide/common/search_text';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import { CommandQuickPickProvider } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import type { QuickPickHighlight, QuickPickMatch, QuickPickProjection } from '../../ide/workbench/services/quick_input/provider';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { HighlightedLabel } from '../../ide/editor/ui/highlighted_label';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { OverlayRenderer } from '../../ide/runtime/overlay_renderer';
import { api } from '../../ide/runtime/overlay_api';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import { HeadlessVideoOutput } from '../../hosts/node/headless/video_output';
import { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import * as constants from '../../ide/common/constants';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';

function ranges(projection: QuickPickProjection, match: QuickPickMatch): QuickPickHighlight[] {
	const result: QuickPickHighlight[] = [];
	for (let index = match.highlightStart; index < match.highlightEnd; index += 1) result.push({ ...projection.highlights.peek(index) });
	return result;
}

test('case-folded search owns original UTF-16 ranges, including expanded letters before and inside a match', () => {
	for (const source of ['İ🦉/index.lua', 'Αİ/ΣΟΣ.lua', 'ordinary.lua']) {
		const text = new CaseFoldedText(source);
		const dot = text.lower.indexOf('.lua');
		assert.equal(source.slice(text.sourceStart(dot), text.sourceEnd(dot + 4)), '.lua');
	}
	const text = new CaseFoldedText('xİz');
	assert.equal(text.lower, 'xi\u0307z');
	assert.equal(text.sourceStart(1), 1); assert.equal(text.sourceEnd(2), 2);
	assert.equal(text.sourceStart(2), 1); assert.equal(text.sourceEnd(3), 2);
	assert.equal(text.sourceStart(3), 2); assert.equal(text.sourceEnd(4), 3);
});

test('literal highlights merge repeated/overlapping terms and mark the actual display field', () => {
	const items = [{ label: 'banana.lua', description: 'SLOT 1', detail: 'LUA' },
		{ label: 'other.lua', description: 'banana SLOT 1', detail: 'LUA' }];
	const provider = new TextQuickPickProvider(items);
	const projection = provider.getPicks('ANA ban ANA lua SLOT');
	assert.deepEqual(ranges(projection, projection.matches[0]), [
		{ field: 'label', start: 0, end: 4 }, { field: 'label', start: 7, end: 10 },
		{ field: 'description', start: 0, end: 4 },
	]);
	assert.deepEqual(ranges(projection, projection.matches[1]), [
		{ field: 'label', start: 6, end: 9 }, { field: 'description', start: 0, end: 4 },
		{ field: 'description', start: 7, end: 11 },
	]);
	const match = projection.matches[0], storage = projection.highlights, first = storage.peek(0);
	provider.getPicks('banana');
	assert.equal(projection.matches[0], match); assert.equal(projection.highlights, storage); assert.equal(storage.peek(0), first);
	assert.deepEqual(ranges(projection, match), [{ field: 'label', start: 0, end: 6 }]);
	provider.getPicks('');
	assert.equal(storage.length, 0);
	for (const item of projection.matches) assert.equal(item.highlightStart, item.highlightEnd);
	assert.equal(provider.getPicks('absent').matches.length, 0);
});

test('literal matching after case-fold expansion does not shift another field or highlight an invented glyph', () => {
	const item = { label: 'İ/shared.lua', description: 'İ tools', detail: 'line 5' };
	const provider = new TextQuickPickProvider([item]);
	let picks = provider.getPicks('shared tools 5');
	assert.deepEqual(ranges(picks, picks.matches[0]), [
		{ field: 'label', start: 2, end: 8 }, { field: 'description', start: 2, end: 7 },
		{ field: 'detail', start: 5, end: 6 },
	]);
	picks = provider.getPicks('İ');
	assert.deepEqual(ranges(picks, picks.matches[0]), [{ field: 'label', start: 0, end: 1 }]);
});

test('command word positions explain abbreviations without marking equivalent separators or exact-id aliases', () => {
	const provider = new CommandQuickPickProvider([
		{ command: 'hot-resume', label: 'Run: Hot Resume', description: '', detail: '' },
		{ command: 'scenarioLab.cancel', label: 'Scenario Lab: Cancel', description: '', detail: '' },
	]);
	for (const query of ['hr', 'h r', 'h:r']) {
		const picks = provider.getPicks(query);
		const expected = query === 'h r' ? [{ field: 'label', start: 5, end: 6 }, { field: 'label', start: 8, end: 10 }]
			: [{ field: 'label', start: 5, end: 6 }, { field: 'label', start: 9, end: 10 }];
		assert.deepEqual(ranges(picks, picks.matches[0]), expected, query);
	}
	const picks = provider.getPicks('scenarioLab.cancel');
	assert.deepEqual(ranges(picks, picks.matches[0]), [], 'an exact id is not a pretend match in the displayed title');
});

test('highlighted labels own prefix clipping and ellipsis, with retained proportional run geometry', t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	t.mock.method(editorViewState.font, 'advance', (char: string) => char === 'W' ? 9 : 2);
	const label = new HighlightedLabel();
	label.layout('WiWiWi', 30); // 33 px full text; 6 px ellipsis -> 22 px body.
	assert.equal(label.visibleEnd, 4); assert.equal(label.marker, '...');
	label.beginHighlights(); label.addHighlight(1, 3); label.addHighlight(4, 6); label.endHighlights();
	assert.deepEqual([...label.runs], [
		{ start: 0, end: 1, x: 0, highlighted: false },
		{ start: 1, end: 3, x: 9, highlighted: true },
		{ start: 3, end: 4, x: 20, highlighted: false },
	]);
	const first = label.runs.peek(0);
	t.mock.method(editorViewState.font, 'advance', () => assert.fail('changing highlights remeasured text'));
	label.beginHighlights(); label.addHighlight(0, 2); label.endHighlights();
	assert.equal(label.runs.peek(0), first);
	assert.deepEqual([...label.runs], [
		{ start: 0, end: 2, x: 0, highlighted: true }, { start: 2, end: 4, x: 11, highlighted: false },
	]);
});

test('shared picker consumes provider spans, updates them without text queries and renders each theme/font directly', t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const picker = new QuickInputController({ text: '', isSupported: () => false, writeText: async () => {} });
	t.after(() => { picker.dispose(); constants.setIdeThemeVariant('light'); });
	const item = { label: 'source_choice', description: 'independent.lua', detail: '7:1' };
	const highlights = new ScratchBuffer<QuickPickHighlight>(() => ({ field: 'label', start: 0, end: 0 }));
	const match = { item, itemIndex: 0, highlightStart: 0, highlightEnd: 1 };
	let calls = 0;
	const provider = { items: [item], getPicks(query: string) {
		calls += 1;
		const range = highlights.get(0); range.field = 'label'; range.start = query === '' ? 0 : 7; range.end = range.start + 3;
		return { matches: [match], selectionIndex: 0, highlights };
	} };
	picker.pick('Proof', 'query', () => provider, () => assert.fail('paint must not accept'));
	const label = picker.layout.renderRows[0].label, run = label.runs.peek(0);
	picker.model.filter('unrelated to the display text'); picker.update();
	assert.equal(label.runs.peek(0), run);
	assert.deepEqual([...label.runs].filter(value => value.highlighted).map(value => [value.start, value.end]), [[7, 10]]);
	assert.equal(picker.model.list.rows[0].item, item);
	const presenter = new VideoPresenter(new HeadlessVideoOutput(384, 288),
		new HeadlessGPUBackend(384, 288, PSX_MACHINE_SPEC.gxGpuVramBytes), 384, 288);
	const renderer = new OverlayRenderer(presenter.hostOverlayQueue);
	for (const variant of ['msx', 'tiny'] as const) {
		configureFontVariant(new VirtualHeadlessClock(), variant, null); picker.update();
		for (const theme of ['light', 'dark'] as const) {
			constants.setIdeThemeVariant(theme);
			for (const selected of [true, false]) {
				picker.model.list.selectionIndex = selected ? 0 : -1;
				renderer.beginFrame(presenter); api.beginFrame(renderer); picker.draw(); renderer.endFrame();
				const frame = presenter.hostOverlayQueue.consumeOverlayFrame();
				const color = selected ? constants.COLOR_QUICK_OPEN_SELECTION_TEXT : constants.COLOR_QUICK_OPEN_TEXT;
				const highlight = selected ? constants.COLOR_QUICK_OPEN_SELECTION_MATCH : constants.COLOR_QUICK_OPEN_MATCH;
				let count = 0;
				for (let index = 0; index < frame.commandCount; index += 1) {
					if (frame.commandKinds[index] !== Host2DKind.Glyphs) continue;
					const glyphs = frame.commandRefs[index] as GlyphRenderSubmission;
					if (glyphs.items !== item.label) continue;
					assert.equal(glyphs.font, editorViewState.font.renderFont());
					assert.equal(glyphs.color, resolveThemeTokenColor(glyphs.item_start === 7 ? highlight : color));
					if (glyphs.item_start === 7) assert.equal(glyphs.item_end, 10);
					count += 1;
				}
				assert.equal(count, 3);
			}
		}
	}
	t.mock.method(editorViewState.font, 'advance', () => assert.fail('warm picker measured text'));
	for (let frame = 0; frame < 1000; frame += 1) picker.update();
	assert.equal(calls, 2, 'layout, selection, fonts, themes and idle never query the provider again');
});
