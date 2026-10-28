import assert from 'node:assert/strict';
import test from 'node:test';
import type { EditorCommandRunner } from '../../ide/common/commands';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import { createLuaSourceRegistry } from '../../ide/runtime/source_registry';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';
import { ResourceViewerEditorPane } from '../../ide/workbench/contrib/resources/editor_pane';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkspaceSourceCatalog } from '../../ide/workspace/source_catalog';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { createTestToolingPackage } from '../helpers/runtime_sources';

test('an admitted source-only image opens its information client without cooked metadata or fabricated preview pixels', t => {
	configureFontVariant('tiny');
	const catalog = new WorkspaceSourceCatalog();
	const context = catalog.admitContext({ admission: { id: 'unbuilt-project', projectRoot: 'carts/unbuilt' },
		programDomain: 'cart', systemContextId: null, luaSources: createLuaSourceRegistry('carts/unbuilt', ''),
		sourceRoots: [], dependencyContextIds: [], previewPackage: createTestToolingPackage('carts/unbuilt'), previewRom: null,
		assetSources: [{ type: 'image', resid: 'new-image', source_path: 'res/img/new.png' }] });
	const resource = catalog.resolveResource({ contextId: context.id, path: 'res/img/new.png' });
	assert.ok(resource);
	const input = new ResourceViewerInput(catalog, resource);
	const menu = new ContextMenuController(inputFocus, pointerCapture);
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	};
	const pane = new ResourceViewerEditorPane(inputFocus.workbenchScope, commands, menu);
	t.after(() => { pane.clearInput(); pane.dispose(); input.dispose(); menu.dispose(); catalog.dispose(); });
	assert.doesNotThrow(() => pane.setInput(input, { left: 0, top: 0, right: 240, bottom: 160 }));
	assert.ok(pane.input.resource === resource);
	assert.equal(input.view.content.image?.rom, null);
	assert.equal(input.preview, undefined);
	assert.equal(commands.isEnabled('resourceViewer.preview', pane.commandTarget), false);
	assert.equal(commands.isEnabled('image.actualSize', pane.commandTarget), false);
	assert.equal(commands.isEnabled('resourceViewer.info', pane.commandTarget), true);
	commands.execute('resourceViewer.info', pane.commandTarget);
	assert.equal(input.view.contentView, 'info');
	const overlay = createHostOverlayFixture(240, 160), bitmap = t.mock.method(api, 'drawBitmap');
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
	assert.doesNotThrow(() => pane.draw());
	overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
	assert.equal(bitmap.mock.callCount(), 0);
	assert.equal(input.preview, undefined);
});
