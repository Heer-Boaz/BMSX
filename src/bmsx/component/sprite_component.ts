import { componenttags_postprocessing, type ComponentAttachOptions } from 'bmsx/component/basecomponent';
import { Component } from 'bmsx/component/basecomponent';
import type { vec2, vec3 } from 'bmsx/rompack/rompack';
import { insavegame } from 'bmsx/serializer/serializationhooks';
import type { color, FlipOptions, RenderLayer } from 'bmsx/render/gameview';
import { new_vec2 } from 'bmsx/utils/utils';

@insavegame
@componenttags_postprocessing('render')
export class SpriteComponent extends Component {
	public imgid: string = 'none';
	public scale: vec2 = new_vec2(1, 1);
	public flip: FlipOptions = { flip_h: false, flip_v: false };
	public colorize: color = { r: 1, g: 1, b: 1, a: 1 };
	public layer: RenderLayer = 'world';
	public ambientAffected?: boolean;
	public ambientFactor?: number; // 0..1
	// Local offset relative to parent
	public offset: vec3 = { x: 0, y: 0, z: 0 };

	constructor(opts: ComponentAttachOptions & { imgid?: string }) {
		super(opts);
		if (opts?.imgid) this.imgid = opts.imgid ?? 'none';
	}
}

