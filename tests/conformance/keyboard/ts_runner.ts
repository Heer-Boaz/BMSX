import { readFileSync } from 'node:fs';
import { Input } from '../../../hosts/common/input/manager';
import { GAMEPAD_BUTTON_IDS } from '../../../hosts/common/input/gamepad_buttons';
import { hidKeyUsageForCode } from '../../../hosts/common/input/hid_keys';
import { HostKeyboardInteraction } from '../../../hosts/common/input/host_keyboard_interaction';
import { OnScreenKeyboard } from '../../../hosts/common/input/on_screen_keyboard';
import { NATIVE_KEYBOARD_PAGES, ON_SCREEN_KEY_DEFINITIONS, OnScreenKeyboardAction, type OnScreenKeyboardCommand } from '../../../hosts/common/input/on_screen_keyboard_keys';
import { HostUiInput, HostUiInputSource } from '../../../hosts/common/input/ui';
import { HostOnScreenKeyboard } from '../../../hosts/common/host_on_screen_keyboard';
import { VirtualHeadlessClock } from '../../../hosts/node/headless/clock';
import { createInputControllerSnapshot, InputControllerSampleContext } from '../../../machine/ts/machine/devices/input/contracts';
import { Font } from '../../../machine/ts/render/shared/bmsx_font';
import { Host2DKind } from '../../../machine/ts/render/host_overlay/commands';
import type { HostMenuFrame } from '../../../machine/ts/render/host_overlay/overlay_queue';
import type { GlyphRenderSubmission, HostImageRenderSubmission, RectRenderSubmission } from '../../../machine/ts/render/shared/submissions';
import { createHostOverlayFixture } from '../../helpers/host_overlay';

type Command = Array<string | number | boolean | string[]>;

class Fixture {
	readonly clock = new VirtualHeadlessClock();
	readonly input = new Input(this.clock, { devices: () => [], subscribe: () => () => {} }, -1);
	readonly model = new OnScreenKeyboard(this.input, NATIVE_KEYBOARD_PAGES);
	readonly overlay: ReturnType<typeof createHostOverlayFixture>;
	readonly view: HostOnScreenKeyboard;
	readonly interaction: HostKeyboardInteraction;
	readonly ui: HostUiInput;
	readonly snapshot = createInputControllerSnapshot();
	frame: HostMenuFrame;
	private pressId = 0;
	private readonly pads = [0, 0];
	private mouseDown = false;

	constructor(width: number, height: number) {
		this.overlay = createHostOverlayFixture(width, height);
		this.overlay.presenter.default_font = new Font();
		this.view = new HostOnScreenKeyboard(this.overlay.presenter, this.model);
		this.interaction = new HostKeyboardInteraction(this.input, this.model, this.overlay.presenter, this.view);
		this.ui = new HostUiInput(this.input, this.overlay.presenter);
		this.input.setFrameDurationMs(20);
		for (let pad = 0; pad < 2; pad++) this.input.connectInputDevice({
			id: `gamepad:${pad}`, kind: 'gamepad', gamepadIndex: pad, label: 'PARITY',
			vibrationInitialization: null, supportsVibration: false, setVibration() {},
		});
		this.input.pollInput();
		this.open();
		this.ui.update(0);
		this.interaction.tickInput(this.ui);
		this.ui.consume();
		this.publish();
	}
	open(): void {
		this.ui.reset(HostUiInputSource.Gamepad | HostUiInputSource.LeftStick | HostUiInputSource.Pointer, 0);
		this.interaction.open();
	}
	close(): void { this.interaction.close(); this.ui.reset(HostUiInputSource.None, 0); }
	publish(): void { this.view.queueRenderCommands(); this.frame = this.overlay.queue.consumeHostMenuFrame(); }
	poll(dt: number): void { this.clock.advance(dt); this.input.pollInput(); }
	physical(key: number, down: boolean): void { this.button('keyboard:0', ON_SCREEN_KEY_DEFINITIONS[key].code, down); }
	private button(device: string, code: string, down: boolean): void {
		this.input.inputButton(device, code, down, down ? 1 : 0, this.clock.now(), ++this.pressId);
	}
	tick(dt: number, x: number, y: number, down: boolean, pad0: number, pad1: number): void {
		if (x !== -1 || y !== -1) this.input.inputAxis2('pointer:0', 'pointer_position', x, y, this.clock.now());
		if (down !== this.mouseDown) { this.button('pointer:0', 'pointer_primary', down); this.mouseDown = down; }
		for (let pad = 0; pad < 2; pad++) {
			const next = pad === 0 ? pad0 : pad1;
			for (let bit = 0; bit < GAMEPAD_BUTTON_IDS.length; bit++) {
				if (((this.pads[pad] ^ next) & (1 << bit)) !== 0) this.button(`gamepad:${pad}`, GAMEPAD_BUTTON_IDS[bit], (next & (1 << bit)) !== 0);
			}
			this.pads[pad] = next;
		}
		this.poll(dt);
		this.ui.update(this.clock.now());
		if (this.model.visible) this.interaction.tickInput(this.ui);
		this.ui.consume();
		this.publish();
	}
	keyPoint(target: number): { x: number; y: number } {
		let command = 3;
		for (const row of NATIVE_KEYBOARD_PAGES[this.view.publishedPage].rows) for (const key of row.keys) {
			const rect = this.frame.commandRefs[command] as RectRenderSubmission;
			command += 3;
			if (key === target) return { x: ((rect.area.left + rect.area.right) / 2) | 0, y: ((rect.area.top + rect.area.bottom) / 2) | 0 };
		}
		throw new Error(`Key ${target} is absent from published page ${this.view.publishedPage}`);
	}
	commands(): Command[] {
		const commands: Command[] = [];
		for (let index = 0; index < this.frame.commandCount; index++) {
			const ref = this.frame.commandRefs[index];
			switch (this.frame.commandKinds[index]) {
				case Host2DKind.Rect: {
					const r = ref as RectRenderSubmission;
					commands.push(['r', r.kind, r.area.left, r.area.top, r.area.right, r.area.bottom, r.area.z, r.color >>> 0, r.layer]); break;
				}
				case Host2DKind.Glyphs: {
					const g = ref as GlyphRenderSubmission;
					commands.push(['g', g.x, g.y, g.z, [g.items as string], g.item_start, g.item_end, g.color >>> 0, g.has_background_color, g.background_color >>> 0, g.layer, g.font === this.overlay.presenter.default_font]); break;
				}
				case Host2DKind.Img: {
					const i = ref as HostImageRenderSubmission;
					commands.push(['i', i.imgid, i.pos.x, i.pos.y, i.pos.z, i.scale.x, i.scale.y, i.flip.flip_h, i.flip.flip_v, i.colorize >>> 0, i.ambient_affected, i.ambient_factor, i.layer]); break;
				}
				default: throw new Error('Unexpected keyboard render command');
			}
		}
		return commands;
	}
	state(action: OnScreenKeyboardAction, hit: number, includeCommands: boolean): object {
		this.input.sampleInputControllerSnapshot(this.snapshot, InputControllerSampleContext.Normal);
		return {
			page: this.model.page, pageCount: this.model.pageCount, selected: this.model.selectedKey, visible: this.model.visible,
			shift: this.model.shiftActive, revision: this.model.revision, action,
			pressed: ON_SCREEN_KEY_DEFINITIONS.map((_, key) => Number(this.model.isKeyPressed(key))),
			highlighted: ON_SCREEN_KEY_DEFINITIONS.map((_, key) => Number(this.model.isKeyHighlighted(key))),
			hid: Array.from(this.snapshot.keyWords), publishedPage: this.view.publishedPage, hit,
			...(includeCommands ? { commands: this.commands() } : {}),
		};
	}
}

