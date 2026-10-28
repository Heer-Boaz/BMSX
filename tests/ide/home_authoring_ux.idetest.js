// Home's real typed entrypoints, cards and Tools menu; no synthetic feature providers.
// Run: npm run ide:test -- nemesis_s tests/ide/home_authoring_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async bounds => {
	t.controlInput([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(3);
};
let captures = 0;
const capture = async label => {
	t.assert(++captures <= 28, 'Home inspection exceeded its capture budget');
	await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(3);
const original = t.activeWorkbenchTab(), models = new Map();
const retain = input => {
	const model = input.workingCopy;
	if (!models.has(model)) models.set(model, { text: model.buffer.getText(), version: model.version });
};
retain(original);
const cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
t.command('home'); await t.frames(3); const home = t.activeWorkbenchTab();
t.assert(home.kind === 'home' && home.resource === undefined, 'Home did not remain workspace content');
const focusAction = async command => {
	t.command('home'); await t.frames(3);
	t.assert(t.activeWorkbenchTab() === home, 'Home discovery replaced its retained workspace input');
	const sections = home.sections.filter(section => section.visibleCount !== 0);
	const sectionIndex = sections.findIndex(section => section.actions.items.some(item => item.command === command));
	t.assert(sectionIndex >= 0, `Home does not expose ${command}`);
	for (let index = 0; index < sectionIndex; index++) await press('Tab');
	await press('Home');
	const state = sections[sectionIndex].actions, visible = state.items.filter(item => item.visible);
	const actionIndex = visible.findIndex(item => item.command === command);
	t.assert(actionIndex >= 0, 'a supported authoring entrypoint was hidden');
	for (let index = 0; index < actionIndex; index++) await press('ArrowDown');
	t.assert(state.hasFocus && state.items[state.focusedIndex].command === command, 'ordinary card navigation focused another command');
	return state.items[state.focusedIndex];
};
const acceptBehavior = async (command, presentation, pointer = false) => {
	const action = await focusAction(command);
	if (pointer) await click(action.bounds); else await press('Enter');
	t.assert(t.activeWorkbenchTab() === home, 'opening a definition chooser replaced Home prematurely');
	await press('ControlLeft', 'Home'); await press('Enter'); await t.frames(8);
	const input = t.activeWorkbenchTab();
	t.assert(input.kind === 'behavior_lens' && input.view.presentation.kind === presentation && input.view.definitionRowKey !== null,
		'the typed Home route did not select its real source-backed behavior kind');
	retain(input); return input;
};
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		await focusAction('resources.focus');
		await press('ShiftLeft', 'Tab'); await press('Home'); await press('Tab');
		t.assert(home.layout.font.variant === font, 'the actual Home font differs from the inspection case');
		await capture(`home-authoring-${font}-${theme}-overview`);
		await focusAction('behaviorLens.stateMachines'); await capture(`home-authoring-${font}-${theme}-behavior-card`);
		await press('Enter'); await capture(`home-authoring-${font}-${theme}-fsm-chooser`);
		await press('ControlLeft', 'Home'); await press('Enter'); await t.frames(8);
		const machine = t.activeWorkbenchTab();
		t.assert(machine.kind === 'behavior_lens' && machine.view.presentation.kind === 'state-graph' && machine.view.definitionRowKey !== null,
			'the FSM entrypoint opened another editor or an unselected catalog');
		await machine.graphLayout.settled; await t.frames(2);
		t.assert(machine.view.presentation.layoutState.kind === 'ready', 'the actual FSM graph has not settled');
		retain(machine); await capture(`home-authoring-${font}-${theme}-fsm-editor`);
		await acceptBehavior('behaviorLens.behaviorTrees', 'graph');
		await acceptBehavior('behaviorLens.actionEffects', 'properties', true);
		await focusAction('aem'); await press('Enter'); await press('ControlLeft', 'Home'); await press('Enter'); await t.frames(6);
		const audio = t.activeWorkbenchTab();
		t.assert(audio.kind === 'aem_editor' && audio.workingCopy.resource.source.type === 'aem', 'Home Audio Events did not open the real canonical map');
		retain(audio);
		for (const command of ['progression', 'inputBindings']) {
			await focusAction(command); await press('Enter');
			await capture(`home-authoring-${font}-${theme}-${command}`); await press('Escape');
			t.assert(t.activeWorkbenchTab() === home, 'cancelling gameplay discovery opened a different subject');
		}
		await press('F10'); for (let index = 0; index < 4; index++) await press('ArrowRight');
		// Tools uses the same typed contributions as the cards, through the ordinary menu owner.
		await capture(`home-authoring-${font}-${theme}-tools`); await press('Escape');
		t.assert(t.activeWorkbenchTab() === home && t.workbenchTabs().includes(original), 'Home navigation lost the retained Source editor');
		for (const [model, snapshot] of models) t.assert(model.buffer.getText() === snapshot.text && model.version === snapshot.version && !model.dirty,
			'Home discovery edited, reconstructed or replaced an authored working copy');
		t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
			'authoring discovery executed or installed the paused program');
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Home discovery logged an error: ${t.logMessage(index).message}`);
