import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { findEditorGroup } from '../../ide/workbench/services/editor/editor_group';
import { EditorParts } from '../../ide/workbench/services/editor/editor_parts';
import { MainWorkspace } from '../../ide/workbench/main_workspace';
import type { EditorInputSerializers } from '../../ide/workbench/services/editor/editor_serialization';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { createTestEditorPaneContributions, createTestGroupPresentation, createTestEditorCloseDependencies } from '../helpers/editor_panes';

function fixture(t: TestContext) {
	configureFontVariant('tiny');
	const surfaces = new WorkbenchSurfaceService(), presentation = createTestGroupPresentation(surfaces);
	const commands = { isEnabled: () => false, execute() {} };
	const main = new MainWorkspace(surfaces, presentation.owner, presentation.focusScope, commands,
		() => parts.main.layout(main.documentBounds), () => parts.activate(parts.main)); main.layout(presentation.workArea);
	const parts = new EditorParts({
		surfaces, owner: presentation.owner, scope: presentation.focusScope, workArea: presentation.workArea,
		mainPresentation: main,
		commands, contextMenu: presentation.contextMenu,
		renderContext: presentation.renderContext, contributions: createTestEditorPaneContributions(commands, presentation.contextMenu),
		...createTestEditorCloseDependencies(t, presentation),
		focusReturn: inputFocus.createTarget(null, presentation.focusScope), layoutMain: () => { main.layout(presentation.workArea); parts.main.layout(main.documentBounds); },
	});
	parts.main.layout(presentation.workArea);
	t.after(() => { parts.dispose(); main.dispose(); presentation.contextMenu.dispose(); surfaces.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); });
	return { parts, surfaces, area: presentation.workArea };
}

test('empty group removal rejects nonmembers, occupied groups, retired hosts and the final retained group', t => {
	const { parts } = fixture(t), part = parts.main, first = part.activeGroup;
	assert.equal(part.removeGroup(first), false);
	const occupied = part.splitGroup(first, 'right'), input = new HomeInput(null);
	occupied.openEditor(input, { preserveFocus: true });
	assert.equal(part.removeGroup(occupied), false); assert.ok(occupied.model.activeTab === input);
	const foreign = parts.createDocument().activeGroup;
	assert.equal(part.removeGroup(foreign), false); assert.equal(foreign.surface.retired, false);
	assert.equal(part.removeGroup(first), true); assert.equal(part.removeGroup(first), false);
	assert.equal(part.groups.length, 1); assert.ok(part.groups[0] === occupied);
	assert.equal(part.removeGroup(occupied), false);
	part.dispose(); assert.equal(part.removeGroup(occupied), false);
});

test('removal normalizes the retained tree and publishes surviving MRU ownership before disposal observers', t => {
	const { parts, area } = fixture(t), part = parts.main, first = part.activeGroup;
	const second = part.splitGroup(first, 'right'), third = part.splitGroup(second, 'down');
	const input = new HomeInput(null); second.openEditor(input, { preserveFocus: true });
	part.activateGroup(second); part.activateGroup(third);
	const root = part.arrangement.root, secondLeaf = part.arrangement.leaves.find(leaf => leaf.group === second)!;
	assert.equal(root.kind, 'split');
	part.arrangement.toggleMaximize(third); part.layout(area);
	let notifications = 0, disposalObserved = false;
	part.onDidChangeGroups(() => {
		notifications++;
		assert.equal(part.groups.length, 2); assert.ok(part.activeGroup === second);
		assert.equal(parts.groups.includes(third), false);
		assert.equal(parts.splitGroup(third, 'left'), undefined, 'a command from the departing group already has no membership');
	});
	third.onWillDispose(() => {
		disposalObserved = true;
		assert.equal(notifications, 1); assert.equal(parts.groups.includes(third), false);
		assert.ok(part.activeGroup === second); assert.equal(third.openingAdmitted, false);
		assert.equal(findEditorGroup(third.focusTarget), null);
	});
	let changedAfterRetirement = false;
	const unbind = parts.onDidChange(() => { changedAfterRetirement = third.surface.retired; });
	assert.equal(part.removeGroup(third), true); unbind();
	assert.equal(notifications, 1); assert.equal(disposalObserved, true); assert.equal(changedAfterRetirement, true);
	assert.ok(part.arrangement.root === root && root.kind === 'split' && root.second === secondLeaf);
	assert.equal(part.arrangement.maximized, undefined);
	assert.ok(part.mostRecentlyActiveGroups[0] === second && part.mostRecentlyActiveGroups[1] === first);
	assert.ok(second.model.activeTab === input); assert.equal(second.surface.retired, false);
});

