import type { Affine2 } from '../../../common/affine2';
import { ActorWorldGeometry } from './world_geometry';
import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { valueTag, ValueTag } from '../../../../machine/ts/machine/cpu/value';
import type { ResourceDomain } from '../../../common/resource';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';

export type ActorVisualKind = 'sprite' | 'region' | 'rectangle' | 'text' | 'models' | 'surface';
export type ActorRenderQuad = {
	domain: ResourceDomain; hashId: number; label: string;
	ox: number; oy: number; ax: number; ay: number; bx: number; by: number;
	localX: number; localY: number; parentHashId: number;
	parentXX: number; parentXY: number; parentYX: number; parentYY: number;
	idTag: ValueTag; idScalar: number; definitionTag: ValueTag; definitionScalar: number;
};

/** Scalar draw evidence. Storage is reused; no guest object survives observation. */
export class ActorRenderGeometry {
	private readonly pose: Affine2 = { xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 };
	public readonly world = new ActorWorldGeometry();
	public clear(): void { this.quads.clear(); this.world.clear(); }
	public readonly quads = new ScratchBuffer<ActorRenderQuad>(() => ({ domain: 0, hashId: 0, label: '',
		localX: 0, localY: 0, parentHashId: 0, parentXX: 1, parentXY: 0, parentYX: 0, parentYY: 1,
		ox: 0, oy: 0, ax: 0, ay: 0, bx: 0, by: 0, idTag: ValueTag.Nil, idScalar: 0, definitionTag: ValueTag.Nil, definitionScalar: 0 }));
	public capture(visual: Table, kind: ActorVisualKind, domain: ResourceDomain, guest: SuspendedGuestSession): void {
		if (kind === 'models') { this.world.captureModels(visual, domain, guest); return; }
		let left = 0, top = 0, width: number, height: number;
		if (kind === 'text') {
			if (guest.isTruthy(guest.readStringMember(visual, '_layout_empty'))) return;
			left = guest.readStringMember(visual, '_layout_left') as number;
			top = guest.readStringMember(visual, '_layout_top') as number;
			width = (guest.readStringMember(visual, '_layout_right') as number) - left;
			height = (guest.readStringMember(visual, '_layout_bottom') as number) - top;
		} else if (kind === 'surface') {
			const source = guest.readStringMember(visual, '_source');
			width = guest.readStringMember(source, 'width') as number; height = guest.readStringMember(source, 'height') as number;
		} else {
			width = guest.readStringMember(visual, kind === 'sprite' ? 'source_width' : kind === 'region' ? 'region_width' : 'width') as number;
			height = guest.readStringMember(visual, kind === 'sprite' ? 'source_height' : kind === 'region' ? 'region_height' : 'height') as number;
		}
		const pose = this.pose;
		const xx = pose.xx = guest.readStringMember(visual, 'wxx') as number, xy = pose.xy = guest.readStringMember(visual, 'wxy') as number;
		const yx = pose.yx = guest.readStringMember(visual, 'wyx') as number, yy = pose.yy = guest.readStringMember(visual, 'wyy') as number;
		pose.ox = guest.readStringMember(visual, 'wox') as number; pose.oy = guest.readStringMember(visual, 'woy') as number;
		const quad = this.quads.get(this.quads.length), owner = guest.readStringMember(visual, 'owner') as Table;
		const id = guest.readStringMember(owner, 'id'), definition = guest.readStringMember(owner, 'definition_id');
		const idTag = valueTag(id), idScalar = guest.identityScalar(id, idTag);
		const definitionTag = valueTag(definition), definitionScalar = guest.identityScalar(definition, definitionTag);
		if (quad.hashId !== owner.hashId || quad.idTag !== idTag || quad.idScalar !== idScalar
			|| quad.definitionTag !== definitionTag || quad.definitionScalar !== definitionScalar) {
			const name = guest.formatValue(id);
			quad.label = definitionTag === ValueTag.Nil ? idTag === ValueTag.Number ? `#${name}` : name
				: `${guest.formatValue(definition)} #${name}`;
			quad.idTag = idTag; quad.idScalar = idScalar; quad.definitionTag = definitionTag; quad.definitionScalar = definitionScalar;
		}
		quad.domain = domain; quad.hashId = owner.hashId;
		quad.localX = guest.readStringMember(owner, 'ox') as number; quad.localY = guest.readStringMember(owner, 'oy') as number;
		const parent = guest.readStringMember(owner, 'parent') as Table | null;
		quad.parentHashId = parent === null ? 0 : parent.hashId;
		// draw() has resolved the same hierarchy used by this visual. Capture the
		// parent basis with the image, not later from an already advanced heap.
		quad.parentXX = parent === null ? 1 : guest.readStringMember(parent, 'wxx') as number;
		quad.parentXY = parent === null ? 0 : guest.readStringMember(parent, 'wxy') as number;
		quad.parentYX = parent === null ? 0 : guest.readStringMember(parent, 'wyx') as number;
		quad.parentYY = parent === null ? 1 : guest.readStringMember(parent, 'wyy') as number;
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
