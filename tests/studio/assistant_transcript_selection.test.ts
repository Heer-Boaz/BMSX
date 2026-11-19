import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { AssistantTranscriptSelection } from '../../ide/workbench/contrib/assistant/transcript_selection';
import { AssistantTranscriptProjection, TRANSCRIPT_IMAGE_ROWS } from '../../ide/workbench/contrib/assistant/projection';
import type { AssistantEntry } from '../../ide/workbench/services/assistant/transcript';
import { WorkspaceEditProposal } from '../../ide/workbench/services/working_copy/workspace_edit';
import { WorkspaceSourceContext } from '../../ide/workbench/services/working_copy/source_context';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function entry(index: number, text: string, images?: readonly string[], proposal?: WorkspaceEditProposal): AssistantEntry {
	return { index, text: new PieceTreeBuffer(text), images, proposal, kind: proposal === undefined ? 'assistant' : 'proposal', resetRevision: 0 };
}

function proposals(t: TestContext) {
	const models = new EditorTextModelService(), source = 'return before\n';
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('review.lua', 1, source)]);
	const model = models.retain(sources.catalog.luaResources[0], 'lua', source), created: WorkspaceEditProposal[] = [];
	const create = () => {
		const proposal = new WorkspaceEditProposal('Same proposal title', new WorkspaceSourceContext(models, sources.catalog), {
			kind: 'edit', edits: new Map([[model, { version: model.version, edits: [{ offset: 7, deleteLength: 6, text: 'after' }] }]]),
		});
		created.push(proposal); return proposal;
	};
	t.after(() => { for (const proposal of created) proposal.dispose(); models.clear(); });
	return { create, model, source };
}

test('duplicate image URLs retain distinct exact entry and slot identities', () => {
	const selection = new AssistantTranscriptSelection(), first = entry(0, 'First', ['same-url', 'same-url']), second = entry(1, 'Second', ['same-url']);
	let targets = 0, proposals = 0;
	selection.onWillChangeTarget(() => targets++); selection.onWillChangeProposal(() => proposals++);
	assert.equal(selection.select(first, 0), true);
	assert.equal(selection.entry, first); assert.equal(selection.imageIndex, 0); assert.equal(selection.proposal, undefined);
	assert.equal(selection.select(first, 0), false);
	assert.equal(selection.select(first, 1), true); assert.equal(selection.imageIndex, 1);
	assert.equal(selection.select(second, 0), true); assert.equal(selection.entry, second);
	assert.equal(selection.select(first), true); assert.equal(selection.imageIndex, undefined);
	assert.equal(targets, 4); assert.equal(proposals, 0);
	assert.deepEqual(first.images, ['same-url', 'same-url']); assert.equal(first.text.getText(), 'First');
});

test('proposal aliases change the target but not the actual admitted proposal identity', t => {
	const f = proposals(t), first = f.create(), second = f.create();
	const a = entry(0, 'Review', ['same-url'], first), alias = entry(1, 'Review alias', undefined, first), b = entry(2, 'Review', undefined, second);
	const selection = new AssistantTranscriptSelection();
	let targetChanges = 0, proposalChanges = 0;
	selection.onWillChangeTarget(() => targetChanges++); selection.onWillChangeProposal(() => proposalChanges++);
	selection.select(a); assert.equal(selection.proposal, first);
	selection.select(alias); assert.equal(selection.proposal, first);
	assert.equal(targetChanges, 2); assert.equal(proposalChanges, 1);
	selection.select(b); assert.equal(selection.proposal, second); assert.equal(proposalChanges, 2);
	selection.select(a, 0); assert.equal(selection.proposal, undefined); assert.equal(proposalChanges, 3);
	selection.select(a); assert.equal(selection.proposal, first); assert.equal(proposalChanges, 4);
	first.dispose(); assert.equal(selection.proposal, first, 'settlement changes the proposal state, not its identity');
	assert.equal(selection.select(a), false); assert.equal(proposalChanges, 4);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false); assert.equal(f.model.dirty, false);
});

test('target and proposal retirement callbacks precede publication and unsubscribe independently', t => {
	const f = proposals(t), proposal = f.create(), original = entry(0, 'Review', ['same-url'], proposal), next = entry(1, 'Next');
	const selection = new AssistantTranscriptSelection(); selection.select(original);
	const events: string[] = [];
	const target = selection.onWillChangeTarget(() => {
		events.push('target'); assert.equal(selection.entry, original); assert.equal(selection.imageIndex, undefined); assert.equal(selection.proposal, proposal);
	});
	const proposalListener = selection.onWillChangeProposal(() => {
		events.push('proposal'); assert.equal(selection.entry, original); assert.equal(selection.imageIndex, undefined); assert.equal(selection.proposal, proposal);
	});
	selection.select(next); assert.deepEqual(events, ['target', 'proposal']); assert.equal(selection.entry, next);
	target(); proposalListener(); selection.select(original); assert.deepEqual(events, ['target', 'proposal']);
});

