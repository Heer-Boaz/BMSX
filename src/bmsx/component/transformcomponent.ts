import { M4, Mat4 } from '../render/3d/math3d';
import type { Identifier, vec3arr } from '../rompack/rompack';
import { insavegame } from '../serializer/gameserializer';
import { Component, componenttags_postprocessing } from './basecomponent';

@insavegame
@componenttags_postprocessing('position_update_axis')
export class TransformComponent extends Component {
    public position: vec3arr;
    public rotation: vec3arr;
    public scale: vec3arr;

    private _parentNode: TransformComponent | null = null;
    private children: TransformComponent[] = [];

    private localMatrix: Mat4 = M4.identity();
    private worldMatrix: Mat4 = M4.identity();
    private dirty = true;

    constructor(parentid: Identifier, opts?: { position?: vec3arr; rotation?: vec3arr; scale?: vec3arr }) {
        super(parentid);
        this.position = opts?.position ?? [0, 0, 0];
        this.rotation = opts?.rotation ?? [0, 0, 0];
        this.scale = opts?.scale ?? [1, 1, 1];
    }

    public get parentNode(): TransformComponent | null {
        return this._parentNode;
    }

    public set parentNode(p: TransformComponent | null) {
        if (this._parentNode === p) return;
        if (this._parentNode) {
            const idx = this._parentNode.children.indexOf(this);
            if (idx >= 0) this._parentNode.children.splice(idx, 1);
        }
        this._parentNode = p;
        if (p) p.children.push(this);
        this.markDirty();
    }

    public markDirty(): void {
        if (!this.dirty) {
            this.dirty = true;
            for (const c of this.children) c.markDirty();
        }
    }

    private updateMatrices(): void {
        this.localMatrix = M4.identity();
        M4.translateSelf(this.localMatrix, this.position[0], this.position[1], this.position[2]);
        M4.rotateXSelf(this.localMatrix, this.rotation[0]);
        M4.rotateYSelf(this.localMatrix, this.rotation[1]);
        M4.rotateZSelf(this.localMatrix, this.rotation[2]);
        M4.scaleSelf(this.localMatrix, this.scale[0], this.scale[1], this.scale[2]);
        if (this._parentNode) {
            const pw = this._parentNode.getWorldMatrix();
            this.worldMatrix = M4.mul(pw, this.localMatrix);
        } else {
            this.worldMatrix = this.localMatrix;
        }
        this.dirty = false;
    }

    public getWorldMatrix(): Mat4 {
        if (this.dirty) this.updateMatrices();
        return this.worldMatrix;
    }

    override postprocessingUpdate(): void {
        const parent = this.parent as any;
        if (!parent) return;

        if (parent.pos) {
            this.position[0] = parent.pos.x;
            this.position[1] = parent.pos.y;
            this.position[2] = parent.pos.z ?? 0;
        }

        if (parent.rotation) {
            this.rotation[0] = parent.rotation[0];
            this.rotation[1] = parent.rotation[1];
            this.rotation[2] = parent.rotation[2];
        }

        if (parent.scale) {
            this.scale[0] = parent.scale[0];
            this.scale[1] = parent.scale[1];
            this.scale[2] = parent.scale[2];
        }

        this.markDirty();
    }
}
