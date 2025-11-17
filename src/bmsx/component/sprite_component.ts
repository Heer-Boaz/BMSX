import { componenttags_postprocessing, type ComponentAttachOptions } from '../component/basecomponent';
import { Component } from '../component/basecomponent';
import type { asset_id, Identifier, vec2, vec3 } from '../rompack/rompack';
import { insavegame } from '../serializer/serializationhooks';
import type { color, FlipOptions, RenderLayer } from '../render/gameview';
import { new_vec2 } from '../utils/vector_operations';

@insavegame
@componenttags_postprocessing('render')
export class SpriteComponent extends Component {
	public imgid: asset_id = 'none';
	public scale: vec2 = new_vec2(1, 1);
	public flip: FlipOptions = { flip_h: false, flip_v: false };
	public colorize: color = { r: 1, g: 1, b: 1, a: 1 };
	public layer: RenderLayer = 'world';
	public ambient_affected?: boolean;
	public ambient_factor?: number; // 0..1
	// Local offset relative to parent
	public offset: vec3 = { x: 0, y: 0, z: 0 };
	/** Optional collider binding; when null, sprite will not drive collider sync. */
	public collider_local_id?: Identifier | null;

	constructor(opts: ComponentAttachOptions & { imgid?: asset_id; collider_local_id?: Identifier | null }) {
		super(opts);
		// The black screen stemmed from the SpriteComponent constructor using this.imgid ??= opts.imgid;, which only assigns when the field is undefined. Since the component initializes imgid to 'none', that assignment never fired, leaving every sprite stuck with the placeholder texture and nothing visible. Switching to explicit logic—if (opts.imgid !== undefined) this.imgid = opts.imgid; plus the matching collider line in src/bmsx/component/sprite_component.ts (line 24)—restores the real IDs, so the renderer once again draws actual assets. No further changes needed unless other components were refactored with the same pattern; worth grepping for ??= on fields that start with defaults.
		if (opts.imgid !== undefined) this.imgid = opts.imgid;
		opts.collider_local_id && (this.collider_local_id = opts.collider_local_id ?? null);
	}
}
