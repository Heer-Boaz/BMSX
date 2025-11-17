import { ECSystem, TickGroup } from './ecsystem';
import type { World } from '../core/world';
import { $ } from '../core/game';
import { SpriteComponent } from '../component/sprite_component';
import type { WorldObject } from '../core/object/worldobject';
import { TransformComponent } from '../component/transformcomponent';
import { excludeclassfromsavegame } from '../serializer/serializationhooks';

@excludeclassfromsavegame
export class SpriteRenderSystem extends ECSystem {
	private static readonly DEBUG_LOG_LIMIT = 20;
	private static debugZeroFrameLogs = 0;
	private static debugSubmitLogs = 0;

	constructor(priority = 8) { super(TickGroup.Presentation, priority); }
	update(world: World): void {
		let processed = 0;
		for (const [o, sc] of world.objectsWithComponents(SpriteComponent, { scope: 'active' })) {
			if (!sc.enabled) continue;
			const parent = o as WorldObject;
			const tc = parent.get_unique_component(TransformComponent);
			const pos = tc
				? { x: tc.position[0] + sc.offset.x, y: tc.position[1] + sc.offset.y, z: tc.position[2] + sc.offset.z }
				: { x: parent.x + sc.offset.x, y: parent.y + sc.offset.y, z: parent.z + sc.offset.z };
			$.view.renderer.submit.sprite({
				imgid: sc.imgid,
				pos,
				scale: sc.scale,
				flip: sc.flip,
				colorize: sc.colorize,
				layer: sc.layer,
				ambient_affected: sc.ambient_affected,
				ambient_factor: sc.ambient_factor,
			});
			processed++;
		}
		if ($.debug) {
			if (processed === 0) {
				if (SpriteRenderSystem.debugZeroFrameLogs < SpriteRenderSystem.DEBUG_LOG_LIMIT) {
					SpriteRenderSystem.debugZeroFrameLogs++;
					const activeCount = world.activeSpace?.objects.length ?? 0;
					console.warn(`[SpriteRenderSystem] 0 sprite components submitted this frame (active objects=${activeCount}).`);
				}
			} else if (SpriteRenderSystem.debugSubmitLogs < SpriteRenderSystem.DEBUG_LOG_LIMIT) {
				SpriteRenderSystem.debugSubmitLogs++;
				console.debug(`[SpriteRenderSystem] Submitted ${processed} sprite components this frame.`);
			}
		}
	}
}
