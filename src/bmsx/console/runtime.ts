import type { StorageService } from '../platform/platform';
import { BmsxConsoleApi } from './api';
import { BmsxConsoleInput } from './input';
import { BmsxConsoleStorage } from './storage';
import { ConsoleColliderManager } from './collision';
import { Physics2DManager } from '../physics/physics2d';
import type { BmsxConsoleCartridge } from './types';

export type BmsxConsoleRuntimeOptions = {
	cart: BmsxConsoleCartridge;
	storage: StorageService;
	playerIndex: number;
	physics: Physics2DManager;
};

export class BmsxConsoleRuntime {
	private readonly cart: BmsxConsoleCartridge;
	private readonly api: BmsxConsoleApi;
	private readonly input: BmsxConsoleInput;
	private readonly storage: BmsxConsoleStorage;
	private readonly colliders: ConsoleColliderManager;
	private readonly physics: Physics2DManager;
	private frameCounter = 0;

	constructor(options: BmsxConsoleRuntimeOptions) {
		this.cart = options.cart;
		this.input = new BmsxConsoleInput(options.playerIndex);
		this.storage = new BmsxConsoleStorage(options.storage, options.cart.meta.persistentId);
		this.colliders = new ConsoleColliderManager();
		this.physics = options.physics;
		this.physics.clear();
		this.api = new BmsxConsoleApi({
			input: this.input,
			storage: this.storage,
			colliders: this.colliders,
			physics: this.physics,
		});
	}

	public boot(): void {
		this.physics.clear();
		this.api.cartdata(this.cart.meta.persistentId);
		this.api.colliderClear();
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
	this.physics.step(deltaSeconds);
	this.frameCounter += 1;
}

	public getApi(): BmsxConsoleApi {
		return this.api;
	}
}
