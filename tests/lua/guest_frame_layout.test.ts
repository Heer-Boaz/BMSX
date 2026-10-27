import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { SYSTEM_RESOURCE_DOMAIN } from '../../ide/common/resource';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { inputFocus } from '../../ide/input/focus';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { TerminalInput } from '../../ide/workbench/contrib/terminal/editor_input';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createTestRuntimeSourceState } from '../helpers/runtime_sources';

function fixture(t: TestContext) {
	const host = createHostFrameFixture();
	const sources = createTestRuntimeSourceState({ projectRootPath: '', records: [], path2lua: {}, module2lua: {}, entrySourcePath: '',
		can_boot_from_source: false, revision: 0 }, [null, null], SYSTEM_RESOURCE_DOMAIN);
	const unused = (): never => { throw new Error('Guest frame arrangement does not request domain execution.'); };
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused,
		{ measureDisplay: () => ({ left: 0, top: 0, width: 640, height: 480 }) }, host.input, host.audio, host.tasks,
		host.execution, host.rewind, host.clock, new HeadlessClipboard(), new IdeMicrotaskQueue(), { log() {} }, 0.3,
		{ width: 640, height: 480 }, sources, new Map(), unused, unused, unused);
	editorRuntimeState.active = true;
	t.after(async () => { inputFocus.setTarget(null); await ide.editor.shutdown(); host.audio.dispose(); host.input.dispose(); });
	return { ...host, ide, editor: ide.editor };
}

// Geometry is the layout-owner contract here: the whole displayed image belongs
// inside the editor's published client, not the physical canvas or Files pane.
for (const kind of ['game_view', 'terminal'] as const) test(`${kind} fits its image to the current client origin across Files and font changes`, t => {
	const f = fixture(t), input = kind === 'game_view' ? new GameViewInput() : new TerminalInput();
	f.editor.editorParts.main.activeGroup.openEditor(input);
	for (const font of ['tiny', 'msx'] as const) {
		f.editor.setFontVariant(font);
		for (const filesVisible of [false, true, false]) {
			if (filesVisible) f.editor.resourcePanel.show(); else f.editor.resourcePanel.hide();
			f.editor.updateViewport({ width: 640, height: 480 }); f.editor.update(0);
			const { layout, frameBounds: frame } = input;
			assert.equal(layout.left > 0, filesVisible);
			assert.ok(frame.left >= layout.left + 4 && frame.right <= layout.right - 4);
			assert.ok(frame.top >= layout.top + 4 && frame.bottom <= layout.bottom - 4);
			assert.ok(frame.right > frame.left && frame.bottom > frame.top);
			assert.equal((frame.right - frame.left) * 3, (frame.bottom - frame.top) * 4);
		}
	}
});
