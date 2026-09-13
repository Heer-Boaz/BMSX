import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { runtimeLuaSourceRegistry } from '../../../ide/runtime/sources';
import { BehaviorLensEditorPane } from '../../../ide/workbench/contrib/behavior_lens/editor_pane';
import { chooseBehavior, revealLensOccurrence } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Two real working copies, one imported source owner; no fixture code is installed. */
export async function testStudioBehaviorImports(test: StudioFixture): Promise<void> {
	const { ide, harness, press, frame, runPaletteCommand, cycles } = test;
	console.info('STUDIO: imported behavior Source, dependency edit and ordinary Undo');
	harness.openLuaSource('cart.lua');
	const main = harness.getActiveEditorDocument().model;
	const originalMain = main.buffer.getText();
	const record = runtimeLuaSourceRegistry(ide.sources, main.resource.domain)!.records.find(record =>
		record.program_module && !record.generated && record.source_path !== main.resource.path && !record.module_path.startsWith('cartlib/'))!;
	harness.openLuaSource(record.source_path);
	const providerTab = getActiveTab();
	const provider = harness.getActiveEditorDocument().model;
	const originalProvider = provider.buffer.getText();
	const position = cycles(), media = ide.sources.currentBlua32Media;
	const source = `local kind = 'sequence'
local leaf = { type = 'wait', duration_ticks = 2 }
return { root = { type = kind, children = { leaf, leaf } } }`;
	provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: source }]);
	main.pushEditOperations([{ offset: 0, deleteLength: main.buffer.length,
		text: `local trees<const> = require('cartlib/behaviour_tree/library')\ntrees.register('fixture.imported', require('${record.module_path}'))` }]);
	const mainVersion = main.version, providerVersion = provider.version;
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.imported', 'BEHAVIOR TREES');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens') throw new Error('imports: Behavior Lens input required');
	const leaves = () => lens.view.source.nodes.filter(node => node.kind === 'node' && node.label === 'wait');
	check(leaves().length === 2 && leaves()[0].authoredRange === leaves()[1].authoredRange,
		'imports: two graph uses share the real imported constructor');
	await revealLensOccurrence(test, lens.view, leaves()[1].rowKey);
	await runPaletteCommand('Behavior Lens: Duplicate BT Child');
	check(leaves().length === 3 && main.version === mainVersion, 'imports: Duplicate changes the provider list, not the registration');
	await press('ControlLeft', 'KeyZ');
	check(provider.buffer.getText() === source, 'imports: Lens Undo restores the provider list');
	await revealLensOccurrence(test, lens.view, leaves()[1].rowKey);
	await runPaletteCommand('Behavior Lens: Remove BT Child');
	check(leaves().length === 1 && main.version === mainVersion, 'imports: Remove changes only the provider list');
	await press('ControlLeft', 'KeyZ');
	check(provider.buffer.getText() === source, 'imports: removed child remains in shared source history');
	await revealLensOccurrence(test, lens.view, leaves()[1].rowKey);
	const target = leaves()[1].referenceRange!;
	const navigationVersion = provider.version;
	await press('Enter');
	const editor = harness.getActiveEditorDocument();
	check(editor.model === provider && editor.view.cursorRow === target.start.line - 1
		&& editor.view.cursorColumn === target.start.column - 1,
		'imports: Source opens the provider at its own written occurrence');
	check(provider.version === navigationVersion && providerVersion < navigationVersion && main.version === mainVersion, 'imports: navigation writes neither buffer');
	provider.pushEditOperations([{ offset: source.indexOf('2'), deleteLength: 1, text: '4' }]);
	await test.clickTab(lens.id);
	check(leaves().every(node => node.detail.includes('duration_ticks=4')), 'imports: dependency edit refreshes both graph occurrences');
	await test.clickTab(providerTab.id);
	await press('ControlLeft', 'KeyZ');
	await test.clickTab(lens.id);
	check(leaves().every(node => node.detail.includes('duration_ticks=2')), 'imports: provider Undo refreshes the existing Lens input');
	// A composite input presents imported authored sources without taking ownership
	// of their buffers, persistence or history away from the workspace.
	const effectSource = "return { period_ms = 40, blocked_tags = { 'busy' } }";
	provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: effectSource }]);
	main.pushEditOperations([{ offset: 0, deleteLength: main.buffer.length,
		text: `local effects<const> = require('cartlib/actioneffects')\neffects.register_effect('fixture.imported-effect', require('${record.module_path}'))` }]);
	await runPaletteCommand('Behavior Lens: Open ActionEffect');
	await chooseBehavior(test, 'EFFECT fixture.imported-effect', 'ACTIONEFFECTS');
	const effectLens = getActiveTab();
	if (effectLens.kind !== 'behavior_lens') throw new Error('imports: effect input required');
	const effect = effectLens.view.document.definitions[0];
	if (effect.behaviorKind !== 'action_effect') throw new Error('imports: effect definition required');
	const period = effect.body!.fields[0];
	await revealLensOccurrence(test, effectLens.view, period.source.rowKey);
	await runPaletteCommand('File: Save');
	await test.until(() => !main.dirty && !provider.dirty, 'imports: composite Save persists both authored resources');
	const registrationVersion = main.version;
	await runPaletteCommand('Behavior Lens: Edit Authored Property');
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof BehaviorLensEditorPane)) throw new Error('imports: effect property pane required');
	check(getActiveTab() === effectLens && pane.propertyEdit.active && pane.propertyEdit.control.field.focusTarget.hasFocus,
		'imports: Edit stays in the Lens with a real provider-owned value draft');
	await press('ControlLeft', 'KeyA'); test.clipboard.text = '80'; await press('ControlLeft', 'KeyV');
	check(provider.buffer.getText() === effectSource && !effectLens.isDirty(), 'imports: a focused draft does not dirty either source');
	await press('Enter');
	check(provider.buffer.getText() === effectSource.replace('40', '80') && main.version === registrationVersion,
		'imports: accepting the cell changes only the provider');
	check(effectLens.isDirty() && !main.dirty && !pane.propertyEdit.active, 'imports: the Lens dirty marker follows its provider, not the registration file');
	await press('ControlLeft', 'KeyZ');
	check(getActiveTab() === effectLens && provider.buffer.getText() === effectSource && main.version === registrationVersion,
		'imports: Lens Undo targets the provider and retains registration identity');
	await test.clickTab(providerTab.id); await press('ControlLeft', 'ShiftLeft', 'KeyZ');
	check(provider.buffer.getText() === effectSource.replace('40', '80'), 'imports: code Redo shares the same source history');
	await test.clickTab(effectLens.id); await press('ControlLeft', 'KeyS');
	await test.until(() => !effectLens.isDirty(), 'imports: Save persists the imported edit from the Lens');
	check(provider.lastSavedSource === effectSource.replace('40', '80') && main.version === registrationVersion,
		'imports: provider persistence does not rewrite the registration source');
	await press('ControlLeft', 'KeyZ');
	check(provider.buffer.getText() === effectSource && effectLens.isDirty(), 'imports: Undo across Save restores real dirty state');
	await test.clickTab(providerTab.id);
	await press('ControlLeft', 'KeyA'); test.clipboard.text = 'return {'; await press('ControlLeft', 'KeyV');
	await test.clickTab(effectLens.id);
	check(effectLens.isDirty() && provider.buffer.getText() === 'return {', 'imports: incomplete provider still belongs to the Lens editing scope');
	await press('ControlLeft', 'KeyZ');
	check(provider.buffer.getText() === effectSource && main.version === registrationVersion,
		'imports: Lens Undo recovers a provider even when its graph could not be projected');
	harness.openLuaSource(main.resource.path); await press('ControlLeft', 'KeyZ');
	await test.clickTab(providerTab.id); await press('ControlLeft', 'KeyZ');
	await test.clickTab(providerTab.id);
	await press('ControlLeft', 'KeyZ');
	check(provider.buffer.getText() === originalProvider, 'imports: Undo removes the independent provider fixture');
	harness.openLuaSource(main.resource.path);
	await press('ControlLeft', 'KeyZ');
	check(main.buffer.getText() === originalMain, 'imports: the registering document retains its own independent history');
	await press('ControlLeft', 'KeyS');
	await test.clickTab(providerTab.id); await press('ControlLeft', 'KeyS');
	await test.until(() => !main.dirty && !provider.dirty, 'imports: restore the fixture sources through ordinary Save');
	await frame();
	check(cycles() === position && ide.sources.currentBlua32Media === media, 'imports: source editing never executes or reinstalls the paused guest');
}