test('navigation follows message/image order, includes duplicate URL slots and clamps at both ends', () => {
	const first = entry(0, 'First message', ['same-url', 'same-url']), imageOnly = entry(1, '', ['other-url']), last = entry(2, 'Last message');
	const entries = [first, imageOnly, last], selection = new AssistantTranscriptSelection();
	const expected = [[first, undefined], [first, 0], [first, 1], [imageOnly, 0], [last, undefined]] as const;
	for (const [entry, imageIndex] of expected) {
		assert.equal(selection.move(1, entries), true); assert.equal(selection.entry, entry); assert.equal(selection.imageIndex, imageIndex);
	}
	assert.equal(selection.move(1, entries), false); assert.equal(selection.entry, last);
	for (let index = expected.length - 2; index >= 0; index--) {
		assert.equal(selection.move(-1, entries), true); assert.equal(selection.entry, expected[index][0]); assert.equal(selection.imageIndex, expected[index][1]);
	}
	assert.equal(selection.move(-1, entries), false); assert.equal(selection.entry, first); assert.equal(selection.imageIndex, undefined);
	selection.select(undefined); assert.equal(selection.move(-1, entries), true); assert.equal(selection.entry, first);
	assert.deepEqual(entries.map(entry => entry.text.getText()), ['First message', '', 'Last message']);
});

test('empty image-only messages skip invisible message targets while empty proposals remain review targets', t => {
	const f = proposals(t), image = entry(0, '', ['same-url', 'same-url']), review = entry(1, '', ['same-url'], f.create());
	const selection = new AssistantTranscriptSelection();
	selection.select(image); assert.equal(selection.imageIndex, 0); assert.equal(selection.proposal, undefined);
	assert.equal(selection.move(-1, [image, review]), false);
	selection.select(review); assert.equal(selection.imageIndex, undefined); assert.equal(selection.proposal, review.proposal);
	selection.move(1, [image, review]); assert.equal(selection.imageIndex, 0); assert.equal(selection.proposal, undefined);
	selection.move(-1, [image, review]); assert.equal(selection.imageIndex, undefined); assert.equal(selection.proposal, review.proposal);
	selection.select(undefined); assert.equal(selection.move(1, []), false); assert.equal(selection.move(-1, []), false);
});

test('prepend and reindex retain the exact target without replaying retirement or changing authored arrays', () => {
	const target = entry(0, 'Retained', ['same-url', 'same-url']), following = entry(1, 'Following'), entries = [target, following];
	const selection = new AssistantTranscriptSelection(); selection.select(target, 1);
	let changes = 0; selection.onWillChangeTarget(() => changes++);
	entries.unshift(entry(0, 'Older'), entry(1, '', ['same-url']));
	entries.forEach((entry, index) => { entry.index = index; });
	assert.equal(selection.entry, target); assert.equal(selection.imageIndex, 1);
	assert.equal(selection.select(target, 1), false); assert.equal(changes, 0);
	assert.equal(selection.move(1, entries), true); assert.equal(selection.entry, following);
	assert.equal(selection.move(-1, entries), true); assert.equal(selection.entry, target); assert.equal(selection.imageIndex, 1);
	assert.equal(target.index, 2); assert.equal(changes, 2);
	assert.deepEqual(entries.map(entry => entry.text.getText()), ['Older', '', 'Retained', 'Following']);
});

