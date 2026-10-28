import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { SCROLLBAR_WIDTH } from '../../ide/common/constants';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { resourceIdentityKey } from '../../ide/common/resource';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { getWorkbenchEditorBounds } from '../../ide/workbench/common/layout';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { WORKBENCH_SPLIT_SIZE } from '../../ide/workbench/ui/split_view';
import type { EditorPaneConstraints } from '../../ide/workbench/services/editor/editor_pane';
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
	// These source-only fixtures exercise layout, not an admitted bootable Studio command.
	// Publish real font metrics after construction rather than calling the unavailable UI action.
	editorRuntimeState.active = true; configureFontVariant(variant);
	ide.editor.resourcePanel.setFontMetrics(editorViewState.font);
	assert.equal(editorViewState.font.variant, variant);
	host.input.setPointerAdmissionMode('routed');
	const resource = sources.catalog.resourceByIdentity.get(resourceIdentityKey({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'review.lua' }))!;
	const model = editorTextModelService.retain(resource, 'lua', record.src);
	const proposal = new WorkspaceEditProposal('Review', new WorkspaceSourceContext(editorTextModelService, sources.catalog), {
		kind: 'edit', edits: new Map([[model, { version: model.version, edits: [{ offset: 7, deleteLength: 1, text: '2' }] }]]),
	});
	const input = new WorkspaceEditReviewInput(proposal), editor = ide.editor;
	const group = editor.editorParts.main.activeGroup;
	group.openEditor(input);
	const pane = group.panes.activePane!;
	let minimum: number | undefined = 200, buttons = 0;
	// A container-layout test programs its child's declared constraint. The real
	// reader, focus, pointer routing and workbench composition remain attached.
	const measure = group.panes.measure;
	const constraint = t.mock.method(group.panes, 'measure', (candidate, font, companionRequested, target) => {
		measure.call(group.panes, candidate, font, companionRequested, target);
		if (candidate === input) target.companionWidth = companionRequested ? minimum : undefined;
	});
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
	return { ide, host, sources, editor, input, model, proposal, pane, arrange, drag, pointer, constraint, setMinimum: (value: number | undefined) => { minimum = value; } };
}

