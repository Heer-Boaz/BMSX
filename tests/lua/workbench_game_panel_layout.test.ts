import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { resourceIdentityKey } from '../../ide/common/resource';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { WorkspaceEditReviewInput } from '../../ide/workbench/contrib/edit_review/editor_input';
import { WorkspaceEditProposal } from '../../ide/workbench/services/working_copy/workspace_edit';
import { WorkspaceSourceContext } from '../../ide/workbench/services/working_copy/source_context';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext, variant: 'tiny' | 'msx') {
	const host = createHostFrameFixture(), record = createScenarioTestSourceRecord('review.lua', 1, 'return 1\n');
	const sources = createScenarioTestSourceState([record]);
	const unused = (): never => { throw new Error('Companion layout does not execute domain work.'); };
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused,
		{ measureDisplay: () => ({ left: 0, top: 0, width: 700, height: 288 }) }, host.input, host.audio, host.tasks,
		host.execution, host.rewind, host.clock, new HeadlessClipboard(), new IdeMicrotaskQueue(), { log() {} }, 0.3,
		{ width: 700, height: 288 }, sources, new Map(), unused, unused, unused);
	editorRuntimeState.active = true; ide.editor.setFontVariant(variant);
	host.input.setPointerAdmissionMode('routed');
	const resource = sources.catalog.resourceByIdentity.get(resourceIdentityKey({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'review.lua' }))!;
	const model = editorTextModelService.retain(resource, 'lua', record.src);
	const proposal = new WorkspaceEditProposal('Review', new WorkspaceSourceContext(editorTextModelService, sources.catalog), {
		kind: 'edit', edits: new Map([[model, { version: model.version, edits: [{ offset: 7, deleteLength: 1, text: '2' }] }]]),
	});
	const input = new WorkspaceEditReviewInput(proposal), editor = ide.editor;
	editor.editorGroup.openEditor(input);
	const pane = editor.editorGroup.panes.activePane!;
	let minimum: number | undefined = 200, buttons = 0;
	// A container-layout test programs its child's declared constraint. The real
	// reader, focus, pointer routing and workbench composition remain attached.
	const constraint = t.mock.getter(pane, 'companionGameMinimumWidth', () => minimum);
	const arrange = (width = 700, height = 288) => { editor.updateViewport({ width, height }); editor.update(0); };
	const pointer = (x: number, y: number, nextButtons = buttons) => {
		editor.dispatchPointer({ x, y, buttons: nextButtons, pressedButtons: nextButtons & ~buttons,
			releasedButtons: buttons & ~nextButtons, cancelledButtons: 0, modifiers: KeyModifier.none,
			spaceDown: false, timestamp: host.clock.now() });
		buttons = nextButtons;
	};
	const drag = (x: number) => {
		const y = input.layout.top + 30;
		pointer(input.layout.right + 2, y, PointerButton.Primary); pointer(x, y); pointer(x, y, 0); editor.update(0);
	};
	editor.gamePanel.toggle(); arrange();
	t.after(async () => {
		inputFocus.setTarget(null); await editor.shutdown(); host.audio.dispose(); host.input.dispose();
	});
	return { editor, input, model, proposal, pane, arrange, drag, pointer, constraint, setMinimum: (value: number | undefined) => { minimum = value; } };
}

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} companion sash preserves both client minima and its own separation`, t => {
		const f = fixture(t, variant);
		assert.equal(f.editor.gamePanel.visible, true);
		f.drag(0);
		// These dimensions are the layout algorithm's contract, not UI snapshots:
		// complete primary client + 4px sash + 160px frame with 4px side padding.
		assert.equal(f.input.layout.right - f.input.layout.left, 200);
		const required = 200 + 4 + 160 + 8;
		f.arrange(required - 1);
		assert.equal(f.editor.gamePanel.visible, false);
		assert.equal(f.editor.gamePanel.enabled, true);
		f.arrange(required);
		assert.equal(f.editor.gamePanel.visible, true);
		assert.equal(f.input.layout.right - f.input.layout.left, 200);
		assert.equal(f.model.buffer.getText(), 'return 1\n');
		assert.equal(f.model.canUndo, false); assert.equal(f.proposal.state, 'pending');
	});

	test(`${variant} companion admission reads current owner constraints and retains placement through passive clamps`, t => {
		const f = fixture(t, variant);
		f.drag(310); const preferred = f.input.layout.right;
		f.arrange(300); assert.equal(f.editor.gamePanel.visible, false);
		assert.equal(f.editor.commands.isActive('gameView.togglePanel'), true);
		f.arrange(); assert.equal(f.input.layout.right, preferred);
		f.setMinimum(550); f.editor.update(0);
		assert.equal(f.editor.gamePanel.visible, false);
		f.setMinimum(200); f.editor.update(0);
		assert.equal(f.editor.gamePanel.visible, true); assert.equal(f.input.layout.right, preferred);
		f.setMinimum(undefined); f.editor.update(0);
		assert.equal(f.editor.gamePanel.visible, false);
		assert.equal(f.editor.commands.isEnabled('gameView.togglePanel'), false);
		assert.equal(f.editor.commands.isEnabled('gameView.closePanel'), true);
		f.editor.commands.execute('gameView.closePanel'); f.editor.update(0);
		assert.equal(f.editor.gamePanel.enabled, false);
		assert.equal(f.editor.commands.isActive('gameView.togglePanel'), false);
	});

	test(`${variant} insufficient preview height retires guest focus without replacing source-review ownership`, t => {
		const f = fixture(t, variant);
		f.pane.focus(); const reader = inputFocus.target;
		f.pointer(f.input.layout.right + 80, f.input.layout.top + 100, PointerButton.Primary);
		f.pointer(f.input.layout.right + 80, f.input.layout.top + 100, 0);
		assert.notEqual(inputFocus.target, reader);
		f.arrange(700, 120);
		assert.equal(f.editor.gamePanel.visible, false);
		assert.equal(inputFocus.target, reader);
		assert.equal(f.editor.editorGroup.panes.activePane, f.pane);
		assert.equal(f.editor.editorGroup.panes.activePane!.input, f.input);
		assert.equal(f.proposal.state, 'pending'); assert.equal(f.model.canUndo, false);
	});

	test(`${variant} a closed companion does not ask its pane to measure a presentation that is not requested`, t => {
		const f = fixture(t, variant);
		f.editor.gamePanel.close();
		const calls = f.constraint.mock.callCount();
		for (let frame = 0; frame < 1000; frame++) f.editor.gamePanel.update();
		assert.equal(f.constraint.mock.callCount(), calls);
	});
}
