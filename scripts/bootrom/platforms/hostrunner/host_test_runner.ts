import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { InputEvt } from '../../../../src/bmsx_hostplatform/platform';

export interface HostTestRunnerClock {
	nowMs(): number;
	scheduleOnce(delayMs: number, cb: () => void): void;
}

export interface HostTestRunnerState {
	assertCount: number;
	finished: boolean;
}

export interface HostTestRunnerOptions {
	testPath: string;
	frameIntervalMs: number;
	logger: (msg: string) => void;
	getEngine: () => any;
	postInput: (event: InputEvt) => void;
	requestExit: (code: number) => void;
	scheduler: HostTestRunnerClock;
	runState: HostTestRunnerState | null;
	captureNow: ((description: string) => void) | null;
	canCaptureNow: (() => boolean) | null;
}

const HOST_TEST_GLOBAL = '__bmsx_host_test';
const CART_SETTLE_FRAMES = 5;
const GAMEPLAY_SETTLE_FRAMES = 50;
const HOST_TEST_PREAMBLE = `
local host = {
	press = function(code, frames)
		return { press = code, hold_frames = frames or 1 }
	end,
	down = function(code)
		return { down = code }
	end,
	up = function(code)
		return { up = code }
	end,
	at = function(frame, command)
		command.frame = frame
		return command
	end,
	capture = function(label)
		return { capture = label or true }
	end,
	log = function(message)
		return { log = message }
	end,
}
`;

type HostTestRunnerPhase = 'cart' | 'install' | 'ready' | 'setup' | 'update' | 'done';

function toLuaStringLiteral(value: string): string {
	return `"${value
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t')}"`;
}

