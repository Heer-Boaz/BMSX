import { $, $rompack, runGate } from '../core/game';
import type { color, RectRenderSubmission, RenderLayer } from '../render/shared/render_types';
import { Msx1Colors } from '../systems/msx';
import { ConsoleFont } from './font';
import { BmsxConsoleInput } from './input';
import { BmsxConsoleStorage } from './storage';
import { BmsxConsoleButton, BmsxConsolePointerButton, ConsolePointerVector, ConsolePointerViewport, ConsolePointerWheel } from './types';
import { ConsoleSpriteRegistry, ConsoleTilemap, type SpriteColliderConfig, type SpriteDefinition, type SpritePhysicsConfig } from './sprites';
import { ConsoleColliderManager, type ColliderCreateOptions, type ColliderContactInfo } from './collision';
import { Physics2DManager } from '../physics/physics2d';
import type { RandomModulationParams, ModulationParams, SoundMasterPlayRequest } from '../audio/soundmaster';
import type { Area, BoundingBoxPrecalc, HitPolygonsPrecalc, Polygon, ImgMeta, Identifier, Registerable, RomPack } from '../rompack/rompack';
import type { World } from '../core/world';
import type { Registry } from '../core/registry';
import { Service } from '../core/service';
import type { EventEmitter, EventPayload } from '../core/eventemitter';
import { EventTimeline } from '../core/eventtimeline';
import type { WorldObject } from '../core/object/worldobject';
import type { Game } from '../core/game';
import type { StateMachineBlueprint } from '../fsm/fsmtypes';
import { taskGate, GateGroup } from '../core/taskgate';
import { StateDefinitionBuilders } from '../fsm/fsmdecorators';
import { setupFSMlibrary } from '../fsm/fsmlibrary';
import { DirectConsoleRenderBackend, type ConsoleRenderBackend, type SpriteCommand } from './render_backend';

type AudioPlayOptions = RandomModulationParams | ModulationParams | SoundMasterPlayRequest | undefined;

export type BmsxConsoleApiOptions = {
	input: BmsxConsoleInput;
	storage: BmsxConsoleStorage;
	colliders: ConsoleColliderManager;
	physics: Physics2DManager;
};

const DRAW_LAYER: RectRenderSubmission['layer'] = 'ui';
const CONSOLE_TAB_SPACES = 2;

