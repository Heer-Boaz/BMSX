import { ECSystem, TickGroup } from "./ecsystem";
import type { World } from "../core/world";
import { id_to_space_symbol, type Space } from "../core/space";
import { $ } from "../core/game";
import { excludeclassfromsavegame } from "../serializer/gameserializer";

@excludeclassfromsavegame
export class PreRenderSubmitSystem extends ECSystem {
	constructor(priority = 10) { super(TickGroup.PreRender, priority); }

	private submitSpace(space: Space): void {
		if (space.depthSortDirty) space.sort_by_depth();
		for (const o of space.objects) {
			if (o.disposeFlag || !o.visible || !o.queueRenderSubmissions) continue;
			// If object has a queueRenderSubmissions method, call it to submit its render submissions
			o.queueRenderSubmissions($.view.renderer);
		}
	}

	update(world: World): void {
		this.submitSpace(world.activeSpace);
		const uiSpace = world[id_to_space_symbol]['ui'];
		uiSpace && this.submitSpace(uiSpace);
	}
}
