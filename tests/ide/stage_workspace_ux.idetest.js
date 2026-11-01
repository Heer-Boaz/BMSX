// Real Main layout workflow on the dedicated Studio cart. No source/model injection.
// npm run ide:test -- studio_test tests/ide/stage_workspace_ux.idetest.js --ttl 180
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => {
	for (const character of text) {
		if (character === '_') await press('ShiftLeft', 'Minus');
		else await press(character === '.' ? 'Period' : `Key${character.toUpperCase()}`);
	}
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(3);
};
const capture = async label => { await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label); };

await t.waitForCart(); await t.frames(90);
await press('ControlRight', 'ShiftRight'); await t.frames(3);
t.command('sceneEditor'); await t.frames(3); await type('root.lua'); await press('Enter'); await t.frames(6);
const main = t.mainWorkspace(), primary = main.primary, layout = main.regionLayout;
const authoring = primary.consumer, model = authoring.workingCopy, source = model.buffer.getText();
t.assert(model.identity.path === 'scenes/root.lua' && !model.dirty, 'the dedicated Main source was not admitted cleanly');
const cycles = t.runtime().machine.scheduler.nowCycles, installed = t.sourceState().currentBlua32Media;

// Add one existing textured prefab through the public hierarchy action, to make the stage visible.
t.command('sceneEditor.outline'); await press('ShiftLeft', 'Tab'); await press('Home');
const action = primary.hierarchy.actionBar.tooltipItem;
t.assert(action?.command === 'sceneEditor.addMember' && action.enabled, 'the real hierarchy Add action was not reachable');
await click((action.bounds.left + action.bounds.right) / 2, (action.bounds.top + action.bounds.bottom) / 2);
await type('studio_test.marker'); await press('Enter');
const canvas = primary.view.viewport.bounds;
await click(Math.round((canvas.left + canvas.right) / 2), Math.round((canvas.top + canvas.bottom) / 2));
const authored = model.buffer.getText(), version = model.version, selected = authoring.selection;
t.assert(authored !== source && selected?.kind === 'member', 'the stage did not admit the ordinary fixture placement');
const retained = () => {
	t.assert(main.primary === primary && authoring.selection === selected && model.version === version && model.buffer.getText() === authored,
		'layout or sizing changed the retained authored subject, selection or source');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === installed,
		'layout or sizing executed/replaced the paused guest');
};
const fonts = new Set();
let clippedIdentityVisited = false;
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		const variant = primary.view.hierarchy.layout.font.variant, label = `stage-${variant}-theme-${theme}`;
		fonts.add(variant); retained(); await capture(`${label}-automatic`);
		const details = primary.details.control, identity = primary.view.details.identity;
		t.command('sceneEditor.outline'); await t.frames(3);
		t.controlInput([{ type: 'pointer', x: identity.bounds.left + 1, y: identity.bounds.top + 1 }]); await t.frames(3);
		t.assert(details.tooltipItem === (identity.clipped ? identity : undefined), 'routed identity hover did not expose exactly its clipped subject');
		clippedIdentityVisited ||= identity.clipped;
		retained(); await capture(`${label}-identity-hover`);
		t.command('sceneEditor.details'); await press('Tab');
		t.assert(details.controls[0].field.focusTarget.hasFocus && details.tooltipItem === undefined,
			'entering a field retained the preceding physical identity hover');
		retained(); await capture(`${label}-identity-hover-to-field`);
		t.command('sceneEditor.outline'); await t.frames(3);
		t.controlInput([{ type: 'pointer', x: canvas.left + 2, y: canvas.top + 2 }]); await t.frames(3);
		t.assert(details.tooltipItem === undefined, 'leaving the identity retained a stale body tooltip');
		t.command('sceneEditor.details'); await t.frames(3);
		t.assert(details.focusTarget.hasFocus && details.tooltipItem === (identity.clipped ? identity : undefined),
			'Details section focus did not expose the same clipped identity for keyboard users');
		retained(); await capture(`${label}-identity-keyboard`);
		const title = primary.details.layoutState.titleBounds;
		t.controlInput([{ type: 'pointer', x: title.left + 1, y: title.top + 1 }]); await t.frames(3);
		t.assert(details.focusTarget.hasFocus, 'chrome identity hover took the current body keyboard focus');
		retained(); await capture(`${label}-identity-chrome-hover`);
		t.controlInput([{ type: 'pointer', x: canvas.left + 2, y: canvas.top + 2 }]); await t.frames(3);
		await press('Tab');
		t.assert(details.controls[0].field.focusTarget.hasFocus && details.tooltipItem === undefined,
			'identity feedback interfered with the first native position field');
		retained(); await capture(`${label}-identity-field-focus`);
		for (const role of ['hierarchy', 'details']) {
			t.command(role === 'hierarchy' ? 'sceneEditor.outline' : 'sceneEditor.details'); await t.frames(3);
			t.assert(layout[`${role}Width`] === undefined, 'automatic layout manufactured an explicit side-size preference');
			const sash = role === 'hierarchy' ? layout.hierarchySash : layout.detailsSash;
			// The current public sash supplies an input target, not a fixed geometry oracle.
			const x = sash.position, y = (sash.bounds.top + sash.bounds.bottom) / 2;
			t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(2);
			t.controlInput([{ type: 'pointer', x: x + (role === 'hierarchy' ? 12 : -12), y }]); await t.frames(2);
			t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(3);
			const requested = layout[`${role}Width`];
			t.assert(requested !== undefined && layout[`${role === 'hierarchy' ? 'details' : 'hierarchy'}Width`] === undefined,
				'the physical sash did not publish only its own explicit sizing intent');
			retained(); await capture(`${label}-${role}-dragged`);
			await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(3);
			t.assert(layout[`${role}Width`] === requested, 'font reflow overwrote the explicit pixel-size request');
			retained(); await capture(`${label}-${role}-other-font`);
			await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(3);
			t.command(role === 'hierarchy' ? 'sceneEditor.outline' : 'sceneEditor.details');
			t.command('workspace.resizeViewWidth'); await press('ArrowRight');
			t.assert(layout[`${role}Width`] !== requested, 'keyboard resize did not operate on the admitted sash');
			await press('Home'); await press('Escape'); await t.frames(3);
			t.assert(layout.hierarchyWidth === undefined && layout.detailsWidth === undefined, 'sash reset did not restore automatic side allocation');
			retained(); await capture(`${label}-${role}-reset`);
		}
		t.command('theme-toggle'); await t.frames(3);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(3);
}
t.assert(fonts.size === 2, 'the visible layout workflow did not exercise both fonts');
t.assert(clippedIdentityVisited, 'the visible workflow never exercised a clipped identity');
t.command('sceneEditor.outline'); t.command('undo'); await t.frames(4);
t.assert(model.buffer.getText() === source && !model.dirty, 'ordinary Undo did not restore the isolated fixture source');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `stage sizing logged an error: ${t.logMessage(index).message}`);
t.log('Completed real Workbench identity hover/keyboard feedback, field focus, side resizing, font reflow and reset in both fonts/themes.');
