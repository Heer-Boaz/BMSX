import { $ } from '../core/game';
import type { WorldObject } from '../core/object/worldobject';
import { ECSystem, TickGroup } from './ecsystem';
import { SpriteAnimationComponent, type SpriteAnimationDefinition } from '../component/sprite_animation_component';
import { SpriteComponent } from '../component/sprite_component';
import { filter_iterable } from '../utils/filter_iterable';

export class SpriteAnimationSystem extends ECSystem {
	constructor(priority = 0) {
		super(TickGroup.Animation, priority);
		this.__ecsId = 'spriteAnimationSystem';
	}

	public override update(): void {
		const world = $.world;
		if (!world) return;
		const deltaSeconds = Number.isFinite($.deltatime) ? $.deltatime_seconds : 0;
		for (const [owner, component] of filter_iterable(world.objects_with_components(SpriteAnimationComponent, { scope: 'active' }), ([obj]) => this.isEligible(obj))) {
			if (!component.pending && component.paused) {
				continue;
			}
			const sprite = this.resolveSprite(owner, component);
			if (!sprite) {
				continue;
			}
			const definition = this.resolveAnimation(component);
			if (!definition) {
				continue;
			}
			const activeDefinition = this.step(component, definition, deltaSeconds);
			const frames = activeDefinition?.frames;
			if (!frames || frames.length === 0) {
				continue;
			}
			const frame = frames[Math.max(0, Math.min(component.frameIndex, frames.length - 1))];
			if (frame) {
				sprite.imgid = frame;
			}
		}
	}

	private step(component: SpriteAnimationComponent, definition: SpriteAnimationDefinition, deltaSeconds: number): SpriteAnimationDefinition | null {
		const pending = component.consumePending();
		let active = definition;
		if (pending) {
			if (pending.restart || component.current !== pending.name) {
				component.current = pending.name;
				component.frameIndex = 0;
				component.elapsed = 0;
			}
			component.paused = false;
			active = this.resolveAnimation(component);
			if (!active) {
				return null;
			}
		}
		if (component.paused) {
			return active;
		}
		const fps = Math.max(1, active.fps ?? 12);
		const duration = 1 / fps;
		let remaining = component.elapsed + Math.max(0, deltaSeconds * (component.playbackRate || 1));
		while (remaining >= duration && !component.paused) {
			remaining -= duration;
			component.frameIndex += 1;
			if (component.frameIndex < active.frames.length) {
				continue;
			}
			if (active.loop === false) {
				const next = active.next?.trim();
				if (next && component.animations[next]) {
					component.current = next;
					component.frameIndex = 0;
					active = this.resolveAnimation(component) ?? active;
					continue;
				}
				component.frameIndex = Math.max(0, active.frames.length - 1);
				component.paused = true;
				remaining = 0;
				break;
			}
			component.frameIndex = 0;
		}
		component.elapsed = remaining;
		return active;
	}

	private resolveSprite(owner: WorldObject, component: SpriteAnimationComponent): SpriteComponent | null {
		if (component.cachedSprite !== undefined) {
			return component.cachedSprite;
		}
		let sprite: SpriteComponent | null = null;
		if (component.spriteId) {
			sprite = owner.get_component_by_id<SpriteComponent>(component.spriteId) ?? null;
		}
		if (!sprite) {
			const sprites = owner.get_components(SpriteComponent);
			if (sprites.length > 0) {
				sprite = sprites[0]!;
			}
		}
		component.cacheSprite(sprite);
		return sprite;
	}

	private resolveAnimation(component: SpriteAnimationComponent): SpriteAnimationDefinition | null {
		let currentId = component.current;
		if (!currentId) {
			currentId = component.autoplay ?? Object.keys(component.animations)[0];
			if (!currentId) {
				return null;
			}
			component.current = currentId;
			component.frameIndex = 0;
			component.elapsed = 0;
		}
		const definition = component.animations[currentId];
		if (!definition || !Array.isArray(definition.frames) || definition.frames.length === 0) {
			return null;
		}
		return definition;
	}

	private isEligible(owner: WorldObject): boolean {
		if (owner.dispose_flag) return false;
		if (owner.active === false) return false;
		if (!owner.tick_enabled) return false;
		return true;
	}
}