function splitFixture(t: TestContext, variant: 'tiny' | 'msx') {
	const f = fixture(t, variant), parts = f.editor.editorParts, main = parts.main, reviewGroup = main.activeGroup;
	f.editor.gamePanel.close();
	const sourceGroup = parts.splitGroup(reviewGroup, 'right')!;
	const source = resolveLuaCodeEditorInput(f.sources.catalog, f.model.resource);
	sourceGroup.openEditor(source); f.editor.gamePanel.toggle(); f.arrange(1100, 720);
	const sourcePane = sourceGroup.panes.activePane!;
	assert.ok(sourcePane.input === source && reviewGroup.panes.activePane === f.pane);
	return { ...f, parts, main, reviewGroup, sourceGroup, source, sourcePane };
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
		assert.equal(f.editor.editorParts.main.activeGroup.panes.activePane, f.pane);
		assert.equal(f.editor.editorParts.main.activeGroup.panes.activePane!.input, f.input);
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

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} companion preserves both real Main clients' reading budgets under hostile inner ratios`, t => {
		const f = splitFixture(t, variant), root = f.main.arrangement.root;
		assert.ok(root.kind === 'split');
		const reviewWidth = Math.max(f.reviewGroup.minimumWidth, f.reviewGroup.companionWidth!);
		const sourceWidth = Math.max(f.sourceGroup.minimumWidth, f.sourceGroup.companionWidth!);
		const required = reviewWidth + WORKBENCH_SPLIT_SIZE + sourceWidth + 4 + 168;
		for (const ratio of [0.99, -3]) {
			root.split.ratio = ratio; f.arrange(required, 720);
			assert.equal(f.editor.gamePanel.visible, true);
			assert.ok(f.reviewGroup.bounds.right - f.reviewGroup.bounds.left >= reviewWidth);
			assert.ok(f.sourceGroup.bounds.right - f.sourceGroup.bounds.left >= sourceWidth);
			assert.equal(root.split.ratio, ratio);
			f.arrange(required - 1, 720); assert.equal(f.editor.gamePanel.visible, false);
			assert.equal(f.editor.gamePanel.enabled, true); assert.equal(root.split.ratio, ratio);
			f.arrange(required, 720); assert.equal(f.editor.gamePanel.visible, true);
			assert.ok(f.reviewGroup.bounds.right - f.reviewGroup.bounds.left >= reviewWidth);
			assert.ok(f.sourceGroup.bounds.right - f.sourceGroup.bounds.left >= sourceWidth);
		}
		assert.ok(f.main.groups.includes(f.reviewGroup) && f.main.groups.includes(f.sourceGroup));
		assert.ok(f.source.workingCopy === f.model && f.sourceGroup.panes.activePane === f.sourcePane);
		assert.equal(f.model.buffer.getText(), 'return 1\n'); assert.equal(f.model.canUndo, false); assert.equal(f.proposal.state, 'pending');
	});

	test(`${variant} an opted-out sibling contributes hard chrome while the active optout withholds the companion`, t => {
		const f = splitFixture(t, variant), game = new GameViewInput();
		f.reviewGroup.openEditor(game, { preserveFocus: true }); f.arrange(1100, 720);
		assert.ok(f.main.activeGroup === f.sourceGroup); assert.equal(f.editor.gamePanel.visible, true);
		const required = f.reviewGroup.minimumWidth + WORKBENCH_SPLIT_SIZE
			+ Math.max(f.sourceGroup.minimumWidth, f.sourceGroup.companionWidth!) + 4 + 168;
		f.arrange(required, 720); assert.equal(f.editor.gamePanel.visible, true);
		f.arrange(required - 1, 720); assert.equal(f.editor.gamePanel.visible, false);
		f.arrange(required, 720); f.reviewGroup.focus(); f.editor.update(0);
		assert.ok(f.main.activeGroup === f.reviewGroup && f.reviewGroup.model.activeTab === game);
		assert.equal(f.editor.gamePanel.visible, false); assert.equal(f.editor.gamePanel.enabled, true);
		f.sourceGroup.focus(); f.editor.update(0);
		assert.equal(f.editor.gamePanel.visible, true); assert.ok(f.sourceGroup.model.activeTab === f.source && f.source.workingCopy === f.model);
	});

	test(`${variant} nested reading budgets use the visible maximized leaf and restore the retained normal topology`, t => {
		const f = splitFixture(t, variant), lower = f.parts.splitGroup(f.sourceGroup, 'down')!, view = f.source.createView();
		lower.openEditor(view); f.arrange(1100, 720);
		const root = f.main.arrangement.root;
		assert.ok(root.kind === 'split' && root.second.kind === 'split');
		root.split.ratio = 0.99; root.second.split.ratio = 0.01;
		const sourceWidth = Math.max(f.sourceGroup.minimumWidth, f.sourceGroup.companionWidth!);
		const normalRequired = Math.max(f.reviewGroup.minimumWidth, f.reviewGroup.companionWidth!) + WORKBENCH_SPLIT_SIZE + sourceWidth + 4 + 168;
		f.arrange(normalRequired, 720); assert.equal(f.editor.gamePanel.visible, true);
		for (const group of [f.sourceGroup, lower]) assert.ok(group.bounds.right - group.bounds.left >= sourceWidth);
		f.main.arrangement.toggleMaximize(f.sourceGroup); f.sourceGroup.focus(); f.arrange(sourceWidth + 4 + 168, 720);
		assert.equal(f.editor.gamePanel.visible, true); assert.ok(f.main.arrangement.maximized === f.sourceGroup);
		assert.equal(f.main.arrangement.leaves.find(leaf => leaf.group === f.reviewGroup)!.visible, false);
		assert.equal(f.main.arrangement.leaves.find(leaf => leaf.group === lower)!.visible, false);
		f.main.arrangement.toggleMaximize(f.sourceGroup); f.arrange(sourceWidth + 4 + 168, 720);
		assert.equal(f.editor.gamePanel.visible, false);
		f.arrange(normalRequired, 720); assert.equal(f.editor.gamePanel.visible, true);
		assert.ok(f.main.arrangement.root === root && f.sourceGroup.panes.activePane === f.sourcePane && lower.model.activeTab === view);
		assert.equal(root.split.ratio, 0.99); assert.equal(root.second.split.ratio, 0.01);
		assert.ok(view.workingCopy === f.model); assert.equal(f.model.canUndo, false); assert.equal(f.proposal.state, 'pending');
	});

	test(`${variant} parent allocation reserves the Files origin exactly once for real split clients`, t => {
		const f = splitFixture(t, variant);
		f.editor.commands.execute('resources'); f.editor.update(0);
		const full = getWorkbenchEditorBounds(), area = f.parts.mainArea;
		assert.equal(f.editor.resourcePanel.visible, true); assert.ok(full.left > 0);
		assert.deepEqual(area.availableBounds, full);
		assert.equal(f.main.clientBounds.left, full.left); assert.equal(f.reviewGroup.bounds.left, full.left);
		assert.equal(f.editor.gamePanel.visible, true);
		assert.equal(area.companionBounds.right, full.right);
		assert.equal(area.companionBounds.left - area.primaryBounds.right, 4);
		assert.ok(f.sourceGroup.bounds.right - f.sourceGroup.bounds.left >= f.sourceGroup.companionWidth!);
	});

	test(`${variant} vertical hard overflow reserves its scrollbar before exact companion admission`, t => {
		const f = splitFixture(t, variant);
		let last = f.sourceGroup;
		for (let index = 0; index < 7; index++) {
			last = f.parts.splitGroup(last, 'down')!; last.openEditor(f.source.createView());
		}
		f.arrange(1200, 900);
		const area = f.parts.mainArea, hardHeight = f.main.arrangement.minimumHeight;
		const chromeHeight = 900 - (area.availableBounds.bottom - area.availableBounds.top);
		const readingWidth = Math.max(f.reviewGroup.minimumWidth, f.reviewGroup.companionWidth!) + WORKBENCH_SPLIT_SIZE
			+ Math.max(f.sourceGroup.minimumWidth, f.sourceGroup.companionWidth!);
		const required = readingWidth + SCROLLBAR_WIDTH + 4 + 168;
		f.arrange(required, hardHeight - 1 + chromeHeight);
		assert.ok(f.main.arrangement.minimumHeight > area.availableBounds.bottom - area.availableBounds.top);
		assert.equal(f.editor.gamePanel.visible, true);
		assert.equal(f.main.clientBounds.right - f.main.clientBounds.left, readingWidth + SCROLLBAR_WIDTH);
		assert.equal(f.main.arrangement.bounds.right - f.main.arrangement.bounds.left, readingWidth);
		assert.equal(f.main.arrangement.maxScrollX, 0); assert.ok(f.main.arrangement.maxScrollY > 0);
		for (const group of f.main.groups) assert.ok(group.bounds.right - group.bounds.left
			>= Math.max(group.minimumWidth, group.companionWidth!));
		f.arrange(required - 1, hardHeight - 1 + chromeHeight); assert.equal(f.editor.gamePanel.visible, false);
		assert.equal(f.editor.gamePanel.enabled, true); assert.equal(f.model.canUndo, false);
	});
}

