import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { SCROLLBAR_WIDTH } from '../../ide/common/constants';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { resourceIdentityKey } from '../../ide/common/resource';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { measureText } from '../../ide/editor/common/text/layout';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { api } from '../../ide/runtime/overlay_api';
import { WorkspaceEditReviewInput } from '../../ide/workbench/contrib/edit_review/editor_input';
import { WorkspaceEditProposal } from '../../ide/workbench/services/working_copy/workspace_edit';
import { WorkspaceSourceContext } from '../../ide/workbench/services/working_copy/source_context';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

const SOURCE = Array.from({ length: 30 }, (_, index) => `local value_${index} = 'before\t🐉 ${'source words '.repeat(8)}'\r\n`).join('');

function fixture(t: TestContext, variant: 'tiny' | 'msx') {
	const host = createHostFrameFixture(), record = createScenarioTestSourceRecord('review.lua', 1, SOURCE);
	const sources = createScenarioTestSourceState([record]);
	const unused = (): never => { throw new Error('Review layout does not execute domain work.'); };
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused,
		{ measureDisplay: () => ({ left: 0, top: 0, width: 384, height: 288 }) }, host.input, host.audio, host.tasks,
		host.execution, host.rewind, host.clock, new HeadlessClipboard(), new IdeMicrotaskQueue(), { log() {} }, 0.3,
		{ width: 384, height: 288 }, sources, new Map(), unused, unused, unused);
	editorRuntimeState.active = true;
	ide.editor.setFontVariant(variant);
	const resource = sources.catalog.resourceByIdentity.get(resourceIdentityKey({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'review.lua' }))!;
	const model = editorTextModelService.retain(resource, 'lua', SOURCE);
	const proposal = new WorkspaceEditProposal('Review canonical source and retain the complete prospective change', new WorkspaceSourceContext(editorTextModelService, sources.catalog), {
		kind: 'edit', edits: new Map([[model, { version: model.version, edits: [{ offset: 0, deleteLength: SOURCE.length, text: SOURCE.replaceAll('before', 'after') }] }]]),
	});
	const input = new WorkspaceEditReviewInput(proposal);
	ide.editor.editorParts.main.activeGroup.openEditor(input);
	const pane = ide.editor.editorParts.main.activeGroup.panes.activePane!;
	const arrange = (left: number, right: number, nextVariant = editorViewState.font.variant, bottom = 276) => {
		if (nextVariant !== editorViewState.font.variant) ide.editor.setFontVariant(nextVariant);
		pane.layout({ left, top: 31, right, bottom }); pane.update(0);
	};
	t.after(async () => {
		inputFocus.setTarget(null); await ide.editor.shutdown(); host.audio.dispose(); host.input.dispose();
	});
	return { input, model, proposal, pane, arrange, host, ide };
}

for (const command of ['workspaceEditReview.apply', 'workspaceEditReview.discard'] as const) {
	test(`the attached review reading client admits ${command} and shares its actual handler`, t => {
		const f = fixture(t, 'tiny');
		f.pane.focus();
		const client = inputFocus.target!, owner = client.parent!;
		assert.ok(client.getCommand(command));
		assert.equal(client.getCommand(command), owner.getCommand(command));
		assert.equal(f.ide.editor.commands.isEnabled(command, client), true);
		f.ide.editor.commands.execute(command, client);
		assert.equal(f.proposal.state, command === 'workspaceEditReview.apply' ? 'applied' : 'discarded');
		assert.equal(f.model.buffer.getText(), command === 'workspaceEditReview.apply' ? SOURCE.replaceAll('before', 'after') : SOURCE);
		assert.equal(f.ide.editor.commands.isEnabled(command, client), false);
	});
}

test('a detached review reading client cannot admit or dispatch its pending proposal', t => {
	const f = fixture(t, 'tiny');
	f.pane.focus();
	const client = inputFocus.target!, owner = client.parent!;
	f.pane.clearInput();
	for (const command of ['workspaceEditReview.apply', 'workspaceEditReview.discard'] as const) {
		assert.equal(f.ide.editor.commands.isEnabled(command, client), false);
		f.ide.editor.commands.execute(command, client);
		assert.equal(f.ide.editor.commands.isEnabled(command, owner), false);
		f.ide.editor.commands.execute(command, owner);
	}
	assert.equal(f.proposal.state, 'pending');
	assert.equal(f.model.buffer.getText(), SOURCE);
	f.pane.setInput(f.input, { left: 0, top: 31, right: 384, bottom: 276 });
	assert.equal(f.ide.editor.commands.isEnabled('workspaceEditReview.apply', client), true);
});

