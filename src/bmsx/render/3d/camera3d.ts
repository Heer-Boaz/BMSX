import type { vec3, vec3arr } from '../../rompack/rompack';
import { bmat, bvec3, Mat4 } from './math3d';

function toVec3(v: vec3 | vec3arr): vec3 {
    return Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : { x: v.x, y: v.y, z: v.z };
}

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

    private _viewMatrix: Mat4 | null = null;
    private _projectionMatrix: Mat4 | null = null;
    private _viewProjectionMatrix: Mat4 | null = null;

    constructor(opts?: {
        position?: vec3 | vec3arr;
        target?: vec3 | vec3arr;
        up?: vec3 | vec3arr;
        fov?: number;
        aspect?: number;
        near?: number;
        far?: number;
    }) {
        this.position = toVec3(opts?.position ?? [0, 0, 5]);
        this.target = toVec3(opts?.target ?? [0, 0, 0]);
        this.up = toVec3(opts?.up ?? [0, 1, 0]);
        this.fov = opts?.fov ?? Math.PI / 4;
        this._aspect = opts?.aspect ?? 1;
        this.near = opts?.near ?? 0.1;
        this.far = opts?.far ?? 100;
        this.projection = 'perspective';
        this.orthoWidth = 10;
        this.orthoHeight = 10;
    }

    private recalculateMatrices(): void {
        this._viewMatrix = bmat.lookAt(
            [this.position.x, this.position.y, this.position.z],
            [this.target.x, this.target.y, this.target.z],
            [this.up.x, this.up.y, this.up.z]
        );
        if (this.projection === 'perspective') {
            this._projectionMatrix = bmat.perspective(this.fov, this._aspect, this.near, this.far);
        } else {
            this._projectionMatrix = bmat.orthographic(
                -this.orthoWidth / 2, this.orthoWidth / 2,
                -this.orthoHeight / 2, this.orthoHeight / 2,
                this.near, this.far
            );
        }
        this._viewProjectionMatrix = bmat.multiply(this._projectionMatrix, this._viewMatrix);
    }

    public setAspect(aspect: number): void {
        this._aspect = aspect;
    }

    public setPosition(pos: vec3 | vec3arr): void {
        this.position = toVec3(pos);
        this.recalculateMatrices();
    }

    public lookAt(target: vec3 | vec3arr): void {
        this.target = toVec3(target);
        this.recalculateMatrices();
    }

    public setViewDepth(near: number, far: number): void {
        this.near = near;
        this.far = far;
    }

    public rotateX(rad: number): void {
        this.position = bvec3.rotateX(this.position, rad, this.target);
    }

    public rotateY(rad: number): void {
        this.position = bvec3.rotateY(this.position, rad, this.target);
    }

    public rotateZ(rad: number): void {
        this.position = bvec3.rotateZ(this.position, rad, this.target);
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

    public get viewMatrix(): Mat4 {
        if (!this._viewMatrix) this.recalculateMatrices();
        return this._viewMatrix;
    }

    public get projectionMatrix(): Mat4 {
        if (!this._projectionMatrix) this.recalculateMatrices();
        return this._projectionMatrix;
    }

    public get viewProjectionMatrix(): Mat4 {
        if (!this._viewProjectionMatrix) this.recalculateMatrices();
        return this._viewProjectionMatrix;
    }
}