test('font publication before viewport synchronization remeasures actual Source budgets without replacing either view', t => {
	const f = splitFixture(t, 'tiny');
	const required = Math.max(f.reviewGroup.minimumWidth, f.reviewGroup.companionWidth!) + WORKBENCH_SPLIT_SIZE
		+ Math.max(f.sourceGroup.minimumWidth, f.sourceGroup.companionWidth!) + 4 + 168;
	f.arrange(required, 720); assert.equal(f.editor.gamePanel.visible, true);
	configureFontVariant('msx'); f.editor.update(0);
	assert.equal(editorViewState.font.variant, 'msx');
	assert.equal(f.editor.gamePanel.visible, false);
	f.editor.updateViewport({ width: required, height: 720 }); f.editor.update(0);
	assert.equal(f.editor.gamePanel.visible, false); assert.equal(f.editor.gamePanel.enabled, true);
	configureFontVariant('tiny'); f.editor.update(0); assert.equal(f.editor.gamePanel.visible, true);
	assert.ok(f.sourceGroup.panes.activePane === f.sourcePane && f.reviewGroup.panes.activePane === f.pane);
	assert.ok(f.source.workingCopy === f.model); assert.equal(f.model.canUndo, false); assert.equal(f.proposal.state, 'pending');
});

test('normal Main frames query each requested reading budget once and tick each concrete pane once', t => {
	const f = splitFixture(t, 'tiny');
	const sourceBudget = t.mock.method(f.sourceGroup.panes, 'measure');
	const sourceUpdate = t.mock.method(f.sourcePane, 'update'), reviewUpdate = t.mock.method(f.pane, 'update');
	const reviewCalls = f.constraint.mock.callCount();
	for (let frame = 0; frame < 20; frame++) f.editor.update(0);
	assert.equal(sourceBudget.mock.callCount(), 20); assert.equal(f.constraint.mock.callCount() - reviewCalls, 20);
	assert.equal(sourceUpdate.mock.callCount(), 20); assert.equal(reviewUpdate.mock.callCount(), 20);
	f.editor.gamePanel.close(); f.editor.update(0);
	const sourceClosed = sourceBudget.mock.calls.filter(call => call.arguments[2]).length;
	const reviewClosed = f.constraint.mock.calls.filter(call => call.arguments[2]).length;
	for (let frame = 0; frame < 20; frame++) f.editor.update(0);
	assert.equal(sourceBudget.mock.calls.filter(call => call.arguments[2]).length, sourceClosed);
	assert.equal(f.constraint.mock.calls.filter(call => call.arguments[2]).length, reviewClosed);
});

