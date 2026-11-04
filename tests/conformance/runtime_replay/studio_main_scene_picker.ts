import type { RuntimeResource } from '../../../ide/common/resource';
import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { createLuaSourceRegistry, registerLuaSourceRecord } from '../../../ide/runtime/source_registry';
import type { ProjectContentEntry } from '../../../ide/workbench/contrib/resources/content_index';
import { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import type { QuickPickItem } from '../../../ide/workbench/services/quick_input/provider';
import { SCENE_AUTHORING_IMPORTS, SCENE_AUTHORING_SOURCE } from '../../fixtures/studio/scene_authoring';
import { createTestSourceOnlyLuaRecord, createTestToolingPackage } from '../../helpers/runtime_sources';
import { check, type StudioFixture } from './studio_fixture';

type SceneChoice = QuickPickItem & { readonly entry: Extract<ProjectContentEntry, { kind: 'scene' }> };

/** Discovery admits an exact Scene document; its companions never become a second source owner. */
export async function testStudioMainScenePicker(test: StudioFixture): Promise<void> {
	const { ide } = test, editor = ide.editor, parts = editor.editorParts, panel = editor.resourcePanel;
	const root = 'tests/fixtures/studio/main-scene-picker', contextId = 'fixture-studio-main-scene-picker';
	const first = SCENE_AUTHORING_SOURCE.replaceAll('fixture.', 'picker.first.').replace("'picker.first.room'", "'picker.same'").replace('return {}\n', '');
	const second = SCENE_AUTHORING_SOURCE.replaceAll('fixture.', 'picker.second.').replace("'picker.second.room'", "'picker.same'");
	const alphaSource = first + second, betaSource = SCENE_AUTHORING_SOURCE.replaceAll('fixture.', 'picker.beta.').replace("'picker.beta.room'", "'picker.same'").replace('x = 1, y = 2, z = 3', 'x = 9, y = 2, z = 3');
	const registry = createLuaSourceRegistry(root, 'alpha.lua');
	for (const [path, source] of [['alpha.lua', alphaSource], ['beta.lua', betaSource],
		['cartlib/world/scene_library.lua', 'return {}'], ...SCENE_AUTHORING_IMPORTS] as const)
		registerLuaSourceRecord(registry, createTestSourceOnlyLuaRecord(path, source, `${root}/${path}`));
	ide.sources.catalog.admitContext({ admission: { id: contextId, projectRoot: root }, programDomain: 'cart', systemContextId: null,
		luaSources: registry, sourceRoots: [{ path: root, resourcePathPrefix: '', modulePathPrefix: '', structured: true, sourceKind: 'source-only' }],
		dependencyContextIds: [], previewPackage: createTestToolingPackage(root), previewRom: null, assetSources: [] });
	const alpha = ide.sources.catalog.resolveResource({ contextId, path: 'alpha.lua' })!;
	const beta = ide.sources.catalog.resolveResource({ contextId, path: 'beta.lua' })!;
	await test.frame();
	check(editor.mainWorkspace.primary === undefined && editorTextModelService.get(alpha) === undefined && editorTextModelService.get(beta) === undefined,
		'Scene chooser: discovery starts without canonical models or a fabricated Scene attachment');
	const background = parts.groups.flatMap(group => group.model.tabs).filter(input => input.kind === 'code_editor')
		.map(input => ({ model: input.workingCopy, source: input.workingCopy.buffer.getText(), version: input.workingCopy.version }));
	const media = ide.sources.currentBlua32Media, cycles = test.cycles(), boot = ide.boots.latestOperation, hotResume = ide.hotResumes.latestOperation;
	const activity = editor.mainWorkspace.activity, activityDisplayed = editor.mainWorkspace.activityDisplayed;
	const choose = async (resource: RuntimeResource, occurrence: number, capture?: string) => {
		const picker = editor.quickInput;
		check(picker.visible && !picker.inputBox, 'Scene chooser: Home and Palette open the real declaration picker');
		const choices = picker.model.items as readonly SceneChoice[];
		check(choices.filter(item => item.entry.ownerResource === alpha).length === 2
			&& choices.filter(item => item.entry.ownerResource === beta).length === 1,
			'Scene chooser: identical names retain their actual file and occurrence identities');
		await test.clipboard.writeText('picker.same'); await test.press('ControlLeft', 'KeyV');
		const rows = picker.model.list.rows;
		const target = rows.findIndex(row => {
			const entry = (row.item as SceneChoice).entry;
			return entry.ownerResource === resource && entry.definition === entry.document.scenes[occurrence];
		});
		check(target >= 0, 'Scene chooser: the exact requested declaration remains selectable');
		await test.press('ControlLeft', 'Home');
		for (let row = 0; row < target; row++) await test.press('ArrowDown');
		if (capture !== undefined) await test.capture?.(capture);
		await test.press('Enter');
		await test.until(() => {
			const primary = editor.mainWorkspace.primary;
			return primary instanceof ScenePrimaryClient && primary.input.resource === resource;
		}, 'Scene chooser: the accepted source-owned Scene document publishes its companions');
	};
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.runPaletteCommand('View: Studio Home');
			await test.until(() => parts.activeGroup.model.activeTab?.kind === 'home', 'Scene chooser: Home is an ordinary retained document');
			const home = parts.activeGroup.model.activeTab;
			if (home?.kind !== 'home') throw new Error('Scene chooser: the actual Home page is required');
			const action = home.sections.flatMap(section => section.actions.items).find(item => item.command === 'sceneEditor')!;
			const files = JSON.stringify(panel.serialize().view), originalGroups = [...parts.groups];
			await test.click(action.bounds);
			await choose(alpha, 1, `main-scene-picker-${editor.fontVariant}-theme-${theme}-choices`);
			const client = editor.mainWorkspace.primary;
			if (!(client instanceof ScenePrimaryClient)) throw new Error('Scene chooser: an actual Scene companion is required');
			const input = client.input, model = input.workingCopy, owner = parts.findGroup(input)!;
			check(owner.model.activeTab === input && client.authoring.subject === client.authoring.document!.scenes[1]
				&& model.buffer.getText() === alphaSource,
				'Scene chooser: the visible document owns the second same-named occurrence and its canonical source');
			await test.runPaletteCommand('Workspace: Focus Hierarchy'); await test.press('Home'); await test.press('ArrowDown'); await test.press('Enter');
			check(client.authoring.selection?.kind === 'member' && client.authoring.selection.index === 0,
				'Scene chooser: ordinary hierarchy input selects the chosen occurrence\'s member');
			const value = 20 + font * 2 + theme;
			await test.click(client.view.details.properties[0].bounds); await test.press('ControlLeft', 'KeyA');
			await test.clipboard.writeText(String(value)); await test.press('ControlLeft', 'KeyV'); await test.press('Enter');
			const accepted = first + second.replace('x = 1, y = 2, z = 3', `x = ${value}, y = 2, z = 3`);
			check(model.dirty && model.buffer.getText() === accepted, 'Scene chooser: editing changes only the second declaration');
			await test.runPaletteCommand('Scene Editor: Open'); await choose(beta, 0);
			const replacement = editor.mainWorkspace.primary;
			if (!(replacement instanceof ScenePrimaryClient)) throw new Error('Scene chooser: the chosen beta document is required');
			const betaInput = replacement.input;
			check(parts.findGroup(input) === owner && owner.model.contains(input) && model.dirty && model.buffer.getText() === accepted
				&& !editor.actionPrompt.visible && replacement.authoring.workingCopy.buffer.getText() === betaSource,
				'Scene chooser: changing documents retains the dirty alpha owner rather than inventing a Main replacement prompt');
			await test.clickTab(input.id, 1, owner);
			await test.until(() => editor.mainWorkspace.primary?.input === input, 'Scene chooser: the retained Scene input reattaches its own companions');
			await test.runPaletteCommand('Workspace: Focus Hierarchy'); await test.press('ControlLeft', 'KeyZ');
			check(!model.dirty && model.buffer.getText() === alphaSource, 'Scene chooser: the retained document owns its original source history');
			await test.runPaletteCommand('Workspace: Clear Primary Authoring');
			await test.until(() => parts.findGroup(input) === undefined, 'Scene chooser: Clear closes the actual Scene document');
			await test.clickTab(betaInput.id, 1, parts.findGroup(betaInput)!);
			await test.runPaletteCommand('Workspace: Clear Primary Authoring');
			await test.until(() => parts.findGroup(betaInput) === undefined, 'Scene chooser: beta document closure retires its companions');
			check(originalGroups.every(group => parts.groups.includes(group)) && JSON.stringify(panel.serialize().view) === files && editor.mainWorkspace.activity === activity
				&& editor.mainWorkspace.activityDisplayed === activityDisplayed,
				'Scene chooser: document selection leaves unrelated Files reading and activity ownership unchanged');
			check(background.every(entry => entry.model.buffer.getText() === entry.source && entry.model.version === entry.version)
				&& ide.sources.currentBlua32Media === media && test.cycles() === cycles
				&& ide.boots.latestOperation === boot && ide.hotResumes.latestOperation === hotResume,
				'Scene chooser: source admission and editing never replace background source or execute guest code');
			if (!originalGroups.includes(owner)) {
				await test.runPaletteCommand('Window: Focus Main Workspace');
				for (let step = 0; parts.activeGroup !== owner && step < parts.groups.length; step++)
					await test.runPaletteCommand('Editor Groups: Focus Next Group');
				check(parts.activeGroup === owner && owner.model.tabs.length === 0, 'Scene chooser: only its newly created empty group is retired');
				await test.runPaletteCommand('Editor Groups: Close Group');
			}
			await test.press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await test.press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
}
