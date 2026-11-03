import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { valueTag, ValueTag } from '../../../../machine/ts/machine/cpu/value';
import type { ResourceDomain } from '../../../common/resource';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';

export type ActorVisualKind = 'sprite' | 'region' | 'rectangle' | 'text';
export type ActorRenderQuad = {
	domain: ResourceDomain; hashId: number; label: string;
	ox: number; oy: number; ax: number; ay: number; bx: number; by: number;
	idTag: ValueTag; idScalar: number; definitionTag: ValueTag; definitionScalar: number;
};

/** Scalar draw evidence. Storage is reused; no guest object survives observation. */
export class ActorRenderGeometry {
	public readonly quads = new ScratchBuffer<ActorRenderQuad>(() => ({ domain: 0, hashId: 0, label: '',
		ox: 0, oy: 0, ax: 0, ay: 0, bx: 0, by: 0, idTag: ValueTag.Nil, idScalar: 0, definitionTag: ValueTag.Nil, definitionScalar: 0 }));
	public capture(visual: Table, kind: ActorVisualKind, domain: ResourceDomain, guest: SuspendedGuestSession): void {
		let left = 0, top = 0, width: number, height: number;
		if (kind === 'text') {
			if (guest.isTruthy(guest.readStringMember(visual, '_layout_empty'))) return;
			left = guest.readStringMember(visual, '_layout_left') as number;
			top = guest.readStringMember(visual, '_layout_top') as number;
			width = (guest.readStringMember(visual, '_layout_right') as number) - left;
			height = (guest.readStringMember(visual, '_layout_bottom') as number) - top;
		} else {
			width = guest.readStringMember(visual, kind === 'sprite' ? 'source_width' : kind === 'region' ? 'region_width' : 'width') as number;
			height = guest.readStringMember(visual, kind === 'sprite' ? 'source_height' : kind === 'region' ? 'region_height' : 'height') as number;
		}
		const xx = guest.readStringMember(visual, 'wxx') as number, xy = guest.readStringMember(visual, 'wxy') as number;
		const yx = guest.readStringMember(visual, 'wyx') as number, yy = guest.readStringMember(visual, 'wyy') as number;
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
		quad.ox = (guest.readStringMember(visual, 'wox') as number) + xx * left + yx * top;
		quad.oy = (guest.readStringMember(visual, 'woy') as number) + xy * left + yy * top;
		quad.ax = xx * width; quad.ay = xy * width; quad.bx = yx * height; quad.by = yy * height;
	}
	public copyFrom(source: ActorRenderGeometry): void {
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
