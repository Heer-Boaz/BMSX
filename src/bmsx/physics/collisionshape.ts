// Basic collision shape definitions for the initial physics MVP.
// Shapes kept intentionally minimal (AABB & Sphere) for fast broadphase + simple narrowphase.
import type { vec3 } from '../rompack/rompack';

export type AABBShape = { kind: 'aabb'; halfExtents: vec3 }; // Centered on body position
export type SphereShape = { kind: 'sphere'; radius: number };

export type CollisionShape = AABBShape | SphereShape;

export function computeAABB(shape: CollisionShape, position: vec3) {
	if (shape.kind === 'aabb') {
		return {
			min: { x: position.x - shape.halfExtents.x, y: position.y - shape.halfExtents.y, z: position.z - shape.halfExtents.z },
			max: { x: position.x + shape.halfExtents.x, y: position.y + shape.halfExtents.y, z: position.z + shape.halfExtents.z },
		};
	}
	// Sphere treated as AABB for broadphase
	return {
		min: { x: position.x - shape.radius, y: position.y - shape.radius, z: position.z - shape.radius },
		max: { x: position.x + shape.radius, y: position.y + shape.radius, z: position.z + shape.radius },
	};
}