// Preview/commit rectangle equality is the placement algorithm's contract. These
// are real input transfers, not snapshots of incidental editor chrome.
for (const variant of ['tiny', 'msx'] as const) for (const movingActive of [true, false])
	test(`${variant} split preview measures the actual ${movingActive ? 'active' : 'inactive'} Source and its surviving optout sibling`, t => {
		const f = splitFixture(t, variant), game = new GameViewInput();
		f.sourceGroup.openEditor(game);
		if (movingActive) {
			f.sourceGroup.openEditor(f.source);
			assert.equal(f.editor.commands.isEnabled('findLocal', f.sourcePane.commandTarget), true);
			f.editor.commands.execute('findLocal', f.sourcePane.commandTarget);
			f.sourceGroup.focus();
		}
		f.arrange(1100, 720);
		assert.ok(f.sourceGroup.model.activeTab === (movingActive ? f.source : game));
		assert.ok(f.sourceGroup.model.activeAfterRemoval(f.source) === game);
		const intrinsic: EditorPaneConstraints = { minimumWidth: 0, minimumHeight: 0, companionWidth: undefined };
		f.sourceGroup.measureInput(f.source, true, intrinsic);
		if (movingActive) assert.ok(f.sourceGroup.minimumHeight > intrinsic.minimumHeight, 'the departing Source really has attached Find chrome that the fresh receiver must not inherit');
		const logicalRuntime = f.editor.gamePanel.focusScope.runtime, timeline = f.reviewGroup.timeline;
		if (movingActive) { assert.ok(logicalRuntime !== undefined); timeline.setContext(logicalRuntime); assert.equal(timeline.available, true); }
		let retirements = 0; t.after(f.editor.gamePanel.focusScope.onDidRetireContext(() => { retirements++; }));
		const root = f.main.arrangement.root, tabs = f.sourceGroup.model.tabs.slice(), pane = f.sourceGroup.panes.activePane;
		const focus = inputFocus.admittedTarget, surfaceRevision = f.editor.surfaces.revision;
		const revision = f.main.arrangement.revision, layoutRevision = f.main.arrangement.layoutRevision, areaRevision = f.parts.mainArea.revision;
		const sourceBounds = { ...f.sourceGroup.bounds }, primaryBounds = { ...f.parts.mainArea.primaryBounds }, version = f.model.version;
		const construction = t.mock.method(f.main, 'createGroup'), layout = t.mock.method(f.sourcePane, 'layout'), update = t.mock.method(f.sourcePane, 'update');
		const preview = { left: 0, top: 0, right: 0, bottom: 0 };
		for (let request = 0; request < 5; request++) f.main.writeSplitPreview(f.sourceGroup, f.source, f.reviewGroup, 'down', preview);
		assert.ok(f.main.arrangement.root === root && f.sourceGroup.panes.activePane === pane && inputFocus.admittedTarget === focus);
		assert.ok(f.sourceGroup.model.tabs.length === tabs.length && tabs.every((tab, index) => f.sourceGroup.model.tabs[index] === tab));
		assert.equal(construction.mock.callCount(), 0); assert.equal(layout.mock.callCount(), 0); assert.equal(update.mock.callCount(), 0);
		assert.equal(f.editor.surfaces.revision, surfaceRevision); assert.equal(f.main.arrangement.revision, revision);
		assert.equal(f.main.arrangement.layoutRevision, layoutRevision); assert.equal(f.parts.mainArea.revision, areaRevision);
		assert.deepEqual(f.sourceGroup.bounds, sourceBounds); assert.deepEqual(f.parts.mainArea.primaryBounds, primaryBounds);
		assert.equal(f.model.version, version); assert.equal(retirements, 0);
		assert.equal(f.parts.moveEditor(f.sourceGroup, f.source, { kind: 'split', group: f.reviewGroup, direction: 'down' }), true);
		f.editor.update(0);
		const receiver = f.parts.findGroup(f.source)!;
		assert.ok(receiver !== f.sourceGroup && receiver !== f.reviewGroup && receiver.model.activeTab === f.source);
		assert.ok(f.sourceGroup.model.activeTab === game && f.sourceGroup.panes.activePane!.input === game);
		assert.deepEqual(receiver.clip, preview); assert.equal(f.editor.gamePanel.visible, true);
		assert.ok(f.source.workingCopy === f.model); assert.equal(f.model.version, version); assert.equal(f.proposal.state, 'pending');
		if (movingActive) {
			assert.equal(retirements, 0, 'a completed supporting move cannot retire the companion during its intermediate empty attachment');
			assert.ok(f.editor.gamePanel.focusScope.runtime === logicalRuntime && timeline.focusScope.runtime === logicalRuntime);
			assert.equal(timeline.available, true);
		}
	});