test('explicit reset releases the target once and cannot revive it from a new equal-index entry', () => {
	const original = entry(0, '', ['same-url']), selection = new AssistantTranscriptSelection(); selection.select(original);
	let changes = 0; selection.onWillChangeTarget(() => changes++);
	assert.equal(selection.select(undefined), true); assert.equal(selection.entry, undefined); assert.equal(selection.imageIndex, undefined);
	assert.equal(selection.select(undefined), false); assert.equal(changes, 1);
	const replacement = entry(0, '', ['same-url']); selection.move(1, [replacement]);
	assert.equal(selection.entry, replacement); assert.notEqual(selection.entry, original); assert.equal(selection.imageIndex, 0);
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} projection publishes exact image-slot indices and reveals their actual first rows`, () => {
	const font = new Font({ variant }), view = new AssistantTranscriptProjection();
	const first = entry(0, '', ['same-url', 'same-url']), second = entry(1, 'A real wrapped message '.repeat(6), ['same-url', 'other-url']);
	const entries = [first, second], measure = (text: string, start: number, end: number) => font.measure(text.slice(start, end));
	view.update(entries, 118, measure, font); view.layout(0, 200);
	for (const entry of entries) for (let imageIndex = 0; imageIndex < entry.images!.length; imageIndex++) {
		const top = view.getSelectionTop(entry, imageIndex), row = view.rowAt(top)!;
		assert.equal(row.entry, entry); assert.equal(row.image!.index, imageIndex); assert.equal(row.image!.line, 0);
		assert.equal(row.image!.url, entry.images![imageIndex]);
		for (let line = 0; line < TRANSCRIPT_IMAGE_ROWS; line++) {
			const projected = view.rowAt(top + line)!;
			assert.equal(projected.image!.index, imageIndex); assert.equal(projected.image!.line, line);
		}
	}
	assert.equal(view.getSelectionTop(first, 0), 0);
	assert.equal(view.getSelectionTop(first, 1), TRANSCRIPT_IMAGE_ROWS);
});

test('selection and target lookup do not read or measure unrelated offscreen history and clean lookups stay cached', () => {
	const entries = Array.from({ length: 5000 }, (_, index) => entry(index, `Message ${index} ${'paragraph '.repeat(25)}`, ['same-url', 'same-url']));
	const reads = new Set<AssistantEntry>(); let measured = 0;
	for (const entry of entries) {
		const read = entry.text.getTextRange.bind(entry.text);
		entry.text.getTextRange = (start, end) => { reads.add(entry); return read(start, end); };
	}
	const selection = new AssistantTranscriptSelection(), view = new AssistantTranscriptProjection(), font = {};
	const measure = (_text: string, start: number, end: number) => { measured++; return end - start; };
	view.update(entries, 40, measure, font); const beforeMove = measured;
	selection.select(entries[2500], 1); selection.move(-1, entries); selection.move(1, entries);
	assert.equal(reads.size, 0); assert.equal(measured, beforeMove);
	const top = view.getSelectionTop(selection.entry!, selection.imageIndex);
	assert.deepEqual([...reads], [entries[2500]]);
	const warm = measured;
	for (let frame = 0; frame < 1000; frame++) assert.equal(view.getSelectionTop(selection.entry!, selection.imageIndex), top);
	assert.equal(measured, warm); assert.equal(reads.size, 1);
});

test('target lookup synchronizes the real retained array on append and prepend before the next pane update', () => {
	const first = entry(0, 'Current', ['same-url']), entries = [first], view = new AssistantTranscriptProjection(), font = {};
	const measure = (_text: string, start: number, end: number) => end - start;
	view.update(entries, 40, measure, font);
	const appended = entry(1, 'Later', ['same-url', 'same-url']); entries.push(appended);
	const selectedTop = view.getSelectionTop(appended, 1);
	assert.ok(selectedTop > view.getSelectionTop(appended, 0));
	view.layout(selectedTop, 200); assert.equal(view.rowAt(selectedTop)!.image!.index, 1);
	const older = entry(0, 'Older page', ['same-url']); entries.unshift(older); entries.forEach((entry, index) => { entry.index = index; });
	const prependedTop = view.getSelectionTop(appended, 1);
	assert.ok(prependedTop > selectedTop);
	view.layout(prependedTop, 200);
	assert.equal(view.rowAt(prependedTop)!.entry, appended); assert.equal(view.rowAt(prependedTop)!.image!.index, 1);
	assert.equal(appended.text.getText(), 'Later'); assert.deepEqual(appended.images, ['same-url', 'same-url']);
});

test('reset and text replacement rebuild only actual projections without reusing an equal URL as target identity', () => {
	const original = entry(0, 'Original text', ['same-url']), entries = [original], view = new AssistantTranscriptProjection(), font = {};
	const measure = (_text: string, start: number, end: number) => end - start;
	view.update(entries, 8, measure, font); view.layout(0, 100);
	const firstTop = view.getSelectionTop(original, 0);
	original.text.replace(0, original.text.length, 'Replacement text with more actual wrapped rows'); original.resetRevision++;
	view.invalidate(original);
	const replacedTop = view.getSelectionTop(original, 0); assert.ok(replacedTop > firstTop);
	view.layout(replacedTop, 100); assert.equal(view.rowAt(replacedTop)!.image!.index, 0);
	view.reset(); entries.length = 0; view.update(entries, 8, measure, font); view.layout(0, 100); assert.equal(view.rows.length, 0);
	const replacement = entry(0, '', ['same-url']); entries.push(replacement);
	assert.equal(view.getSelectionTop(replacement, 0), 0);
	view.layout(0, 100); assert.equal(view.rowAt(0)!.entry, replacement); assert.equal(view.rowAt(0)!.image!.index, 0);
	assert.equal(original.text.getText(), 'Replacement text with more actual wrapped rows');
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} image reveal survives a predecessor growing from estimated 100 rows to actual 1000 rows`, () => {
	const font = new Font({ variant }), quote = '> '.repeat(5);
	const source = `${quote}\`\`\`lua\n${quote}${'x'.repeat(1000)}\n${quote}\`\`\``;
	const previous = entry(0, source), target = entry(1, '', ['same-url', 'same-url']), tail = entry(2, 'tail\n'.repeat(30));
	const entries = [previous, target, tail], view = new AssistantTranscriptProjection();
	let measurements = 0; const reads = new Set<AssistantEntry>();
	for (const entry of entries) {
		const read = entry.text.getTextRange.bind(entry.text);
		entry.text.getTextRange = (start, end) => { reads.add(entry); return read(start, end); };
	}
	const measure = (text: string, start: number, end: number) => { measurements++; return font.measure(text.slice(start, end)); };
	view.update(entries, font.measure('m'.repeat(10)), measure, font);
	const estimatedStart = view.entryTop(target.index), estimatedImage = view.getSelectionTop(target, 0), visible = 10;
	assert.ok(estimatedStart >= 100 && estimatedStart < 120);
	assert.equal(reads.has(previous), false, 'the predecessor is still estimated when revealing the target starts');
	const top = view.revealSelection(target, 0, estimatedImage - 8, visible);
	const imageTop = view.getSelectionTop(target, 0);
	assert.ok(view.entryTop(target.index) >= 1000, 'real deeply quoted code wraps must refine the actual predecessor');
	assert.ok(top < view.entryTop(target.index), 'bottom alignment retains a legitimate negative offset relative to the selected entry');
	assert.ok(imageTop >= top && imageTop + TRANSCRIPT_IMAGE_ROWS <= top + visible);
	for (let line = 0; line < TRANSCRIPT_IMAGE_ROWS; line++) {
		const row = view.rowAt(imageTop + line)!;
		assert.equal(row.entry, target); assert.equal(row.image!.index, 0); assert.equal(row.image!.line, line);
	}
	assert.equal(view.layout(top, visible), top, 'the next ordinary frame must not restore the obsolete estimated scroll position');
	const rows = view.rows.slice(), warm = measurements, readCount = reads.size;
	for (let frame = 0; frame < 1000; frame++) assert.equal(view.revealSelection(target, 0, top, visible), top);
	assert.equal(measurements, warm); assert.equal(reads.size, readCount);
	assert.ok(view.rows.every((row, index) => row === rows[index]), 'clean reveals retain actual materialized row objects');
	assert.equal(previous.text.getText(), source);
});

