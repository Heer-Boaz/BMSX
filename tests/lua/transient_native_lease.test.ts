import assert from 'node:assert/strict';
import test from 'node:test';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import { applyViewportSize, configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import type { EditorCommandRunner } from '../../ide/common/commands';

for (const kind of ['menu', 'picker'] as const) test(`${kind} retains its actual native authority through later acceptance-disposal callbacks`, t => {
	configureFontVariant('tiny'); applyViewportSize({ width: 384, height: 288 }); refreshWorkbenchLayout();
	const semantic = inputFocus.createTarget(), nativeScope = new InputFocusScope(Symbol('native region'), semantic.scope);
	const origin = inputFocus.createTarget(null, nativeScope); origin.commandContext = semantic;
	origin.bindKeyboard(() => {}); semantic.bindKeyboard(() => {}); origin.focus();
	const generation = nativeScope.contextGeneration;
	const semanticGeneration = semantic.scope.contextGeneration;
	const menu = new ContextMenuController(inputFocus, pointerCapture);
	const picker = new QuickInputController(menu, () => {}, () => false,
		{ kind: 'workspace', scope: inputFocus.workbenchScope, bounds: { left: 0, top: 0, right: 384, bottom: 288 } });
	let admitted = 0, laterDisposal = 0;
	const commands: EditorCommandRunner = { isEnabled: () => true, execute: () => { admitted++; } };
	const retireAndReadmit = () => {
		laterDisposal++; nativeScope.retireContext(); origin.focus();
	};
	if (kind === 'menu') {
		menu.show(0, 0, [{ type: 'command', command: 'editor.source' }], commands, {
			selectFirst: true, invocationOrigin: origin, returnFocus: origin, commandTarget: semantic,
			onWillShow: lifetime => lifetime.add({ dispose: retireAndReadmit }),
		});
		menu.accept();
	} else {
		picker.pick('Source', '', () => new TextQuickPickProvider([{ label: 'Source', description: '', detail: '' }]),
			() => commands.execute('editor.source', semantic, undefined, origin),
			lifetime => { lifetime.add({ dispose: retireAndReadmit }); }, { invocationOrigin: origin, commandTarget: semantic });
		picker.accept();
	}
	t.after(() => { picker.dispose(); menu.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); });
	assert.equal(laterDisposal, 1); assert.ok(nativeScope.contextGeneration > generation);
	assert.equal(semantic.scope.contextGeneration, semanticGeneration, 'the semantic command subject remains available');
	assert.equal(admitted, 0);
});
