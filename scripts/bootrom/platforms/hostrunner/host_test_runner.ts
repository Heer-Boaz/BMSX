import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { extractErrorMessage } from '../../../../src/bmsx/lua/value';
import type { InputEvt } from '../../../../src/bmsx_hostplatform/platform';

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
	isCartProgramActive: () => boolean;
	evaluateLua: (source: string) => unknown[];
	installNativeGlobal: (name: string, value: unknown) => void;
	requestNewGame: () => void;
	postInput: (event: InputEvt) => void;
	requestExit: (code: number) => void;
	scheduler: HostTestRunnerClock;
	runState: HostTestRunnerState | null;
	captureNow: ((description: string) => void) | null;
	canCaptureNow: (() => boolean) | null;
}

const HOST_RUNNER_GLOBAL = '__bmsx_host_runner';
const HOST_BRIDGE_GLOBAL = '__bmsx_host_bridge';
const HOST_RUNNER_LUA_PATH = 'scripts/bootrom/platforms/hostrunner/host_test_runner.lua';

class HostTestRunner {
	private readonly label: string;
	private runnerSource = '';
	private testSource = '';
	private installed = false;
	private stopped = false;

	constructor(private readonly options: HostTestRunnerOptions) {
		this.label = path.basename(options.testPath);
	}

	public async start(): Promise<void> {
		this.runnerSource = await fs.readFile(path.resolve(HOST_RUNNER_LUA_PATH), 'utf8');
		this.testSource = await fs.readFile(path.resolve(this.options.testPath), 'utf8');
		this.options.logger(`test:${this.label} waiting for cart`);
		this.scheduleNextFrame();
	}

	private scheduleNextFrame(): void {
		this.options.scheduler.scheduleOnce(this.options.frameIntervalMs, (timestampMs) => this.tick(timestampMs));
	}

	private tick(timestampMs: number): void {
		try {
			this.tickUnsafe(timestampMs);
		} catch (error) {
			this.captureFailure();
			console.error(`[bootrom:hostrunner] Fatal error:`, error);
			this.options.requestExit(1);
			return;
		}
		if (!this.stopped) {
			this.scheduleNextFrame();
		}
	}

	private tickUnsafe(timestampMs: number): void {
		if (!this.installed) {
			if (!this.options.isCartProgramActive()) {
				return;
			}
			this.install();
		}
		this.options.evaluateLua(`return ${HOST_RUNNER_GLOBAL}.tick(${timestampMs})`);
	}

	private install(): void {
		this.installHostBridge();
		this.options.evaluateLua(`${this.runnerSource}\n${this.testSource}\n${HOST_RUNNER_GLOBAL}.install()`);
		this.installed = true;
	}

	private installHostBridge(): void {
		const bridge = {
			log: (message: string) => this.options.logger(`test:${this.label} ${message}`),
			request_new_game: () => this.options.requestNewGame(),
			post_key: (code: string, down: boolean, timestamp: number) => {
				this.options.postInput(this.keyEvent(code, down, timestamp));
			},
			capture: (description: string) => this.capture(description),
			pass: () => this.pass(),
		};
		this.options.installNativeGlobal(HOST_BRIDGE_GLOBAL, bridge);
	}

	private keyEvent(code: string, down: boolean, timestamp: number): InputEvt {
		return {
			type: 'button',
			deviceId: 'keyboard:0',
			code,
			down,
			timestamp,
		};
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

	private captureFailure(): void {
		this.capture(`test_fail:${this.label}`);
	}
}

export async function runHostTest(options: HostTestRunnerOptions): Promise<void> {
	try {
		await new HostTestRunner(options).start();
	} catch (error) {
		options.captureNow?.(`test_fail:${path.basename(options.testPath)}: ${extractErrorMessage(error)}`);
		console.error(`[bootrom:hostrunner] Fatal error:`, error);
		options.requestExit(1);
	}
}
