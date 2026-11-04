import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { RemoteInput } from '../../hosts/common/input/remote';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { StudioUiService } from '../../ide/workbench/services/assistant/ui_tools';
import { decodeStudioUiRequest } from '../../ide/workbench/services/assistant/ui_tool_protocol';
import { StudioToolRequests } from '../../ide/workbench/services/assistant/tool_requests';
import type { WorkspaceToolService } from '../../ide/workbench/services/assistant/tool_service';

function fixture(t: TestContext) {
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, new HeadlessInputHub(), -1);
	const models = new EditorTextModelService();
	const bounds = { left: 50, top: 30, width: 400, height: 300 };
	const size = { x: 800, y: 600 };
	const pointer: { x: number; y: number; pressed: number; released: number; cancelled: number }[] = [];
	const keys: { code: string; down: boolean }[] = [];
	const wheel: number[] = [];
	const remote = new RemoteInput(input, clock, (code, down) => keys.push({ code, down }), event => pointer.push({
		x: event.x, y: event.y, pressed: event.pressedButtons, released: event.releasedButtons, cancelled: event.cancelledButtons,
	}), event => { wheel.push(event.deltaY); return true; });
	let reads = 0, frame = 0;
	const ui = new StudioUiService(() => { reads++; return { width: size.x, height: size.y, imageUrl: 'data:image/png;base64,Zm9v' }; },
		size, { measureDisplay: () => bounds }, models, remote);
	const context = ui.open(true);
	const signal = new AbortController().signal;
	const tick = () => { ui.beforeFrame(); ui.afterFrame(++frame); };
	const capture = async (owner = context) => {
		const request = owner.execute('studio_capture_ui', {}, signal);
		tick();
		const result = await request;
		assert.equal(result.kind, 'image');
		return (result.data as { capture: string }).capture;
	};
	t.after(() => { ui.dispose(); input.dispose(); models.clear(); });
	return { ui, context, input, models, bounds, size, pointer, keys, wheel, tick, capture, signal, reads: () => reads };
}

test('UI capture waits for presentation and coalesces readback; idle frames do not capture', async t => {
	const f = fixture(t);
	f.ui.afterFrame(0);
	assert.equal(f.reads(), 0);
	const first = f.context.execute('studio_capture_ui', {}, f.signal);
	const other = f.ui.open(false).execute('studio_capture_ui', {}, f.signal);
	f.ui.afterFrame(0);
	assert.equal(f.reads(), 0, 'admission is not a completed presentation');
	f.tick();
	const [a, b] = await Promise.all([first, other]);
	assert.equal(f.reads(), 1);
	assert.equal(a.kind, 'image'); assert.equal(b.kind, 'image');
	if (a.kind !== 'image' || b.kind !== 'image') throw new Error('Expected image tool results');
	assert.deepEqual(a.images, b.images);
	assert.notEqual(a.data.capture, b.data.capture);
	assert.equal(a.data.inputAllowed, true); assert.equal(b.data.inputAllowed, false);
	f.tick(); f.tick();
	assert.equal(f.reads(), 1);
	const cancelled = new AbortController();
	const pending = f.ui.capture(cancelled.signal);
	const rejected = assert.rejects(pending);
	cancelled.abort();
	await rejected;
	f.tick();
	assert.equal(f.reads(), 1, 'cancelled capture does not retain readback work');
});

test('image-pixel pointer coordinates use the actual display transform and ordinary remote input', async t => {
	const f = fixture(t), capture = await f.capture();
	const request = f.context.execute('studio_ui_input', { capture, steps: [
		{ events: [{ type: 'pointer', x: 200, y: 100 }, { type: 'button', button: 'primary', down: true }], frames: 2 },
		{ events: [{ type: 'pointer', x: 300, y: 200 }, { type: 'wheel', deltaY: -3 }, { type: 'button', button: 'primary', down: false }], frames: 1 },
	] }, f.signal);
	assert.equal(f.pointer.length, 0, 'input waits for the ordinary host frame');
	f.tick();
	assert.deepEqual(f.pointer[0], { x: 150, y: 80, pressed: 0, released: 0, cancelled: 0 });
	assert.equal(f.input.pointerButtonsDown, true);
	f.tick();
	assert.equal(f.pointer.length, 2, 'a held step is not applied a second time');
	f.tick();
	assert.deepEqual((await request).data, { completedFrames: 3 });
	assert.deepEqual(f.pointer[2], { x: 200, y: 130, pressed: 0, released: 0, cancelled: 0 });
	assert.equal(f.pointer[3].released, PointerButton.Primary);
	assert.deepEqual(f.wheel, [-3]);
	assert.equal(f.input.pointerButtonsDown, false);
});

