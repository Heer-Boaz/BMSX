import type { Affine2 } from '../../../common/affine2';
import { ActorWorldGeometry } from './world_geometry';
import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import { numberToHost, isNil, valueIsNumber, valueTag, ValueTag, type Value } from '../../../../machine/ts/machine/cpu/value';
import type { ResourceDomain } from '../../../common/resource';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';

export type ActorVisualKind = 'sprite' | 'region' | 'rectangle' | 'text' | 'models' | 'surface';
export type ActorRenderQuad = {
	domain: ResourceDomain; hashId: number; label: string;
	ox: number; oy: number; ax: number; ay: number; bx: number; by: number;
	localX: number; localY: number; parentHashId: number;
	parentXX: number; parentXY: number; parentYX: number; parentYY: number;
	idTag: ValueTag; idScalar: number | string; definitionTag: ValueTag; definitionScalar: number | string;
};

/** Scalar draw evidence. Storage is reused; no guest object survives observation. */
export class ActorRenderGeometry {
	private readonly pose: Affine2 = { xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 };
	public readonly world = new ActorWorldGeometry();
	public clear(): void { this.quads.clear(); this.world.clear(); }
	public readonly quads = new ScratchBuffer<ActorRenderQuad>(() => ({ domain: 0, hashId: 0, label: '',
		localX: 0, localY: 0, parentHashId: 0, parentXX: 1, parentXY: 0, parentYX: 0, parentYY: 1,
		ox: 0, oy: 0, ax: 0, ay: 0, bx: 0, by: 0, idTag: ValueTag.Nil, idScalar: 0, definitionTag: ValueTag.Nil, definitionScalar: 0 }));
	public capture(visual: Value, kind: ActorVisualKind, domain: ResourceDomain, guest: SuspendedGuestSession): void {
		if (kind === 'models') { this.world.captureModels(visual, domain, guest); return; }
		let left = 0, top = 0, width: number, height: number;
		if (kind === 'text') {
			if (guest.isTruthy(guest.readStringMember(visual, '_layout_empty'))) return;
			left = numberToHost(guest.readStringMember(visual, '_layout_left'));
			top = numberToHost(guest.readStringMember(visual, '_layout_top'));
			width = numberToHost(guest.readStringMember(visual, '_layout_right')) - left;
			height = numberToHost(guest.readStringMember(visual, '_layout_bottom')) - top;
		} else if (kind === 'surface') {
			const source = guest.readStringMember(visual, '_source');
			width = numberToHost(guest.readStringMember(source, 'width')); height = numberToHost(guest.readStringMember(source, 'height'));
		} else {
			width = numberToHost(guest.readStringMember(visual, kind === 'sprite' ? 'source_width' : kind === 'region' ? 'region_width' : 'width'));
			height = numberToHost(guest.readStringMember(visual, kind === 'sprite' ? 'source_height' : kind === 'region' ? 'region_height' : 'height'));
		}
		const pose = this.pose;
		const xx = pose.xx = numberToHost(guest.readStringMember(visual, 'wxx')), xy = pose.xy = numberToHost(guest.readStringMember(visual, 'wxy'));
		const yx = pose.yx = numberToHost(guest.readStringMember(visual, 'wyx')), yy = pose.yy = numberToHost(guest.readStringMember(visual, 'wyy'));
		pose.ox = numberToHost(guest.readStringMember(visual, 'wox')); pose.oy = numberToHost(guest.readStringMember(visual, 'woy'));
		const quad = this.quads.get(this.quads.length), owner = guest.readStringMember(visual, 'owner');
		const ownerHashId = guest.identityScalar(owner, ValueTag.Table);
		const id = guest.readStringMember(owner, 'id'), definition = guest.readStringMember(owner, 'definition_id');
		const idTag = valueTag(id), idScalar = guest.identityScalar(id, idTag);
		const definitionTag = valueTag(definition), definitionScalar = guest.identityScalar(definition, definitionTag);
		if (quad.hashId !== ownerHashId || quad.idTag !== idTag || quad.idScalar !== idScalar
			|| quad.definitionTag !== definitionTag || quad.definitionScalar !== definitionScalar) {
			const name = guest.formatValue(id);
			quad.label = definitionTag === ValueTag.Nil ? valueIsNumber(id) ? `#${name}` : name
				: `${guest.formatValue(definition)} #${name}`;
			quad.idTag = idTag; quad.idScalar = idScalar; quad.definitionTag = definitionTag; quad.definitionScalar = definitionScalar;
		}
		quad.domain = domain; quad.hashId = ownerHashId;
		quad.localX = numberToHost(guest.readStringMember(owner, 'ox')); quad.localY = numberToHost(guest.readStringMember(owner, 'oy'));
		const parent = guest.readStringMember(owner, 'parent');
		quad.parentHashId = isNil(parent) ? 0 : guest.identityScalar(parent, ValueTag.Table);
		// draw() has resolved the same hierarchy used by this visual. Capture the
		// parent basis with the image, not later from an already advanced heap.
		quad.parentXX = isNil(parent) ? 1 : numberToHost(guest.readStringMember(parent, 'wxx'));
		quad.parentXY = isNil(parent) ? 0 : numberToHost(guest.readStringMember(parent, 'wxy'));
		quad.parentYX = isNil(parent) ? 0 : numberToHost(guest.readStringMember(parent, 'wyx'));
		quad.parentYY = isNil(parent) ? 1 : numberToHost(guest.readStringMember(parent, 'wyy'));
		quad.ox = pose.ox + xx * left + yx * top;
		quad.oy = pose.oy + xy * left + yy * top;
		quad.ax = xx * width; quad.ay = xy * width; quad.bx = yx * height; quad.by = yy * height;
		this.world.captureCanvas(visual, kind, quad, pose, width, height, guest);
	}
	public copyFrom(source: ActorRenderGeometry): void {
		this.world.copyFrom(source.world);
		this.quads.clear();
		for (let i = 0; i < source.quads.length; i++) Object.assign(this.quads.get(i), source.quads.peek(i));
	}
}

export class ActorRenderFrame extends ActorRenderGeometry {
	public sequence: number | undefined;
	public width = 0;
	public height = 0;
	public offsetX = 0;
	public offsetY = 0;
	public copyFrame(source: ActorRenderFrame): void {
		this.copyFrom(source);
		this.width = source.width; this.height = source.height;
		this.offsetX = source.offsetX; this.offsetY = source.offsetY;
	}
}
