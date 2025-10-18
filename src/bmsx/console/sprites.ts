import { $rompack } from '../core/game';
import { clamp } from '../utils/utils';

export type SpriteFlags = number;

export type SpriteColliderConfig =
	| { kind: 'sprite'; layer?: number; mask?: number; isTrigger?: boolean }
	| { kind: 'box'; width?: number; height?: number; layer?: number; mask?: number; isTrigger?: boolean }
	| { kind: 'circle'; radius?: number; layer?: number; mask?: number; isTrigger?: boolean };

export type SpritePhysicsConfig = {
	mass?: number;
	restitution?: number;
	gravityScale?: number;
	maxSpeed?: number | null;
	isStatic?: boolean;
};

export type SpriteDefinition = {
	id: number;
	bitmapId: string;
	width: number;
	height: number;
	originX: number;
	originY: number;
	flags: SpriteFlags;
	collider: SpriteColliderConfig | null;
	physics: SpritePhysicsConfig | null;
};

export class ConsoleSpriteRegistry {
	private readonly sprites = new Map<number, SpriteDefinition>();
	private readonly defaultTileSize = { width: 8, height: 8 };

	public defineSprite(index: number, bitmapId: string, opts?: { width?: number; height?: number; originX?: number; originY?: number; flags?: SpriteFlags; collider?: SpriteColliderConfig | null; physics?: SpritePhysicsConfig | null }): void {
		if (!Number.isInteger(index) || index < 0) {
			throw new Error(`[ConsoleSpriteRegistry] Sprite index '${index}' must be a non-negative integer.`);
		}
		if (!bitmapId || bitmapId.length === 0) {
			throw new Error('[ConsoleSpriteRegistry] Bitmap id must be provided.');
		}
		const meta = $rompack?.img?.[bitmapId]?.imgmeta ?? null;
		const width = opts?.width ?? meta?.width ?? this.defaultTileSize.width;
		const height = opts?.height ?? meta?.height ?? this.defaultTileSize.height;
		if (width <= 0 || height <= 0) {
			throw new Error('[ConsoleSpriteRegistry] Sprite dimensions must be positive.');
		}
		const definition: SpriteDefinition = {
			id: index,
			bitmapId,
			width,
			height,
			originX: opts?.originX ?? 0,
			originY: opts?.originY ?? 0,
			flags: opts?.flags ?? 0,
			collider: this.resolveColliderConfig(opts?.collider),
			physics: this.resolvePhysicsConfig(opts?.physics),
		};
		this.sprites.set(index, definition);
	}

	private resolveColliderConfig(config: SpriteColliderConfig | null | undefined): SpriteColliderConfig | null {
		if (config === undefined) return { kind: 'sprite' };
		if (config === null) return null;
		if (config.kind === 'circle') {
			if (config.radius !== undefined && !(config.radius > 0)) {
				throw new Error('[ConsoleSpriteRegistry] Circular sprite colliders require a positive radius when provided.');
			}
			return {
				kind: 'circle',
				radius: config.radius,
				layer: config.layer,
				mask: config.mask,
				isTrigger: config.isTrigger,
			};
		}
		if (config.kind === 'box') {
			if (config.width !== undefined && !(config.width > 0)) {
				throw new Error('[ConsoleSpriteRegistry] Box sprite colliders require a positive width when provided.');
			}
			if (config.height !== undefined && !(config.height > 0)) {
				throw new Error('[ConsoleSpriteRegistry] Box sprite colliders require a positive height when provided.');
			}
			return {
				kind: 'box',
				width: config.width,
				height: config.height,
				layer: config.layer,
				mask: config.mask,
				isTrigger: config.isTrigger,
			};
		}
		return {
			kind: 'sprite',
			layer: config.layer,
			mask: config.mask,
			isTrigger: config.isTrigger,
		};
	}

	private resolvePhysicsConfig(config: SpritePhysicsConfig | null | undefined): SpritePhysicsConfig | null {
		if (config === undefined) {
			return {
				mass: 1,
				restitution: 1,
				gravityScale: 0,
				maxSpeed: null,
				isStatic: false,
			};
		}
		if (config === null) return null;
		const mass = config.mass ?? 1;
		if (!(mass > 0)) throw new Error('[ConsoleSpriteRegistry] Sprite physics mass must be positive.');
		const restitution = config.restitution ?? 1;
		if (restitution < 0) throw new Error('[ConsoleSpriteRegistry] Sprite physics restitution must be non-negative.');
		const gravityScale = config.gravityScale ?? 0;
		if (!Number.isFinite(gravityScale)) throw new Error('[ConsoleSpriteRegistry] Sprite physics gravity scale must be finite.');
		const maxSpeed = config.maxSpeed ?? null;
		if (maxSpeed !== null && !(maxSpeed > 0)) throw new Error('[ConsoleSpriteRegistry] Sprite physics max speed must be positive when provided.');
		return {
			mass,
			restitution,
			gravityScale,
			maxSpeed,
			isStatic: config.isStatic ?? false,
		};
	}

	public get(index: number): SpriteDefinition | undefined {
		return this.sprites.get(index);
	}

