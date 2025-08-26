import { RenderView } from '../view/render_view';
import { RGCommandKind, RGDrawCommand } from './rendergraph';

// Builds draw command list based on current subsystem queues/state.
export function buildDrawCommands(view: RenderView): RGDrawCommand[] {
    const cmds: RGDrawCommand[] = [];
    cmds.push({ kind: RGCommandKind.Skybox });
    cmds.push({ kind: RGCommandKind.MeshBatch });
    cmds.push({ kind: RGCommandKind.ParticleBatch });
    cmds.push({ kind: RGCommandKind.SpriteBatch });
    cmds.push({ kind: RGCommandKind.PostProcess });
    return cmds;
}
