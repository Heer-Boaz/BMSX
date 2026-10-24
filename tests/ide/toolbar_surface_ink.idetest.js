// Shipped Nemesis contributions; ordinary input only, no edited or injected models.
// Run: npm run ide:test -- nemesis_s tests/ide/toolbar_surface_ink.idetest.js --ttl 120
// Cart Map has dedicated responsive coverage; Assistant/Conversations require connected fixtures.
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const point = async (x, y) => { t.controlInput([{ type: 'pointer', x, y }]); await t.frames(2); };
const click = async bounds => {
	t.controlInput([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const type = async text => { for (const character of text) await press(`Key${character.toUpperCase()}`); };
let captures = 0, panelOpen = false;
const capture = async label => {
	t.assert(++captures <= 44, 'the bounded toolbar workflow exceeded its capture budget');
	await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label);
};
const full = async () => {
	if (panelOpen) { t.command('gameView.closePanel'); await t.frames(3); panelOpen = false; }
};
const minimum = async (input, bar, variant) => {
	if (!panelOpen) { t.command('gameView.togglePanel'); await t.frames(3); panelOpen = true; }
	// Read the owning editor edge, not a contribution's internal divider.
	const x = (input.kind === 'animation' ? bar.bounds.right + 4 : input.layout.right) + 2;
	t.controlInput([{ type: 'pointer', x, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
	t.assert((input.kind === 'animation' ? bar.bounds.right + 4 : input.layout.right) === (variant === 'tiny' ? 78 : 118),
		`${input.kind}: the actual sash did not reach its font minimum`);
};
const metadata = (label, phase, variant, theme, bars) => {
	t.log(JSON.stringify({ surfaceInk: label, phase, variant, theme, bars: bars.map(([surface, bar]) => ({
		surface, bounds: { ...bar.bounds }, hasFocus: bar.hasFocus,
		hovered: bar.hoveredCommand === null ? null : String(bar.hoveredCommand),
		items: bar.items.map(item => ({ command: item.command, label: item.label, icon: item.icon,
			visible: item.visible, overflowed: item.overflowed, enabled: item.enabled, checked: item.checked, bounds: { ...item.bounds } })),
		more: bar.overflow === undefined ? undefined : { visible: bar.overflow.button.visible,
			bounds: { ...bar.overflow.button.bounds }, commands: bar.overflow.items.filter(item => item.type === 'command').map(item => item.command) },
	})) }));
};
const hoverAction = async bar => {
	const item = bar.overflow?.button.visible ? bar.overflow.button
		: bar.items.find(item => item.visible && !item.overflowed && item.icon !== undefined)
			?? bar.items.find(item => item.visible && !item.overflowed);
	t.assert(item !== undefined, 'the actual toolbar has no painted action');
	await point((item.bounds.left + item.bounds.right) / 2, (item.bounds.top + item.bounds.bottom) / 2);
	t.assert(bar.hoveredCommand === item.command, 'the physical pointer did not reach the painted action');
	return item;
};
const open = async (command, kind, query = '') => {
	await full(); t.openLuaSource('cart.lua'); await t.frames(2);
	t.command(command); await t.frames(2);
	if (query !== '') await type(query);
	await press('Enter'); await t.frames(3);
	const input = t.activeWorkbenchTab();
	t.assert(input.kind === kind, `${command}: the shipped contribution did not open through its chooser`);
	return input;
};
const matrix = async (label, input, bar, fullCaptures, groups = false) => {
	const model = input.workingCopy, source = model?.buffer.getText(), version = model?.version;
	const cycles = t.runtime().machine.scheduler.nowCycles;
	for (let font = 0; font < 2; font++) {
		const variant = input.kind === 'animation' ? (input.tracks.layout.rowHeight - 4 === 6 ? 'tiny' : 'msx') : input.layout.font.variant;
		for (let theme = 0; theme < 2; theme++) {
			await full(); await point(2, 285);
			let groupIndex = -1;
			if (groups) {
				const tree = input.tree, layout = tree.layout;
				groupIndex = tree.rows.findIndex(row => row.element.kind === 'group' && !row.element.warning);
				t.assert(groupIndex >= 0 && groupIndex < layout.visibleRowCount, 'the shipped AEM has no visible ordinary group');
				await click({ left: layout.contentLeft, right: layout.contentRight, top: layout.contentTop, bottom: layout.contentTop + layout.rowHeight });
				await press('Home');
				for (let row = 0; row < groupIndex + 1; row++) await press('ArrowDown');
				t.assert(tree.selectionIndex !== groupIndex, 'the idle AEM group is still selected');
				await point(2, 285);
			}
			metadata(label, 'full-idle', variant, theme, [['body', bar]]);
			if (fullCaptures) await capture(`${label}-${variant}-${theme}-full-idle`);
			if (input.kind === 'aem_editor') {
				const add = bar.items.find(item => item.command === 'aem.add');
				t.assert(add !== undefined && add.visible && !add.overflowed && add.enabled && add.icon === undefined,
					'the actual AEM Add action is not an enabled painted label');
				await point((add.bounds.left + add.bounds.right) / 2, (add.bounds.top + add.bounds.bottom) / 2);
				t.assert(bar.hoveredCommand === add.command, 'the physical pointer did not hover the actual AEM Add label');
				metadata(label, 'full-add-hover', variant, theme, [['body', bar]]);
				await capture(`${label}-${variant}-${theme}-full-add-hover`);
				t.assert(model.buffer.getText() === source && model.version === version, 'AEM label hover changed canonical source');
				t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'AEM label hover advanced the paused guest');
			}
			if (groups) {
				const tree = input.tree, layout = tree.layout;
				await point(layout.contentLeft + layout.twistieWidth + 8,
					layout.contentTop + (groupIndex - (tree.scroll | 0) + 0.5) * layout.rowHeight);
				t.assert(tree.hoverIndex === groupIndex && tree.selectionIndex !== groupIndex, 'the actual group hover was not distinct from selection');
				t.log(JSON.stringify({ surfaceInk: label, phase: 'group-hover', variant, theme, groupIndex,
					label: tree.rows[groupIndex].element.label, kind: tree.rows[groupIndex].element.kind, layout: { ...layout } }));
				await capture(`${label}-${variant}-${theme}-group-hover`);
			}
			if (input.kind === 'actor_lab') {
				// Actor Lab already owns a game frame; the separate Game Panel stays hidden.
				await capture(`${label}-${variant}-${theme}-full-idle`);
			} else {
				await minimum(input, bar, variant);
				await hoverAction(bar);
				metadata(label, 'minimum-hover', variant, theme, [['body', bar]]);
				await capture(`${label}-${variant}-${theme}-minimum-hover`);
			}
			t.assert(t.activeWorkbenchTab() === input, `${label}: hover or resize replaced the input`);
			if (model !== undefined) t.assert(model.buffer.getText() === source && model.version === version, `${label}: presentation changed canonical source`);
			t.assert(t.runtime().machine.scheduler.nowCycles === cycles, `${label}: presentation advanced the paused guest`);
			t.command('theme-toggle'); await t.frames(2);
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	await full();
};

await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
const canonical = t.activeWorkbenchTab().workingCopy, original = canonical.buffer.getText(), originalVersion = canonical.version;

const audio = await open('aem', 'aem_editor');
t.assert(audio.workingCopy.resource.path === 'res/data/events.aem.yaml', 'the AEM chooser selected another source');
await matrix('aem', audio, audio.actionBar, true, true);

const animation = await open('animation', 'animation', 'director');
t.assert(animation.workingCopy.resource.path === 'director.lua', 'the animation chooser selected another authored source');
await matrix('animation', animation, animation.actionBar, true);

const scene = await open('sceneEditor', 'scene_editor');
t.assert(scene.workingCopy.resource.path === 'scenes/end_demo.lua', 'the Scene chooser selected another authored source');
await matrix('scene', scene, scene.actionBar, false);

// A known shipped producer, not a fabricated program or another cartridge session.
const program = await open('inputBindings', 'lua_program', 'director');
t.assert(program.programKind === 'input' && program.workingCopy.resource.path === 'director.lua', 'Input Bindings lost the real director producer');
await matrix('lua-program', program, program.actionBar, true);

t.openLuaSource('cart.lua'); await t.frames(2); t.command('actorLab'); await t.frames(2); await press('Enter'); await t.frames(3);
const actor = t.activeWorkbenchTab();
t.assert(actor.kind === 'actor_lab' && actor.actorPresent, 'the running Intro actor did not open');
await matrix('actor', actor, actor.actionBar, false);

await full(); t.openLuaSource('cart.lua'); await t.frames(2);
t.command('romInspector'); await t.frames(2); await press('ArrowDown'); await press('Enter'); await t.frames(3);
const rom = t.activeWorkbenchTab();
t.assert(rom.kind === 'rom_inspector' && rom.snapshot.domain === 0, 'the installed cartridge snapshot did not open');
await press('ShiftLeft', 'Tab'); await type('konami'); await press('Enter'); await press('Home');
t.assert(rom.model.selection.label === 'intro_konami', 'the actual ROM asset filter selected another subject');
const snapshot = rom.snapshot, subject = rom.model.selection, cycles = t.runtime().machine.scheduler.nowCycles;
for (let font = 0; font < 2; font++) {
	const variant = rom.layout.font.variant;
	for (let theme = 0; theme < 2; theme++) {
		await full(); await minimum(rom, rom.actions, variant);
		t.command('romInspector.inspect'); await t.frames(3);
		t.assert(rom.readerWindow.open && rom.reader.subject === subject && rom.reader.preview.image.width > 0, 'ordinary inspection lost the actual image document');
		const source = rom.readerViewActions.items.find(item => item.command === 'romInspector.source');
		t.assert(source.visible && !source.overflowed && source.icon === 'source' && !source.enabled,
			'the shipped image no longer exercises the actual disabled Reader Source icon');
		await point((source.bounds.left + source.bounds.right) / 2, (source.bounds.top + source.bounds.bottom) / 2);
		t.assert(rom.readerViewActions.hoveredCommand === source.command, 'the disabled Reader Source icon did not receive actual hover');
		metadata('rom', 'minimum-reader-disabled-hover', variant, theme,
			[['body', rom.actions], ['floating-body', rom.readerViewActions], ['window-title', rom.readerActions]]);
		await capture(`rom-${variant}-${theme}-minimum-reader-disabled-hover`);
		await press('Escape');
		t.assert(rom.readerWindow.open, 'Escape from the actual Reader unexpectedly hid it');
		// One filtered row makes Home/End a vacuous focus probe. Edit the actual catalog filter instead.
		await press('ShiftLeft', 'Tab'); await press('ControlLeft', 'KeyA'); await type('konam');
		t.assert(rom.model.filter === 'konam', 'Reader Escape did not return keyboard ownership to the catalog filter ring');
		await press('ControlLeft', 'KeyA'); await type('konami'); await press('Enter'); await press('Home');
		t.command('romInspector.inspect'); await t.frames(2); t.command('window.hide'); await t.frames(2);
		t.assert(!rom.readerWindow.open && rom.snapshot === snapshot && rom.reader.subject === subject, 'closing the Reader replaced its retained snapshot or subject');
		t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'ROM presentation advanced the paused guest');
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
await full();
t.assert(canonical.buffer.getText() === original && canonical.version === originalVersion, 'toolbar presentation changed the original cart source');
t.assert(captures === 44, 'the bounded matrix did not capture every declared toolbar/group state');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Toolbar surface workflow logged an error: ${t.logMessage(index).message}`);