	public require(index: number): SpriteDefinition {
		const def = this.get(index);
		if (!def) throw new Error(`[ConsoleSpriteRegistry] Sprite ${index} not defined.`);
		return def;
	}

	public setFlags(index: number, flags: SpriteFlags): void {
		const def = this.require(index);
		def.flags = flags >>> 0;
	}

	public fset(index: number, flag: number, value: boolean): void {
		if (!Number.isInteger(flag) || flag < 0 || flag > 7) {
			throw new Error('[ConsoleSpriteRegistry] Flag index must be between 0 and 7.');
		}
		const mask = 1 << flag;
		const def = this.require(index);
		if (value) def.flags |= mask;
		else def.flags &= ~mask;
	}

	public fget(index: number, flag?: number): boolean | SpriteFlags {
		const def = this.require(index);
		if (flag === undefined) return def.flags;
		if (!Number.isInteger(flag) || flag < 0 || flag > 7) {
			throw new Error('[ConsoleSpriteRegistry] Flag index must be between 0 and 7.');
		}
		return (def.flags & (1 << flag)) !== 0;
	}
}

export class ConsoleTilemap {
	private tiles: number[] = [];
	private width = 0;
	private height = 0;
	private tileWidth: number = 8;
	private tileHeight: number = 8;

	private readonly sprites: ConsoleSpriteRegistry;

	constructor(sprites: ConsoleSpriteRegistry) {
		this.sprites = sprites;
	}

	public resize(width: number, height: number, fill: number = 0): void {
		if (width <= 0 || height <= 0) {
			throw new Error('[ConsoleTilemap] Width and height must be positive.');
		}
		this.width = Math.floor(width);
		this.height = Math.floor(height);
		this.tiles = new Array(this.width * this.height);
		this.tiles.fill(fill);
	}

	public setTileSize(width: number, height: number): void {
		if (width <= 0 || height <= 0) {
			throw new Error('[ConsoleTilemap] Tile size must be positive.');
		}
		this.tileWidth = Math.floor(width);
		this.tileHeight = Math.floor(height);
	}

	public load(data: number[], width: number, height: number, tileSize?: { width: number; height: number }): void {
		if (data.length !== width * height) {
			throw new Error('[ConsoleTilemap] Data length does not match provided dimensions.');
		}
		this.resize(width, height);
		for (let i = 0; i < data.length; i++) {
			this.tiles[i] = data[i];
		}
		if (tileSize) {
			this.setTileSize(tileSize.width, tileSize.height);
		}
	}

	public mget(mapX: number, mapY: number): number {
		const x = Math.floor(mapX);
		const y = Math.floor(mapY);
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
		return this.tiles[y * this.width + x] ?? 0;
	}

	public mset(mapX: number, mapY: number, spriteIndex: number): void {
		const x = Math.floor(mapX);
		const y = Math.floor(mapY);
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
		this.tiles[y * this.width + x] = spriteIndex;
	}

	public draw(mapX: number, mapY: number, screenX: number, screenY: number, width: number, height: number, draw: (sprite: SpriteDefinition, x: number, y: number) => void): void {
		const startX = clamp(Math.floor(mapX), 0, this.width);
		const startY = clamp(Math.floor(mapY), 0, this.height);
		const endX = clamp(startX + Math.floor(width), 0, this.width);
		const endY = clamp(startY + Math.floor(height), 0, this.height);
		const tileW = this.tileWidth;
		const tileH = this.tileHeight;
		let destY = screenY;
		for (let ty = startY; ty < endY; ty++, destY += tileH) {
			let destX = screenX;
			for (let tx = startX; tx < endX; tx++, destX += tileW) {
				const spriteIndex = this.mget(tx, ty);
				if (spriteIndex === 0) continue;
				const definition = this.sprites.get(spriteIndex);
				if (!definition) continue;
				draw(definition, destX, destY);
			}
		}
	}

	public isRectFlagged(x: number, y: number, width: number, height: number, flagBit: number): boolean {
		if (!Number.isInteger(flagBit) || flagBit < 0 || flagBit > 7) {
			throw new Error('[ConsoleTilemap] Flag bit must be between 0 and 7.');
		}
		const tileW = this.tileWidth;
		const tileH = this.tileHeight;
		const minTileX = clamp(Math.floor(x / tileW), 0, this.width);
		const minTileY = clamp(Math.floor(y / tileH), 0, this.height);
		const maxTileX = clamp(Math.floor((x + width - 1) / tileW), 0, this.width - 1);
		const maxTileY = clamp(Math.floor((y + height - 1) / tileH), 0, this.height - 1);
		for (let ty = minTileY; ty <= maxTileY; ty++) {
			for (let tx = minTileX; tx <= maxTileX; tx++) {
				const spriteIndex = this.mget(tx, ty);
				if (spriteIndex === 0) continue;
				const def = this.sprites.get(spriteIndex);
				if (!def) continue;
				if ((def.flags & (1 << flagBit)) !== 0) return true;
			}
		}
		return false;
	}

	public get mapWidth(): number { return this.width; }
	public get mapHeight(): number { return this.height; }
	public get tileWidthPixels(): number { return this.tileWidth; }
	public get tileHeightPixels(): number { return this.tileHeight; }
}
