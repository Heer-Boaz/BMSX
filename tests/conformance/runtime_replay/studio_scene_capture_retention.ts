import { LuaSyntaxKind, type LuaTableField } from '../../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../../toolchain/ts/lua/syntax/ast/traversal';
import { sourceRangesEqual } from '../../../toolchain/ts/lua/source_range';
import { getCachedLuaParse } from '../../../toolchain/ts/lua/analysis/cache';
import { createLuaTableFieldRemovalEdits } from '../../../ide/language/lua/source_edits';
import { editorFeedbackState } from '../../../ide/common/feedback_state';
import { actionPromptState } from '../../../ide/workbench/contrib/modal/action_prompt';
import { openSceneEditor } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

/** Exercise source removal through the existing Save & Hot Resume route; no unshipped Remove button. */
export async function testSceneCaptureRetention(test: StudioFixture): Promise<void> {
	const { harness, ide, runtime, tasks, press, until, cycles, title, guest, runMenuCommand } = test;
	harness.openLuaSource('scenes/root.lua');
	const model = harness.getActiveEditorDocument().model;
	const original = model.buffer.getText();
	const scene = await openSceneEditor(test);
	const range = scene.members.rows[2].entry.range;
	const parsed = getCachedLuaParse({ source: original, path: model.resource.path }).parsed;
	let field: LuaTableField | undefined;
	walkLuaAst(parsed.chunk!, node => {
		if (node.kind === LuaSyntaxKind.TableConstructorExpression) {
			for (const candidate of node.fields) {
				if (sourceRangesEqual(candidate.value.range, range)) field = candidate;
			}
		}
	});
	const removals = createLuaTableFieldRemovalEdits(model.buffer, parsed.tokens, field!);
	const actor = title();
	const actorX = guest.readStringMember(actor, 'x');
	const before = cycles();
	const functionId = 'module:scenes/root/module/decl:root_scene.register';
	const prior = ide.sources.currentBlua32Media.cartridgeSlots[0]!.symbols!;
	const index = prior.metadata.functionIds.indexOf(functionId);
	const names = prior.metadata.upvalueBindingsByFunction[index].map(slot => prior.metadata.capturedLocals[slot].name);
	check(names.length === 6 && names[4] === 'title_screen' && names[5] === 'director', 'capture: real installed register closure owns six distinct cells');
	harness.openLuaSource('scenes/root.lua');
	model.pushEditOperations(removals);
	const removed = model.buffer.getText();
	check(removed !== original && cycles() === before && title() === actor, 'capture: authored member deletion leaves the paused machine alone');
	for (const expected of [removed, original, removed, original]) {
		if (model.buffer.getText() !== expected) await press('ControlLeft', expected === original ? 'KeyZ' : 'KeyY');
		check(model.buffer.getText() === expected, 'capture: ordinary source history supplies the intended revision');
		await press('ControlLeft', 'ShiftLeft', 'KeyS');
		check(actionPromptState.prompt !== null && actionPromptState.prompt.workingCopies.includes(model), 'capture: real save/apply prompt owns the dirty scene source');
		await press('Enter');
		await until(() => tasks.ready && !runtime.completionCallPending() && !ide.debugger.plans.mutationActive
			&& actionPromptState.prompt === null, 'capture: source Save & Hot Resume completes with retained cells');
		check(!model.dirty && model.lastSavedSource === expected
			&& ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get('scenes/root') === expected,
			`capture: saved and installed scene definitions agree: dirty=${model.dirty} saved=${model.lastSavedSource === expected} installed=${ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get('scenes/root') === expected} feedback=${JSON.stringify(editorFeedbackState.message)}`);
		const fresh = ide.sources.currentBlua32Media.cartridgeSlots[0]!.symbols!;
		const currentIndex = fresh.metadata.functionIds.indexOf(functionId);
		const currentNames = fresh.metadata.upvalueBindingsByFunction[currentIndex].map(slot => fresh.metadata.capturedLocals[slot].name);
		check(currentNames.join('|') === names.join('|'), 'capture: original title and director slots survive removal and undo without reinterpretation');
		check(title() === actor && guest.readStringMember(actor, 'x') === actorX,
			'capture: <init> updates future scene composition in the same live heap, without moving or deleting its actor');
		await press('ControlRight', 'ShiftRight');
		await runMenuCommand('pause');
		harness.openLuaSource('scenes/root.lua');
	}
}
