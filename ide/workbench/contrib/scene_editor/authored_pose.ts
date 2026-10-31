import { LuaSyntaxKind, type LuaExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaWrittenExpression } from '../../../../toolchain/ts/lua/semantic/written_sources';
import { affine2FromPose, affine2Rotation, affine2Scale, affine2Skew } from '../../../common/affine2';
import { affine3FromTRS, affine3Rotation, affine3Scale } from '../../../../machine/ts/common/affine3';
import type { LuaSourceReader } from '../../../language/lua/source_reader';
import { readSceneSourceTransform } from './authored_affine';
import type { SceneSourceAffine } from './model';

type Quaternion = readonly [number, number, number, number];
export type SceneAuthoredPose = {
	readonly affine: SceneSourceAffine;
	readonly rotation: number | Quaternion | undefined;
	readonly scale: readonly number[] | undefined;
	readonly skew: number | undefined;
};

/** Semantic source construction, not Lua evaluation. Exact transform input
 * invalidates inherited editing channels; position-only overrides need none. */
export function readSceneSourcePose(reader: LuaSourceReader, file: FileSemanticData, expression: LuaExpression,
	family: '2d' | '3d', defaults?: SceneAuthoredPose): SceneAuthoredPose | undefined {
	let affine: SceneSourceAffine = defaults === undefined ? family === '2d'
		? { family, xx: 1, xy: 0, yx: -0, yy: 1, ox: 0, oy: 0 }
		: { family, xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 0, oy: 0, oz: 0 }
		: { ...defaults.affine };
	let rotation = defaults === undefined ? family === '2d' ? 0 : [0, 0, 0, 1] as Quaternion : defaults.rotation;
	let scale = defaults === undefined ? family === '2d' ? [1, 1] : [1, 1, 1] : defaults.scale;
	let skew = defaults === undefined ? 0 : defaults.skew;
	const fields = ['transform', 'position', 'rotation', 'scale', 'skew'] as const;
	const sources = fields.map(name => family === '3d' && name === 'skew' ? null : reader.memberState(file, expression, name));
	if (sources.some(source => source === undefined)) return;
	const present = (source: LuaWrittenExpression | null | undefined): source is LuaWrittenExpression => source !== null && source !== undefined
		&& source.expression.kind !== LuaSyntaxKind.NilLiteralExpression;
	const number = (source: LuaWrittenExpression): number | undefined => reader.numberValue(source.file, source.expression);
	const axis = (source: LuaWrittenExpression, name: string, inherited: number): number | undefined => {
		const value = reader.memberState(source.file, source.expression, name);
		return value === undefined ? undefined : present(value) ? number(value) : inherited;
	};
	const [transformSource, positionSource, rotationSource, scaleSource, skewSource] = sources;
	if (present(transformSource)) {
		const transformed = readSceneSourceTransform(reader, transformSource.file, transformSource.expression, family);
		if (transformed?.family !== family) return;
		affine = transformed; rotation = undefined; scale = undefined; skew = undefined;
	}
	if (present(positionSource)) {
		const x = axis(positionSource, 'x', affine.ox), y = axis(positionSource, 'y', affine.oy);
		if (x === undefined || y === undefined) return;
		affine.ox = x; affine.oy = y;
		if (affine.family === '3d') { const z = axis(positionSource, 'z', affine.oz); if (z === undefined) return; affine.oz = z; }
	}
	const scaleXSource = present(scaleSource) ? reader.memberState(scaleSource.file, scaleSource.expression, 'x') : null;
	const scaleYSource = present(scaleSource) ? reader.memberState(scaleSource.file, scaleSource.expression, 'y') : null;
	const scaleZSource = family === '3d' && present(scaleSource) ? reader.memberState(scaleSource.file, scaleSource.expression, 'z') : null;
	if (scaleXSource === undefined || scaleYSource === undefined || scaleZSource === undefined) return;
	const rotationSupplied = present(rotationSource), scaleSupplied = present(scaleXSource) || present(scaleYSource) || present(scaleZSource);
	const skewSupplied = family === '2d' && present(skewSource);
	if (rotationSupplied || scaleSupplied || skewSupplied) {
		const inheritedScale = scale ?? (affine.family === '2d' ? affine2Scale(affine) : affine3Scale(affine));
		const sx = present(scaleXSource) ? number(scaleXSource) : inheritedScale[0];
		const sy = present(scaleYSource) ? number(scaleYSource) : inheritedScale[1];
		if (sx === undefined || sy === undefined) return;
		if (affine.family === '2d') {
			const r = rotationSupplied ? number(rotationSource) : rotation as number | undefined ?? affine2Rotation(affine);
			const k = skewSupplied ? number(skewSource!) : skew ?? affine2Skew(affine);
			if (r === undefined || k === undefined) return;
			affine = { family, ...affine2FromPose(affine.ox, affine.oy, r, sx, sy, k) } as SceneSourceAffine;
			rotation = r; scale = [sx, sy]; skew = k;
		} else {
			let q: Quaternion | undefined;
			if (rotationSupplied) {
				const values = ['x', 'y', 'z', 'w'].map(name => reader.member(rotationSource.file, rotationSource.expression, name));
				const numbers = values.map(value => value === undefined ? undefined : number(value));
				if (numbers.some(value => value === undefined)) return;
				q = numbers as unknown as Quaternion;
			} else q = rotation as Quaternion | undefined ?? affine3Rotation(affine);
			const sz = present(scaleZSource) ? number(scaleZSource) : inheritedScale[2];
			if (q === undefined || sz === undefined) return;
			affine = { family: '3d', ...affine3FromTRS(affine.ox, affine.oy, affine.oz, q[0], q[1], q[2], q[3], sx, sy, sz) };
			rotation = q; scale = [sx, sy, sz];
		}
	}
	return { affine, rotation, scale, skew };
}