function toLuaLiteral(value: unknown): string {
	if (value === null || value === undefined) {
		return 'nil';
	}
	if (typeof value === 'string') {
		return toLuaStringLiteral(value);
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? String(value) : 'nil';
	}
	if (typeof value === 'boolean') {
		return value ? 'true' : 'false';
	}
	return 'nil';
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

class HostTestRunner {
	private readonly label: string;
	private source = '';
	private phase: HostTestRunnerPhase = 'cart';
	private cartSettleFrames = 0;
	private gameplaySettleFrames = 0;
	private updateFrames = 0;
	private pressId = 1;
	private readonly activePressIds = new Map<string, number>();

	constructor(private readonly options: HostTestRunnerOptions) {
		this.label = path.basename(options.testPath);
	}

	public async start(): Promise<void> {
		this.source = await fs.readFile(path.resolve(this.options.testPath), 'utf8');
		this.options.logger(`test:${this.label} waiting for cart`);
		this.scheduleNextFrame();
	}

	private scheduleNextFrame(): void {
		this.options.scheduler.scheduleOnce(this.options.frameIntervalMs, () => this.tick());
	}

	private tick(): void {
		try {
			this.tickUnsafe();
		} catch (error) {
			this.captureFailure();
			console.error(`[bootrom:hostrunner] Fatal error:`, error);
			this.options.requestExit(1);
			return;
		}
		if (this.phase !== 'done') {
			this.scheduleNextFrame();
		}
	}

	private tickUnsafe(): void {
		if (this.phase === 'cart') {
			this.tickCart();
			return;
		}
		if (this.phase === 'install') {
			this.installHostTest();
			return;
		}
		if (this.phase === 'ready') {
			this.tickReady();
			return;
		}
		if (this.phase === 'setup') {
			this.runSetup();
			return;
		}
		if (this.phase === 'update') {
			this.tickUpdate();
		}
	}

	private tickCart(): void {
		const engine = this.options.getEngine();
		if (!engine || !engine.initialized || !engine.is_cart_program_active()) {
			this.cartSettleFrames = 0;
			return;
		}
		this.cartSettleFrames += 1;
		if (this.cartSettleFrames < CART_SETTLE_FRAMES) {
			return;
		}
		this.options.logger(`test:${this.label} cart active, requesting new_game`);
		engine.request_new_game();
		this.phase = 'install';
	}

	private installHostTest(): void {
		this.options.logger(`test:${this.label} loaded`);
		this.phase = 'ready';
	}

	private tickReady(): void {
		const [ready] = this.evalHook('ready');
		if (ready !== true) {
			this.gameplaySettleFrames = 0;
			return;
		}
		this.gameplaySettleFrames += 1;
		if (this.gameplaySettleFrames < GAMEPLAY_SETTLE_FRAMES) {
			return;
		}
		this.options.logger(`test:${this.label} gameplay ready`);
		this.phase = 'setup';
	}

	private runSetup(): void {
		const [setupResult] = this.evalHook('setup');
		this.applyHookResult(setupResult);
		this.phase = 'update';
	}

	private tickUpdate(): void {
		this.updateFrames += 1;
		const engine = this.options.getEngine();
		const currentMusic = engine.sndmaster.currentTrackByType('music');
		const [result] = this.evalHook('update', `${this.updateFrames}, ${toLuaLiteral(currentMusic)}`);
		this.applyHookResult(result);
		if (!this.isDoneResult(result)) {
			return;
		}
		this.finish();
	}

	private finish(): void {
		this.phase = 'done';
		if (this.options.runState) {
			this.options.runState.assertCount += 1;
			this.options.runState.finished = true;
		}
		this.capturePass();
		this.options.logger(`test:${this.label} passed`);
		this.options.requestExit(0);
	}

	private evalLua(source: string): unknown[] {
		return this.options.getEngine().evaluate_lua(source) as unknown[];
	}

	// Hooks are loaded and called inside the same console chunk so external test
	// files do not retain console-eval closures across frames.
	private evalHook(name: string, args = ''): unknown[] {
		return this.evalLua(`${HOST_TEST_PREAMBLE}\n${this.source}\nreturn ${HOST_TEST_GLOBAL}.${name}(${args})`);
	}

	private applyHookResult(result: unknown): void {
		if (typeof result === 'string') {
			this.options.logger(`test:${this.label} ${result}`);
			return;
		}
		this.applyCommands(result);
	}

	private isDoneResult(result: unknown): boolean {
		if (result === true) {
			return true;
		}
		if (!result || typeof result !== 'object' || Array.isArray(result)) {
			return false;
		}
		return (result as Record<string, unknown>).done === true;
	}

	private applyCommands(command: unknown): void {
		if (command === null || command === undefined || typeof command === 'boolean') {
			return;
		}
		if (Array.isArray(command)) {
			for (let i = 0; i < command.length; i += 1) {
				this.applyCommands(command[i]);
			}
			return;
		}
		if (typeof command !== 'object') {
			throw new Error(`Host test command must be a table, got ${typeof command}.`);
		}
		const record = command as Record<string, unknown>;
		const frame = this.optionalNumberField(record, 'frame');
		if (frame !== null && frame > 0) {
			this.options.scheduler.scheduleOnce(Math.round(frame) * this.options.frameIntervalMs, () => this.applyCommandNow(record));
			return;
		}
		this.applyCommandNow(record);
	}

	private applyCommandNow(command: Record<string, unknown>): void {
		const log = this.optionalStringField(command, 'log');
		if (log !== null) {
			this.options.logger(`test:${this.label} ${log}`);
		}
		const capture = command.capture;
		if (capture === true) {
			this.captureCommand('capture');
		} else if (typeof capture === 'string') {
			this.captureCommand(capture);
		}
		const down = this.optionalStringField(command, 'down');
		if (down !== null) {
			this.buttonDown(down);
		}
		const up = this.optionalStringField(command, 'up');
		if (up !== null) {
			this.buttonUp(up);
		}
		const press = this.optionalStringField(command, 'press');
		if (press !== null) {
			const holdFrames = this.optionalNumberField(command, 'hold_frames') ?? 1;
			this.pressButton(press, holdFrames);
		}
	}

	private optionalStringField(command: Record<string, unknown>, field: string): string | null {
		if (!(field in command)) {
			return null;
		}
		const value = command[field];
		if (typeof value !== 'string') {
			throw new Error(`Host test command field '${field}' must be a string.`);
		}
		return value;
	}

	private optionalNumberField(command: Record<string, unknown>, field: string): number | null {
		if (!(field in command)) {
			return null;
		}
		const value = command[field];
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new Error(`Host test command field '${field}' must be a finite number.`);
		}
		return value;
	}

	private captureCommand(label: string): void {
		if (this.options.captureNow && (!this.options.canCaptureNow || this.options.canCaptureNow())) {
			this.options.captureNow(`test:${label}`);
		}
	}

	private pressButton(code: string, holdFrames: number): void {
		const pressId = this.buttonDown(code);
		this.options.scheduler.scheduleOnce(Math.max(1, holdFrames) * this.options.frameIntervalMs, () => {
			this.buttonUpWithPressId(code, pressId);
		});
	}

	private buttonDown(code: string): number {
		if (this.activePressIds.has(code)) {
			throw new Error(`Host test button '${code}' is already down.`);
		}
		const pressId = this.pressId;
		this.pressId += 1;
		this.activePressIds.set(code, pressId);
		this.options.postInput(this.buttonEvent(code, true, pressId));
		return pressId;
	}

	private buttonUp(code: string): void {
		const pressId = this.activePressIds.get(code);
		if (pressId === undefined) {
			throw new Error(`Host test button '${code}' was released before it was pressed.`);
		}
		this.buttonUpWithPressId(code, pressId);
	}

	private buttonUpWithPressId(code: string, pressId: number): void {
		if (this.activePressIds.get(code) === pressId) {
			this.activePressIds.delete(code);
		}
		this.options.postInput(this.buttonEvent(code, false, pressId));
	}

	private buttonEvent(code: string, down: boolean, pressId: number): InputEvt {
		return {
			type: 'button',
			deviceId: 'keyboard:0',
			code,
			down,
			value: down ? 1 : 0,
			timestamp: Math.round(this.options.scheduler.nowMs()),
			pressId,
			modifiers: { ctrl: false, shift: false, alt: false, meta: false },
		} as InputEvt;
	}

	private capturePass(): void {
		if (this.options.captureNow && (!this.options.canCaptureNow || this.options.canCaptureNow())) {
			this.options.captureNow(`test_pass:${this.label}`);
		}
	}

	private captureFailure(): void {
		if (this.options.captureNow && (!this.options.canCaptureNow || this.options.canCaptureNow())) {
			this.options.captureNow(`test_fail:${this.label}`);
		}
	}
}

export async function runHostTest(options: HostTestRunnerOptions): Promise<void> {
	try {
		await new HostTestRunner(options).start();
	} catch (error) {
		options.captureNow?.(`test_fail:${path.basename(options.testPath)}: ${formatError(error)}`);
		console.error(`[bootrom:hostrunner] Fatal error:`, error);
		options.requestExit(1);
	}
}
