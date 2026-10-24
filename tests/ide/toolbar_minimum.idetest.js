// Real contribution toolbars at the Game Panel's supported minimum editor width.
// Run: npm run ide:test -- nemesis_s tests/ide/toolbar_minimum.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true })));
	await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false })));
	await t.frames(2);
};
const click = async bounds => {
	t.controlInput([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]);
	await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]);
	await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
const open = async (command, kind) => {
	// Use the actual chooser, not context-sensitive Source-to-view shortcuts.
	t.openLuaSource('cart.lua'); await t.frames(2);
	t.command(command); await t.frames(2); await press('Enter'); await t.frames(3);
	const input = t.activeWorkbenchTab();
	t.assert(input.kind === kind, `${command}: the actual shipped contribution did not open`);
	return input;
};
const lineHeight = input => input.kind === 'animation' ? input.tracks.layout.rowHeight - 4 : input.layout.rowHeight;
const focusContent = async input => {
	if (input.kind === 'animation') {
		const list = input.tracks.layout;
		await click({ left: list.contentLeft, right: list.contentRight, top: list.contentTop, bottom: list.contentTop + list.rowHeight });
	} else await click(input.layout.sourceBounds);
};
const bounded = input => {
	const bar = input.actionBar, right = bar.bounds.right + 4;
	for (const item of bar.items) if (item.visible && !item.overflowed)
		t.assert(item.bounds.left >= 0 && item.bounds.right <= right - 4, `${input.kind}: a painted primary command escaped its actual editor bounds`);
	if (bar.overflow?.button.visible) {
		t.assert(bar.overflow.button.bounds.left >= 0 && bar.overflow.button.bounds.right <= right - 4, `${input.kind}: More escaped its actual editor bounds`);
		const commands = [...bar.items.filter(item => item.visible && !item.overflowed).map(item => item.command),
			...bar.overflow.items.filter(item => item.type === 'command').map(item => item.command)];
		t.assert(new Set(commands).size === commands.length, `${input.kind}: a command appears in both primary and secondary actions`);
		t.assert(commands.every(command => !command.endsWith('.more')), `${input.kind}: a second named More was nested inside More`);
	}
};
const sourceOpened = (input, source) => {
	const code = t.activeWorkbenchTab();
	t.assert(code.kind === 'code_editor' && code.workingCopy === input.workingCopy, `${input.kind}: Source lost the original canonical working copy`);
	t.assert(input.workingCopy.buffer.getText() === source, `${input.kind}: toolbar or focus navigation rewrote authored source`);
};

await t.waitForCart(); await t.frames(90);
for (const [command, kind, path] of [
	['animation', 'animation', 'director.lua'], ['sceneEditor', 'scene_editor', 'scenes/end_demo.lua'],
	['cartMap', 'cart_map', 'res/data/nemesis_s_stage.yaml'],
]) {
	let input = await open(command, kind);
	t.assert(input.workingCopy.resource.path === path, `${kind}: the chooser selected a different authored resource`);
	const originalInput = input, source = input.workingCopy.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles;
	for (let font = 0; font < 2; font++) {
		bounded(input);
		await capture(`${kind}-full-${lineHeight(input) === 6 ? 'tiny' : 'msx'}`);
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	t.command('gameView.togglePanel'); await t.frames(3);
	// The published editor right edge is two pixels before the actual outer sash.
	const sash = input.actionBar.bounds.right + 6;
	t.controlInput([{ type: 'pointer', x: sash, y: 80 }, { type: 'button', button: 'primary', down: true }]);
	await t.frames(1);
	t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
	for (let font = 0; font < 2; font++) {
		const variant = lineHeight(input) === 6 ? 'tiny' : 'msx';
		t.assert(input.actionBar.bounds.right + 4 === (variant === 'tiny' ? 78 : 118), `${kind}: the real sash did not reach the supported ${variant} minimum`);
		if (kind === 'scene_editor') {
			const details = input.actionBar.items.find(item => item.command === 'sceneEditor.details');
			t.assert(input.layout.mode === 'outline' && input.section === 'outline', 'the narrow Scene toolbar still accompanies two cramped columns');
			t.assert(details.visible && !details.overflowed && details.icon === 'info', 'compact Details navigation is not a directly reachable native icon');
		}
		for (let theme = 0; theme < 2; theme++) {
			bounded(input); await capture(`${kind}-minimum-${variant}-theme-${theme}`);
			t.command('theme-toggle'); await t.frames(2);
		}
		if (kind !== 'animation') {
			const header = input.layout.sourceBounds;
			t.controlInput([{ type: 'pointer', x: (header.left + header.right) / 2, y: (header.top + header.bottom) / 2 }]);
			await capture(`${kind}-minimum-${variant}-full-source-hint`);
		}
		await focusContent(input);
		const bar = input.actionBar;
		if (kind === 'cart_map') {
			const visible = bar.items.filter(item => item.visible && !item.overflowed);
			t.assert(bar.overflow === undefined && visible.length === 2
				&& visible.some(item => item.command === 'cartMap.source')
				&& visible.some(item => item.command === (input.layout.mode === 'outline' ? 'cartMap.map' : 'cartMap.outline')),
				'the compact map toolbar must expose Source and exactly its other client, without More');
			await click(visible.find(item => item.command === 'cartMap.source').bounds); sourceOpened(input, source);
			input = await open(command, kind); await focusContent(input);
			await press('ShiftLeft', 'Tab');
			t.assert(input.actionBar.hasFocus, 'map Source is not keyboard reachable at the supported minimum');
			await press('End'); await press('Enter'); sourceOpened(input, source);
		} else {
			t.assert(bar.overflow.button.visible, `${kind}: the supported minimum has no More affordance`);
			t.assert(bar.overflow.items.some(item => item.type === 'command' && item.command === `${command}.source`), `${kind}: original Source is not reachable in More`);
			await click(bar.overflow.button.bounds); await capture(`${kind}-minimum-${variant}-more-pointer`);
			await press('Escape'); await press('ShiftLeft', 'Tab');
			t.assert(bar.hasFocus, `${kind}: dismissing pointer More did not restore the actual content focus ring`);
			await press('End'); await press('Enter'); await capture(`${kind}-minimum-${variant}-more-keyboard`);
			// All member mutations are disabled at the scene root. Animation has no selected producer;
			// Source is its last eligible authored secondary action, not another More popup.
			if (kind === 'animation') {
				t.assert(input.details.selectionIndex === -1, 'the root-only Source test accidentally selected a producer');
				await press('End');
			} else await press('Home');
			await press('Enter'); sourceOpened(input, source);
		}
		input = await open(command, kind);
		t.assert(input === originalInput, `${kind}: returning from Source replaced the retained contribution input`);
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, `${kind}: toolbar presentation advanced the paused guest`);
	t.assert(input.workingCopy.buffer.getText() === source, `${kind}: the minimum-width workflow changed source bytes`);
	t.command('gameView.closePanel'); await t.frames(3);
}
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Toolbar workflow logged an error: ${t.logMessage(index).message}`);