test('shrinking predecessor estimates clamp a negative selection anchor without hiding any image row', () => {
	const previous = entry(0, `[label]: https://example.test/${'a'.repeat(2000)}`), target = entry(1, '', ['same-url']), tail = entry(2, 'tail\n'.repeat(30));
	const entries = [previous, target, tail], view = new AssistantTranscriptProjection(), font = {};
	const measure = (_text: string, start: number, end: number) => end - start;
	view.update(entries, 10, measure, font);
	const estimatedStart = view.entryTop(target.index), estimatedImage = view.getSelectionTop(target, 0);
	assert.ok(estimatedStart > 200);
	const visible = 10, top = view.revealSelection(target, 0, estimatedImage - 8, visible), imageTop = view.getSelectionTop(target, 0);
	assert.equal(view.entryTop(target.index), 1, 'a Markdown reference definition contributes no rendered message text');
	assert.equal(top, 0, 'the selected-entry-relative negative anchor clamps only at the real document origin');
	assert.ok(imageTop >= top && imageTop + TRANSCRIPT_IMAGE_ROWS <= top + visible);
	for (let line = 0; line < TRANSCRIPT_IMAGE_ROWS; line++) assert.equal(view.rowAt(imageTop + line)!.image!.line, line);
	assert.equal(view.layout(top, visible), top);
});

