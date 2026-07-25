import * as path from 'node:path';

import { extractErrorMessage } from '../../../../machine/ts/lua/value';
import { EMPTY_CALL_ARGS, Table, asStringId, valueIsString, type Closure, type StringValue, type Value } from '../../../../machine/ts/machine/cpu/cpu';
import { callClosureIntoSuspended } from '../../../../ide/runtime/closure_executor';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { InputEvt } from 'bmsx/platform';
import { HOST_TEST_LOADER_GLOBAL } from './host_test_cartridge';

export interface HostTestRunnerClock {
	scheduleOnce(delayMs: number, cb: (timestampMs: number) => void): void;
}

export interface HostTestRunnerState {
	assertCount: number;
	finished: boolean;
}

export interface HostTestRunnerOptions {
	testPath: string;
	frameIntervalMs: number;
	logger: (msg: string) => void;
	runtime: Runtime;
	postInput: (event: InputEvt) => void;
	requestExit: (code: number) => void;
	scheduler: HostTestRunnerClock;
	runState: HostTestRunnerState | null;
	captureNow: ((description: string) => void) | null;
	canCaptureNow: (() => boolean) | null;
}

type ScheduledHostCommand = {
	log: string | null;
	capture: string | null;
	down: string | null;
	up: string | null;
	press: string | null;
	holdFrames: number;
	newGame: boolean;
};

const HOST_TEST_GLOBAL = '__bmsx_host_test';
const CART_SETTLE_FRAMES = 5;
const GAMEPLAY_SETTLE_FRAMES = 50;

class HostTestRunner {
	private readonly label: string;
	private readonly scheduledCommands = new Map<number, ScheduledHostCommand[]>();
	private readonly updateArgs: Value[] = [0];
	private ready!: Closure;
	private setup!: Closure;
	private update!: Closure;
	private frameKey!: StringValue;
	private pressKey!: StringValue;
	private downKey!: StringValue;
	private upKey!: StringValue;
	private holdFramesKey!: StringValue;
	private captureKey!: StringValue;
	private logKey!: StringValue;
	private newGameKey!: StringValue;
	private doneKey!: StringValue;
	private phase: 'cart' | 'ready' | 'setup' | 'update' = 'cart';
	private cartSettleFrames = 0;
	private gameplaySettleFrames = 0;
	private updateFrames = 0;
	private tickTimestampMs = 0;
	private installed = false;
	private stopped = false;
	private readonly tickCallback = (timestampMs: number): void => this.tick(timestampMs);

	constructor(private readonly options: HostTestRunnerOptions) {
		this.label = path.basename(options.testPath);
	}

	public start(): void {
		this.options.logger(`test:${this.label} waiting for cart`);
		this.options.scheduler.scheduleOnce(this.options.frameIntervalMs, this.tickCallback);
	}

	private tick(timestampMs: number): void {
		try {
			this.tickUnsafe(timestampMs);
		} catch (error) {
			this.capture(`test_fail:${this.label}`);
			console.error('[bootrom:hostrunner] Fatal error:', error);
			this.options.requestExit(1);
			return;
		}
		if (!this.stopped) {
			this.options.scheduler.scheduleOnce(this.options.frameIntervalMs, this.tickCallback);
		}
	}

	private tickUnsafe(timestampMs: number): void {
		if (!this.options.runtime.machine.cpu.isCartridgeExecutionActive() || !this.options.runtime.isInitialized) {
			return;
		}
		if (!this.installed) {
			this.install();
		}
		this.tickTimestampMs = timestampMs;
		switch (this.phase) {
			case 'cart':
				this.cartSettleFrames += 1;
				if (this.cartSettleFrames >= CART_SETTLE_FRAMES) {
					this.options.logger(`test:${this.label} cart active`);
					this.phase = 'ready';
				}
				return;
			case 'ready':
				if (this.callGuest(this.ready, EMPTY_CALL_ARGS) !== true) {
					this.gameplaySettleFrames = 0;
					return;
				}
				this.gameplaySettleFrames += 1;
				if (this.gameplaySettleFrames >= GAMEPLAY_SETTLE_FRAMES) {
					this.options.logger(`test:${this.label} gameplay ready`);
					this.phase = 'setup';
				}
				return;
			case 'setup':
				this.applyCommands(this.callGuest(this.setup, EMPTY_CALL_ARGS));
				this.phase = 'update';
				return;
			case 'update': {
				this.updateFrames += 1;
				this.applyScheduledCommands();
				this.updateArgs[0] = this.updateFrames;
				const result = this.callGuest(this.update, this.updateArgs);
				this.applyCommands(result);
				if (result === true || (result instanceof Table && result.getStringKey(this.doneKey) === true)) {
					this.pass();
				}
				return;
			}
		}
	}

	private install(): void {
		const runtime = this.options.runtime;
		const cpu = runtime.machine.cpu;
		const loader = cpu.getGlobalByKey(runtime.internString(HOST_TEST_LOADER_GLOBAL)) as Closure;
		const results = runtime.luaScratch.values.acquire();
		try {
			callClosureIntoSuspended(runtime, loader, EMPTY_CALL_ARGS, results);
		} finally {
			runtime.luaScratch.values.release(results);
		}
		const testTable = cpu.getGlobalByKey(runtime.internString(HOST_TEST_GLOBAL)) as Table;
		this.ready = testTable.getStringKey(runtime.internString('ready')) as Closure;
		this.setup = testTable.getStringKey(runtime.internString('setup')) as Closure;
		this.update = testTable.getStringKey(runtime.internString('update')) as Closure;
		this.frameKey = runtime.internString('frame');
		this.pressKey = runtime.internString('press');
		this.downKey = runtime.internString('down');
		this.upKey = runtime.internString('up');
		this.holdFramesKey = runtime.internString('hold_frames');
		this.captureKey = runtime.internString('capture');
		this.logKey = runtime.internString('log');
		this.newGameKey = runtime.internString('new_game');
		this.doneKey = runtime.internString('done');
		this.installed = true;
		this.options.logger(`test:${this.label} loaded`);
	}