export class BmsxConsoleApi {
	private readonly input: BmsxConsoleInput;
	private readonly storage: BmsxConsoleStorage;
	private readonly font: ConsoleFont;
	private readonly spriteRegistry: ConsoleSpriteRegistry;
	private readonly tilemap: ConsoleTilemap;
	private readonly colliders: ConsoleColliderManager;
	private readonly physics: Physics2DManager;
	private readonly spriteCommandsById = new Map<string, SpriteCommand>();
	private readonly pendingVelocities = new Map<string, { vx: number; vy: number }>();
	private readonly pendingPositions = new Map<string, { x: number; y: number }>();
	private frameIndex: number = 0;
	private deltaSecondsValue: number = 0;
	private spriteInstanceSerial = 0;
private renderBackend: ConsoleRenderBackend = new DirectConsoleRenderBackend();

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
		this.colliders = options.colliders;
		this.physics = options.physics;
		this.physics.bindColliders(this.colliders);
	}

	public setRenderBackend(backend: ConsoleRenderBackend | null): void {
		this.renderBackend = backend ?? new DirectConsoleRenderBackend();
	}

	public beginFrame(frame: number, deltaSeconds: number): void {
		if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
			throw new Error('[BmsxConsoleApi] Delta seconds must be a finite non-negative number.');
		}
		this.frameIndex = frame;
		this.deltaSecondsValue = deltaSeconds;
		this.renderBackend.beginFrame();
	}

	public beginPausedFrame(frame: number): void {
		this.frameIndex = frame;
		this.deltaSecondsValue = 0;
		this.renderBackend.beginFrame();
	}

	public endFrame(): void {
		this.renderBackend.endFrame();
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

	public mousebtn(button: BmsxConsolePointerButton): boolean {
		return this.input.pointerButton(button);
	}

	public mousebtnp(button: BmsxConsolePointerButton): boolean {
		return this.input.pointerButtonPressed(button);
	}

	public mousebtnr(button: BmsxConsolePointerButton): boolean {
		return this.input.pointerButtonReleased(button);
	}

	public mousepos(): ConsolePointerViewport {
		return this.pointerViewportPosition();
	}

	public pointerScreenPosition(): ConsolePointerVector {
		return this.input.pointerPosition();
	}

	public pointerDelta(): ConsolePointerVector {
		return this.input.pointerDelta();
	}

	public pointerViewportPosition(): ConsolePointerViewport {
		return this.pointerViewportPositionInternal();
	}

	public mousewheel(): ConsolePointerWheel {
		return this.input.pointerWheel();
	}

	public stat(index: number): number {
		if (!Number.isFinite(index)) {
			throw new Error('[BmsxConsoleApi] stat index must be finite.');
		}
		const value = Math.trunc(index);
		switch (value) {
			case 32: {
				const viewport = this.pointerViewportPositionInternal();
				if (!viewport.valid) {
					return 0;
				}
				return Math.floor(viewport.x);
			}
			case 33: {
				const viewport = this.pointerViewportPositionInternal();
				if (!viewport.valid) {
					return 0;
				}
				return Math.floor(viewport.y);
			}
			case 34: {
				return this.computePointerButtonMask();
			}
			case 36: {
				const wheel = this.input.pointerWheel();
				if (!wheel.valid) {
					return 0;
				}
				return Math.floor(wheel.value);
			}
			default:
				return 0;
		}
	}

	public cls(colorIndex: number = 0): void {
		const color = this.paletteColor(colorIndex);
		this.renderBackend.drawRect({
			kind: 'fill',
			x0: 0,
			y0: 0,
			x1: this.displayWidth,
			y1: this.displayHeight,
			color,
			layer: DRAW_LAYER,
		});
	}

	public rect(x0: number, y0: number, x1: number, y1: number, colorIndex: number): void {
		this.renderBackend.drawRect({ kind: 'rect', x0, y0, x1, y1, color: this.paletteColor(colorIndex), layer: DRAW_LAYER });
	}

	public rectfill(x0: number, y0: number, x1: number, y1: number, colorIndex: number): void {
		this.renderBackend.drawRect({ kind: 'fill', x0, y0, x1, y1, color: this.paletteColor(colorIndex), layer: DRAW_LAYER });
	}

	public rectfillColor(x0: number, y0: number, x1: number, y1: number, colorValue: color): void {
		this.renderBackend.drawRect({ kind: 'fill', x0, y0, x1, y1, color: colorValue, layer: DRAW_LAYER });
	}

	public print(text: string, x: number, y: number, colorIndex: number): void {
		const color = this.paletteColor(colorIndex);
		const baseX = Math.floor(x);
		let cursorY = Math.floor(y);
		const lines = text.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const expanded = this.expandTabs(lines[i]);
			if (expanded.length > 0) {
				this.renderBackend.drawText({ kind: 'print', text: expanded, x: baseX, y: cursorY, color }, this.font);
			}
			if (i < lines.length - 1) {
				cursorY += this.font.lineHeight();
			}
		}
	}

	public spr(sprite: number | string, x: number, y: number, options?: { id?: string; scale?: number; layer?: RenderLayer; flipH?: boolean; flipV?: boolean }): void {
		const scale = options?.scale ?? 1;
		const flipH = options?.flipH ?? false;
		const flipV = options?.flipV ?? false;
		const layer = options?.layer ?? DRAW_LAYER;
		const spriteId = options?.id ?? null;
		let command: SpriteCommand;
		if (typeof sprite === 'number') {
			const def = this.spriteRegistry.require(sprite);
			const baseX = x - def.originX * scale;
			const baseY = y - def.originY * scale;
			command = {
				kind: 'sprite',
				imgId: def.bitmapId,
				spriteIndex: sprite,
				originX: def.originX,
				originY: def.originY,
				baseX,
				baseY,
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
				positionDirty: false,
				colorize: undefined,
			};
		} else {
			const baseX = x;
			const baseY = y;
			command = {
				kind: 'sprite',
				imgId: sprite,
				spriteIndex: null,
				originX: 0,
				originY: 0,
				baseX,
				baseY,
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
				positionDirty: false,
				colorize: undefined,
			};
		}
		this.submitSpriteCommand(command);
		this.renderBackend.drawSprite(command);
		this.syncSpriteCollider(command);
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
			this.pendingPositions.set(id, { x, y });
			return;
		}
		this.setCommandPosition(command, x, y);
		command.positionDirty = true;
		this.pendingPositions.delete(id);
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
		this.physics.ensureBody(id, { isStatic: true, restitution: 1, mass: Infinity });
	}

	public colliderDestroy(id: string): void {
		this.colliders.remove(id);
		this.physics.removeBody(id);
		this.pendingVelocities.delete(id);
	}

	public colliderClear(): void {
		this.colliders.clear();
		this.physics.clear();
		this.pendingVelocities.clear();
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

	public spriteSetVelocity(id: string, vx: number, vy: number): void {
		if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
			throw new Error('[BmsxConsoleApi] Velocity components must be finite.');
		}
		this.pendingVelocities.set(id, { vx, vy });
		if (this.physics.hasBody(id)) {
			this.physics.setVelocity(id, vx, vy);
		}
	}

	public spriteVelocity(id: string): { vx: number; vy: number } {
		return this.physics.getVelocity(id);
	}

	public spriteCenter(id: string): { x: number; y: number } | null {
		if (!this.colliders.has(id)) return null;
		if (!this.physics.hasBody(id)) return null;
		return this.physics.getCenter(id);
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

	public world(): World {
		return $.world;
	}

	public worldObject(id: Identifier): WorldObject | null {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error('[BmsxConsoleApi] worldObject id must be a non-empty string.');
		}
		return $.world.getFromCurrentSpace(id);
	}

	public worldObjects(): WorldObject[] {
		return $.world.allObjectsFromSpaces;
	}

	public registry(): Registry {
		return $.registry;
	}

	public registryIds(): Identifier[] {
		return $.registry.getRegisteredEntityIds();
	}

	public registryGet(id: Identifier): Registerable | null {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error('[BmsxConsoleApi] registryGet id must be a non-empty string.');
		}
		return $.registry.get(id);
	}

	public services(): Service[] {
		return Array.from($.registry.iterate(Service));
	}

	public service(id: Identifier): Service | null {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error('[BmsxConsoleApi] service id must be a non-empty string.');
		}
		return $.registry.get<Service>(id);
	}

	public game(): Game {
		return $;
	}

	public rompack(): RomPack | undefined {
		return $rompack;
	}

	public events(): EventEmitter {
		return $.event_emitter;
	}

	public emit(eventName: string, payload?: EventPayload, emitterId?: Identifier): void {
		if (typeof eventName !== 'string' || eventName.length === 0) {
			throw new Error('[BmsxConsoleApi] emit requires a non-empty event name.');
		}
		let emitter: Registerable | null = null;
		if (typeof emitterId === 'string' && emitterId.length > 0) {
			emitter = $.registry.get(emitterId);
		}
		$.emit(eventName, (emitter as any) ?? null, payload);
	}

	public emitGameplay(eventName: string, emitterId: Identifier, payload?: EventPayload): void {
		if (typeof eventName !== 'string' || eventName.length === 0) {
			throw new Error('[BmsxConsoleApi] emitGameplay requires a non-empty event name.');
		}
		if (typeof emitterId !== 'string' || emitterId.length === 0) {
			throw new Error('[BmsxConsoleApi] emitGameplay requires a non-empty emitter id.');
		}
		const emitter = $.registry.get(emitterId);
		if (!emitter) {
			throw new Error(`[BmsxConsoleApi] Emitter '${emitterId}' not found.`);
		}
		$.emitGameplay(eventName, emitter as any, payload);
	}

	public emitPresentation(eventName: string, emitterId: Identifier | null, payload?: EventPayload): void {
		if (typeof eventName !== 'string' || eventName.length === 0) {
			throw new Error('[BmsxConsoleApi] emitPresentation requires a non-empty event name.');
		}
		const emitter = emitterId ? $.registry.get(emitterId) : null;
		$.emitPresentation(eventName, emitter, payload);
	}

	public timelines(): EventTimeline[] {
		return Array.from($.registry.iterate(EventTimeline));
	}

	public taskgate(name: string): GateGroup {
		if (typeof name !== 'string' || name.length === 0) {
			throw new Error('[BmsxConsoleApi] taskgate requires a non-empty group name.');
		}
		return taskGate.group(name);
	}

	public runGate(): GateGroup {
		return runGate;
	}

	public registerFsm(id: string, blueprint: Record<string, unknown>): void {
		const trimmed = typeof id === 'string' ? id.trim() : '';
		if (trimmed.length === 0) {
			throw new Error('[BmsxConsoleApi] registerFsm id must be a non-empty string.');
		}
		if (typeof blueprint !== 'object' || blueprint === null) {
			throw new Error('[BmsxConsoleApi] registerFsm blueprint must be a table/object.');
		}
		const prepared = this.cloneStateMachineData(blueprint);
		this.registerPreparedFsm(trimmed, prepared);
	}

	public registerPreparedFsm(id: string, blueprint: StateMachineBlueprint, options?: { setup?: boolean }): void {
		const trimmed = typeof id === 'string' ? id.trim() : '';
		if (trimmed.length === 0) {
			throw new Error('[BmsxConsoleApi] registerPreparedFsm id must be a non-empty string.');
		}
		if (typeof blueprint !== 'object' || blueprint === null) {
			throw new Error('[BmsxConsoleApi] registerPreparedFsm blueprint must be an object.');
		}
		this.setFsmBlueprintFactory(trimmed, blueprint);
		if (!options || options.setup !== false) {
			setupFSMlibrary();
		}
	}

	public defineSprite(index: number, bitmapId: string, opts?: { width?: number; height?: number; originX?: number; originY?: number; flags?: number; collider?: SpriteColliderConfig | null; physics?: SpritePhysicsConfig | null }): void {
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

	private setFsmBlueprintFactory(id: string, blueprint: StateMachineBlueprint): void {
		const snapshot = this.cloneStateMachineData(blueprint);
		StateDefinitionBuilders[id] = () => this.cloneStateMachineData(snapshot);
	}

	private cloneStateMachineData<T>(source: T): T {
		return JSON.parse(JSON.stringify(source)) as T;
	}

	private submitSpriteCommand(command: SpriteCommand): void {
		if (command.instanceId === '') {
			command.instanceId = this.allocateSpriteInstanceId();
		}
		if (command.colliderId === '') {
			command.colliderId = this.generateSpriteColliderId(command);
		}
		if (command.spriteId !== null) {
			const existing = this.spriteCommandsById.get(command.spriteId);
			if (existing) {
				this.releaseSpriteCollider(existing);
			}
			this.spriteCommandsById.set(command.spriteId, command);
			const pending = this.pendingPositions.get(command.spriteId);
			if (pending && command.spriteIndex !== null) {
				this.setCommandPosition(command, pending.x, pending.y);
				command.positionDirty = true;
				this.pendingPositions.delete(command.spriteId);
			}
		}
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

	private pointerViewportPositionInternal(): ConsolePointerViewport {
		const screen = this.input.pointerPosition();
		if (!screen.valid) {
			return { x: 0, y: 0, valid: false, inside: false };
		}
		const view = $.view;
		if (!view) {
			throw new Error('[BmsxConsoleApi] Game view not initialised.');
		}
		const rect = view.surface.measureDisplay();
		const width = rect.width;
		const height = rect.height;
		if (width <= 0 || height <= 0) {
			return { x: 0, y: 0, valid: false, inside: false };
		}
		const relativeX = screen.x - rect.left;
		const relativeY = screen.y - rect.top;
		const inside = relativeX >= 0 && relativeX < width && relativeY >= 0 && relativeY < height;
		const viewportX = (relativeX / width) * this.displayWidth;
		const viewportY = (relativeY / height) * this.displayHeight;
		return { x: viewportX, y: viewportY, valid: true, inside };
	}

	private computePointerButtonMask(): number {
		let mask = 0;
		if (this.input.pointerButton(BmsxConsolePointerButton.Primary)) {
			mask |= 1;
		}
		if (this.input.pointerButton(BmsxConsolePointerButton.Secondary)) {
			mask |= 2;
		}
		if (this.input.pointerButton(BmsxConsolePointerButton.Auxiliary)) {
			mask |= 4;
		}
		if (this.input.pointerButton(BmsxConsolePointerButton.Back)) {
			mask |= 8;
		}
		if (this.input.pointerButton(BmsxConsolePointerButton.Forward)) {
			mask |= 16;
		}
		return mask;
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
	const existing = command.positionDirty ? null : this.colliders.get(command.colliderId);
	if (existing) {
		const state = this.colliders.getState(command.colliderId);
		command.baseX = state.centerX - build.width / 2;
		command.baseY = state.centerY - build.height / 2;
		command.drawX = command.baseX + command.originX * command.scale;
		command.drawY = command.baseY + command.originY * command.scale;
	}
	const centerX = command.baseX + build.width / 2;
	const centerY = command.baseY + build.height / 2;
	this.colliders.setPosition(command.colliderId, centerX, centerY);
	command.positionDirty = false;
	this.configurePhysicsBody(command, definition);
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
		const meta = this.getSpriteMeta(definition.bitmapId);
		const baseWidth = meta?.width ?? definition.width;
		const baseHeight = meta?.height ?? definition.height;
		const width = baseWidth * scale;
		const height = baseHeight * scale;
		if (!(width > 0) || !(height > 0)) {
			throw new Error(`[BmsxConsoleApi] Sprite ${command.spriteIndex ?? -1} metadata width/height must be positive.`);
		}
		const boundingSource = meta?.boundingbox ?? this.defaultBoundingBox(baseWidth, baseHeight);
		const bounding = this.selectBounding(boundingSource, command.flipH, command.flipV);
		const polygonsSource = meta?.hitpolygons ?? null;
		const polygons = polygonsSource ? this.selectPolygons(polygonsSource, command.flipH, command.flipV) : null;
		const scaledArea = this.scaleArea(bounding, scale);
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

	private setCommandPosition(command: SpriteCommand, x: number, y: number): void {
		command.drawX = x;
		command.drawY = y;
		const originX = command.originX;
		const originY = command.originY;
		command.baseX = x - originX * command.scale;
		command.baseY = y - originY * command.scale;
	}

	private configurePhysicsBody(command: SpriteCommand, definition: SpriteDefinition): void {
		const physicsConfig = definition.physics;
		if (physicsConfig === null) {
			if (this.physics.hasBody(command.colliderId)) {
				this.physics.removeBody(command.colliderId);
			}
			this.pendingVelocities.delete(command.colliderId);
			return;
		}
		this.physics.ensureBody(command.colliderId, {
			mass: physicsConfig.mass,
			restitution: physicsConfig.restitution,
			gravityScale: physicsConfig.gravityScale,
			maxSpeed: physicsConfig.maxSpeed,
			isStatic: physicsConfig.isStatic,
		});
		if (physicsConfig.isStatic) {
			this.pendingVelocities.delete(command.colliderId);
			return;
		}
		const pending = this.pendingVelocities.get(command.colliderId);
		if (pending) {
			this.physics.setVelocity(command.colliderId, pending.vx, pending.vy);
			this.pendingVelocities.delete(command.colliderId);
		}
	}
	private getSpriteMeta(bitmapId: string): ImgMeta | null {
		const entry = $rompack?.img?.[bitmapId] ?? null;
		if (!entry || !entry.imgmeta) {
			return null;
		}
		return entry.imgmeta as ImgMeta;
	}

	private selectBounding(box: BoundingBoxPrecalc, flipH: boolean, flipV: boolean): Area {
		if (flipH && flipV) return box.fliphv;
		if (flipH) return box.fliph;
		if (flipV) return box.flipv;
		return box.original;
	}

	private defaultBoundingBox(width: number, height: number): BoundingBoxPrecalc {
		const original = this.makeArea(0, 0, width, height);
		return {
			original,
			fliph: this.makeArea(0, 0, width, height),
			flipv: this.makeArea(0, 0, width, height),
			fliphv: this.makeArea(0, 0, width, height),
		};
	}

	private selectPolygons(polys: HitPolygonsPrecalc, flipH: boolean, flipV: boolean): Polygon[] {
		if (flipH && flipV) return polys.fliphv;
		if (flipH) return polys.fliph;
		if (flipV) return polys.flipv;
		return polys.original;
	}

	private makeArea(x0: number, y0: number, x1: number, y1: number): Area {
		return {
			start: { x: x0, y: y0 },
			end: { x: x1, y: y1 },
		};
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

private expandTabs(text: string): string {
		if (text.indexOf('\t') === -1) {
			return text;
		}
		let result = '';
		for (let i = 0; i < text.length; i++) {
			const ch = text.charAt(i);
			if (ch === '\t') {
				for (let j = 0; j < CONSOLE_TAB_SPACES; j++) {
					result += ' ';
				}
			} else {
				result += ch;
			}
		}
		return result;
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
