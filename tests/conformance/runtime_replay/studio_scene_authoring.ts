import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import type { SceneEditorInput } from '../../../ide/workbench/contrib/scene_editor/editor_input';
import { openSceneEditor, selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';
import { CHARACTER_MAP } from '../../../ide/common/character_map';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';

/** Physical single-line typing, including Lua punctuation; no clipboard/model writes. */
export async function typeSourceText(test: StudioFixture, text: string): Promise<void> {
	for (const character of text) {
		if (character === ' ') { await test.press('Space'); continue; }
		const entry = Object.entries(CHARACTER_MAP).find(([, value]) => value.normal === character || value.shift === character);
		check(entry !== undefined, `keyboard can type ${character}`);
		if (entry[1].normal === character) await test.press(entry[0]);
		else await test.press('ShiftLeft', entry[0]);
	}
}

/** Navigate and edit through visible controls. Guest access below is read-only:
 * no model edits, clipboard injection, runtime calls or alternative cart. */
export async function openScene(test: StudioFixture, name: string, memberCount = 3) {
	await test.press('ControlLeft', 'Comma');
	await test.press('ControlLeft', 'KeyA');
	await test.press('Backspace');
	await typeSourceText(test, `scenes/${name}`);
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

/** Reach even a scrolled option through the editor's actual Tab/reveal route. */
export async function focusOption(test: StudioFixture, scene: SceneEditorInput, member: number, label: string) {
	await selectMember(test, scene, member);
	const pane = test.ide.editor.editorPanes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('the Scene Editor must own the option inputs');
	const index = scene.optionProperties.findIndex(property => property.label === label);
	check(index >= 0, `${label}: authored option appears in the inspector`);
	const control = pane.options.controls[index];
	for (let step = 0; !control.field.focusTarget.hasFocus && step < pane.controls.length + pane.options.controls.length + 3; step += 1) await test.press('Tab');
	check(control.field.focusTarget.hasFocus, `${label}: Tab reaches the authored option`);
	const bounds = scene.optionProperties[index].bounds;
	check(bounds.top >= scene.details.bounds.top && bounds.bottom <= scene.details.bounds.bottom,
		`${label}: focus reveals the complete option input`);
	await test.click(bounds);
	await test.press('ControlLeft', 'KeyA');
	return control;
}

export async function editOption(test: StudioFixture, scene: SceneEditorInput, member: number, label: string, text: string) {
	const control = await focusOption(test, scene, member, label);
	await typeSourceText(test, text);
	check(control.pending, `${label}: keyboard produces a local draft`);
	await test.press('ControlLeft', 'KeyS');
	await test.until(() => !scene.workingCopy.dirty, `${label}: Save commits and persists the option`);
	check(control.field.text === text && !control.pending && control.field.focusTarget.hasFocus,
		`${label}: Save retains the accepted field's focus`);
	await test.press('Enter');
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
