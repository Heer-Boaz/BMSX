import { ECSystem, TickGroup } from "./ecsystem";
import type { World } from "../core/world";
import { id_to_space_symbol, type Space } from "../core/space";
import { $ } from "../core/game";
import { excludeclassfromsavegame } from '../serializer/serializationhooks';
import { CustomVisualComponent } from "../component/customvisual_component";

@excludeclassfromsavegame
export class PreRenderSubmitSystem extends ECSystem {
	constructor(priority = 10) { super(TickGroup.Presentation, priority); }

	private submitSpace(space: Space): void {
		if (space.depthSortDirty) space.sort_by_depth();
		for (const o of space.objects) {
			if (o.dispose_flag || !o.visible) continue;
			// Flush all GenericRendererComponent instances, including subclasses
			for (const c of o.iterate_components_by_type(CustomVisualComponent)) {
				c.flush($.view.renderer);
			}
		}
	}

	update(world: World): void {
		this.submitSpace(world.activeSpace);
		const uiSpace = world[id_to_space_symbol]['ui'];
		if (!uiSpace) {
			throw new Error('[PreRenderSubmitSystem] UI space is not registered.');
		}
		this.submitSpace(uiSpace);
	}
}
