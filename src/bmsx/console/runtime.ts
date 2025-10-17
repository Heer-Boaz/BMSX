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
	private frameCounter: number = 0;

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
		this.cart.init(this.api);
	}

	public frame(deltaMilliseconds: number): void {
		if (!Number.isFinite(deltaMilliseconds) || deltaMilliseconds < 0) {
			throw new Error('[BmsxConsoleRuntime] Delta time must be a finite non-negative number.');
		}
		const deltaSeconds = deltaMilliseconds / 1000;
		this.api.beginFrame(this.frameCounter, deltaSeconds);
		this.cart.update(this.api, deltaSeconds);
		this.cart.draw(this.api);
		this.frameCounter += 1;
	}

	public getApi(): BmsxConsoleApi {
		return this.api;
	}
}
