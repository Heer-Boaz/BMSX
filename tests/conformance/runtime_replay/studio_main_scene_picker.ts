import type { RuntimeResource } from '../../../ide/common/resource';
import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { inputFocus } from '../../../ide/input/focus';
import { createLuaSourceRegistry, registerLuaSourceRecord } from '../../../ide/runtime/source_registry';
import type { ProjectContentEntry } from '../../../ide/workbench/contrib/resources/content_index';
import { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import type { QuickPickItem } from '../../../ide/workbench/services/quick_input/provider';
import { SCENE_AUTHORING_SOURCE } from '../../fixtures/studio/scene_authoring';
import { createTestSourceOnlyLuaRecord, createTestToolingPackage } from '../../helpers/runtime_sources';
import { check, type StudioFixture } from './studio_fixture';

type SceneChoice = QuickPickItem & { readonly entry: Extract<ProjectContentEntry, { kind: 'scene' }> };

/** Main-subject discovery starts from source admissions, never a pre-opened document or Files selection. */
export async function testStudioMainScenePicker(test: StudioFixture): Promise<void> {
	const { ide } = test, editor = ide.editor, parts = editor.editorParts, panel = editor.resourcePanel;
	const root = 'tests/fixtures/studio/main-scene-picker', contextId = 'fixture-studio-main-scene-picker';
	const first = SCENE_AUTHORING_SOURCE.replace("'fixture.room'", "'picker.same'").replace('return {}\n', '');
	const second = SCENE_AUTHORING_SOURCE.replace("'fixture.room'", "'picker.same'");
	const alphaSource = first + second, betaSource = second.replace('0, 0, 1, 1,', '0, 0, 1, 9,');
	const registry = createLuaSourceRegistry(root, 'alpha.lua');
	for (const [path, source] of [['alpha.lua', alphaSource], ['beta.lua', betaSource], ['cartlib/world/scene_library.lua', 'return {}']] as const)
		registerLuaSourceRecord(registry, createTestSourceOnlyLuaRecord(path, source, `${root}/${path}`));
	ide.sources.catalog.admitContext({ admission: { id: contextId, projectRoot: root }, programDomain: 'cart', systemContextId: null,
		luaSources: registry, sourceRoots: [{ path: root, resourcePathPrefix: '', modulePathPrefix: '', structured: true, sourceKind: 'source-only' }],
		dependencyContextIds: [], previewPackage: createTestToolingPackage(root), previewRom: null, assetSources: [] });
	const alpha = ide.sources.catalog.resolveResource({ contextId, path: 'alpha.lua' })!;
	const beta = ide.sources.catalog.resolveResource({ contextId, path: 'beta.lua' })!;
	await test.frame();
	check(editor.mainWorkspace.primary === undefined && editorTextModelService.get(alpha) === undefined && editorTextModelService.get(beta) === undefined
		&& parts.groups.every(group => group.model.tabs.every(input => input.resource?.contextId !== contextId)),
		'Main chooser: the isolated source admissions have no primary client, Source model or document view');
	const background = parts.groups.flatMap(group => group.model.tabs).filter(input => input.kind === 'code_editor')
		.map(input => ({ model: input.workingCopy, source: input.workingCopy.buffer.getText(), version: input.workingCopy.version }));
	const media = ide.sources.currentBlua32Media, cycles = test.cycles(), boot = ide.boots.latestOperation, hotResume = ide.hotResumes.latestOperation;
	const activity = editor.mainWorkspace.activity, activityDisplayed = editor.mainWorkspace.activityDisplayed;
	const choose = async (resource: RuntimeResource, occurrence: number, capture?: string) => {
		const picker = editor.quickInput;
		check(picker.visible && !picker.inputBox, 'Main chooser: ordinary Home or Palette intent opens the actual scene picker');
		const choices = picker.model.items as readonly SceneChoice[];
		check(choices.filter(item => item.entry.ownerResource === alpha).length === 2
			&& choices.filter(item => item.entry.ownerResource === beta).length === 1,
			'Main chooser: one file contributes both exact occurrences, not just a first-scene file row');
		await test.clipboard.writeText('picker.same'); await test.press('ControlLeft', 'KeyV');
		const rows = picker.model.list.rows;
		const target = rows.findIndex(row => {
			const entry = (row.item as SceneChoice).entry;
			return entry.ownerResource === resource && entry.definition === entry.document.scenes[occurrence];
		});
		check(target >= 0 && rows.filter(row => (row.item as SceneChoice).entry.projectContextId === contextId).length === 3,
			'Main chooser: identical names retain both same-file occurrences and the different-file namesake');
		await test.press('ControlLeft', 'Home');
		for (let row = 0; row < target; row++) await test.press('ArrowDown');
		if (capture !== undefined) await test.capture?.(capture);
		await test.press('Enter');
	};
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.runPaletteCommand('View: Studio Home');
			await test.until(() => parts.activeGroup.model.activeTab?.kind === 'home', 'Main chooser: Home is an ordinary retained document');
			const home = parts.activeGroup.model.activeTab;
			if (home?.kind !== 'home') throw new Error('Main chooser: the real Home action page is required');
			const action = home.sections.flatMap(section => section.actions.items).find(item => item.command === 'sceneEditor')!;
			check(action.visible && action.enabled, 'Main chooser: Home offers the registered Main-subject action without requiring a Source tab');
			const groups = parts.groups.map(group => ({ group, active: group.model.activeTab, inputs: [...group.model.tabs] }));
			const files = JSON.stringify(panel.serialize().view);
			await test.click(action.bounds);
			if (font === 0 && theme === 0) check(editorTextModelService.get(alpha) === undefined && editorTextModelService.get(beta) === undefined,
				'Main chooser: discovery itself does not admit either canonical working copy');
			await choose(alpha, 1, `main-scene-picker-${editor.fontVariant}-theme-${theme}-choices`);
			await test.until(() => editor.mainWorkspace.primary instanceof ScenePrimaryClient
				&& editor.mainWorkspace.primary.consumer.workingCopy.resource === alpha,
				'Main chooser: the Home choice admits the exact second declaration independently of documents');
			const client = editor.mainWorkspace.primary;
			if (!(client instanceof ScenePrimaryClient)) throw new Error('Main chooser: an actual primary Scene client is required');
			const model = client.consumer.workingCopy;
			check(client.consumer.subject === client.consumer.document!.scenes[1] && model.buffer.getText() === alphaSource,
				'Main chooser: selection is the second authored occurrence, not the file first scene or a namesake');
			await test.runPaletteCommand('Workspace: Focus Hierarchy'); await test.press('Home'); await test.press('ArrowDown'); await test.press('Enter');
			check(client.consumer.selection?.kind === 'member' && client.consumer.selection.index === 0,
				'Main chooser: ordinary hierarchy input selects a member of the chosen occurrence');
			const value = 20 + font * 2 + theme;
			await test.click(client.view.details.properties[0].bounds); await test.press('ControlLeft', 'KeyA');
			await test.clipboard.writeText(String(value)); await test.press('ControlLeft', 'KeyV'); await test.press('Enter');
			const accepted = first + second.replace('0, 0, 1, 1,', `0, 0, 1, ${value},`);
			check(model.dirty && model.buffer.getText() === accepted,
				'Main chooser: actual Details editing changes only the chosen second Scene occurrence');
			await test.runPaletteCommand('Workspace: Choose Main Scene'); await choose(beta, 0);
			await test.until(() => {
				const target = inputFocus.admittedTarget;
				return target !== null && editor.surfaces.findByScope(target.scope.surfaceScope)?.role === 'modal';
			}, 'Main chooser: replacing the final dirty Main consumer reaches its actual native close decision');
			const modal = editor.surfaces.findByScope(inputFocus.admittedTarget!.scope.surfaceScope)!;
			check(modal.presentationParent === editor.mainWorkspace.surface && editor.mainWorkspace.primary === client && model.dirty,
				'Main chooser: the replacement decision belongs to Main, not a background document or workspace popup');
			await test.capture?.(`main-scene-picker-${editor.fontVariant}-theme-${theme}-cancel`);
			await test.press('Escape');
			check(!modal.visible && editor.mainWorkspace.primary === client && model.dirty && model.buffer.getText() === accepted,
				'Main chooser: native Cancel preserves the exact previous Main subject and canonical accepted edit');
			await test.runPaletteCommand('Workspace: Focus Hierarchy'); await test.press('ControlLeft', 'KeyZ');
			check(!model.dirty && model.buffer.getText() === alphaSource, 'Main chooser: ordinary primary Undo cleans only the test edit');
			await test.runPaletteCommand('Workspace: Choose Main Scene'); await choose(beta, 0);
			await test.until(() => editor.mainWorkspace.primary instanceof ScenePrimaryClient
				&& editor.mainWorkspace.primary.consumer.workingCopy.resource === beta,
				'Main chooser: explicit clean replacement admits the selected namesake from its different file');
			const replacement = editor.mainWorkspace.primary;
			check(replacement instanceof ScenePrimaryClient && replacement.consumer.subject === replacement.consumer.document!.scenes[0]
				&& replacement.consumer.workingCopy.buffer.getText() === betaSource,
				'Main chooser: cross-file selection keeps its real source owner and authored occurrence');
			check(parts.groups.length === groups.length && groups.every(entry => parts.groups.includes(entry.group)
				&& entry.group.model.activeTab === entry.active && entry.group.model.tabs.length === entry.inputs.length
				&& entry.group.model.tabs.every((input, index) => input === entry.inputs[index]))
				&& parts.groups.every(group => group.model.tabs.every(input => input.resource?.contextId !== contextId)),
				'Main chooser: primary admission creates no hidden Source/Scene tab and retains every independent document');
			check(JSON.stringify(panel.serialize().view) === files && editor.mainWorkspace.activity === activity
				&& editor.mainWorkspace.activityDisplayed === activityDisplayed,
				'Main chooser: discovery and primary selection leave Files reading and the independent activity untouched');
			check(background.every(entry => entry.model.buffer.getText() === entry.source && entry.model.version === entry.version)
				&& ide.sources.currentBlua32Media === media && test.cycles() === cycles
				&& ide.boots.latestOperation === boot && ide.hotResumes.latestOperation === hotResume,
				'Main chooser: choosing authored work changes neither background canonical source nor guest execution');
			await test.capture?.(`main-scene-picker-${editor.fontVariant}-theme-${theme}-main`);
			await test.runPaletteCommand('Workspace: Clear Primary Authoring');
			check(editor.mainWorkspace.primary === undefined, 'Main chooser: explicit clear returns to honest unbound Main without closing documents');
			await test.press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await test.press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
}
