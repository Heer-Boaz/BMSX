import { inputFocus } from '../../../ide/input/focus';
import { createLuaSourceRegistry, registerLuaSourceRecord } from '../../../ide/runtime/source_registry';
import { AnimationEditorPane } from '../../../ide/workbench/contrib/animation/editor_pane';
import { captureCodeEditorView } from '../../../ide/workbench/contrib/code_editor/view_snapshot';
import { LuaTableFieldKind } from '../../../toolchain/ts/lua/syntax/ast';
import { createTestToolingPackage } from '../../helpers/runtime_sources';
import { createScenarioTestSourceRecord } from '../../helpers/scenario_sources';
import { chooseBehavior, revealLensOccurrence } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

const ANIMATION_SOURCE = `return {
    playback_mode = 'once',
    note = [=[O'Brien\`Fx]=],
    empty = '',
    tracks = {},
}
`;

const EFFECT_SOURCE = `local effects = require('cartlib/actioneffects')
effects.register_effect('fixture.values.effect', {
    cooldown_ms = 800,
    handler = function(owner) return owner.result end,
    event = 'starcatch.dashed',
})
return {}
`;

/** Source-only values retain decoded data and authored expression intent through real controls. */
export async function testStudioSourceValues(test: StudioFixture): Promise<void> {
	const { ide, press, frame, cycles } = test, editor = ide.editor;
	console.info('STUDIO: independent Animation / Effect string values');
	const root = 'tests/fixtures/studio/source-values';
	const registry = createLuaSourceRegistry(root, 'effects.lua');
	for (const [path, source] of [
		['source_values_animation.lua', ANIMATION_SOURCE],
		['effects.lua', EFFECT_SOURCE],
		['cartlib/actioneffects.lua', 'return {}'],
	] as const) registerLuaSourceRecord(registry, createScenarioTestSourceRecord(path, 1, source, `${root}/${path}`));
	const context = ide.sources.catalog.admitContext({
		admission: { id: 'fixture-studio-source-values', projectRoot: root }, programDomain: 'cart', systemContextId: null,
		luaSources: registry, sourceRoots: [{ path: root, resourcePathPrefix: '', modulePathPrefix: '', structured: true, sourceKind: 'source-only' }],
		dependencyContextIds: [], previewPackage: createTestToolingPackage(root), previewRom: null, assetSources: [],
	});
	const resource = ide.sources.catalog.resolveResource({ contextId: context.id, path: 'effects.lua' })!;
	await editor.navigation.openResource(editor.editorParts.main.activeGroup, resource);
	const source = editor.editorParts.activeGroup.model.activeTab;
	if (source?.kind !== 'code_editor') throw new Error('source values: independent fixture requires its Source receiver');
	const sourceGroup = editor.editorParts.activeGroup, before = cycles(), media = ide.sources.currentBlua32Media;

	// The selected source has no Animation: choose the separate definition through the real picker.
	await test.runPaletteCommand('Animation: Open');
	const picker = editor.editorParts.activePart.quickInput;
	check(picker.visible, 'source values: Animation without a matching source offers authored definitions');
	await test.clipboard.writeText('source_values_animation.lua'); await press('ControlLeft', 'KeyV');
	check(picker.model.list.rows.length === 1 && picker.model.list.rows[0].item.label === 'source_values_animation.lua',
		'source values: the independent Animation is uniquely selectable');
	await press('Enter');
	const animation = editor.editorParts.activeGroup.model.activeTab;
	if (animation.kind !== 'animation') throw new Error('source values: native Animation input required');
	await test.runPaletteCommand('Animation: Focus Details'); await press('Home');
	const playbackIndex = animation.details.rows.findIndex(row => row.element.field.kind === LuaTableFieldKind.IdentifierKey
		&& row.element.field.name === 'playback_mode');
	check(playbackIndex >= 0, 'source values: Details exposes the exact authored playback field');
	for (let row = 0; row < playbackIndex; row++) await press('ArrowDown');
	const playback = animation.details.rows[playbackIndex].element;
	check(animation.detailSelection !== undefined && animation.details.selectionIndex === playbackIndex && playback.value === 'once',
		'source values: ordinary Details navigation selects the decoded playback string, not its Lua delimiters');
	check(animation.details.rows.some(row => row.element.value === "O'Brien`Fx")
		&& animation.details.rows.some(row => row.element.field.kind === LuaTableFieldKind.IdentifierKey
			&& row.element.field.name === 'empty' && row.element.value === ''),
		'source values: genuine apostrophes, backticks, case and empty string payloads survive decoding');
	const animationModel = animation.workingCopy;
	const pane = editor.editorParts.activeGroup.panes.activePane;
	if (!(pane instanceof AnimationEditorPane)) throw new Error('source values: native Animation pane required');
	const animationReceipt = pane.captureSourceLocation()!;
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.capture?.(`source-values-animation-${editor.fontVariant}-theme-${theme}`);
			await press('ControlLeft', 'AltLeft', 'KeyT');
			check(animationModel.buffer.getText() === ANIMATION_SOURCE && animationReceipt.isCurrent!(),
				'source values: theme presentation preserves source bytes and the selected authored occurrence');
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	await press('ContextMenu'); await test.clickContextCommand('animation.edit');
	const animationField = inputFocus.admittedTarget!;
	check(animationField.textInput!.readText().text === "'once'", 'source values: Edit starts from the original Lua expression, not the display payload');
	await press('ControlLeft', 'KeyA'); await test.clipboard.writeText('"loop"'); await press('ControlLeft', 'KeyV');
	check(animationModel.buffer.getText() === ANIMATION_SOURCE && animationField.edit!.pending,
		'source values: a property draft does not rewrite canonical source');
	await press('Enter');
	check(animationModel.buffer.getText() === ANIMATION_SOURCE.replace("'once'", '"loop"')
		&& animation.details.rows[animation.details.selectionIndex].element.value === 'loop',
		'source values: accepting an authored Lua replacement updates the decoded Details value');
	await press('ControlLeft', 'KeyZ');
	check(animationModel.buffer.getText() === ANIMATION_SOURCE
		&& animation.details.rows[animation.details.selectionIndex].element.value === 'once',
		'source values: a single native Undo restores the exact source expression and decoded value');
	await press('ContextMenu'); await test.clickContextCommand('editor.source');
	const animationCode = editor.editorParts.activeGroup.model.activeTab;
	if (animationCode.kind !== 'code_editor') throw new Error('source values: Animation Source navigation requires text receiver');
	check(animationCode.workingCopy === animationModel
		&& captureCodeEditorView(animationCode).cursor === ANIMATION_SOURCE.indexOf('playback_mode'),
		'source values: Source returns to the written consumer field rather than the decoded payload');

	await test.clickTab(source.id, 1, sourceGroup);
	await test.runPaletteCommand('Behavior Lens: Open ActionEffect');
	await chooseBehavior(test, 'EFFECT fixture.values.effect');
	const effect = editor.editorParts.activeGroup.model.activeTab;
	if (effect.kind !== 'behavior_lens' || effect.view.presentation.kind !== 'properties') throw new Error('source values: native Effect properties required');
	const properties = effect.view.presentation;
	const event = [...properties.nodesBySource.values()].find(node => node.element.kind === 'property'
		&& node.element.write?.field.kind === LuaTableFieldKind.IdentifierKey && node.element.write.field.name === 'event')!.element;
	if (event.kind !== 'property') throw new Error('source values: exact authored event property required');
	await revealLensOccurrence(test, effect.view, event.source.rowKey);
	check(event.value === 'starcatch.dashed' && source.workingCopy === effect.workingCopy,
		'source values: the selected Effect event consumes decoded string data from the same canonical working copy');
	const effectReceipt = editor.behaviorLens.captureSourceLocation(effect, 'selected')!;
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.capture?.(`source-values-effect-${editor.fontVariant}-theme-${theme}`);
			await press('ControlLeft', 'AltLeft', 'KeyT');
			check(source.workingCopy.buffer.getText() === EFFECT_SOURCE && effectReceipt.isCurrent!(),
				'source values: theme presentation leaves authored Effect source and selected occurrence unchanged');
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	await press('ContextMenu'); await test.clickContextCommand('behaviorLens.editProperty');
	const effectField = inputFocus.admittedTarget!;
	check(effectField.textInput!.readText().text === "'starcatch.dashed'", 'source values: Effect Edit retains the original Lua delimiter form');
	await press('ControlLeft', 'KeyA'); await test.clipboard.writeText("[=[O'Brien`Fx]=]"); await press('ControlLeft', 'KeyV'); await press('Enter');
	check(source.workingCopy.buffer.getText() === EFFECT_SOURCE.replace("'starcatch.dashed'", "[=[O'Brien`Fx]=]")
		&& effect.view.presentation.tree.rows[effect.view.presentation.tree.selectionIndex].element.value === "O'Brien`Fx",
		'source values: accepted long-string source preserves genuine punctuation in the decoded Effect payload');
	await test.capture?.('source-values-effect-punctuation');
	await press('ControlLeft', 'KeyZ');
	check(source.workingCopy.buffer.getText() === EFFECT_SOURCE, 'source values: one native Effect Undo restores exact authored source bytes');
	await press('ContextMenu'); await test.clickContextCommand('editor.source');
	const effectCode = editor.editorParts.activeGroup.model.activeTab;
	check(effectCode.kind === 'code_editor' && effectCode.workingCopy === source.workingCopy
		&& captureCodeEditorView(effectCode).cursor === EFFECT_SOURCE.indexOf('event ='),
		'source values: Effect Source navigation still targets the written event field');

	for (const group of editor.editorParts.groups) for (const input of [...group.model.tabs]) {
		if (input.resource?.contextId === context.id) check(await group.close(input.id), 'source values: clean fixture closes through its real editor group');
	}
	await frame();
	check(cycles() === before && ide.sources.currentBlua32Media === media,
		'source values: independent string authoring never installs or executes guest code');
	console.info('STUDIO: independent Animation / Effect string values PASS');
}
