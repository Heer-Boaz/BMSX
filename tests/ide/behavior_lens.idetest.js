const pressKey = async (code, pressId) => {
	t.postInput({
		type: 'button',
		deviceId: 'keyboard:0',
		code,
		down: true,
		value: 1,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
	t.postInput({
		type: 'button',
		deviceId: 'keyboard:0',
		code,
		down: false,
		value: 0,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
};

let choicePressId = 1000;
const chooseBehavior = async query => {
	t.command('behaviorLens');
	for (const character of query) {
		await pressKey(character === ' ' ? 'Space' : `Key${character.toUpperCase()}`, ++choicePressId);
	}
	await pressKey('Enter', ++choicePressId);
};

const pressGamepad = async (code, pressId) => {
	t.postInput({
		type: 'button',
		deviceId: 'gamepad:0',
		code,
		down: true,
		value: 1,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
	t.postInput({
		type: 'button',
		deviceId: 'gamepad:0',
		code,
		down: false,
		value: 0,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
};

const clickPointer = async (x, y, pressId) => {
	t.postInput({
		type: 'axis2',
		deviceId: 'pointer:0',
		code: 'pointer_position',
		x,
		y,
		timestamp: 0,
	});
	await t.frames(1);
	t.postInput({
		type: 'button',
		deviceId: 'pointer:0',
		code: 'pointer_primary',
		down: true,
		value: 1,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
};

const releasePointer = async (pressId) => {
	t.postInput({
		type: 'button',
		deviceId: 'pointer:0',
		code: 'pointer_primary',
		down: false,
		value: 0,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
};

const moveSelectionToIndex = async (view, targetIndex, firstPressId) => {
	const startIndex = view.selectionIndex;
	if (startIndex < targetIndex) {
		for (let index = startIndex; index < targetIndex; index += 1) {
			await pressKey('ArrowDown', firstPressId + index - startIndex);
		}
	} else {
		for (let index = startIndex; index > targetIndex; index -= 1) {
			await pressKey('ArrowUp', firstPressId + startIndex - index);
		}
	}
	t.assert(view.selectionIndex === targetIndex, 'retained keyboard navigation did not reach the requested row');
};

await t.waitForCart();
await t.frames(4);
t.openLuaSource('enemies/moon_tree.lua');
await t.frames(2);

const sourceTab = t.activeWorkbenchTab();
t.assert(sourceTab.kind === 'code_editor', 'Moon source did not open as a code editor input');
const sourceTabId = sourceTab.id;
const originalSource = sourceTab.context.model.buffer.getText();
await chooseBehavior('bt moon');
await t.frames(2);

const lensTab = t.activeWorkbenchTab();
t.assert(lensTab.kind === 'behavior_lens', 'Behavior Lens command did not activate its workbench input');
const view = lensTab.view;
const retainedDocument = view.document;
t.assert(view.presentation.kind === 'graph', 'BT must use the concrete graph');
const viewport = view.presentation.viewport;
const retainedNodes = viewport.model.nodes;
const retainedLayout = view.layout;
const retainedFirstNode = viewport.model.nodes[0];

t.assert(view.resource.path === 'enemies/moon_tree.lua', 'Behavior Lens lost its source resource identity');
t.assert(view.document.definitions.length === 1, 'Moon source should expose one behavior-tree registration');
t.assert(view.sourceNodes.length === 99, 'Moon behavior-tree topology is incomplete');
t.assert(viewport.model.nodes[0].source === view.document.definitions[0], 'graph registration owns its root occurrence');
t.assert(view.layout.viewportWidth === 384 && view.layout.viewportHeight === 288, 'test did not exercise the constrained IDE viewport');
t.assert(view.layout.font.variant === 'tiny', 'Behavior Lens did not use the active IDE tiny font');
t.assert(view.layout.rowHeight === 6, 'Behavior Lens row metrics do not come from the tiny IDE font');

const flyAttackOccurrences = view.sourceNodes.filter(node =>
	node.authoredRange.start.line === 14
		&& node.referenceRange !== null
		&& (node.referenceRange.start.line === 149 || node.referenceRange.start.line === 182));
t.assert(flyAttackOccurrences.length === 2, 'reused const initializer occurrences were collapsed into one view node');
t.assert(flyAttackOccurrences[0].rowKey !== flyAttackOccurrences[1].rowKey, 'reused initializer occurrences share view identity');

await t.frames(3);
const stableTab = t.activeWorkbenchTab();
t.assert(stableTab === lensTab, 'unchanged frames replaced the active Behavior Lens input');
t.assert(stableTab.view === view, 'unchanged frames replaced retained Behavior Lens view state');
t.assert(view.document === retainedDocument, 'unchanged frames rebuilt source recognition');
t.assert(viewport.model.nodes === retainedNodes && view.layout === retainedLayout, 'unchanged frames rebuilt retained layout containers');
t.assert(viewport.model.nodes[0] === retainedFirstNode, 'unchanged frames rebuilt formatted rows');

t.command('theme-toggle');
await t.frames(2);
t.assert(t.activeWorkbenchTab() === lensTab, 'workbench theme action replaced the active custom editor input');
t.command('theme-toggle');
await t.frames(2);
t.assert(t.activeWorkbenchTab() === lensTab, 'restoring the workbench theme replaced the active custom editor input');

await pressKey('ArrowDown', 1);
t.assert(viewport.selection === viewport.model.nodes[0].children[0], 'keyboard down did not enter the actual root');

t.postInput({
	type: 'connect',
	device: {
		id: 'gamepad:0',
		kind: 'gamepad',
		gamepadIndex: 0,
		label: 'BEHAVIOR LENS TEST PAD',
		vibrationInitialization: null,
		supportsVibration: false,
		setVibration() {},
	},
	timestamp: 0,
});
await t.frames(1);
await pressGamepad('down', 2);
t.assert(viewport.selection.parent === viewport.model.nodes[0].children[0], 'gamepad down did not enter the first child');
const selectedBranch = viewport.model.nodes[0].children[0].children.find(node => node.expandable);
t.assert(selectedBranch, 'the real tree has an expandable branch');
let siblingPressId = 2000;
while (viewport.selection !== selectedBranch) await pressKey('ArrowRight', ++siblingPressId);

if (view.collapsedRowKeys.has(selectedBranch.source.rowKey)) await pressKey('Space', 3);
await pressKey('ArrowDown', 4);
t.assert(viewport.selection.parent.source.rowKey === selectedBranch.source.rowKey, 'down did not enter an expanded child');
t.capture('behavior-lens-moon-tiny-384x288');

const selectedNode = viewport.selection;
const selectedRange = selectedNode.source.referenceRange || selectedNode.source.authoredRange;
const pointerX = viewport.bounds.left + (selectedNode.bounds.left + selectedNode.bounds.right) / 2 - viewport.scrollX;
const pointerY = viewport.bounds.top + (selectedNode.bounds.top + selectedNode.bounds.bottom) / 2 - viewport.scrollY;
await clickPointer(pointerX, pointerY, 5);
t.assert(t.activeWorkbenchTab() === lensTab, 'single click unexpectedly navigated away from the lens');
const selectionAfterClick = viewport.selection;
await t.frames(1);
t.assert(viewport.selection === selectionAfterClick, 'held pointer press repeated Behavior Lens activation');
await releasePointer(5);
await clickPointer(pointerX, pointerY, 6);
await t.frames(4);

const navigatedTab = t.activeWorkbenchTab();
t.assert(navigatedTab.kind === 'code_editor' && navigatedTab.id === sourceTabId, 'double click did not return to the owning code input');
const activeDocument = t.activeEditorDocument();
t.assert(activeDocument.model.resource.path === selectedRange.path, 'double click navigated to the wrong source resource');
t.assert(activeDocument.view.cursorRow === selectedRange.start.line - 1, 'double click navigated to the wrong source line');
t.assert(activeDocument.view.cursorColumn === selectedRange.start.column - 1, 'double click navigated to the wrong source column');
await releasePointer(6);

await chooseBehavior('bt moon');
await t.frames(2);
const reopenedTab = t.activeWorkbenchTab();
t.assert(reopenedTab === lensTab && reopenedTab.view === view, 'reopening duplicated the Behavior Lens input or its view state');
t.assert(t.workbenchTabs().filter(tab => tab.kind === 'behavior_lens').length === 1, 'source owns more than one Behavior Lens input');

const selectedRowKey = view.selection.rowKey;
const selectedAuthoredLine = view.nodesByRowKey.get(selectedRowKey).authoredRange.start.line;
await pressKey('Escape', 7);
t.assert(t.activeWorkbenchTab().kind === 'code_editor', 'Escape did not return to source');
t.replaceActiveCodeSource(`-- behavior lens refresh\n${originalSource}`);
await t.frames(2);
await chooseBehavior('bt moon');
await t.frames(2);

const refreshedTab = t.activeWorkbenchTab();
t.assert(refreshedTab === lensTab && refreshedTab.view === view, 'source refresh replaced the retained Behavior Lens input');
t.assert(view.document !== retainedDocument, 'source edit did not install a new immutable topology generation');
t.assert(view.presentation.viewport === viewport && view.layout === retainedLayout, 'source refresh replaced retained view containers');
t.assert(
	view.nodesByRowKey.get(view.selection.rowKey).authoredRange.start.line === selectedAuthoredLine + 1,
	'explicitly reopening the registration did not select the new source generation',
);

await pressKey('Escape', 8);
t.openLuaSource('player/player.lua');
await t.frames(2);
await chooseBehavior('fsm ids player');
await t.frames(2);

const fsmTab = t.activeWorkbenchTab();
t.assert(fsmTab.kind === 'behavior_lens', 'player FSM did not open in a Behavior Lens input');
const fsmView = fsmTab.view;
t.assert(fsmView.presentation.kind === 'state-graph', 'FSM must open its compound graph');
await fsmTab.graphLayout.settled;
await t.frames(1);
t.assert(fsmView.presentation.layoutState.kind === 'ready', 'Node layout engine did not complete the actual FSM');
t.assert(fsmView.document.definitions.length === 1, 'player source should expose one FSM registration');
t.assert(fsmView.document.definitions[0].behaviorKind === 'state_machine', 'player registration was not recognized as an FSM');
const flyingState = fsmView.sourceNodes.find(node => node.kind === 'state' && node.label === 'flying');
const projectilesState = fsmView.sourceNodes.find(node => node.kind === 'state' && node.label === 'projectiles');
t.assert(flyingState.authoredRange.start.line === 1370, 'nested flying state lost its authored source range');
t.assert(flyingState.detail === 'initial', 'nested FSM initial-state semantics are missing');
t.assert(projectilesState.authoredRange.start.line === 1410, 'concurrent projectiles state lost its authored source range');
t.assert(projectilesState.detail === 'concurrent', 'concurrent FSM semantics are missing');

const stateGraph = fsmView.presentation.viewport;
t.assert(stateGraph.model.nodesBySource.has(projectilesState.rowKey), 'concurrent state has no diagram card');
const projectilesIndex = stateGraph.model.nodes.indexOf(stateGraph.model.nodesBySource.get(projectilesState.rowKey));
for (let index = 0; index < projectilesIndex; index += 1) await pressKey('Tab', ++choicePressId);
await pressKey('Enter', ++choicePressId);
t.assert(t.activeWorkbenchTab().kind === 'code_editor', 'activating the concurrent state did not return to source');
t.assert(t.activeEditorDocument().view.cursorRow === projectilesState.authoredRange.start.line - 1, 'concurrent state navigated to the wrong line');
await chooseBehavior('fsm ids player');
await t.frames(2);
t.assert(stateGraph.model.nodesBySource.has(flyingState.rowKey), 'nested state is missing from compound containment');
const activeState = stateGraph.model.nodes.find(node => node.source.label === 'active');
t.assert(activeState.children.some(node => node.source === flyingState), 'nested state was flattened out of its parent');
const flyingIndex = stateGraph.model.nodes.indexOf(stateGraph.model.nodesBySource.get(flyingState.rowKey));
for (let index = 0; index < flyingIndex; index += 1) await pressKey('Tab', ++choicePressId);
await pressKey('Enter', ++choicePressId);
t.assert(t.activeEditorDocument().view.cursorRow === flyingState.authoredRange.start.line - 1, 'nested state navigated to the wrong line');

t.openLuaSource('player/actioneffects.lua');
await t.frames(2);
await chooseBehavior('effect fire salvo');
await t.frames(2);

const effectTab = t.activeWorkbenchTab();
t.assert(effectTab.kind === 'behavior_lens', 'real ActionEffect did not open in a Behavior Lens input');
const effectView = effectTab.view;
t.assert(effectView.document.definitions.length === 1, 'Nemesis player source should expose one ActionEffect registration');
t.assert(effectView.document.definitions[0].behaviorKind === 'action_effect', 'registration was not recognized as an ActionEffect');
t.assert(effectView.presentation.kind === 'properties', 'ActionEffect must open its property inspector');
const properties = effectView.presentation.tree;
const periodRowIndex = properties.rows.findIndex(row => row.element.kind === 'property' && row.element.source.label.startsWith('period_ms ='));
t.assert(periodRowIndex >= 0, 'real ActionEffect period is not present in the retained rows');
await moveSelectionToIndex(properties, periodRowIndex, 180);
await pressKey('Enter', 190);
t.assert(t.activeEditorDocument().model.resource.path === 'player/actioneffects.lua', 'ActionEffect navigation opened the wrong source');
t.assert(t.activeEditorDocument().view.cursorRow === 16, 'ActionEffect period navigated to the wrong authored line');
