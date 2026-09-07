import { check, type StudioFixture } from './studio_fixture';

/** Exercise the shipped Format Document keybinding and document history. */
export async function testSourceFormatting(test: StudioFixture): Promise<void> {
	const { harness, frame, press } = test;
	harness.openLuaSource('scenes/root.lua');
	const model = harness.getActiveEditorDocument().model;
	const original = model.buffer.getText();
	// Arrange authored source; the formatting under test is invoked only by input.
	const prefix = "do\nlocal start = '--[['\nlocal s = [=[first  \n  middle\n    last]=]\nlocal finish = ']]'\nlocal short = 'a\\z  \n   b'\n-- actual comment  \nend\n\n";
	const formattedPrefix = "do\n\tlocal start = '--[['\n\tlocal s = [=[first  \n  middle\n    last]=]\n\tlocal finish = ']]'\n\tlocal short = 'a\\z  \n   b'\n\t-- actual comment  \nend\n\n";
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]);
	await frame();
	await press('AltLeft', 'ShiftLeft', 'KeyF');
	check(model.buffer.getText() === formattedPrefix + original, 'format: physical command changes indentation, never string/comment content');
	const version = model.version;
	await press('AltLeft', 'ShiftLeft', 'KeyF');
	check(model.version === version, 'format: an already formatted document creates no undo entry');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === prefix + original, 'format: one document Undo restores every authored byte');
	await press('ControlLeft', 'KeyY');
	check(model.buffer.getText() === formattedPrefix + original, 'format: document Redo restores the formatting');
	await press('ControlLeft', 'KeyZ');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty, 'format: undoing the fixture returns to the saved source before scene tests');
}
