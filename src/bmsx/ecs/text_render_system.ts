import { ECSystem, TickGroup } from './ecsystem';
import type { World } from '../core/world';
import { TextComponent } from '../component/text_component';
import { TransformComponent } from '../component/transformcomponent';
import type { WorldObject } from '../core/object/worldobject';
import { renderGlyphs } from '../render/glyphs';
import { wrapGlyphs, calculateCenteredBlockX } from 'bmsx/render/glyphs';
import { excludeclassfromsavegame } from 'bmsx/serializer/serializationhooks';

@excludeclassfromsavegame
export class TextRenderSystem extends ECSystem {
	constructor(priority = 7) { super(TickGroup.PreRender, priority); }
	update(world: World): void {
		for (const [o, tcx] of world.objectsWithComponents(TextComponent, { scope: 'current' })) {
			if (!tcx.enabled) continue;
			const parent = o as WorldObject;
			const t = parent.getUniqueComponent(TransformComponent);
			let x = (t ? t.position[0] : parent.x) + (tcx.offset?.x ?? 0);
			const y = (t ? t.position[1] : parent.y) + (tcx.offset?.y ?? 0);
			const z = (t ? t.position[2] : parent.z) + (tcx.offset?.z ?? 950);
			// Layout: wrapping and simple centering
			let lines: string | string[] = tcx.text;
			if (typeof lines === 'string' && tcx.wrapChars && tcx.wrapChars > 0) {
				lines = wrapGlyphs(lines, tcx.wrapChars);
			}
			if (tcx.centerBlockWidth && tcx.centerBlockWidth > 0) {
				const arr = Array.isArray(lines) ? lines : [lines];
				const cw = tcx.charWidth ?? 8;
				x += calculateCenteredBlockX(arr, cw, tcx.centerBlockWidth);
			}
			renderGlyphs(x, y, lines, z, tcx.font, tcx.color, tcx.backgroundColor, tcx.layer);
		}
	}
}