for (const local of [true, false]) test(`whole-group preview uses ${local ? 'retained local' : 'fresh cross-part'} Source attachment extents`, t => {
	const f = splitFixture(t, 'msx');
	assert.equal(f.editor.commands.isEnabled('findLocal', f.sourcePane.commandTarget), true);
	f.editor.commands.execute('findLocal', f.sourcePane.commandTarget); f.sourceGroup.focus(); f.editor.update(0);
	const intrinsic: EditorPaneConstraints = { minimumWidth: 0, minimumHeight: 0, companionWidth: undefined };
	f.sourceGroup.measureInput(f.source, false, intrinsic);
	assert.ok(f.sourceGroup.minimumHeight > intrinsic.minimumHeight);
	const targetPart = local ? f.main : f.parts.createDocument({ requestedBounds: { left: 50, top: 32, right: 1050, bottom: 700 } });
	const reference = local ? f.reviewGroup : targetPart.activeGroup;
	f.sourceGroup.focus(); f.editor.update(0);
	const pane = f.sourceGroup.panes.activePane!, context = pane.inputScope!.contextGeneration;
	const sourceRoot = f.main.arrangement.root, targetRoot = targetPart.arrangement.root, surfaces = f.editor.surfaces.revision;
	const construction = t.mock.method(targetPart, 'createGroup'), preview = { left: 0, top: 0, right: 0, bottom: 0 };
	assert.equal(targetPart.writeMovePreview(f.sourceGroup, reference, 'down', preview), true);
	assert.ok(f.main.arrangement.root === sourceRoot && targetPart.arrangement.root === targetRoot && f.sourceGroup.panes.activePane === pane);
	assert.equal(pane.inputScope!.contextGeneration, context); assert.equal(construction.mock.callCount(), 0);
	assert.equal(f.editor.surfaces.revision, surfaces);
	assert.equal(f.parts.moveGroup(f.sourceGroup, { kind: 'split', group: reference, direction: 'down' }), true); f.editor.update(0);
	const receiver = f.parts.findGroup(f.source)!;
	assert.deepEqual(receiver.clip, preview); assert.ok(receiver.model.activeTab === f.source && f.source.workingCopy === f.model);
	if (local) {
		assert.ok(receiver === f.sourceGroup && receiver.panes.activePane === pane);
		assert.equal(pane.inputScope!.contextGeneration, context);
	} else {
		assert.ok(receiver !== f.sourceGroup && f.parts.partForGroup(receiver) === targetPart && receiver.panes.activePane !== pane);
		assert.equal(receiver.minimumHeight, intrinsic.minimumHeight, 'a cross-part Source receives fresh controls, not the departing Find bar');
	}
});
