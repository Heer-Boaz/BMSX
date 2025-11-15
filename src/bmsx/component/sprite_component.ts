import { componenttags_postprocessing, type ComponentAttachOptions } from '../component/basecomponent';
import { Component } from '../component/basecomponent';
import type { Identifier, vec2, vec3 } from '../rompack/rompack';
import { insavegame } from '../serializer/serializationhooks';
import type { color, FlipOptions, RenderLayer } from '../render/gameview';
import { new_vec2 } from '../utils/vector_operations';

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
	/** Optional collider binding; when null, sprite will not drive collider sync. */
	public colliderLocalId?: Identifier | null;

	constructor(opts: ComponentAttachOptions & { imgid?: string; colliderLocalId?: Identifier | null }) {
		super(opts);
		if (opts.imgid !== undefined) this.imgid = opts.imgid;
		opts.colliderLocalId && (this.colliderLocalId = opts.colliderLocalId ?? null);
	}
}
