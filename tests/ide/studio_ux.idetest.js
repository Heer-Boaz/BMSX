// Real shipped contribution baselines, not model-injected render fixtures.
// Run: npm run ide:test -- nemesis_s tests/ide/studio_ux.idetest.js
// Nemesis does not issue GTE commands; its GTE empty state is intentional.
// Connected Assistant/Conversations and other contributions need separate workflows.
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true })));
	await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false })));
	await t.frames(2);
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]);
	await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]);
	await t.frames(2);
};
const capture = async label => {
	await t.frames(2);
	t.log(`VISUAL ${label}`);
	t.capture(label);
};
// Menu order and eligibility belong to the actual open popup, including secondary actions.
const chooseOverflowCommand = async command => {
	const menu = t.contextMenu();
	t.assert(menu.visible, 'the actual overflow popup is not open');
	const commands = menu.model.rows.filter(row => row.command !== undefined && row.enabled);
	const index = commands.findIndex(entry => entry.command === command);
	t.assert(index >= 0, `${command} is not an eligible overflow action`);
	await press('Home');
	for (let item = 0; item < index; item++) await press('ArrowDown');
	await press('Enter');
};
const matrix = async (label, input, layout = input.layout) => {
	const cycles = t.runtime().machine.scheduler.nowCycles;
	for (let font = 0; font < 2; font++) {
		const variant = layout.font.variant;
		for (let theme = 0; theme < 2; theme++) {
			t.assert(t.activeWorkbenchTab() === input, `${label}: presentation replaced the retained input`);
			t.assert(layout.rowHeight === layout.font.lineHeight, `${label}: layout ignored font metrics`);
			if ((label === 'scenario-tests' || label === 'scenario-debug-entry') && theme === 0) {
				const pane = label === 'scenario-tests' ? input.view.testPane : input.view.resultPane;
				const index = pane.rows.findIndex(row => row.kind === (label === 'scenario-tests' ? 'module' : 'result'));
				const row = pane.rows[index], parent = pane.rows[index - 1];
				t.assert(row.expanded && row.depth === parent.depth + 1 && row.textLeft > parent.textLeft,
					`${label}: nested branch has no actual indentation`);
				const x = (row.twistieLeft + row.twistieRight) / 2;
				const y = pane.layout.contentTop + (index - (pane.scroll | 0)) * pane.layout.rowHeight + pane.layout.rowHeight / 2;
				await click(x, y);
				t.assert(!pane.rows[index].expanded, `${label}: the painted ${variant} chevron did not collapse`);
				t.assert(pane.selectionIndex === index && input.view.focus === (label === 'scenario-tests' ? 'tests' : 'results'),
					`${label}: the clicked branch did not become the actual keyboard cursor`);
				await click(x, y);
				t.assert(pane.rows[index].expanded, `${label}: the painted ${variant} chevron did not expand`);
				if (label === 'scenario-tests') await press('ArrowDown');
			}
			if (label === 'scenario-debug-entry' && theme === 0) t.log(JSON.stringify({ phase: label, variant,
				actions: input.view.actionBar.items.filter(item => item.visible)
					.map(item => ({ command: item.command, width: item.width, bounds: item.bounds })) }));
			await capture(`${label}-${variant}-theme-${theme}`);
			t.command('theme-toggle');
			await t.frames(2);
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, `${label}: presentation advanced the paused guest`);
};

await t.waitForCart();
await t.frames(90);
t.openLuaSource('cart.lua');
await t.frames(2);
const authored = t.activeWorkbenchTab();
const source = authored.context.model.buffer.getText();

t.command('aem');
await t.frames(2);
await press('Enter');
await t.frames(3);
const audio = t.activeWorkbenchTab();
t.assert(audio.kind === 'aem_editor' && audio.tree.rows.length > 0, 'the shipped audio event map did not open');
t.assert(audio.workingCopy.resource.path === 'res/data/events.aem.yaml', 'the audio map lost its actual resource identity');
const audioSource = audio.workingCopy.buffer.getText();
await matrix('audio-events', audio);
t.command('resources');
await t.frames(3);
const audioResize = t.resourcePanel().resizeBounds;
const audioSash = { x: (audioResize.left + audioResize.right) / 2, y: (audioResize.top + audioResize.bottom) / 2 };
const audioSelection = audio.tree.rows[audio.tree.selectionIndex];
t.controlInput([{ type: 'pointer', ...audioSash }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
t.controlInput([{ type: 'pointer', x: (audioSash.x + audio.layout.right) / 2, y: audioSash.y }]); await t.frames(2);
t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
t.assert(audio.tree.rows[audio.tree.selectionIndex] === audioSelection, 'Files resizing leaked a press into the audio property tree');
await matrix('audio-events-files', audio);
await press('ControlLeft', 'ShiftLeft', 'KeyT');
// Take real content focus before using keyboard disclosure/feedback navigation.
const audioTree = audio.tree;
await click(audioTree.layout.contentRight - 8, audioTree.layout.contentTop + audioTree.layout.rowHeight / 2);
const transitionPath = ['events', 'story', 'rules', 0, 'go', 'music_transition'];
const authoredTransition = audio.document.getIn(transitionPath, true);
const fullKey = audioTree.rows.findIndex(row => row.element.node === authoredTransition);
t.assert(fullKey >= 0, 'the actual authored audio transition key is missing');
await press('Home');
for (let row = 0; row < fullKey; row++) await press('ArrowDown');
const transition = audioTree.rows[audioTree.selectionIndex].element;
t.assert(transition.node === authoredTransition && transition.path.length === transitionPath.length
	&& transition.path.every((part, index) => part === transitionPath[index]), 'keyboard selection lost the authored audio transition');
await capture('audio-events-msx-files-authored-transition');
const audioMore = audio.actionBar.overflow.button;
t.assert(audioMore.visible, 'the narrow audio toolbar has no overflow affordance');
await click((audioMore.bounds.left + audioMore.bounds.right) / 2, (audioMore.bounds.top + audioMore.bounds.bottom) / 2);
await capture('audio-events-more-pointer');
await press('Escape');
await press('Home');
t.assert(audioTree.selectionIndex === 0, 'dismissing audio More did not return to its actual content');
await press('Tab');
await press('End');
t.assert(audio.actionBar.hasFocus && audio.actionBar.focusedIndex === audio.actionBar.items.length, 'keyboard navigation did not enter audio More');
await press('Enter');
await capture('audio-events-more-keyboard');
await press('Escape');
t.assert(audio.actionBar.hasFocus, 'dismissing keyboard More did not restore its actual toolbar focus');
const audioGroup = t.activeEditorGroup();
await press('Enter');
await chooseOverflowCommand('editor.sourceToSide');
await t.frames(3);
const audioCode = t.activeWorkbenchTab();
t.assert(t.activeEditorGroup() !== audioGroup && audioGroup.model.activeTab === audio
	&& audioCode.kind === 'code_editor' && audioCode.workingCopy === audio.workingCopy,
	'overflow Source to Side did not open the original authored audio working copy beside its retained visual input');
t.assert(audio.workingCopy.buffer.getText() === audioSource, 'feedback or overflow actions edited the authored audio source');
t.command('group.close');
await t.frames(3);
t.assert(t.activeEditorGroup() === audioGroup && t.activeWorkbenchTab() === audio,
	'closing the side Source group did not return to the originating audio view');
t.command('resources');
await t.frames(3);
await press('ControlLeft', 'ShiftLeft', 'KeyT');

t.command('scenarioLab');
await t.frames(3);
const scenarios = t.activeWorkbenchTab();
t.assert(scenarios.kind === 'scenario_lab' && scenarios.view.testPane.rows.some(row => row.kind === 'test'),
	'the packaged Scenario Lab test cases did not open');
const scenarioModules = scenarios.view.testPane.rows.filter(row => row.kind === 'module');
const encounterModule = scenarioModules.find(row => row.module.resource.path === 'tests/carts/nemesis_s/nemesis_s_bel_encounter_assert.lua');
t.assert(encounterModule !== undefined && scenarioModules.some(row => row.module.resource.path === 'tests/carts/nemesis_s/nemesis_s_cinematic_flow_assert.lua'),
	'the actual authored scenario modules are absent from the current catalog');
t.assert(scenarioModules.every(row => row.identity.includes(row.module.resource.path)
	&& row.id === row.module.id && row.root.id === row.module.parentId), 'compact captions replaced full source membership');
// Scenario Lab stores its font/layout with the view, not the editor input.
await matrix('scenario-tests', scenarios, scenarios.view.layout);
t.assert(scenarios.view.testPane.rows[scenarios.view.testPane.selectionIndex].kind === 'test',
	'the disclosed module did not navigate to an actual child test case');
t.command('scenarioLab.debug');
for (let frame = 0; frame < 1200 && !scenarios.view.debugger?.stopped; frame++) await t.frames(1);
t.assert(scenarios.view.debugger?.stopped, 'the selected real test never reached its debugger entry stop');
const scenarioDebugRun = scenarios.view.resultService.liveRun, originalDebugCaseId = scenarioDebugRun.scopeId;
await matrix('scenario-debug-entry', scenarios, scenarios.view.layout);
t.command('resources');
await t.frames(3);
const scenarioResize = t.resourcePanel().resizeBounds;
const scenarioSash = { x: (scenarioResize.left + scenarioResize.right) / 2, y: (scenarioResize.top + scenarioResize.bottom) / 2 };
const scenarioSelection = scenarios.view.testPane.selectedNodeId;
t.controlInput([{ type: 'pointer', ...scenarioSash }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
t.controlInput([{ type: 'pointer', x: (scenarioSash.x + scenarios.view.layout.right) / 2, y: scenarioSash.y }]); await t.frames(2);
t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
t.assert(scenarios.view.testPane.selectedNodeId === scenarioSelection, 'Files resizing leaked a press into Scenario selection');
await matrix('scenario-debug-files', scenarios, scenarios.view.layout);
await press('ControlLeft', 'ShiftLeft', 'KeyT');
// Full membership belongs to the retained row, available through normal focus and hover.
const scenarioTests = scenarios.view.testPane;
const disclosureModuleIndex = scenarioTests.rows.findIndex(row => row.kind === 'module' && row.id === encounterModule.id);
t.assert(disclosureModuleIndex >= 0, 'the actual encounter module is no longer in the current catalog');
await click(scenarioTests.rows[0].textLeft + 2, scenarioTests.layout.contentTop + scenarioTests.layout.rowHeight / 2);
await press('Home');
for (let row = 0; row < disclosureModuleIndex; row++) await press('ArrowDown');
const scenarioModule = scenarioTests.rows[scenarioTests.selectionIndex];
t.assert(scenarioModule.kind === 'module' && scenarioModule.id === encounterModule.module.id
	&& scenarioModule.module === encounterModule.module, 'keyboard navigation lost the authored scenario module identity');
await capture('scenario-msx-module-full-identity-keyboard');
await press('ArrowDown');
const scenarioCase = scenarioTests.rows[scenarioTests.selectionIndex];
t.assert(scenarioCase.kind === 'test' && scenarioCase.caption === scenarioCase.test.caseName
	&& scenarioCase.identity.includes(scenarioCase.test.resource.path), 'keyboard row identity no longer names the actual authored test case');
await capture('scenario-msx-narrow-case-full-identity-keyboard');
const moduleHoverY = scenarioTests.layout.contentTop + (disclosureModuleIndex - (scenarioTests.scroll | 0)) * scenarioTests.layout.rowHeight + scenarioTests.layout.rowHeight / 2;
t.controlInput([{ type: 'pointer', x: scenarioModule.textLeft + 2, y: moduleHoverY }]);
await capture('scenario-msx-narrow-module-full-identity-hover');
const actualTestId = scenarioCase.id;
await press('Enter');
await t.frames(3);
const scenarioSource = t.activeWorkbenchTab();
t.assert(scenarioSource.kind === 'code_editor' && scenarioSource.workingCopy.resource.path === scenarioCase.test.resource.path
	&& scenarioSource.workingCopy.resource.domain === scenarioCase.test.resource.domain, 'compact test caption changed Source command ownership');
t.command('scenarioLab');
await t.frames(3);
t.assert(t.activeWorkbenchTab() === scenarios && scenarioTests.rows[scenarioTests.selectionIndex].id === actualTestId,
	'returning from authored Source changed the selected typed case membership');
// Restore the actual paused test scope before exercising its original results and action bar.
t.assert(scenarios.view.resultService.liveRun === scenarioDebugRun && scenarios.view.debugger?.stopped,
	'presentation and authored Source navigation replaced or resumed the stopped test run');
const originalCaseIndex = scenarioTests.rows.findIndex(row => row.id === originalDebugCaseId);
t.assert(originalCaseIndex >= 0, 'the originating stopped test case lost its typed membership');
await press('Home');
for (let row = 0; row < originalCaseIndex; row++) await press('ArrowDown');
const scenarioResults = scenarios.view.resultPane;
await click(scenarioResults.rows[0].textLeft + 2, scenarioResults.layout.contentTop + scenarioResults.layout.rowHeight / 2);
const scenarioBar = scenarios.view.actionBar, scenarioMore = scenarioBar.overflow.button;
t.assert(scenarioMore.visible, 'the constrained stopped-test toolbar has no More affordance');
await click((scenarioMore.bounds.left + scenarioMore.bounds.right) / 2, (scenarioMore.bounds.top + scenarioMore.bounds.bottom) / 2);
await capture('scenario-debug-more-pointer');
await press('Escape');
await press('Home');
t.assert(scenarios.view.focus === 'results' && scenarios.view.resultPane.selectionIndex === 0,
	'dismissing stopped-test More did not return to its actual result pane');
t.assert(scenarios.view.split.resizable === false, 'the constrained stopped-test client unexpectedly exposes a resizable sash');
await press('Tab');
await press('End');
t.assert(scenarioBar.hasFocus && scenarioBar.focusedIndex === scenarioBar.items.length,
	'keyboard navigation did not enter stopped-test More');
await press('Enter');
await capture('scenario-debug-more-keyboard');
await chooseOverflowCommand('scenarioLab.inspectStop');
await capture('scenario-debug-target-narrow');
// The target's own composite follows its content. Its final eligible menu action
// is Close Target; after closing, ordinary navigation must reach the original results.
await press('Tab');
await press('End');
await press('Enter');
await capture('scenario-debug-target-more-keyboard');
await press('End');
await press('Enter');
await press('End');
t.assert(scenarios.view.resultPane.selectionIndex === scenarios.view.resultPane.rows.length - 1
	&& scenarios.view.resultPane.selectionIndex > 0, 'target overflow Close did not restore the originating result pane');
t.command('resources');
t.command('gameView.closePanel');
await t.frames(3);
await press('ControlLeft', 'ShiftLeft', 'KeyT');
t.command('scenarioLab.inspectStop');
await capture('scenario-debug-target');
await press('Escape');
t.command('scenarioLab.cancel');
for (let frame = 0; frame < 1200 && scenarios.view.runActive; frame++) await t.frames(1);
t.assert(!scenarios.view.runActive, 'the stopped test target did not retire after cancellation');

t.command('gpuDebugger');
await t.frames(2);
const gpu = t.activeWorkbenchTab();
t.assert(gpu.kind === 'gpu_debugger', 'GPU Operations did not open');
for (let step = 0; step < 4; step++) {
	t.command('stepFrame');
	await t.frames(8);
}
t.assert(gpu.history.count > 0 && gpu.selected.sequence >= 0, 'frame stepping did not produce real GPU observations');
await matrix('gpu-operation', gpu);
await press('Enter');
await capture('gpu-operation-details');
await press('Escape');

t.command('gteDebugger');
await t.frames(2);
const gte = t.activeWorkbenchTab();
t.assert(gte.kind === 'gte_debugger' && gte.history.observing, 'GTE Debugger did not attach its observation session');
t.assert(gte.history.count === 0 && gte.selected.sequence === -1, 'the 2D cart acquired fabricated GTE evidence');
await matrix('gte-empty', gte);

t.command('events');
await t.frames(2);
const events = t.activeWorkbenchTab();
t.assert(events.kind === 'event_viewer' && events.history.count > 0, 'the cart event history did not open');
await matrix('events', events);
await press('Home');
await press('Enter');
await capture('event-details');
await press('Escape');

t.command('romInspector');
await t.frames(2);
await press('ArrowDown');
await press('Enter');
await t.frames(3);
const rom = t.activeWorkbenchTab();
t.assert(rom.kind === 'rom_inspector' && rom.snapshot.domain === 0, 'the actual cartridge ROM snapshot did not open');
// Enter from the list's preceding filter uses ordinary field input and selection.
await press('ShiftLeft', 'Tab');
for (const code of ['KeyK', 'KeyO', 'KeyN', 'KeyA', 'KeyM', 'KeyI']) await press(code);
await press('Enter');
await press('Home');
await press('Enter');
await t.frames(2);
t.assert(rom.model.selection.label === 'intro_konami' && rom.readerWindow.open && rom.reader.subject === rom.model.selection && rom.reader.view === 'preview',
	'the actual ROM image did not resolve through its existing image decoder');
t.assert(rom.reader.preview.image.width > 0 && rom.reader.preview.image.height > 0, 'ROM image preview has no decoded pixels');
await matrix('rom-image', rom);

t.assert(authored.context.model.buffer.getText() === source, 'UI presentation changed canonical authored source');
for (let index = 0; index < t.logMessageCount(); index++) {
	const message = t.logMessage(index);
	t.assert(message.level !== 3, `UI workflow logged an error: ${message.message}`);
}