test('UI control rejects concurrent ownership and cancellation cancels, rather than clicks, held input', async t => {
	const f = fixture(t), capture = await f.capture(), cancel = new AbortController();
	const steps = [{ events: [{ type: 'key', code: 'KeyW', down: true }, { type: 'button', button: 'secondary', down: true }], frames: 4 }];
	const pending = f.context.execute('studio_ui_input', { capture, steps }, cancel.signal);
	const rejected = assert.rejects(pending);
	f.tick();
	assert.equal(f.input.pointerButtonsDown, true);
	await assert.rejects(f.context.execute('studio_ui_input', { capture, steps }, f.signal));
	assert.equal(f.input.pointerButtonsDown, true, 'rejected callers cannot release the admitted owner');
	cancel.abort(); await rejected;
	assert.equal(f.input.pointerButtonsDown, false);
	assert.equal(f.pointer.at(-1)!.cancelled, PointerButton.Secondary);
	assert.equal(f.pointer.at(-1)!.released, 0);
	assert.deepEqual(f.keys, [{ code: 'KeyW', down: true }], 'disconnect is not an editing key-up activation');
	const next = f.context.execute('studio_ui_input', { capture, steps: [{ events: [], frames: 1 }] }, f.signal);
	f.tick(); await next;
});

test('capture receipts belong to one context; resize and workspace replacement revoke pointer authority', async t => {
	const f = fixture(t), capture = await f.capture();
	const steps = [{ events: [{ type: 'pointer', x: 100, y: 100 }], frames: 1 }];
	await assert.rejects(f.ui.open(true).execute('studio_ui_input', { capture, steps }, f.signal));
	f.size.x++;
	const resized = f.context.execute('studio_ui_input', { capture, steps }, f.signal);
	const rejected = assert.rejects(resized);
	f.tick(); await rejected;
	assert.equal(f.pointer.length, 0);
	const fresh = await f.capture();
	f.models.clear();
	await assert.rejects(f.context.execute('studio_ui_input', { capture: fresh, steps }, f.signal));
	await assert.rejects(f.context.execute('studio_capture_ui', {}, f.signal), 'an old context cannot recapture a replacement workspace');
	await f.capture(f.ui.open(true));
	assert.equal(f.pointer.length, 0);
});

test('workspace retirement releases admitted input and rejects pending capture', async t => {
	const f = fixture(t), capture = await f.capture();
	const pending = f.context.execute('studio_ui_input', { capture,
		steps: [{ events: [{ type: 'button', button: 'primary', down: true }], frames: 120 }] }, f.signal);
	const inputRejected = assert.rejects(pending);
	f.tick();
	const captureRejected = assert.rejects(f.context.execute('studio_capture_ui', {}, f.signal));
	f.models.clear();
	await Promise.all([inputRejected, captureRejected]);
	assert.equal(f.input.pointerButtonsDown, false);
	assert.equal(f.pointer.at(-1)!.cancelled, PointerButton.Primary);
});

test('tool context retirement cancels input; UI cannot bypass source or proposal authority', async t => {
	const f = fixture(t);
	const domain = { open() { return { execute() { throw new Error('UI is not a source/runtime domain command'); } }; } } as unknown as WorkspaceToolService;
	for (const authority of [{ sourceAccess: 'review', reviewApproval: 'agent' }, { sourceAccess: 'edit', reviewApproval: 'user' },
		{ sourceAccess: 'edit', reviewApproval: 'agent' }] as const) {
		const requests = new StudioToolRequests(domain, authority, f.ui);
		await requests.execute('open', { type: 'open', context: 'test' });
		const captureRequest = requests.execute('capture', { type: 'call', context: 'test', name: 'studio_capture_ui', arguments: {} });
		f.tick();
		const snapshot = await captureRequest;
		assert.equal(snapshot?.success, true);
		if (!snapshot?.success) throw new Error('Capture failed');
		const data = snapshot.data as { capture: string; inputAllowed: boolean };
		const allow = authority.sourceAccess === 'edit' && authority.reviewApproval === 'agent';
		assert.equal(data.inputAllowed, allow);
		const pending = requests.execute('input', { type: 'call', context: 'test', name: 'studio_ui_input', arguments: {
			capture: data.capture, steps: [{ events: [{ type: 'button', button: 'primary', down: true }], frames: 120 }],
		} });
		f.tick();
		assert.equal(f.input.pointerButtonsDown, allow);
		if (allow) requests.release('test');
		else assert.equal((await pending)?.success, false);
		await pending;
		assert.equal(f.input.pointerButtonsDown, false);
		requests.close(new Error('Test ended'));
	}
});

test('external input decoding is bounded and rejects malformed batches before input admission', () => {
	for (const steps of [[], [{ events: [], frames: 0 }], [{ events: [], frames: 121 }],
		[{ events: [], frames: 100 }, { events: [], frames: 21 }],
		[{ events: Array.from({ length: 257 }, () => ({ type: 'wheel', deltaY: 1 })), frames: 1 }],
		[{ events: [{ type: 'pointer', x: -1, y: 0 }], frames: 1 }],
		[{ events: [{ type: 'wheel', deltaY: '1' }], frames: 1 }],
		[{ events: [{ type: 'button', button: 'not-a-button', down: true }], frames: 1 }],
		[{ events: [{ type: 'key', code: 'Control', down: true }], frames: 1 }],
		[{ events: [{ type: 'key', code: 'constructor', down: true }], frames: 1 }],
		[{ events: [{ type: 'key', code: 'KeyA', down: true, command: 'save' }], frames: 1 }]]) {
		assert.throws(() => decodeStudioUiRequest('studio_ui_input', { capture: 'test', steps }));
	}
});
