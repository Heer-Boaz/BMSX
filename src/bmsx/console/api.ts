import { $, $rompack } from '../core/game';
import type { color, RectRenderSubmission, RenderLayer } from '../render/shared/render_types';
import { Msx1Colors } from '../systems/msx';
import { new_area3d } from '../utils/utils';
import { ConsoleFont } from './font';
import type { ConsoleGlyph } from './font';
import { BmsxConsoleInput } from './input';
import { BmsxConsoleStorage } from './storage';
import { BmsxConsoleButton } from './types';
import { ConsoleSpriteRegistry, ConsoleTilemap, SpriteColliderConfig, SpriteDefinition } from './sprites';
import { ConsoleColliderManager, type ColliderCreateOptions, type ColliderContactInfo } from './collision';
import type { RandomModulationParams, ModulationParams, SoundMasterPlayRequest } from '../audio/soundmaster';
import type { Area, BoundingBoxPrecalc, HitPolygonsPrecalc, Polygon } from '../rompack/rompack';

type AudioPlayOptions = RandomModulationParams | ModulationParams | SoundMasterPlayRequest | undefined;

export type BmsxConsoleApiOptions = {
	input: BmsxConsoleInput;
	storage: BmsxConsoleStorage;
};

const DRAW_LAYER: RectRenderSubmission['layer'] = 'ui';

type RectCommand = {
	kind: 'rect' | 'fill';
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	color: color;
	layer?: RenderLayer;
};

type PrintCommand = {
	kind: 'print';
	text: string;
	x: number;
	y: number;
	color: color;
};

type SpriteCommand = {
	kind: 'sprite';
	imgId: string;
	spriteIndex: number | null;
	x: number;
	y: number;
	drawX: number;
	drawY: number;
	scale: number;
	layer?: RenderLayer;
	flipH: boolean;
	flipV: boolean;
	spriteId: string | null;
	instanceId: string;
	colliderId: string;
	width: number;
	height: number;
};

type DrawCommand = RectCommand | PrintCommand | SpriteCommand;

export class BmsxConsoleApi {
	private readonly input: BmsxConsoleInput;
	private readonly storage: BmsxConsoleStorage;
	private readonly font: ConsoleFont;
	private readonly spriteRegistry: ConsoleSpriteRegistry;
	private readonly tilemap: ConsoleTilemap;
	private readonly colliders: ConsoleColliderManager;
	private readonly commands: DrawCommand[] = [];
	private readonly spriteCommandsById = new Map<string, SpriteCommand>();
	private writeCursor = 0;
	private frameIndex: number = 0;
	private deltaSecondsValue: number = 0;
	private spriteInstanceSerial = 0;

	constructor(options: BmsxConsoleApiOptions) {
		const view = $.view;
		if (!view) {
			throw new Error('[BmsxConsoleApi] Game view not initialised.');
		}
		const viewport = view.viewportSize;
		if (viewport.x <= 0 || viewport.y <= 0) {
			throw new Error('[BmsxConsoleApi] Invalid viewport size.');
		}
		this.input = options.input;
		this.storage = options.storage;
		this.font = new ConsoleFont();
		this.spriteRegistry = new ConsoleSpriteRegistry();
		this.tilemap = new ConsoleTilemap(this.spriteRegistry);
		this.colliders = new ConsoleColliderManager();
	}

