import { appendAffine2, type Affine2 } from '../../../common/affine2';
import { appendAffine3, type Affine3 } from '../../../../machine/ts/common/affine3';
import type { SceneSourceAffine, SceneSourceObject } from './model';
import type { SceneSpatialReadModel } from './spatial_projection';

/** An occurrence-keyed overlay. Entries outside this subset borrow the source snapshot. */
export type SceneTransformPreview = {
	readonly worlds: ReadonlyMap<SceneSourceObject, Readonly<SceneSourceAffine> | undefined>;
	readonly revision: number;
};

export type SceneTranslationPlan = {
	readonly entry: SceneSourceObject;
	readonly spatial: SceneSpatialReadModel;
	readonly locals: ReadonlyMap<SceneSourceObject, Readonly<SceneSourceAffine> | undefined>;
	readonly local: Readonly<SceneSourceAffine>;
	readonly world: Readonly<SceneSourceAffine>;
	readonly parentInverse: Readonly<SceneSourceAffine> | undefined;
};

type ProposedPlacement = {
	readonly family: '2d'; readonly local: Readonly<Affine2>; readonly world: Affine2; readonly parent: Readonly<Affine2> | undefined;
} | {
	readonly family: '3d'; readonly local: Readonly<Affine3>; readonly world: Affine3; readonly parent: Readonly<Affine3> | undefined;
};

/** One gesture's retained poses, never a mutation of source-derived caches or a guest World. */
export class SceneTranslationProposal implements SceneTransformPreview {
	public readonly initialWorld: Readonly<SceneSourceAffine>;
	public readonly currentWorld: Readonly<SceneSourceAffine>;
	public readonly currentLocal: SceneSourceAffine;
	public readonly worlds = new Map<SceneSourceObject, SceneSourceAffine | undefined>();
	private readonly placements: ProposedPlacement[] = [];
	public revision = 0;

	public constructor(private readonly plan: SceneTranslationPlan) {
		this.initialWorld = plan.world;
		this.currentLocal = { ...plan.local };
		const worlds = this.worlds;
		for (const entry of plan.spatial.constructionOrder) {
			const parent = plan.spatial.parents.get(entry);
			if (entry !== plan.entry && (parent === undefined || !worlds.has(parent))) continue;
			const sourceLocal = plan.locals.get(entry), sourceWorld = plan.spatial.worlds.get(entry);
			const local = entry === plan.entry ? this.currentLocal : sourceLocal!;
			const world = sourceWorld === undefined ? undefined : { ...sourceWorld };
			worlds.set(entry, world);
			if (world === undefined) continue;
			const parentWorld = parent === undefined ? undefined : worlds.has(parent) ? worlds.get(parent) : plan.spatial.worlds.get(parent);
			// A known source world already proves matching local/parent families.
			if (world.family === '2d') this.placements.push({ family: '2d', local, world, parent: parentWorld });
			else this.placements.push({ family: '3d', local: local as Readonly<Affine3>, world, parent: parentWorld as Readonly<Affine3> | undefined });
		}
		this.currentWorld = worlds.get(plan.entry)!;
	}

	/** Absolute world displacement from the captured pose, not an accumulated motion. */
	public translate(dx: number, dy: number, dz: number): boolean {
		const local = this.currentLocal, initial = this.plan.local, inverse = this.plan.parentInverse;
		if (local.family === '2d' && dz !== 0) return false;
		let ox: number, oy: number, oz = 0;
		if (dx === 0 && dy === 0 && dz === 0) {
			ox = initial.ox; oy = initial.oy; if (initial.family === '3d') oz = initial.oz;
		} else if (inverse?.family === '2d') {
			ox = initial.ox + (inverse.xx * dx + inverse.yx * dy);
			oy = initial.oy + (inverse.xy * dx + inverse.yy * dy);
		} else if (inverse?.family === '3d' && initial.family === '3d') {
			ox = initial.ox + (inverse.xx * dx + inverse.yx * dy + inverse.zx * dz);
			oy = initial.oy + (inverse.xy * dx + inverse.yy * dy + inverse.zy * dz);
			oz = initial.oz + (inverse.xz * dx + inverse.yz * dy + inverse.zz * dz);
		} else {
			ox = initial.ox + dx; oy = initial.oy + dy; if (initial.family === '3d') oz = initial.oz + dz;
		}
		if (Object.is(local.ox, ox) && Object.is(local.oy, oy) && (local.family === '2d' || Object.is(local.oz, oz))) return true;
		local.ox = ox; local.oy = oy; if (local.family === '3d') local.oz = oz;
		for (const placement of this.placements) {
			if (placement.parent === undefined) Object.assign(placement.world, placement.local);
			else if (placement.family === '2d') {
				const { local, world, parent } = placement;
				Object.assign(world, parent); appendAffine2(world, local.xx, local.xy, local.yx, local.yy, local.ox, local.oy);
			} else {
				const { local, world, parent } = placement;
				Object.assign(world, parent); appendAffine3(world, local);
			}
		}
		this.revision++;
		return true;
	}
}
