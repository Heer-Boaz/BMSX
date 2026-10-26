import assert from 'node:assert/strict';
import test from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { CodeLayout } from '../../ide/editor/ui/code/layout';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';

for (const debounce of [0, 200]) {
	test(`retiring a code layout cancels its ${debounce === 0 ? 'dispatch' : 'debounce'} work at the clock owner`, t => {
		const clock = new VirtualHeadlessClock();
		const scheduled = t.mock.method(clock, 'scheduleOnce');
		const layout = new CodeLayout(new EditorFont('tiny'), {
			maxHighlightCache: 64, semanticDebounceMs: debounce, clock,
			inlineEdit: { version: 0, active: false, row: 0, startColumn: 0, endColumn: 0, text: '', preserveCase: false },
			getBuiltinIdentifiers: () => ({ epoch: 0, ids: [] }), computeWrapWidth: () => 320,
		});
		layout.requestSemanticUpdate(new PieceTreeBuffer('return 1'), 1, { domain: 0, path: 'retired.lua' });
		const timer = scheduled.mock.calls[0].result!;
		assert.equal(timer.isActive(), true);
		layout.dispose();
		assert.equal(timer.isActive(), false, 'retired generations must release their queued work, not only ignore its result');
		clock.advance(200);
		assert.equal(scheduled.mock.callCount(), 1, 'retirement cannot enqueue a later dispatch');
	});
}

test('invalidating a live layout cancels the queued semantic dispatch before accepting another generation', t => {
	const clock = new VirtualHeadlessClock();
	const scheduled = t.mock.method(clock, 'scheduleOnce');
	const layout = new CodeLayout(new EditorFont('tiny'), {
		maxHighlightCache: 64, semanticDebounceMs: 0, clock,
		inlineEdit: { version: 0, active: false, row: 0, startColumn: 0, endColumn: 0, text: '', preserveCase: false },
		getBuiltinIdentifiers: () => ({ epoch: 0, ids: [] }), computeWrapWidth: () => 320,
	});
	t.after(() => layout.dispose());
	const buffer = new PieceTreeBuffer('return 1');
	layout.requestSemanticUpdate(buffer, 1, { domain: 0, path: 'generation.lua' });
	const retired = scheduled.mock.calls[0].result!;
	layout.invalidateAllHighlights();
	assert.equal(retired.isActive(), false);
	layout.requestSemanticUpdate(buffer, 1, { domain: 0, path: 'generation.lua' });
	assert.equal(scheduled.mock.calls[1].result!.isActive(), true, 'invalidation is not disposal of the live projection');
});

test('replacing the font retires the previous layout and its pending semantic work', t => {
	const clock = new VirtualHeadlessClock();
	configureFontVariant(clock, 'tiny', 'lua');
	const previous = editorViewState.layout;
	const scheduled = t.mock.method(clock, 'scheduleOnce');
	previous.requestSemanticUpdate(new PieceTreeBuffer('return 1'), 1, { domain: 0, path: 'font.lua' });
	const timer = scheduled.mock.calls[0].result!;
	assert.equal(timer.isActive(), true);
	configureFontVariant(clock, 'msx', 'lua');
	t.after(() => editorViewState.layout.dispose());
	assert.notEqual(editorViewState.layout, previous);
	assert.equal(timer.isActive(), false);
	clock.advance(200);
	assert.equal(scheduled.mock.callCount(), 1);
});