	private callGuest(fn: Closure, args: ReadonlyArray<Value>): Value | undefined {
		const runtime = this.options.runtime;
		const results = runtime.luaScratch.values.acquire();
		try {
			callClosureIntoSuspended(runtime, fn, args, results);
			return results.length === 0 ? undefined : results[0];
		} finally {
			runtime.luaScratch.values.release(results);
		}
	}

	private applyCommands(value: Value | undefined): void {
		switch (value) {
			case undefined:
			case null:
			case true:
			case false:
				return;
		}
		const stringPool = this.options.runtime.machine.cpu.stringPool;
		if (valueIsString(value)) {
			this.options.logger(`test:${this.label} ${stringPool.toString(asStringId(value))}`);
			return;
		}
		const command = value as Table;
		const frameValue = command.getStringKey(this.frameKey);
		const pressValue = command.getStringKey(this.pressKey);
		const downValue = command.getStringKey(this.downKey);
		const upValue = command.getStringKey(this.upKey);
		const holdFramesValue = command.getStringKey(this.holdFramesKey);
		const captureValue = command.getStringKey(this.captureKey);
		const logValue = command.getStringKey(this.logKey);
		const newGameValue = command.getStringKey(this.newGameKey);
		if (pressValue === null && downValue === null && upValue === null && captureValue === null && logValue === null && newGameValue === null) {
			for (let index = 1; index <= command.arrayLength; index += 1) {
				this.applyCommands(command.getInteger(index));
			}
			return;
		}
		const press = pressValue === null ? null : stringPool.toString(asStringId(pressValue as StringValue));
		const down = downValue === null ? null : stringPool.toString(asStringId(downValue as StringValue));
		const up = upValue === null ? null : stringPool.toString(asStringId(upValue as StringValue));
		let capture: string | null = null;
		switch (captureValue) {
			case null:
				break;
			case true:
				capture = 'test:capture';
				break;
			default:
				capture = `test:${stringPool.toString(asStringId(captureValue as StringValue))}`;
		}
		const log = logValue === null ? null : stringPool.toString(asStringId(logValue as StringValue));
		const holdFrames = holdFramesValue === null ? 1 : holdFramesValue as number;
		const newGame = newGameValue === true;
		if (frameValue !== null && (frameValue as number) > 0) {
			const dueFrame = this.updateFrames + (frameValue as number);
			let commands = this.scheduledCommands.get(dueFrame);
			if (!commands) {
				commands = [];
				this.scheduledCommands.set(dueFrame, commands);
			}
			commands.push({ log, capture, down, up, press, holdFrames, newGame });
			return;
		}
		this.applyCommand(log, capture, down, up, press, holdFrames, newGame);
	}

	private applyScheduledCommands(): void {
		const commands = this.scheduledCommands.get(this.updateFrames);
		if (!commands) {
			return;
		}
		this.scheduledCommands.delete(this.updateFrames);
		for (let index = 0; index < commands.length; index += 1) {
			const command = commands[index];
			this.applyCommand(command.log, command.capture, command.down, command.up, command.press, command.holdFrames, command.newGame);
		}
	}

	private applyCommand(log: string | null, capture: string | null, down: string | null, up: string | null, press: string | null, holdFrames: number, newGame: boolean): void {
		if (log !== null) {
			this.options.logger(`test:${this.label} ${log}`);
		}
		if (capture !== null) {
			this.capture(capture);
		}
		if (down !== null) {
			this.postKey(down, true);
		}
		if (up !== null) {
			this.postKey(up, false);
		}
		if (press !== null) {
			this.postKey(press, true);
			const dueFrame = this.updateFrames + holdFrames;
			let commands = this.scheduledCommands.get(dueFrame);
			if (!commands) {
				commands = [];
				this.scheduledCommands.set(dueFrame, commands);
			}
			commands.push({ log: null, capture: null, down: null, up: press, press: null, holdFrames: 1, newGame: false });
		}
		if (newGame) {
			const runtime = this.options.runtime;
			this.callGuest(runtime.machine.cpu.getGlobalByKey(this.newGameKey) as Closure, EMPTY_CALL_ARGS);
		}
	}

	private postKey(code: string, down: boolean): void {
		this.options.postInput({
			type: 'button',
			deviceId: 'keyboard:0',
			code,
			down,
			timestamp: this.tickTimestampMs,
		});
	}

	private capture(description: string): void {
		if (this.options.captureNow && (!this.options.canCaptureNow || this.options.canCaptureNow())) {
			this.options.captureNow(description);
		}
	}

	private pass(): void {
		this.stopped = true;
		if (this.options.runState) {
			this.options.runState.assertCount += 1;
			this.options.runState.finished = true;
		}
		this.capture(`test_pass:${this.label}`);
		this.options.logger(`test:${this.label} passed`);
		this.options.requestExit(0);
	}

}

export function runHostTest(options: HostTestRunnerOptions): void {
	try {
		new HostTestRunner(options).start();
	} catch (error) {
		options.captureNow?.(`test_fail:${path.basename(options.testPath)}: ${extractErrorMessage(error)}`);
		console.error('[bootrom:hostrunner] Fatal error:', error);
		options.requestExit(1);
	}
}
