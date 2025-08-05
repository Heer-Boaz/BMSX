import { to_vec3 } from '../../core/utils';
import type { vec3, vec3arr } from '../../rompack/rompack';
import { bmat, bvec3, Mat4, bquat } from './math3d';

/**
 * Simple camera helper for 3D rendering.
 */
export class Camera3D {
    public position: vec3;
    public target: vec3;
    public up: vec3;
    public fov: number;
    public near: number;
    public far: number;
    private _aspect: number;
    public projection: 'perspective' | 'orthographic';
    public orthoWidth: number;
    public orthoHeight: number;

    constructor(opts?: {
        position?: vec3 | vec3arr;
        target?: vec3 | vec3arr;
        up?: vec3 | vec3arr;
        fov?: number;
        aspect?: number;
        near?: number;
        far?: number;
    }) {
        this.position = to_vec3(opts?.position ?? [0, 0, 5]);
        this.target = to_vec3(opts?.target ?? [0, 0, 0]);
        this.up = to_vec3(opts?.up ?? [0, 1, 0]);
        this.fov = opts?.fov ?? Math.PI / 4;
        this._aspect = opts?.aspect ?? 1;
        this.near = opts?.near ?? 0.1;
        this.far = opts?.far ?? 100;
        this.projection = 'perspective';
        this.orthoWidth = 10;
        this.orthoHeight = 10;
    }

    public setAspect(aspect: number): void {
        this._aspect = aspect;
    }

    public setPosition(pos: vec3 | vec3arr): void {
        this.position = to_vec3(pos);
    }

    public lookAt(target: vec3 | vec3arr): void {
        this.target = to_vec3(target);
    }

    public setViewDepth(near: number, far: number): void {
        this.near = near;
        this.far = far;
    }

    public rotateX(rad: number): void {
        const offset = bvec3.sub(this.position, this.target);
        const rotated = bquat.rotateVec3(bquat.fromAxisAngle({ x: 1, y: 0, z: 0 }, rad), offset);
        this.position = bvec3.add(this.target, rotated);
    }

    public rotateY(rad: number): void {
        const offset = bvec3.sub(this.position, this.target);
        const rotated = bquat.rotateVec3(bquat.fromAxisAngle({ x: 0, y: 1, z: 0 }, rad), offset);
        this.position = bvec3.add(this.target, rotated);
    }

    public rotateZ(rad: number): void {
        const offset = bvec3.sub(this.position, this.target);
        const rotated = bquat.rotateVec3(bquat.fromAxisAngle({ x: 0, y: 0, z: 1 }, rad), offset);
        this.position = bvec3.add(this.target, rotated);
    }

    public moveForward(dist: number): void {
        const forward = bvec3.normalize(bvec3.sub(this.target, this.position));
        const delta = bvec3.scale(forward, dist);
        this.position = bvec3.add(this.position, delta);
        this.target = bvec3.add(this.target, delta);
    }

    public moveRight(dist: number): void {
        const forward = bvec3.normalize(bvec3.sub(this.target, this.position));
        const right = bvec3.normalize(bvec3.cross(forward, this.up));
        const delta = bvec3.scale(right, dist);
        this.position = bvec3.add(this.position, delta);
        this.target = bvec3.add(this.target, delta);
    }

    public moveUp(dist: number): void {
        const up = bvec3.normalize(this.up);
        const delta = bvec3.scale(up, dist);
        this.position = bvec3.add(this.position, delta);
        this.target = bvec3.add(this.target, delta);
    }

    public usePerspective(fov?: number): void {
        this.projection = 'perspective';
        if (fov !== undefined) this.fov = fov;
    }

    public useOrthographic(width: number, height: number): void {
        this.projection = 'orthographic';
        this.orthoWidth = width;
        this.orthoHeight = height;
    }

    public setFov(fov: number): void {
        this.fov = fov;
    }

    public get projectionMatrix(): Mat4 {
        if (this.projection === 'orthographic') {
            return bmat.orthographic(-this.orthoWidth / 2, this.orthoWidth / 2, -this.orthoHeight / 2, this.orthoHeight / 2, this.near, this.far);
        }
        return bmat.perspective(this.fov, this._aspect, this.near, this.far);
    }

    public get viewMatrix(): Mat4 {
        return bmat.lookAt(
            [this.position.x, this.position.y, this.position.z],
            [this.target.x, this.target.y, this.target.z],
            [this.up.x, this.up.y, this.up.z]
        );
    }

    public get viewProjectionMatrix(): Mat4 {
        return bmat.multiply(this.projectionMatrix, this.viewMatrix);
    }
}
