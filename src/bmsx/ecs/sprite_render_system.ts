import { ECSystem, TickGroup } from './ecsystem';
import type { World } from '../core/world';
import { $ } from '../core/game';
import { SpriteComponent } from '../component/sprite_component';
import type { WorldObject } from '../core/object/worldobject';
import { TransformComponent } from '../component/transformcomponent';
import { excludeclassfromsavegame } from '../serializer/serializationhooks';

@excludeclassfromsavegame
export class SpriteRenderSystem extends ECSystem {
	constructor(priority = 8) { super(TickGroup.Presentation, priority); }
	update(world: World): void {
		for (const [o, sc] of world.objects_with_components(SpriteComponent, { scope: 'active' })) {
			if (o.dispose_flag || !o.visible) continue;
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
	}
}
}
