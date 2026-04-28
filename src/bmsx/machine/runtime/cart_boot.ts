import { engineCore } from '../../core/engine';
import type { Program, ProgramMetadata } from '../cpu/cpu';
import { IO_SYS_BOOT_CART, IO_SYS_CART_BOOTREADY } from '../bus/io';
import { PROGRAM_ASSET_ID } from '../program/asset';
import * as luaPipeline from '../../ide/runtime/lua_pipeline';
import { Runtime } from './runtime';

export type PreparedCartProgram = {
	program: Program;
	metadata: ProgramMetadata;
	entryProtoIndex: number;
	moduleProtoMap: Map<string, number>;
	moduleAliases: Array<{ alias: string; path: string }>;
	staticModulePaths: string[];
	entryPath: string;
};

export class CartBootState {
	public pending = false;
	public preparedProgram: PreparedCartProgram = null;
	private deferredPreparationHandle: { stop(): void } = null;
	private deferredPreparationScheduled = false;
	private deferredPreparationCompleted = false;

	constructor(private readonly runtime: Runtime) {
	}

	public reset(): void {
		this.pending = false;
		this.preparedProgram = null;
		this.resetDeferredPreparation();
		this.setReadyFlag(false);
	}

	public resetDeferredPreparation(): void {
		if (this.deferredPreparationHandle !== null) {
			this.deferredPreparationHandle.stop();
			this.deferredPreparationHandle = null;
		}
		this.deferredPreparationScheduled = false;
		this.deferredPreparationCompleted = false;
	}

	public scheduleDeferredPreparation(): void {
		const runtime = this.runtime;
		if (this.deferredPreparationCompleted || this.deferredPreparationScheduled) {
			return;
		}
		if (!runtime.assets.cartLayer || !runtime.cartAssetSource || !runtime.cartLuaSources) {
			return;
		}
		this.deferredPreparationScheduled = true;
		const handle = engineCore.platform.frames.start(() => {
			handle.stop();
			if (this.deferredPreparationHandle === handle) {
				this.deferredPreparationHandle = null;
			}
			this.deferredPreparationScheduled = false;
			if (this.deferredPreparationCompleted) {
				return;
			}
			this.deferredPreparationCompleted = true;
			void this.prepare().catch((error: unknown) => {
				console.error('Failed to prepare cart boot:', error);
				this.setReadyFlag(false);
			});
		});
		this.deferredPreparationHandle = handle;
	}

	public processPending(): void {
		const runtime = this.runtime;
		this.pollSystemBootRequest();
		if (!this.pending) {
			return;
		}
		if (!runtime.luaGate.ready) {
			return;
		}
		const frameLoop = runtime.frameLoop;
		const hasPendingCall = runtime.pendingCall !== null;
		if (frameLoop.currentFrameState !== null || hasPendingCall) {
			luaPipeline.resetFrameState(runtime);
		}
		if (hasPendingCall) {
			runtime.pendingCall = null;
			runtime.vblank.clearHaltUntilIrq();
		}
		runtime.frameScheduler.clearQueuedTime();
		this.pending = false;
		console.info('Switching to cart program after BIOS boot request.');
		runtime.activateProgramSource('cart');
		void luaPipeline.reloadProgramAndResetWorld(runtime);
	}

	private setReadyFlag(value: boolean): void {
		this.runtime.machine.memory.writeValue(IO_SYS_CART_BOOTREADY, value ? 1 : 0);
	}

	private request(): void {
		this.pending = true;
		this.setReadyFlag(false);
	}

	private async prepare(): Promise<void> {
		const runtime = this.runtime;
		this.setReadyFlag(false);
		this.preparedProgram = null;
		try {
			if (runtime.cartLuaSources.can_boot_from_source) {
				this.preparedProgram = luaPipeline.compileCartLuaProgramForBoot(runtime);
				this.setReadyFlag(true);
				console.info('Cart boot payload prepared from Lua sources.');
				return;
			}
			const programEntry = runtime.cartAssetSource.getEntry(PROGRAM_ASSET_ID);
			this.setReadyFlag(!!programEntry);
		} catch (error) {
			this.preparedProgram = null;
			this.setReadyFlag(false);
			console.error('Failed to prepare cart boot payload:', error);
			throw error;
		}
	}

	private pollSystemBootRequest(): void {
		const runtime = this.runtime;
		if (runtime.activeProgramSource !== 'engine') {
			return;
		}
		if (runtime.machine.memory.readIoU32(IO_SYS_BOOT_CART) === 0) {
			return;
		}
		runtime.machine.memory.writeValue(IO_SYS_BOOT_CART, 0);
		runtime.frameScheduler.clearQueuedTime();
		this.request();
	}
}