test('an oversized image tile lead-aligns its first actual row and stays there on the next ordinary layout', () => {
	const entries = [entry(0, 'Before\n'.repeat(50)), entry(1, 'Image text', ['same-url', 'same-url']), entry(2, 'After\n'.repeat(50))];
	const target = entries[1], view = new AssistantTranscriptProjection(), font = {};
	const measure = (_text: string, start: number, end: number) => end - start;
	view.update(entries, 30, measure, font);
	const visible = 3, top = view.revealSelection(target, 1, 0, visible), imageTop = view.getSelectionTop(target, 1);
	assert.equal(top, imageTop, 'a six-row image cannot be fully shown in three rows; its start is the honest navigation target');
	for (let line = 0; line < visible; line++) {
		const row = view.rowAt(top + line)!;
		assert.equal(row.entry, target); assert.equal(row.image!.index, 1); assert.equal(row.image!.line, line);
	}
	assert.equal(view.layout(top, visible), top);
});

test('selection reveal retains an exact duplicate-URL slot across prepend and two-way font reflow', () => {
	const quote = '> '.repeat(5), previous = entry(0, `${quote}\`\`\`lua\n${quote}${'x'.repeat(400)}\n${quote}\`\`\``);
	const target = entry(1, '', ['same-url', 'same-url']), entries = [previous, target, entry(2, 'Tail\n'.repeat(50))];
	const selection = new AssistantTranscriptSelection(), view = new AssistantTranscriptProjection(); selection.select(target, 1);
	let font = new Font({ variant: 'tiny' }); const measure = (text: string, start: number, end: number) => font.measure(text.slice(start, end));
	view.update(entries, font.measure('m'.repeat(10)), measure, font);
	let top = view.revealSelection(target, 1, 0, 10);
	const older = entry(0, '', ['same-url', 'same-url']); entries.unshift(older); entries.forEach((entry, index) => { entry.index = index; });
	// No intervening pane update: reveal must synchronize the actual retained entry sequence itself.
	top = view.revealSelection(selection.entry!, selection.imageIndex, top, 10);
	for (const variant of ['msx', 'tiny', 'msx', 'tiny'] as const) {
		font = new Font({ variant }); view.update(entries, variant === 'tiny' ? 78 : 118, measure, font);
		top = view.revealSelection(selection.entry!, selection.imageIndex, top, 10);
		const imageTop = view.getSelectionTop(target, 1);
		assert.ok(imageTop >= top && imageTop + TRANSCRIPT_IMAGE_ROWS <= top + 10);
		assert.equal(selection.entry, target); assert.equal(selection.imageIndex, 1);
		for (let line = 0; line < TRANSCRIPT_IMAGE_ROWS; line++) {
			const row = view.rowAt(imageTop + line)!;
			assert.equal(row.entry, target); assert.equal(row.image!.index, 1); assert.equal(row.image!.line, line);
		}
		assert.equal(view.layout(top, 10), top);
	}
	assert.equal(target.index, 2); assert.deepEqual(target.images, ['same-url', 'same-url']);
});

test('queued text invalidation follows the actual entry through prepend before the next projection update', () => {
	const first = entry(0, 'First message'), target = entry(1, 'old text', ['same-url']);
	const entries = [first, target], view = new AssistantTranscriptProjection(), font = {};
	const measure = (_text: string, start: number, end: number) => end - start;
	view.update(entries, 20, measure, font); view.layout(0, 100);
	const oldImageTop = view.getSelectionTop(target, 0);
	target.text.insert(target.text.length, ' ADDED_MARKER with enough text for more actual rows');
	view.invalidate(target);
	const older = entry(0, 'Earlier page', ['same-url']); entries.unshift(older);
	entries.forEach((entry, index) => { entry.index = index; });
	const imageTop = view.getSelectionTop(target, 0); view.layout(imageTop, 100);
	const rendered = view.rows.filter(row => row.entry === target && !row.heading && !row.image).map(row => row.text).join(' ');
	assert.ok(rendered.includes('ADDED_MARKER'), 'a queued source delta cannot move to another entry after its index changes');
	assert.ok(imageTop > oldImageTop, 'the real appended text must move the target image below its new wrapped rows');
	assert.equal(view.rowAt(imageTop)!.entry, target); assert.equal(view.rowAt(imageTop)!.image!.index, 0);
	assert.equal(first.text.getText(), 'First message'); assert.equal(older.text.getText(), 'Earlier page');
	assert.equal(target.text.getText(), 'old text ADDED_MARKER with enough text for more actual rows');
});