	public beginFrame(frame: number, deltaSeconds: number): void {
		if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
			throw new Error('[BmsxConsoleApi] Delta seconds must be a finite non-negative number.');
		}
		this.frameIndex = frame;
		this.deltaSecondsValue = deltaSeconds;
		this.writeCursor = 0;
		this.replayCommands();
	}

	public frameNumber(): number {
		return this.frameIndex;
	}

	public deltaSeconds(): number {
		return this.deltaSecondsValue;
	}

	public get displayWidth(): number {
		return $.view.viewportSize.x;
	}

	public get displayHeight(): number {
		return $.view.viewportSize.y;
	}

	public btn(button: BmsxConsoleButton): boolean {
		return this.input.btn(button);
	}

	public btnp(button: BmsxConsoleButton): boolean {
		return this.input.btnp(button);
	}

	public cls(colorIndex: number = 0): void {
		const command: RectCommand = {
			kind: 'fill',
			x0: 0,
			y0: 0,
			x1: this.displayWidth,
			y1: this.displayHeight,
			color: this.paletteColor(colorIndex),
			layer: DRAW_LAYER,
		};
		this.clearCommandHistory();
		this.recordCommand(command);
	}

	public rect(x0: number, y0: number, x1: number, y1: number, colorIndex: number): void {
		const command: RectCommand = {
			kind: 'rect',
			x0,
			y0,
			x1,
			y1,
			color: this.paletteColor(colorIndex),
			layer: DRAW_LAYER,
		};
		this.recordCommand(command);
	}

	public rectfill(x0: number, y0: number, x1: number, y1: number, colorIndex: number): void {
		const command: RectCommand = {
			kind: 'fill',
			x0,
			y0,
			x1,
			y1,
			color: this.paletteColor(colorIndex),
			layer: DRAW_LAYER,
		};
		this.recordCommand(command);
	}

	public print(text: string, x: number, y: number, colorIndex: number): void {
		const command: PrintCommand = {
			kind: 'print',
			text,
			x,
			y,
			color: this.paletteColor(colorIndex),
		};
		this.recordCommand(command);
	}

	public spr(sprite: number | string, x: number, y: number, options?: { id?: string; scale?: number; layer?: RenderLayer; flipH?: boolean; flipV?: boolean }): void {
		const scale = options?.scale ?? 1;
		const flipH = options?.flipH ?? false;
		const flipV = options?.flipV ?? false;
		const layer = options?.layer ?? DRAW_LAYER;
		const spriteId = options?.id ?? null;
		if (typeof sprite === 'number') {
			const def = this.spriteRegistry.require(sprite);
			const command: SpriteCommand = {
				kind: 'sprite',
				imgId: def.bitmapId,
				spriteIndex: sprite,
				x: x - def.originX * scale,
				y: y - def.originY * scale,
				drawX: x,
				drawY: y,
				scale,
				layer,
				flipH,
				flipV,
				spriteId,
				instanceId: '',
				colliderId: '',
				width: 0,
				height: 0,
			};
			this.recordCommand(command);
			return;
		}
		const command: SpriteCommand = {
			kind: 'sprite',
			imgId: sprite,
			spriteIndex: null,
			x,
			y,
			drawX: x,
			drawY: y,
			scale,
			layer,
			flipH,
			flipV,
			spriteId,
			instanceId: '',
			colliderId: '',
			width: 0,
			height: 0,
		};
		this.recordCommand(command);
	}

	public spriteExists(id: string): boolean {
		if (!id) {
			throw new Error('[BmsxConsoleApi] Sprite id must be a non-empty string.');
		}
		return this.spriteCommandsById.has(id);
	}

	public spriteSetPosition(id: string, x: number, y: number): void {
		if (!id) {
			throw new Error('[BmsxConsoleApi] Sprite id must be a non-empty string.');
		}
		const command = this.spriteCommandsById.get(id);
		if (!command || command.spriteIndex === null) {
			return;
		}
		const definition = this.spriteRegistry.require(command.spriteIndex);
		const scale = command.scale;
		command.drawX = x;
		command.drawY = y;
		command.x = x - definition.originX * scale;
		command.y = y - definition.originY * scale;
		this.syncSpriteCollider(command);
	}

	public cartdata(namespace: string): void {
		this.storage.setNamespace(namespace);
	}

	public dset(index: number, value: number): void {
		this.storage.setValue(index, value);
	}

	public dget(index: number): number {
		return this.storage.getValue(index);
	}

	public colliderCreate(id: string, opts: ColliderCreateOptions): void {
		this.colliders.create(id, opts);
	}

	public colliderDestroy(id: string): void {
		this.colliders.remove(id);
	}

	public colliderClear(): void {
		this.colliders.clear();
	}

	public colliderSetPosition(id: string, x: number, y: number): void {
		this.colliders.setPosition(id, x, y);
	}

	public colliderOverlap(aId: string, bId: string): boolean {
		return this.colliders.overlap(aId, bId);
	}

	public colliderContact(aId: string, bId: string): ColliderContactInfo | null {
		return this.colliders.contact(aId, bId);
	}

	public sfx(id: string, options?: AudioPlayOptions): void {
		$.playAudio(id, options);
	}

	public stopSfx(): void {
		$.sndmaster.stopEffect();
	}

	public music(id: string | null, options?: AudioPlayOptions): void {
		if (!id) {
			$.sndmaster.stopMusic();
			return;
		}
		$.sndmaster.stopMusic();
		void $.sndmaster.play(id, options as SoundMasterPlayRequest | ModulationParams | RandomModulationParams | undefined);
	}

	public stopMusic(): void {
		$.sndmaster.stopMusic();
	}

	public setMasterVolume(volume: number): void {
		$.sndmaster.volume = volume;
	}

	public pauseAudio(): void {
		$.sndmaster.pause();
	}

	public resumeAudio(): void {
		$.sndmaster.resume();
	}

	public defineSprite(index: number, bitmapId: string, opts?: { width?: number; height?: number; originX?: number; originY?: number; flags?: number; collider?: SpriteColliderConfig | null }): void {
		this.spriteRegistry.defineSprite(index, bitmapId, opts);
	}

	public fset(index: number, flag: number, value: boolean): void {
		this.spriteRegistry.fset(index, flag, value);
	}

	public fget(index: number, flag?: number): boolean | number {
		return this.spriteRegistry.fget(index, flag);
	}

	public loadMap(data: number[], width: number, height: number, tileSize?: { width: number; height: number }): void {
		this.tilemap.load(data, width, height, tileSize);
	}

	public setTileSize(width: number, height: number): void {
		this.tilemap.setTileSize(width, height);
	}

	public mget(mapX: number, mapY: number): number {
		return this.tilemap.mget(mapX, mapY);
	}

	public mset(mapX: number, mapY: number, spriteIndex: number): void {
		this.tilemap.mset(mapX, mapY, spriteIndex);
	}

	public map(mapX: number, mapY: number, screenX: number, screenY: number, width: number, height: number, layer?: RenderLayer): void {
		this.tilemap.draw(mapX, mapY, screenX, screenY, width, height, (definition: SpriteDefinition, x: number, y: number) => {
			this.spr(definition.id, x, y, { layer });
		});
	}

	public mapCollidesRect(x: number, y: number, width: number, height: number, flagBit: number = 0): boolean {
		return this.tilemap.isRectFlagged(x, y, width, height, flagBit);
	}

	public getTileDimensions(): { width: number; height: number; } {
		return { width: this.tilemap.tileWidthPixels, height: this.tilemap.tileHeightPixels };
	}

	private recordCommand(command: DrawCommand): void {
		const existing = this.writeCursor < this.commands.length ? this.commands[this.writeCursor] : null;
		if (existing && existing.kind === 'sprite') {
			if (command.kind === 'sprite') {
				this.prepareSpriteReplacement(existing, command);
			} else {
				this.disposeSpriteCommand(existing);
			}
		}
		if (this.writeCursor < this.commands.length) {
			this.commands[this.writeCursor] = command;
		} else {
			this.commands.push(command);
		}
		this.writeCursor++;
		if (command.kind === 'sprite') {
			this.registerSpriteCommand(command);
		}
		this.executeCommand(command);
	}

	private prepareSpriteReplacement(existing: SpriteCommand, replacement: SpriteCommand): void {
		this.unregisterSpriteCommand(existing);
		if (this.canReuseSpriteCollider(existing, replacement)) {
			replacement.instanceId = existing.instanceId;
			replacement.colliderId = existing.colliderId;
			return;
		}
		this.releaseSpriteCollider(existing);
		replacement.instanceId = this.allocateSpriteInstanceId();
		replacement.colliderId = this.generateSpriteColliderId(replacement);
	}

	private disposeSpriteCommand(command: SpriteCommand): void {
		this.unregisterSpriteCommand(command);
		this.releaseSpriteCollider(command);
	}

	private registerSpriteCommand(command: SpriteCommand): void {
		if (command.instanceId === '') {
			command.instanceId = this.allocateSpriteInstanceId();
		}
		if (command.colliderId === '') {
			command.colliderId = this.generateSpriteColliderId(command);
		}
		if (command.spriteId !== null) {
			this.spriteCommandsById.set(command.spriteId, command);
		}
	}

	private unregisterSpriteCommand(command: SpriteCommand): void {
		if (command.spriteId === null) return;
		const mapped = this.spriteCommandsById.get(command.spriteId);
		if (mapped === command) {
			this.spriteCommandsById.delete(command.spriteId);
		}
	}

	private canReuseSpriteCollider(existing: SpriteCommand, replacement: SpriteCommand): boolean {
		const existingId = existing.spriteId;
		const replacementId = replacement.spriteId;
		if (existingId === null && replacementId === null) return true;
		if (existingId !== null && replacementId !== null && existingId === replacementId) return true;
		return false;
	}

	private generateSpriteColliderId(command: SpriteCommand): string {
		if (command.spriteId !== null) return command.spriteId;
		return `console_sprite_${command.instanceId}`;
	}

	private allocateSpriteInstanceId(): string {
		const id = `spr_${this.spriteInstanceSerial}`;
		this.spriteInstanceSerial += 1;
		return id;
	}

	private releaseSpriteCollider(command: SpriteCommand): void {
		if (command.colliderId.length === 0) return;
		if (this.colliders.has(command.colliderId)) {
			this.colliders.remove(command.colliderId);
		}
		command.colliderId = '';
	}

	private clearCommandHistory(): void {
		if (this.commands.length > 0) {
			for (const command of this.commands) {
				if (command.kind === 'sprite') {
					this.disposeSpriteCommand(command);
				}
			}
		}
		this.commands.length = 0;
		this.spriteCommandsById.clear();
		this.writeCursor = 0;
	}

	private replayCommands(): void {
		if (this.commands.length === 0) return;
		for (const command of this.commands) {
			this.executeCommand(command);
		}
	}

	private executeCommand(command: DrawCommand): void {
		switch (command.kind) {
			case 'rect':
			case 'fill':
				this.submitRectangle(command.x0, command.y0, command.x1, command.y1, command.color, command.kind, command.layer);
				return;
			case 'print':
				this.renderText(command.text, command.x, command.y, command.color);
				return;
			case 'sprite':
				this.renderSprite(command);
				return;
		}
	}

	private renderSprite(command: SpriteCommand): void {
		$.view.renderer.submit.sprite({
			imgid: command.imgId,
			pos: { x: Math.floor(command.x), y: Math.floor(command.y), z: 0 },
			scale: { x: command.scale, y: command.scale },
			flip: command.flipH || command.flipV ? { flip_h: command.flipH, flip_v: command.flipV } : undefined,
			layer: command.layer ?? DRAW_LAYER,
		});
		this.syncSpriteCollider(command);
	}

	private syncSpriteCollider(command: SpriteCommand): void {
		if (command.spriteIndex === null) {
			if (command.colliderId.length !== 0) {
				this.releaseSpriteCollider(command);
			}
			return;
		}
		const definition = this.spriteRegistry.require(command.spriteIndex);
		const config = definition.collider;
		if (config === null) {
			if (command.colliderId.length !== 0) {
				this.releaseSpriteCollider(command);
			}
			return;
		}
		if (command.instanceId === '') {
			command.instanceId = this.allocateSpriteInstanceId();
		}
		if (command.colliderId === '') {
			command.colliderId = this.generateSpriteColliderId(command);
		}
		const build = this.buildSpriteCollider(definition, command, config);
		command.width = build.width;
		command.height = build.height;
		const collider = this.colliders.upsert(command.colliderId, build.options);
		if (build.geometry) {
			collider.setGeometry(build.geometry.area, build.geometry.polygons);
		}
		const centerX = command.x + build.width / 2;
		const centerY = command.y + build.height / 2;
		this.colliders.setPosition(command.colliderId, centerX, centerY);
	}

	private buildSpriteCollider(definition: SpriteDefinition, command: SpriteCommand, config: SpriteColliderConfig): { options: ColliderCreateOptions; width: number; height: number; geometry: { area: Area | null; polygons: Polygon[] | null } | null } {
		const scale = command.scale;
		if (!(scale > 0)) throw new Error('[BmsxConsoleApi] Sprite scale must be positive.');
		if (config.kind === 'circle') {
			const baseRadius = config.radius !== undefined ? config.radius : Math.max(definition.width, definition.height) / 2;
			const radius = baseRadius * scale;
			if (!(radius > 0)) {
				throw new Error(`[BmsxConsoleApi] Sprite ${command.spriteIndex ?? -1} circle radius must be positive.`);
			}
			return {
				options: {
					kind: 'circle',
					radius,
					layer: config.layer,
					mask: config.mask,
					isTrigger: config.isTrigger ?? false,
				},
				width: radius * 2,
				height: radius * 2,
				geometry: null,
			};
		}
		if (config.kind === 'box') {
			const width = (config.width ?? definition.width) * scale;
			const height = (config.height ?? definition.height) * scale;
			if (!(width > 0) || !(height > 0)) {
				throw new Error(`[BmsxConsoleApi] Sprite ${command.spriteIndex ?? -1} box collider dimensions must be positive.`);
			}
			return {
				options: {
					kind: 'box',
					width,
					height,
					layer: config.layer,
					mask: config.mask,
					isTrigger: config.isTrigger ?? false,
				},
				width,
				height,
				geometry: {
					area: { start: { x: 0, y: 0 }, end: { x: width, y: height } },
					polygons: null,
				},
			};
		}
		const meta = this.requireSpriteMeta(definition.bitmapId);
		const baseWidth = meta.width ?? definition.width;
		const baseHeight = meta.height ?? definition.height;
		const width = baseWidth * scale;
		const height = baseHeight * scale;
		if (!(width > 0) || !(height > 0)) {
			throw new Error(`[BmsxConsoleApi] Sprite ${command.spriteIndex ?? -1} metadata width/height must be positive.`);
		}
		const bounding = meta.boundingbox ? this.selectBounding(meta.boundingbox, command.flipH, command.flipV) : null;
		const polygons = meta.hitpolygons ? this.selectPolygons(meta.hitpolygons, command.flipH, command.flipV) : null;
		const scaledArea = bounding ? this.scaleArea(bounding, scale) : { start: { x: 0, y: 0 }, end: { x: width, y: height } };
		const scaledPolys = polygons ? this.scalePolygons(polygons, scale) : null;
		return {
			options: {
				kind: 'custom',
				width,
				height,
				layer: config.layer,
				mask: config.mask,
				isTrigger: config.isTrigger ?? false,
			},
			width,
			height,
			geometry: {
				area: scaledArea,
				polygons: scaledPolys,
			},
		};
	}
	private requireSpriteMeta(bitmapId: string): { width: number; height: number; boundingbox?: BoundingBoxPrecalc; hitpolygons?: HitPolygonsPrecalc } {
		const entry = $rompack?.img?.[bitmapId] ?? null;
		if (!entry || !entry.imgmeta) {
			throw new Error(`[BmsxConsoleApi] Sprite bitmap '${bitmapId}' metadata not found.`);
		}
		return entry.imgmeta as { width: number; height: number; boundingbox?: BoundingBoxPrecalc; hitpolygons?: HitPolygonsPrecalc };
	}

	private selectBounding(box: BoundingBoxPrecalc, flipH: boolean, flipV: boolean): Area {
		if (flipH && flipV) return box.fliphv;
		if (flipH) return box.fliph;
		if (flipV) return box.flipv;
		return box.original;
	}

	private selectPolygons(polys: HitPolygonsPrecalc, flipH: boolean, flipV: boolean): Polygon[] {
		if (flipH && flipV) return polys.fliphv;
		if (flipH) return polys.fliph;
		if (flipV) return polys.flipv;
		return polys.original;
	}

	private scaleArea(area: Area, scale: number): Area {
		return {
			start: { x: area.start.x * scale, y: area.start.y * scale },
			end: { x: area.end.x * scale, y: area.end.y * scale },
		};
	}

	private scalePolygons(polys: Polygon[], scale: number): Polygon[] {
		return polys.map(poly => {
			const scaled: number[] = [];
			for (let i = 0; i < poly.length; i += 2) {
				scaled.push(poly[i] * scale, poly[i + 1] * scale);
			}
			return scaled;
		});
	}

	private renderText(text: string, originX: number, originY: number, colorRef: color): void {
		let cursorX = Math.floor(originX);
		let cursorY = Math.floor(originY);
		for (let i = 0; i < text.length; i++) {
			const ch = text.charAt(i);
			if (ch === '\n') {
				cursorX = Math.floor(originX);
				cursorY += this.font.lineHeight();
				continue;
			}
			const glyph = this.font.getGlyph(ch);
			this.renderGlyph(glyph, cursorX, cursorY, colorRef);
			cursorX += glyph.advance;
		}
	}

	private renderGlyph(glyph: ConsoleGlyph, originX: number, originY: number, colorRef: color): void {
		for (let i = 0; i < glyph.segments.length; i++) {
			const segment = glyph.segments[i];
			const px = originX + segment.x;
			const py = originY + segment.y;
			this.submitRectangle(px, py, px + segment.length, py + 1, colorRef, 'fill', DRAW_LAYER);
		}
	}

	private submitRectangle(x0: number, y0: number, x1: number, y1: number, color: number | color, kind: 'rect' | 'fill', layer?: RenderLayer): void {
		const colorObj: color = typeof color === 'number' ? this.paletteColor(color) : color;
		const sx = Math.floor(x0);
		const sy = Math.floor(y0);
		const ex = Math.floor(x1);
		const ey = Math.floor(y1);
		const minX = Math.min(sx, ex);
		const maxX = Math.max(sx, ex);
		const minY = Math.min(sy, ey);
		const maxY = Math.max(sy, ey);
		const width = maxX - minX;
		const height = maxY - minY;
		if (width === 0 || height === 0) {
			throw new Error('[BmsxConsoleApi] Rectangles must span at least one pixel in width and height.');
		}
		const area = new_area3d(minX, minY, 0, maxX, maxY, 0);
		$.view.renderer.submit.rect({ kind, area, color: colorObj, layer: layer ?? DRAW_LAYER });
	}

	private paletteColor(index: number): color {
		if (!Number.isInteger(index)) {
			throw new Error('[BmsxConsoleApi] Color index must be an integer.');
		}
		if (index < 0 || index >= Msx1Colors.length) {
			throw new Error(`[BmsxConsoleApi] Color index ${index} outside palette range 0-${Msx1Colors.length - 1}.`);
		}
		return Msx1Colors[index];
	}
}
