import { componenttags_postprocessing, type ComponentAttachOptions } from '../component/basecomponent';
import { Component } from '../component/basecomponent';
import type { asset_id, Identifier, vec2, vec3, BoundingBoxPrecalc, HitPolygonsPrecalc, RectBounds } from '../rompack/rompack';
import { excludepropfromsavegame, insavegame } from '../serializer/serializationhooks';
import type { color, FlipOptions, RenderLayer } from '../render/gameview';
import type { TimelinePlayOptions, TimelineFrameEventPayload } from './timeline_component';
import { new_vec2 } from '../utils/vector_operations';
import { Collider2DComponent } from './collisioncomponents';
import type { GameEvent } from '../core/game_event';
import { $ } from '../core/game';

@insavegame
@componenttags_postprocessing('render')
export class SpriteComponent extends Component {
	static { this.autoRegister(); }
	private _imgid: asset_id = 'none';
	public scale: vec2 = new_vec2(1, 1);
	private readonly flip_state: FlipOptions = { flip_h: false, flip_v: false };
	@excludepropfromsavegame
	private readonly flip_handle = this.create_flip_proxy();
	public colorize: color = { r: 1, g: 1, b: 1, a: 1 };
	public layer: RenderLayer = 'world';
	public ambient_affected?: boolean;
	public ambient_factor?: number; // 0..1
	// Local offset relative to parent
	public offset: vec3 = { x: 0, y: 0, z: 0 };
	public autoplay_timeline_id?: string;
	/** Optional collider binding; when null, sprite will not drive collider sync. */
	private _colliderLocalId?: Identifier;
	@excludepropfromsavegame
	private colliderSyncToken = '';
	@excludepropfromsavegame
	private timeline_followers = new Map<string, () => void>();

	public get imgid(): asset_id { return this._imgid; }

	public set imgid(value: asset_id) {
		if (this._imgid === value) return;
		this._imgid = value;
		this.syncCollider();
	}

	public get flip(): FlipOptions { return this.flip_handle; }

	public set flip(value: FlipOptions) {
		if (value.flip_h !== undefined) this.flip_state.flip_h = value.flip_h;
		if (value.flip_v !== undefined) this.flip_state.flip_v = value.flip_v;
		this.syncCollider();
	}

	public get collider_local_id(): Identifier { return this._colliderLocalId; }

	public set collider_local_id(value: Identifier) {
		const next = value ;
		if (this._colliderLocalId === next) return;
		this._colliderLocalId = next;
		this.syncCollider();
	}

	constructor(opts: ComponentAttachOptions & { imgid?: asset_id; collider_local_id?: Identifier }) {
		super(opts);
		if (opts.imgid !== undefined) this.imgid = opts.imgid;
		if (opts.collider_local_id !== undefined) this.collider_local_id = opts.collider_local_id;
		else this.syncCollider();
	}

	public override bind(): void {
		super.bind();
		const autoplay = this.autoplay_timeline_id;
		if (autoplay) {
			this.observe_timeline(autoplay);
			this.parent.play_timeline(autoplay, { rewind: true, snap_to_start: true });
		}
	}

	public override dispose(): void {
		this.release_timeline_followers();
		super.dispose();
	}

	public override detach(): void {
		this.release_timeline_followers();
		super.detach();
	}

	public play_ani(id: string, opts?: TimelinePlayOptions): void {
		this.observe_timeline(id);
		this.parent.play_timeline(id, opts);
	}

	public stop_ani(id: string): void {
		this.parent.stop_timeline(id);
	}

	public resume_ani(id: string): void {
		this.observe_timeline(id);
		this.parent.play_timeline(id, { rewind: false, snap_to_start: false });
	}

	private resolveCollider(): Collider2DComponent {
		const owner = this.parent;
		const explicitLocalId = this._colliderLocalId;
		if (explicitLocalId) {
			const bound = owner.get_component_by_local_id(Collider2DComponent, explicitLocalId);
			if (bound) return bound;
			return undefined;
		}
		const primarySprite = owner.get_first_component(SpriteComponent);
		if (this === primarySprite) {
			return owner.getOrCreateCollider();
		}
		return undefined;
	}

	private syncCollider(): void {
		if (!this.is_attached) return;
		const collider = this.resolveCollider();
		if (!collider) {
			this.colliderSyncToken = '';
			return;
		}
		const id = this._imgid;
		const flipH = this.flip_state.flip_h;
		const flipV = this.flip_state.flip_v;
		const token = `${id}|${flipH ? 1 : 0}|${flipV ? 1 : 0}`;
		if (this.colliderSyncToken === token) return;
		if (id === 'none') {
			collider.setLocalArea(null);
			collider.setLocalPolygons(null);
			collider.syncToken = token;
			this.colliderSyncToken = token;
			return;
		}

		const entry = $.rompack.img[id];
		if (!entry) {
			const ownerId = this.parent.id ?? '<unknown>';
			const componentId = this.id ?? this.constructor.name;
			throw new Error(`[SpriteComponent] Sprite asset '${id}' not found in rompack (object='${ownerId}', component='${componentId}').`);
		}
		const imgmeta = entry['imgmeta'];
		if (!imgmeta) {
			throw new Error(`[SpriteComponent] Sprite asset '${id}' is missing metadata.`);
		}

		const box = imgmeta['boundingbox'] as BoundingBoxPrecalc;
		if (box) collider.setLocalArea(selectBoundingBox(flipH, flipV, box)); else collider.setLocalArea(null);
		const polys = imgmeta['hitpolygons'] as HitPolygonsPrecalc;
		if (polys) collider.setLocalPolygons(selectConcavePolygon(flipH, flipV, polys)); else collider.setLocalPolygons(null);
		collider.syncToken = token;
		this.colliderSyncToken = token;
	}

	private observe_timeline(id: string): void {
		if (this.timeline_followers.has(id)) return;
		const channel = this.parent.timeline_events(id);
		const remove = channel.on_frame(this, (event: GameEvent<'timeline.frame', TimelineFrameEventPayload<asset_id>>) => {
			this.imgid = event.frame_value as asset_id;
		});
		this.timeline_followers.set(id, remove);
	}

	private release_timeline_followers(): void {
		for (const remove of this.timeline_followers.values()) remove();
		this.timeline_followers.clear();
	}

	private create_flip_proxy(): FlipOptions {
		const target = this.flip_state;
		return new Proxy(target, {
			get: (obj, prop) => Reflect.get(obj, prop),
			set: (obj, prop, value) => {
				if (prop === 'flip_h' || prop === 'flip_v') {
					const next = value === true;
					if ((obj as Record<string, boolean>)[prop as keyof typeof obj] !== next) {
						(obj as Record<string, boolean>)[prop as keyof typeof obj] = next;
						this.syncCollider();
					}
					return true;
				}
				return Reflect.set(obj, prop, value);
			},
		}) as FlipOptions;
	}
}

function selectBoundingBox(flip_h: boolean, flip_v: boolean, box: BoundingBoxPrecalc): RectBounds {
	if (flip_h && flip_v) return box.fliphv;
	if (flip_h) return box.fliph;
	if (flip_v) return box.flipv;
	return box.original;
}

function selectConcavePolygon(flip_h: boolean, flip_v: boolean, polys: HitPolygonsPrecalc) {
	if (flip_h && flip_v) return polys.fliphv;
	if (flip_h) return polys.fliph;
	if (flip_v) return polys.flipv;
	return polys.original;
}
