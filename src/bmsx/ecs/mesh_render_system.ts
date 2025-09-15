import { ECSystem, TickGroup } from './ecsystem';
import type { World } from '../core/world';
import { $ } from '../core/game';
import type { WorldObject } from '../core/object/worldobject';
import { TransformComponent } from '../component/transformcomponent';
import { MeshComponent } from '../component/mesh_component';
import { M4 } from '../render/3d/math3d';
import { excludeclassfromsavegame } from 'bmsx/serializer/serializationhooks';

@excludeclassfromsavegame
export class MeshRenderSystem extends ECSystem {
	constructor(priority = 9) { super(TickGroup.PreRender, priority); }
	update(world: World): void {
		const cam = $.world.activeCamera3D;
		const base = new Float32Array(16);
		for (const [o, mc] of world.objectsWithComponents(MeshComponent, { scope: 'current' })) {
			if (!mc.enabled) continue;
			const parent = o as WorldObject;
			const tc = parent.getUniqueComponent(TransformComponent);
			if (tc) {
				M4.copyInto(base, tc.getWorldMatrix());
			} else {
				M4.setIdentity(base);
				M4.translateSelf(base, parent.x, parent.y, parent.z);
				const s = tc.scale as [number, number, number] | undefined;
				if (Array.isArray(s) && s.length >= 3) M4.scaleSelf(base, s[0], s[1], s[2]);
			}
			const subs = mc.collectSubmissions(base, true);
			for (const s of subs) {
				// Frustum culling: quick bounding-sphere test if camera available
				if (cam && s.mesh) {
					const m = s.matrix;
					const c = s.mesh.boundingCenter;
					const cx = m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12];
					const cy = m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13];
					const cz = m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14];
					const scale = M4.maxScale(m);
					const radius = s.mesh.boundingRadius * scale;
					if (mc.enableCulling && !cam.sphereInFrustum([cx, cy, cz], radius)) continue;
					// Simple LOD: beyond thresholds, drop morph weights to save work
					const dx = cx - cam.position.x, dy = cy - cam.position.y, dz = cz - cam.position.z;
					const dist2 = dx*dx + dy*dy + dz*dz;
					const L1 = mc.lodMorphDropDistance > 0 ? mc.lodMorphDropDistance * mc.lodMorphDropDistance : -1;
					const L2 = mc.lodMorphDisableDistance > 0 ? mc.lodMorphDisableDistance * mc.lodMorphDisableDistance : -1;
					if (L1 > 0 && dist2 > L1) {
						// Submit a copy without morph weights when far
						const sub = { ...s, morphWeights: (L2 > 0 && dist2 > L2) ? undefined : s.morphWeights };
						$.view.renderer.submit.mesh(sub);
						continue;
					}
				}
				$.view.renderer.submit.mesh(s);
			}
		}
	}
}
