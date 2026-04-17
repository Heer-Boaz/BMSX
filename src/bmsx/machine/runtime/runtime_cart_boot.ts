import { $ } from '../../core/engine_core';
import type { CanonicalizationType } from '../../rompack/rompack';
import type { Program, ProgramMetadata } from '../cpu/cpu';
import { IO_SYS_BOOT_CART, IO_SYS_CART_BOOTREADY } from '../bus/io';
import { PROGRAM_ASSET_ID } from '../program/program_asset';
import * as runtimeLuaPipeline from '../../ide/runtime/runtime_lua_pipeline';
import type { Runtime } from './runtime';

export type PreparedCartProgram = {
	program: Program;
	metadata: ProgramMetadata;
	entryProtoIndex: number;
	moduleProtoMap: Map<string, number>;
	moduleAliases: Array<{ alias: string; path: string }>;
	entryPath: string;
	canonicalization: CanonicalizationType;
};

export class RuntimeCartBootState {
	public pending = false;
	public preparedProgram: PreparedCartProgram = null;
	private deferredPreparationHandle: { stop(): void } = null;
	private deferredPreparationScheduled = false;
	private deferredPreparationCompleted = false;

	public reset(runtime: Runtime): void {
		this.pending = false;
		this.preparedProgram = null;
		this.resetDeferredPreparation();
		this.setReadyFlag(runtime, false);
	}

	public resetDeferredPreparation(): void {
		if (this.deferredPreparationHandle !== null) {
			this.deferredPreparationHandle.stop();
			this.deferredPreparationHandle = null;
		}
		this.deferredPreparationScheduled = false;
		this.deferredPreparationCompleted = false;
	}

	public scheduleDeferredPreparation(runtime: Runtime): void {
		if (this.deferredPreparationCompleted || this.deferredPreparationScheduled) {
			return;
		}
		if (!runtime.assets.cartLayer || !runtime.cartAssetSource || !runtime.cartLuaSources) {
			return;
		}
		this.deferredPreparationScheduled = true;
		const handle = $.platform.frames.start(() => {
			handle.stop();
			if (this.deferredPreparationHandle === handle) {
				this.deferredPreparationHandle = null;
			}
			this.deferredPreparationScheduled = false;
			if (this.deferredPreparationCompleted) {
				return;
			}
			this.deferredPreparationCompleted = true;
			void this.prepare(runtime).catch((error: unknown) => {
				console.error('Failed to prepare cart boot:', error);
				this.setReadyFlag(runtime, false);
			});
		});
		this.deferredPreparationHandle = handle;
	}

	public processPending(runtime: Runtime): void {
		this.pollSystemBootRequest(runtime);
		if (!this.pending) {
			return;
		}
		if (!runtime.luaGate.ready) {
			return;
		}
		if (runtime.frameLoop.currentFrameState !== null) {
			runtimeLuaPipeline.resetFrameState(runtime);
		}
		if (runtime.pendingCall !== null) {
			if (runtime.frameLoop.currentFrameState === null) {
				runtimeLuaPipeline.resetFrameState(runtime);
			}
			runtime.pendingCall = null;
			runtime.vblank.clearHaltUntilIrq(runtime);
		}
		runtime.machineScheduler.clearQueuedTime();
		this.pending = false;
		console.info('Switching to cart program after BIOS boot request.');
		runtime.activateProgramSource('cart');
		void runtimeLuaPipeline.reloadProgramAndResetWorld(runtime);
	}

	private setReadyFlag(runtime: Runtime, value: boolean): void {
		runtime.machine.memory.writeValue(IO_SYS_CART_BOOTREADY, value ? 1 : 0);
	}

	private request(runtime: Runtime): void {
		this.pending = true;
		this.setReadyFlag(runtime, false);
	}

	private async prepare(runtime: Runtime): Promise<void> {
		this.setReadyFlag(runtime, false);
		this.preparedProgram = null;
		if (!runtime.assets.cartLayer || !runtime.cartAssetSource || !runtime.cartLuaSources) {
			return;
		}
		try {
			if (runtime.cartLuaSources.can_boot_from_source) {
				this.preparedProgram = runtimeLuaPipeline.compileCartLuaProgramForBoot(runtime);
				this.setReadyFlag(runtime, true);
				console.info('Cart boot payload prepared from Lua sources.');
				return;
			}
			const programEntry = runtime.cartAssetSource.getEntry(PROGRAM_ASSET_ID);
			this.setReadyFlag(runtime, !!programEntry);
		} catch (error) {
			this.preparedProgram = null;
			this.setReadyFlag(runtime, false);
			console.error('Failed to prepare cart boot payload:', error);
			throw error;
		}
	}

	private pollSystemBootRequest(runtime: Runtime): void {
		if ($.lua_sources !== runtime.engineLuaSources) {
			return;
		}
		if (runtime.machine.memory.readIoU32(IO_SYS_BOOT_CART) === 0) {
			return;
		}
		runtime.machine.memory.writeValue(IO_SYS_BOOT_CART, 0);
		runtime.machineScheduler.clearQueuedTime();
		this.request(runtime);
	}
}
