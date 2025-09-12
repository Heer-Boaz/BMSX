import { componenttags_postprocessing } from 'bmsx/component/basecomponent';
import { GenericRendererComponent } from 'bmsx/component/generic_renderer_component';
import type { Identifier, vec2, vec3 } from 'bmsx/rompack/rompack';
import { insavegame, type RevivableObjectArgs } from 'bmsx/serializer/serializationhooks';
import type { color, FlipOptions } from 'bmsx/render/gameview';
import { new_vec2 } from 'bmsx/utils/utils';
import type { WorldObject } from 'bmsx';

/**
 * SpriteRendererComponent
 * - Non-unique render component that submits a single sprite every frame.
 * - Uses parent's world position plus an optional local offset.
 * - Flush occurs centrally by PreRenderSubmitSystem via GenericRendererComponent.
 */
@insavegame
@componenttags_postprocessing('render')
export class SpriteRendererComponent extends GenericRendererComponent {
	// Persistent sprite parameters
	public imgid: string = 'none';
	public scale: vec2 = new_vec2(1, 1);
	public flip: FlipOptions = { flip_h: false, flip_v: false };
	public colorize: color = { r: 1, g: 1, b: 1, a: 1 };
	public layer: 'world' | 'ui' = 'world';
	public ambientAffected?: boolean;
	public ambientFactor?: number; // 0..1

	// Local sprite offset relative to parent position
	public offset: vec3 = {x: 0, y: 0, z: 0};

	constructor(opts: RevivableObjectArgs & { parentid: Identifier; imgid?: string }) {
		super(opts);
		if (opts?.imgid) this.imgid = opts.imgid ?? 'none';
	}

	override postprocessingUpdate(): void {
		const p = this.parentAs<WorldObject>();
		if (!p) return;
		// Compose world position with local offset
		const pos: vec3 = {
			x: p.x + this.offset.x,
			y: p.y + this.offset.y,
			z: p.z + this.offset.z,
		};
		this.submitSprite({
			imgid: this.imgid,
			pos,
			scale: this.scale,
			flip: this.flip,
			colorize: this.colorize,
			layer: this.layer,
			ambientAffected: this.ambientAffected,
			ambientFactor: this.ambientFactor,
		});
	}
}
