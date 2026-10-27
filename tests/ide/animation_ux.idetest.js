// Real shipped EndDemo callback captions and canonical Source ownership.
// Run: npm run ide:test -- nemesis_s tests/ide/animation_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true })));
	await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false })));
	await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart();
await t.frames(90);
t.openLuaSource('cart.lua');
await t.frames(2);
t.command('animation');
await t.frames(2);
for (const key of ['KeyE', 'KeyN', 'KeyD']) await press(key);
await press('Enter');
await t.frames(3);
const animation = t.activeWorkbenchTab();
t.assert(animation.kind === 'animation' && animation.workingCopy.resource.path === 'end_demo.lua', 'the actual EndDemo animation did not open');
const source = animation.workingCopy.buffer.getText(), tracks = animation.document.tracks;
t.assert(tracks.length === 3 && animation.document.clips.length === 4, 'the real authored EndDemo track/clip membership changed');
t.assert(tracks[0].label === 'apply_slide', 'the written named callback was not used as the compact caption');
t.assert(tracks[1].label === 'Apply @99:12', 'the anonymous callback did not keep its real written source occurrence');
t.assert(tracks[2].label === 'presentation.members.curtain.visible', 'the actual property path was replaced with an invented target');
const cycles = t.runtime().machine.scheduler.nowCycles;
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		t.assert(animation.tracks.rows[1].text !== animation.tracks.rows[2].text, 'different callback tracks have indistinguishable visible labels');
		await capture(`animation-captions-${font === 0 ? 'tiny' : 'msx'}-${theme}`);
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
await press('ArrowDown');
t.assert(animation.trackIndex === 0, 'ordinary keyboard navigation did not select the named callback track');
const apply = animation.details.rows.find(row => row.element.label === 'apply').element;
t.assert(apply.value === 'apply_slide' && apply.description.includes('end_demo.lua:90'), 'caption shortening discarded the full callback/source context');
await capture('animation-selected-callback-tiny');
await press('ControlLeft', 'ShiftLeft', 'KeyT');
await capture('animation-selected-callback-msx');
t.command('editor.source'); await t.frames(3);
const authored = t.activeWorkbenchTab();
t.assert(authored.kind === 'code_editor' && authored.workingCopy === animation.workingCopy, 'Source no longer owns the canonical EndDemo working copy');
t.assert(animation.workingCopy.buffer.getText() === source, 'presentation edited canonical authored source');
t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'presentation advanced the paused guest');
for (let index = 0; index < t.logMessageCount(); index++) {
	const message = t.logMessage(index);
	t.assert(message.level !== 3, `Authoring workflow logged an error: ${message.message}`);
}