let fixture: Fixture;
for (const line of readFileSync(process.argv[2], 'utf8').trim().split('\n')) {
	const [op, ...fields] = line.trim().split(/\s+/);
	const a = fields.map(Number);
	if (op === 'SCHEMA') {
		console.log(JSON.stringify({ schema: {
			keys: ON_SCREEN_KEY_DEFINITIONS.map(({ code, ...key }) => ({ ...key, usage: hidKeyUsageForCode(code) })),
			pages: NATIVE_KEYBOARD_PAGES.map(page => ({ initialKey: page.initialKey, rows: page.rows.map(({ units, keys, starts, spans }) => ({ units, keys, starts, spans })) })),
		} }));
		continue;
	}
	let action = OnScreenKeyboardAction.None, hit = -1, includeCommands = false;
	switch (op) {
		case 'RESET': fixture?.input.dispose(); fixture = new Fixture(a[0], a[1]); includeCommands = true; break;
		case 'OPEN': fixture.open(); break;
		case 'CLOSE': fixture.close(); break;
		case 'PAGE': fixture.model.setPage(a[0]); break;
		case 'SELECT': fixture.model.selectKey(a[0], a[1]); break;
		case 'PRESS': fixture.model.pressKey(a[0], a[1]); break;
		case 'RELEASE': fixture.model.releaseSource(a[0], a[1] !== 0); break;
		case 'COMMAND': action = fixture.model.command(a[0], a[1] as OnScreenKeyboardCommand); break;
		case 'ACTIVATE': action = fixture.model.activateKey(a[0], a[1]); break;
		case 'HORIZONTAL': fixture.model.moveHorizontal(a[0]); break;
		case 'VERTICAL': fixture.model.moveVertical(a[0]); break;
		case 'FEEDBACK': fixture.model.updateFeedback(a[0]); break;
		case 'PHYSICAL': fixture.physical(a[0], a[2] !== 0); break;
		case 'POLL': fixture.poll(a[0]); break;
		case 'DOCK': fixture.view.togglePosition(); break;
		case 'BOUNDS': Object.assign(fixture.overlay.output.visibleViewportBounds, { left: a[0], top: a[1], right: a[2], bottom: a[3] }); break;
		case 'HIT': hit = fixture.view.hitTestAt(a[0], a[1]); break;
		case 'PUBLISH': fixture.publish(); includeCommands = true; break;
		case 'FRAME_KEY': {
			const point = fixture.keyPoint(a[1]); fixture.tick(a[0], point.x + a[2], point.y + a[3], a[4] !== 0, a[5], a[6]); includeCommands = true; break;
		}
		case 'FRAME': fixture.tick(a[0], a[1], a[2], a[3] !== 0, a[4], a[5]); includeCommands = true; break;
		default: throw new Error(`Unknown keyboard trace command ${op}`);
	}
	console.log(JSON.stringify(fixture.state(action, hit, includeCommands)));
}
fixture.input.dispose();
