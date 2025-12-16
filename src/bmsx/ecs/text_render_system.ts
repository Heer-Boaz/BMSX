import { ECSystem, TickGroup } from './ecsystem';
import type { World } from '../core/world';
import { TextComponent } from '../component/text_component';
import { TransformComponent } from '../component/transformcomponent';
import type { WorldObject } from '../core/object/worldobject';
import { excludeclassfromsavegame } from '../serializer/serializationhooks';
import { $ } from '../core/game';

@excludeclassfromsavegame
export class TextRenderSystem extends ECSystem {
	constructor(priority = 7) { super(TickGroup.Presentation, priority); }
	update(world: World): void {
		for (const [o, tcx] of world.objects_with_components(TextComponent, { scope: 'active' })) {
			if (!tcx.enabled) continue;
			const parent = o as WorldObject;
			const t = parent.get_unique_component(TransformComponent);
			const offset = tcx.offset;
			if (!offset) {
				throw new Error('[TextRenderSystem] TextComponent missing offset configuration.');
			}
			let x = (t ? t.position[0] : parent.x) + offset.x;
			const y = (t ? t.position[1] : parent.y) + offset.y;
			const z = (t ? t.position[2] : parent.z) + offset.z;

			$.view.renderer.submit.glyphs({ x, y, z, glyphs: tcx.text, font: tcx.font, color: tcx.color, background_color: tcx.backgroundColor, layer: tcx.layer });
		}
	}
}
