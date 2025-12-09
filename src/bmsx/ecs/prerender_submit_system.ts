import { ECSystem, TickGroup } from "./ecsystem";
import type { World } from "../core/world";
import type { Space } from "../core/space";
import { $ } from "../core/game";
import { excludeclassfromsavegame } from '../serializer/serializationhooks';
import { CustomVisualComponent } from "../component/customvisual_component";
import { sortSpriteQueue } from "../render/shared/render_queues";
import type { RenderLayer } from "../render/shared/render_types";
import { DEFAULT_ZCOORD } from "../render/backend/webgl/webgl.constants";

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

	private renderLayerWeight(layer?: RenderLayer): number {
		if (layer === 'ide') return 2;
		if (layer === 'ui') return 1;
		return 0;
	}

	private sortSprites(): void {
		sortSpriteQueue((a, b) => {
			const la = this.renderLayerWeight(a.options.layer);
			const lb = this.renderLayerWeight(b.options.layer);
			if (la !== lb) return la - lb;
			const za = a.options.pos.z ?? DEFAULT_ZCOORD;
			const zb = b.options.pos.z ?? DEFAULT_ZCOORD;
			if (za !== zb) return za - zb;
			return a.submissionIndex - b.submissionIndex;
		});
	}

	update(world: World): void {
		this.submitSpace(world.activeSpace);
		const uiSpace = world.getSpace('ui');
		if (!uiSpace) {
			throw new Error('[PreRenderSubmitSystem] UI space is not registered.');
		}
		this.submitSpace(uiSpace);
		this.sortSprites();
	}
}