for (const variant of ['tiny', 'msx'] as const) {
	// Pixel positions and widths here are the explicit pane-layout algorithm,
	// not an end-to-end screenshot or incidental caption oracle.
	test(`${variant} review text, clips and wrapping consume the actual offset client`, t => {
		const f = fixture(t, variant), { input } = f;
		f.arrange(115, 384);
		const width = 384 - 115, textWidth = width - SCROLLBAR_WIDTH - 8;
		assert.equal(input.viewport.bounds.left, 119);
		assert.equal(input.viewport.bounds.right, 384 - SCROLLBAR_WIDTH);
		assert.equal(input.projectedWidth, textWidth);
		assert.ok(measureText(input.status) <= width - 8);
		assert.ok(measureText(input.heading) <= input.actionBar.items[0].bounds.left - 115 - 8);
		for (const row of input.rows) assert.ok(measureText(row.text) <= textWidth);
		const glyphs = t.mock.method(api, 'blit_text_inline_with_font');
		f.ide.overlayRenderer.beginFrame(f.host.presenter); api.beginFrame(f.ide.overlayRenderer);
		f.pane.draw(); f.ide.overlayRenderer.endFrame(); f.host.presenter.hostOverlayQueue.consumeOverlayFrame();
		const calls = glyphs.mock.calls;
		assert.equal(calls.find(call => call.arguments[0] === input.heading)!.arguments[1], 119);
		assert.equal(calls.find(call => call.arguments[0] === input.status)!.arguments[1], 119);
		const body = calls.filter(call => call.arguments[2] >= input.viewport.bounds.top);
		assert.ok(body.length > 0); assert.ok(body.every(call => call.arguments[1] === 119));
		f.arrange(115, 384, variant, 32);
		assert.equal(input.viewport.bounds.top, 32); assert.equal(input.viewport.bounds.bottom, 32);
	});

	test(`${variant} translation retains projection and 1000 idle updates do no glyph measurement`, t => {
		const f = fixture(t, variant), { input } = f;
		f.arrange(0, 269);
		const first = input.rows[0], text = input.rows.map(row => row.text), projection = t.mock.method(input.rowStorage, 'clear');
		f.arrange(115, 384);
		assert.equal(projection.mock.callCount(), 0, 'an equal-width origin change is not a text reflow');
		assert.equal(input.rows[0], first); assert.deepEqual(input.rows.map(row => row.text), text);
		const advance = t.mock.method(editorViewState.font, 'advance');
		for (let frame = 0; frame < 1000; frame++) f.pane.update(0);
		assert.equal(advance.mock.callCount(), 0); assert.equal(projection.mock.callCount(), 0);
	});

	test(`${variant} Files-sized reflow, font changes and detach preserve exact source intent and End`, t => {
		const f = fixture(t, variant), { input, model, proposal } = f;
		f.arrange(0, 384);
		const index = input.rows.findIndex(row => row.kind === 'after' && row.start > 500 && row.decoration === 0);
		assert.ok(index > 0);
		input.reading.noteUserScroll(); input.viewport.scrollbar.setScroll((index + 0.375) * input.layout.rowHeight);
		input.reading.capture(input.viewport, input.rows);
		const { line, offset, decoration, fraction } = input.reading, top = input.viewport.scrollTop;
		for (const font of [variant === 'tiny' ? 'msx' : 'tiny', variant] as const) {
			f.arrange(115, 384, font);
			assert.equal(input.reading.line, line); assert.equal(input.reading.offset, offset);
			assert.equal(input.reading.decoration, decoration); assert.equal(input.reading.fraction, fraction);
		}
		f.pane.clearInput(); f.pane.setInput(input, { left: 115, top: 31, right: 384, bottom: 276 });
		assert.equal(input.reading.line, line); assert.equal(input.reading.offset, offset);
		f.arrange(0, 384); assert.equal(input.viewport.scrollTop, top);
		f.pane.focus(); inputFocus.handleKeyboard(new KeyInputEvent('End', KeyModifier.none, false, true));
		assert.equal(input.reading.edge, 'end');
		f.arrange(115, 384, variant === 'tiny' ? 'msx' : 'tiny', 32);
		f.arrange(0, 384, variant);
		assert.equal(input.reading.edge, 'end');
		assert.equal(input.viewport.scrollTop, input.viewport.scrollbar.getMaximumScroll());
		assert.equal(model.buffer.getText(), SOURCE); assert.equal(model.canUndo, false); assert.equal(model.dirty, false);
		assert.equal(proposal.state, 'pending');
		const file = input.proposal.files[0]; assert.ok(file.kind === 'edit'); assert.equal(file.model, model);
	});
}
