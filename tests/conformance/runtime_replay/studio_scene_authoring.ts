import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import type { SceneEditorInput } from '../../../ide/workbench/contrib/scene_editor/editor_input';
import { openSceneEditor, selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

/** Navigate and edit through visible controls. Guest access below is read-only:
 * no model edits, clipboard injection, runtime calls or alternative cart. */
export async function openScene(test: StudioFixture, name: string, memberCount = 3) {
	await test.press('ControlLeft', 'Comma');
	await test.press('ControlLeft', 'KeyA');
	await test.press('Backspace');
	for (const character of `scenes/${name}`) {
		if (character === '_') await test.press('ShiftLeft', 'Minus');
		else if (character >= '0' && character <= '9') await test.press(`Digit${character}`);
		else await test.press(character === '/' ? 'Slash' : `Key${character.toUpperCase()}`);
	}
	const picker = test.ide.editor.quickInput;
	check(picker.model.list.rows[0].item.label === `scenes/${name}.lua`, 'file picker finds the actual scene source');
	await test.press('Enter');
	await test.until(() => getActiveTab().kind === 'code_editor'
		&& getActiveTab().resource?.path === `scenes/${name}.lua`, 'file picker opens scene code');
	const scene = await openSceneEditor(test);
	check(scene.outline.roots.length === 1 && scene.outline.roots[0].children.length === memberCount,
		`${name}: Studio exposes all ${memberCount} separately authored members`);
	return scene;
}

export async function editPosition(test: StudioFixture, scene: SceneEditorInput, member: number, field: number, value: number) {
	await selectMember(test, scene, member);
	await test.click(scene.properties[field].bounds);
	await test.press('ControlLeft', 'KeyA');
	for (const digit of String(value)) await test.press(`Digit${digit}`);
	await test.press('Enter');
	check(scene.properties[field].value === value, 'visible position property accepts keyboard input');
	await test.press('ControlLeft', 'KeyS');
	await test.until(() => !scene.workingCopy.dirty, 'save authored position through the workspace API');
}

