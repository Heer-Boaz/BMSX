import { $ } from '../../core/engine';
import type { Program, ProgramMetadata } from '../cpu/cpu';
import { IO_SYS_BOOT_CART, IO_SYS_CART_BOOTREADY } from '../bus/io';
import { PROGRAM_ASSET_ID } from '../program/asset';
import * as luaPipeline from '../../ide/runtime/lua_pipeline';
import type { Runtime } from './runtime';

export type PreparedCartProgram = {
	program: Program;
	metadata: ProgramMetadata;
	entryProtoIndex: number;
	moduleProtoMap: Map<string, number>;
	moduleAliases: Array<{ alias: string; path: string }>;
	entryPath: string;
};

export class CartBootState {
	public pending = false;
	public preparedProgram: PreparedCartProgram = null;
	private deferredPreparationHandle: { stop(): void } = null;
	private deferredPreparationScheduled = false;
	private deferredPreparationCompleted = false;

	public reset(runtime: Runtime): void {
		this.pending = false;
		this.preparedProgram = null;
		this.resetDeferredPreparation();
		runtime.machine.memory.writeValue(IO_SYS_CART_BOOTREADY, 0);
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
				runtime.machine.memory.writeValue(IO_SYS_CART_BOOTREADY, 0);
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
		if (runtime.frameLoop.currentFrameState !== null || runtime.pendingCall !== null) {
			luaPipeline.resetFrameState(runtime);
		}
		if (runtime.pendingCall !== null) {
			runtime.pendingCall = null;
			runtime.vblank.clearHaltUntilIrq(runtime);
		}
		runtime.frameScheduler.clearQueuedTime();
		this.pending = false;
		console.info('Switching to cart program after BIOS boot request.');
		runtime.activateProgramSource('cart');
		void luaPipeline.reloadProgramAndResetWorld(runtime);
	}

	private request(runtime: Runtime): void {
		this.pending = true;
		runtime.machine.memory.writeValue(IO_SYS_CART_BOOTREADY, 0);
	}

	private async prepare(runtime: Runtime): Promise<void> {
		this.preparedProgram = null;
		if (runtime.assets.cartLayer && runtime.cartAssetSource && runtime.cartLuaSources) {
			try {
				if (runtime.cartLuaSources.can_boot_from_source) {
					this.preparedProgram = luaPipeline.compileCartLuaProgramForBoot(runtime);
					console.info('Cart boot payload prepared from Lua sources.');
					runtime.machine.memory.writeValue(IO_SYS_CART_BOOTREADY, 1);
					return;
				}
				runtime.machine.memory.writeValue(
					IO_SYS_CART_BOOTREADY,
					runtime.cartAssetSource.getEntry(PROGRAM_ASSET_ID) ? 1 : 0,
				);
			} catch (error) {
				this.preparedProgram = null;
				console.error('Failed to prepare cart boot payload:', error);
				throw error;
			}
		}
		runtime.machine.memory.writeValue(IO_SYS_CART_BOOTREADY, 0);
	}

	private pollSystemBootRequest(runtime: Runtime): void {
		if ($.sources !== runtime.engineLuaSources) {
			return;
		}
		if (runtime.machine.memory.readIoU32(IO_SYS_BOOT_CART) === 0) {
			return;
		}
		runtime.machine.memory.writeValue(IO_SYS_BOOT_CART, 0);
		runtime.frameScheduler.clearQueuedTime();
		this.request(runtime);
	}
}
