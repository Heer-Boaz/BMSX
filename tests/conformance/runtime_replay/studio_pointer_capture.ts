import { pointerCapture } from '../../../ide/input/pointer/capture';
import { check, type StudioFixture } from './studio_fixture';

/** Exercise the real dispatcher, not just a control's direct event method. */
export async function testStudioPointerCapture(test: StudioFixture): Promise<void> {
	const { ide, frame, press, movePointer, setPointerButton } = test;
	check(ide.editor.isActive, 'pointer capture requires an active workbench');
	let moves = 0;
	let stops = 0;
	const target = { handleCapturedPointer() { moves += 1; }, cancelPointer() { stops += 1; } };
	movePointer({ left: 80, top: 100, right: 82, bottom: 102 });
	await frame();
	setPointerButton('pointer_primary', true);
	await frame();
	pointerCapture.capture(target);
	await frame();
	check(moves === 1, 'active capture receives movement before ordinary pane dispatch');
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	check(ide.editor.quickInput.visible && stops === 1, 'the actual palette ends lower pointer capture');
	const beforeClose = moves;
	await press('Escape');
	await frame();
	check(!ide.editor.quickInput.visible && moves === beforeClose, 'closing palette while held cannot resume the departed gesture');
	setPointerButton('pointer_primary', false);
	await frame();
	console.info('STUDIO: pointer capture / palette interruption PASS');
}
