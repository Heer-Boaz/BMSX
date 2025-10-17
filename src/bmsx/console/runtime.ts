import { $ } from '../core/game';
import type { StorageService } from '../platform/platform';
import { BmsxConsoleApi } from './api';
import { BmsxConsoleInput } from './input';
import { BmsxConsoleStorage } from './storage';
import type { BmsxConsoleCartridge } from './types';

export type BmsxConsoleRuntimeOptions = {
	cart: BmsxConsoleCartridge;
	storage: StorageService;
	playerIndex: number;
	displayWidth: number;
	displayHeight: number;
};

export class BmsxConsoleRuntime {
	private readonly cart: BmsxConsoleCartridge;
	private readonly api: BmsxConsoleApi;
	private readonly input: BmsxConsoleInput;
	private readonly storage: BmsxConsoleStorage;
	private frameCounter = 0;

	constructor(options: BmsxConsoleRuntimeOptions) {
		this.cart = options.cart;
		this.input = new BmsxConsoleInput(options.playerIndex);
		this.storage = new BmsxConsoleStorage(options.storage, options.cart.meta.persistentId);
		this.api = new BmsxConsoleApi({
			displayWidth: options.displayWidth,
			displayHeight: options.displayHeight,
			input: this.input,
			storage: this.storage,
		});
	}

	public boot(): void {
		this.api.cartdata(this.cart.meta.persistentId);
		const displaySize = { x: this.api.displayWidth(), y: this.api.displayHeight() };
		$.view.canvasSize = { ...displaySize };
		const displayWidth = Math.round($.view.canvasSize.x * $.view.canvasScale);
		const displayHeight = Math.round($.view.canvasSize.y * $.view.canvasScale);
		const displayLeft = Math.round(($.view.windowSize.x - displayWidth) / 2);
		const displayTop = Math.round(($.view.windowSize.y - displayHeight) / 2);
		$.view.surface.setDisplaySize(displayWidth, displayHeight);
		$.view.surface.setDisplayPosition(displayLeft, displayTop);
		$.view.handleResize();
		this.cart.init(this.api);
	}

	public frame(deltaMilliseconds: number): void {
		if (!Number.isFinite(deltaMilliseconds) || deltaMilliseconds < 0) {
			throw new Error('[BmsxConsoleRuntime] Delta time must be a finite non-negative number.');
		}
		const deltaSeconds = deltaMilliseconds / 1000;
		this.input.beginFrame(this.frameCounter);
		this.api.beginFrame(this.frameCounter, deltaSeconds);
		this.cart.update(this.api, deltaSeconds);
		this.cart.draw(this.api);
		this.frameCounter += 1;
	}

	public getApi(): BmsxConsoleApi {
		return this.api;
	}
}
