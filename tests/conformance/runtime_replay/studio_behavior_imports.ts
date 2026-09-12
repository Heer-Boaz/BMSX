import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { runtimeLuaSourceRegistry } from '../../../ide/runtime/sources';
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
	const target = leaves()[1].referenceRange!;
	await press('Enter');
	const editor = harness.getActiveEditorDocument();
	check(editor.model === provider && editor.view.cursorRow === target.start.line - 1
		&& editor.view.cursorColumn === target.start.column - 1,
		'imports: Source opens the provider at its own written occurrence');
	check(provider.version === providerVersion && main.version === mainVersion, 'imports: navigation writes neither buffer');
	provider.pushEditOperations([{ offset: source.indexOf('2'), deleteLength: 1, text: '4' }]);
	await test.clickTab(lens.id);
	check(leaves().every(node => node.detail.includes('duration_ticks=4')), 'imports: dependency edit refreshes both graph occurrences');
	await test.clickTab(providerTab.id);
	await press('ControlLeft', 'KeyZ');
	await test.clickTab(lens.id);
	check(leaves().every(node => node.detail.includes('duration_ticks=2')), 'imports: provider Undo refreshes the existing Lens input');
	await test.clickTab(providerTab.id);
	await press('ControlLeft', 'KeyZ');
	check(provider.buffer.getText() === originalProvider, 'imports: Undo removes the independent provider fixture');
	harness.openLuaSource(main.resource.path);
	await press('ControlLeft', 'KeyZ');
	check(main.buffer.getText() === originalMain, 'imports: the registering document retains its own independent history');
	await frame();
	check(cycles() === position && ide.sources.currentBlua32Media === media, 'imports: source editing never executes or reinstalls the paused guest');
}
