import { SoundMaster } from "../audio/soundmaster";
import { Input } from "../input/manager";
import { LogLevel, setMicrotaskQueue } from '../platform';
import type { Platform } from '../platform';
import { PAL_REFRESH_UFPS_SCALED, PSX_MACHINE_SPEC } from '../machine/model_registry';
import { HZ_SCALE } from '../machine/runtime/timing/constants';
import { Runtime } from '../machine/runtime/runtime';
import { Memory } from '../machine/memory/memory';
import { configureMemoryMap } from '../machine/memory/map';
import { resolveRuntimeTiming } from '../machine/runtime/boot_timing';
import { SYS_PRINT_BUFFER_BYTES } from '../spec/bmsx/io';
import { parseRomImage } from '../rompack/image';
import {
	type CartridgeSlotMediaPair,
} from '../machine/devices/cartridge/contracts';

const systemOutputDecoder = new TextDecoder('utf-8', { fatal: true });
const EMPTY_CARTRIDGE_ROM = new Uint8Array(0);

export interface MachineInitializationOptions {
	systemRom: Uint8Array;
	cartridgeSlots: [Uint8Array | null, Uint8Array | null];
	debug?: boolean;
	platform: Platform;
}

const DEFAULT_MASTER_VOLUME = 1;

export class MachineManager {
	private initialized = false;

	/**
	 * Indicates whether debug mode is enabled.
	 */
	public get debug(): boolean { return this._debug; }
	private _debug: boolean = false;
	/**
	 * The time difference between the current frame and the previous frame.
	 */
	public deltatime: number = 0;

	public get deltatime_seconds(): number { return this.deltatime / 1000; }

	public host_show_fps = false;
	public host_fps = 0;
	private audioUfpsScaled = PAL_REFRESH_UFPS_SCALED;
	private readonly systemOutputBytes = new Uint8Array(SYS_PRINT_BUFFER_BYTES);

	/**
	 * The ID of the animation frame request.
	 */
	private _platform!: Platform;
	private _runtime!: Runtime;
	/**
	 * Indicates whether the game is currently running.
	 */
	public running!: boolean;

	/**
	 * Indicates whether the game is currently paused (by the debugger).
	 */
	private _paused!: boolean;

	public get paused(): boolean { return this._paused; }
	public set paused(value: boolean) {
		if (this._paused === value) return; // No change
		this._paused = value;
		if (this._paused) {
			this.sndmaster.pause();
		} else {
			this.sndmaster.resume();
		}
	}

	public get input(): Input { return Input.instance!; }
	public get sndmaster(): SoundMaster { return SoundMaster.instance; }
	public get platform(): Platform { return this._platform!; }
	public get runtime(): Runtime { return this._runtime; }

	constructor() {
		this.initialized = false;
	}

	public syncAudioTiming(): void {
		const ufpsScaled = this.runtime.timing.ufpsScaled;
		this.platform.audio.setFrameTimeSec(HZ_SCALE / ufpsScaled);
		this.sndmaster.setMixerUfpsScaled(ufpsScaled);
		this.audioUfpsScaled = ufpsScaled;
	}

	public flushSystemOutput(runtime: Runtime): void {
		const output = runtime.machine.systemController;
		const byteCount = output.hostOutputAvailableByteCount();
		if (byteCount === 0) {
			return;
		}
		for (let index = 0; index < byteCount; index += 1) {
			this.systemOutputBytes[index] = output.readHostOutputByte();
		}
		let lineStart = 0;
		for (let index = 0; index < byteCount; index += 1) {
			if (this.systemOutputBytes[index] === 10) {
				this.platform.log(LogLevel.Info, systemOutputDecoder.decode(this.systemOutputBytes.subarray(lineStart, index)));
				lineStart = index + 1;
			}
		}
	}

	public syncRuntimeAudioTiming(): void {
		if (this.runtime.timing.ufpsScaled !== this.audioUfpsScaled) {
			this.syncAudioTiming();
		}
	}

	public bootstrapStartupAudio(): void {
		if (!this.platform.audio.available) {
			return;
		}
		this.syncAudioTiming();
		this.sndmaster.bootstrapRuntimeAudio(this.runtime.timing.ufpsScaled, DEFAULT_MASTER_VOLUME);
	}

	public initialize(options: MachineInitializationOptions): Runtime {
		const {
			systemRom,
			cartridgeSlots,
			debug = false,
			platform,
		} = options;
		const systemImage = parseRomImage(systemRom, 'system');
		const cartridgeImages = [
			cartridgeSlots[0] ? parseRomImage(cartridgeSlots[0], 'cart') : null,
			cartridgeSlots[1] ? parseRomImage(cartridgeSlots[1], 'cart') : null,
		] as const;
		const cartridgeMedia: CartridgeSlotMediaPair = [
			{
				rom: EMPTY_CARTRIDGE_ROM,
				boardWord: 0,
				ramByteCount: 0,
				present: false,
			},
			{
				rom: EMPTY_CARTRIDGE_ROM,
				boardWord: 0,
				ramByteCount: 0,
				present: false,
			},
		];
		for (let slotIndex = 0; slotIndex < cartridgeImages.length; slotIndex += 1) {
			const image = cartridgeImages[slotIndex];
			if (!image) continue;
			cartridgeMedia[slotIndex] = {
				rom: image.bytes,
				boardWord: image.header.cartridgeBoardWord,
				ramByteCount: image.header.cartridgeRamByteCount,
				present: true,
			};
		}
		configureMemoryMap(PSX_MACHINE_SPEC.ramBytes);
		const memory = new Memory({
			systemRom: systemImage.bytes,
			cartridgeSlots: cartridgeMedia,
		});
		this._platform = platform;
		setMicrotaskQueue(platform.microtasks);
		this.running = false;
		this._paused = false;
		this._debug = debug;

		const timing = resolveRuntimeTiming(PSX_MACHINE_SPEC.cpuFreqHz);
		const runtime = new Runtime({
			memory,
			pcrtcRunning: timing.pcrtcRunning,
			ufpsScaled: timing.ufpsScaled,
			cpuHz: timing.cpuHz,
			cycleBudgetPerFrame: timing.cycleBudgetPerFrame,
			totalHalfLines: timing.totalHalfLines,
			activeDisplayHalfLines: timing.activeDisplayHalfLines,
			geoWorkUnitsPerSec: timing.geoWorkUnitsPerSec,
		}, Input.instance);
		this._runtime = runtime;
		this.syncAudioTiming();

		this.initialized = true;
		return runtime;
	}

	/**
	 * Starts the game loop and sets the `running` flag to `true`.
	 * @returns void
	 */
	public start(): void {
		if (!this.initialized) {
			throw new Error('Game not initialized. Call init() before starting the game!');
		}
		const now = this.platform.clock.now();
		const runtime = this.runtime;
		runtime.frameLoop.currentTimeMs = now;
		runtime.frameScheduler.clearQueuedTime();
		this.running = true;
	}

}

export const machineManager = new MachineManager();
