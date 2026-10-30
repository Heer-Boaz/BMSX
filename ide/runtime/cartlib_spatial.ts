import { ScratchBuffer } from '../../machine/ts/common/scratchbuffer';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { valueTag, ValueTag } from '../../machine/ts/machine/cpu/value';
import { appendAffine2, type Affine2 } from '../common/affine2';
import type { SuspendedGuestSession } from './suspended_guest';

/** Same-build read-only formatter. It neither invokes a guest getter nor writes
 * the guest's derived caches; all borrowed links end with this observation. */
export class CartlibSpatialReader2D {
	private readonly indices = new WeakMap<Table, { epoch: number; index: number }>();
	private readonly poses = new ScratchBuffer<Affine2>(() => ({ xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 }));
	private readonly ancestors = new ScratchBuffer<Table | null>(() => null);
	private readonly localPose: Affine2 = { xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 };
	private epoch = 0;
	public constructor(private readonly guest: SuspendedGuestSession) {}

	/** Start one coherent observation, sharing each ancestor composition. */
	public begin(): void {
		this.end(); this.epoch++; this.poses.clear();
	}

	/** Release borrowed guest references; numeric scratch and weak metadata survive. */
	public end(): void {
		for (let index = 0; index < this.ancestors.size; index++) this.ancestors.set(index, null);
		this.ancestors.clear();
	}

	public readVisual(visual: Table, destination: Affine2): void {
		// Match the guest owner's world * (attachment * presentation) grouping.
		const guest = this.guest, local = this.localPose;
		local.xx = guest.readStringMember(visual, 'attachment_xx') as number;
		local.xy = guest.readStringMember(visual, 'attachment_xy') as number;
		local.yx = guest.readStringMember(visual, 'attachment_yx') as number;
		local.yy = guest.readStringMember(visual, 'attachment_yy') as number;
		local.ox = guest.readStringMember(visual, 'attachment_ox') as number;
		local.oy = guest.readStringMember(visual, 'attachment_oy') as number;
		appendAffine2(local,
			guest.readStringMember(visual, 'presentation_xx') as number,
			guest.readStringMember(visual, 'presentation_xy') as number,
			guest.readStringMember(visual, 'presentation_yx') as number,
			guest.readStringMember(visual, 'presentation_yy') as number,
			guest.readStringMember(visual, 'presentation_ox') as number,
			guest.readStringMember(visual, 'presentation_oy') as number);
		this.readWorld(guest.readStringMember(visual, 'spatial') as Table, destination);
		appendAffine2(destination, local.xx, local.xy, local.yx, local.yy, local.ox, local.oy);
	}

	private readWorld(spatial: Table, destination: Affine2): void {
		const guest = this.guest, ancestors = this.ancestors;
		let current: Table | null = spatial;
		let parentIndex: number | undefined;
		let count = 0;
		while (current !== null) {
			const cached = this.indices.get(current);
			if (cached !== undefined && cached.epoch === this.epoch) { parentIndex = cached.index; break; }
			ancestors.set(count++, current);
			const parent = guest.readStringMember(current, 'spatial_parent');
			current = valueTag(parent) === ValueTag.Nil ? null : parent as Table;
		}
		let parent = parentIndex === undefined ? undefined : this.poses.peek(parentIndex);
		while (count > 0) {
			const node = ancestors.peek(--count)!;
			ancestors.set(count, null);
			const index = this.poses.size, pose = this.poses.get(index);
			if (parent === undefined) {
				pose.xx = 1; pose.xy = 0; pose.yx = 0; pose.yy = 1; pose.ox = 0; pose.oy = 0;
			} else {
				pose.xx = parent.xx; pose.xy = parent.xy; pose.yx = parent.yx; pose.yy = parent.yy;
				pose.ox = parent.ox; pose.oy = parent.oy;
			}
			appendAffine2(pose,
				guest.readStringMember(node, 'xx') as number, guest.readStringMember(node, 'xy') as number,
				guest.readStringMember(node, 'yx') as number, guest.readStringMember(node, 'yy') as number,
				guest.readStringMember(node, 'ox') as number, guest.readStringMember(node, 'oy') as number);
			const cached = this.indices.get(node);
			if (cached === undefined) this.indices.set(node, { epoch: this.epoch, index });
			else { cached.epoch = this.epoch; cached.index = index; }
			parent = pose;
		}
		ancestors.clear();
		destination.xx = parent!.xx; destination.xy = parent!.xy;
		destination.yx = parent!.yx; destination.yy = parent!.yy;
		destination.ox = parent!.ox; destination.oy = parent!.oy;
	}
}