test('retiring an empty group releases all owned surfaces, context subscriptions and its removed sash gesture', t => {
	const { parts, surfaces, area } = fixture(t), part = parts.main, first = part.activeGroup;
	const second = part.splitGroup(first, 'right'); part.layout(area);
	let transientRetirements = 0, contextRetirements = 0;
	second.focusScope.onDidRetireContext(() => { contextRetirements++; });
	const transientScope = Symbol('group-owned inspection');
	const transient = surfaces.attach({ role: 'transient', outsidePress: 'owner', lifetimeOwner: second.paneSurface,
		presentationParent: null, captureScope: transientScope, getBounds: () => second.bounds, getClip: () => area,
		isVisible: () => true, draw() {}, onRetire: () => { transientRetirements++; } });
	// Address the actual produced sash, rather than manufacturing a captured target.
	const branch = part.arrangement.splits[0], x = branch.split.position, y = (branch.sashBounds.top + branch.sashBounds.bottom) / 2;
	const sash = surfaces.hitTest(x, y)!;
	const down: PointerInputSnapshot = { valid: true, insideViewport: true, viewportX: x, viewportY: y, modifiers: KeyModifier.none, spaceDown: false,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	pointerCapture.beginRoute(sash.captureScope, down); sash.handlePointer!(down, 0);
	assert.equal(pointerCapture.active, true);
	assert.equal(part.removeGroup(second), true);
	assert.equal(second.surface.retired, true); assert.equal(second.paneSurface.retired, true); assert.equal(second.tabSurface.retired, true);
	assert.equal(transient.retired, true); assert.equal(transientRetirements, 1); assert.equal(contextRetirements, 1);
	assert.equal(surfaces.findByScope(transientScope), undefined); assert.equal(surfaces.findByScope(second.captureScope), undefined);
	assert.equal(surfaces.findByScope(second.tabScope), undefined); assert.equal(surfaces.findByScope(sash.captureScope), undefined);
	assert.equal(surfaces.findByScope(second.surface.captureScope), undefined);
	assert.equal(surfaces.findByScope(second.timeline.focusScope.surfaceScope), undefined);
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	assert.equal(second.focus(), false); assert.equal(findEditorGroup(second.focusTarget), null);
	let changes = 0;
	const unbind = parts.onDidChange(() => { changes++; }); second.model.clear(); unbind();
	assert.equal(changes, 0, 'the retired model no longer owns a Part subscription');
});

test('removing another branch retains a surviving sash capture and does not focus a replacement client', t => {
	const { parts, surfaces, area } = fixture(t), part = parts.main, first = part.activeGroup;
	const second = part.splitGroup(first, 'right'), third = part.splitGroup(second, 'down'); part.layout(area);
	const root = part.arrangement.splits[0], x = root.split.position, y = (root.sashBounds.top + root.sashBounds.bottom) / 2;
	const sash = surfaces.hitTest(x, y)!;
	const down: PointerInputSnapshot = { valid: true, insideViewport: true, viewportX: x, viewportY: y, modifiers: KeyModifier.none, spaceDown: false,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	pointerCapture.beginRoute(sash.captureScope, down); sash.handlePointer!(down, 0);
	const focused = inputFocus.target;
	assert.equal(part.removeGroup(third), true);
	assert.equal(sash.retired, false); assert.equal(pointerCapture.active, true); assert.equal(pointerCapture.draining, false);
	assert.ok(inputFocus.target === focused); assert.ok(part.arrangement.splits[0] === root);
});

test('a newer unrelated focus acquired by a disposal observer is not replaced by MRU selection', t => {
	const { parts } = fixture(t), part = parts.main, first = part.activeGroup, removed = part.splitGroup(first, 'right');
	const unrelated = parts.createDocument().activeGroup; unrelated.openEditor(new HomeInput(null), { preserveFocus: true });
	part.activateGroup(removed);
	removed.onWillDispose(() => { unrelated.focus(); });
	assert.equal(part.removeGroup(removed), true);
	assert.ok(part.activeGroup === first); assert.ok(parts.activeGroup === unrelated);
	assert.ok(inputFocus.target === unrelated.panes.activePane!.commandTarget);
});

test('a floating part selects its surviving input title without focusing that client', t => {
	const { parts } = fixture(t), part = parts.createDocument(), first = part.activeGroup, input = new HomeInput(null);
	first.openEditor(input, { preserveFocus: true });
	const removed = part.splitGroup(first, 'right'); part.activateGroup(removed);
	const focused = inputFocus.target;
	assert.equal(part.removeGroup(removed), true);
	assert.ok(part.activeGroup === first); assert.equal(part.window!.model.title, input.title);
	assert.ok(inputFocus.target === focused);
});

test('frontend disposal from the topology notification still retires the removed group exactly once', t => {
	const { parts } = fixture(t), part = parts.main, removed = part.splitGroup(part.activeGroup, 'right');
	let retirements = 0; removed.onWillDispose(() => { retirements++; });
	part.onDidChangeGroups(() => { parts.dispose(); });
	assert.equal(part.removeGroup(removed), true);
	assert.equal(retirements, 1); assert.equal(removed.surface.retired, true); assert.equal(part.retired, true);
});

test('accepted group removal aborts pending reconstruction and retires its late candidate', async t => {
	const { parts } = fixture(t), part = parts.main, first = part.activeGroup, removed = part.splitGroup(first, 'right');
	let resolve!: (input: HomeInput) => void;
	const waiting = new Promise<HomeInput>(done => { resolve = done; });
	const unused = { serialize: (): never => assert.fail('unexpected serialization'), deserialize: (): never => assert.fail('unexpected reconstruction') };
	const serializers: EditorInputSerializers = { home: { serialize: () => '', deserialize: () => waiting },
		animation: unused, aem_editor: unused, cart_map: unused, lua_program: unused, actor_lab: unused, game_view: unused,
		event_viewer: unused, terminal: unused, code_editor: unused, behavior_lens: unused, scene_editor: unused, resource_view: unused, scenario_lab: unused };
	const restoration = part.restore({ layout: { kind: 'group', group: { inputs: [{ kind: 'home', value: '' }], active: 0, preview: null } },
		active: 0, mru: [0], scrollX: 0, scrollY: 0 }, serializers);
	removed.setOpenAdmission(false);
	assert.equal(part.removeGroup(removed), true);
	const late = new HomeInput(null); let retired = false; late.onWillDispose(() => { retired = true; }); resolve(late);
	assert.equal(await restoration, false); assert.equal(retired, true);
	assert.equal(part.groups.length, 1); assert.ok(part.activeGroup === first); assert.equal(first.model.tabs.length, 0);
});
