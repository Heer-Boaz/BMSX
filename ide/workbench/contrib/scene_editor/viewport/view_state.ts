import { pickViewportCanvas, measureViewportCanvas } from './canvas_geometry';
import { create_rect_bounds, copy_rect_bounds, type RectBounds } from '../../../../../machine/ts/common/rect';
import type { BFont } from '../../../../../machine/ts/render/shared/bitmap_font';
import { editorViewState } from '../../../../editor/ui/view/state';
import { WorkbenchCanvasCaption } from '../../../ui/canvas_caption';
import { createWorkbenchActionBar, layoutWorkbenchActionBar } from '../../../ui/action_bar';
import { WorkbenchMenu } from '../../../ui/menu/model';
import { measureText } from '../../../../editor/common/text/layout';
import type { SceneAddMemberChoice, SceneAuthoringContext } from '../authoring_context';
import type { SceneSourceAffine, SceneSourceObject } from '../model';
import type { SceneSpatialReadModel } from '../spatial_projection';
import type { WorkspaceSourceCatalog } from '../../../../workspace/source_catalog';
import { WorkspaceImageAssets } from '../../../../workspace/image_assets';
import { WorkspaceModelAssets } from '../../../../workspace/model_assets';
import { SceneViewportCamera } from './camera';
import { SceneViewportCanvas } from './canvas';
import { SceneViewportGeometry, type SceneViewportGeometryBounds } from './geometry';
import type { SceneVisualReadModel } from '../visual_projection';
import type { SceneTransformPreview } from '../transform_proposal';
import { SceneTranslationGizmo, TRANSLATE_AXIS_LABELS } from './translate_gizmo';
import { collectSceneTextImages } from './text_layout';
import { SCENE_VIEWPORT_ACTIONS, SCENE_VIEWPORT_NAVIGATION, SCENE_VIEWPORT_VIEWS } from './menus';

export type SceneMemberPlacementPreview = SceneTransformPreview<SceneAddMemberChoice> & {
	readonly visuals: SceneVisualReadModel<SceneAddMemberChoice>;
	readonly world: SceneSourceAffine;
	revision: number;
};
export type SceneViewportPlacement = { readonly definitionLabel: string; readonly preview: SceneMemberPlacementPreview | undefined;
	x: number; y: number; z: number; located: boolean };

export const SCENE_VIEWPORT_POINT_STRIDE = 8;
const AXIS_UNIT_PIXELS = 16;

/** Retained source reading and numeric screen projection; selection stays with the authored context. */
export class SceneViewportViewState {
	public readonly camera = new SceneViewportCamera();
	public readonly gizmo = new SceneTranslationGizmo();
	public readonly caption = new WorkbenchCanvasCaption();
	public navigationTool: 'select' | 'pan' | 'orbit' = 'select';
	public navigationSpeed = 1;
	public readonly navigationActions = createWorkbenchActionBar(new WorkbenchMenu(SCENE_VIEWPORT_ACTIONS, this), true);
	public readonly viewMenu = new WorkbenchMenu(SCENE_VIEWPORT_VIEWS, this);
	public readonly navigationMenu = new WorkbenchMenu(SCENE_VIEWPORT_NAVIGATION, this);
	public readonly axisLabelWidths = [0, 0, 0];
	private labelFont: BFont | undefined;
	public transformPreview: SceneTransformPreview | undefined;
	public placementPreview: SceneMemberPlacementPreview | undefined;
	public readonly canvas: SceneViewportCanvas;
	public readonly placementCanvas: SceneViewportCanvas<SceneAddMemberChoice>;
	public readonly geometry: SceneViewportGeometry;
	public readonly placementGeometry: SceneViewportGeometry<SceneAddMemberChoice>;
	public readonly bounds = create_rect_bounds();
	public readonly entries: SceneSourceObject[] = [];
	/** Per occurrence: origin XY, X endpoint XY, Y endpoint XY, Z endpoint XY. */
	public readonly points: number[] = [];
	public readonly segment = [0, 0, 0, 0];
	public source: SceneSpatialReadModel | undefined;
	public selected: SceneSourceObject | undefined;
	public allocationRevision = 0;
	public projectionRevision = 0;
	public canFrameAll = false;
	private projectedSource: SceneSpatialReadModel | undefined;
	private projectedCamera = -1;
	private projectedAllocation = -1;
	private projectedPreview: SceneTransformPreview | undefined;
	private projectedPreviewRevision = -1;
	private lineHeight = 0;
	private disposed = false;
	private readonly visualBounds = create_rect_bounds();
	private readonly modelBounds: SceneViewportGeometryBounds = { originX: 0, originY: 0, originZ: 0, minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
	private readonly frameEntries = new Set<SceneSourceObject>();
	private initialSource: SceneSpatialReadModel | undefined;
	private initialVisuals: SceneVisualReadModel | undefined;
	private initialWidth = -1;
	private initialHeight = -1;
	private initialCatalogRevision = -1;
	private initialCameraRevision = -1;
	private initialMode: string | undefined;
	private modeSource: SceneSpatialReadModel | undefined;
	private sourceMode: '2d' | '3d' | undefined;
	private readonly listeners = new Set<() => void>();
	private readonly unbindCamera: () => void;
	private readonly images: WorkspaceImageAssets;
	private readonly modelAssets: WorkspaceModelAssets;
	private readonly imageIds = new Set<string>();
	private readonly modelIds = new Set<string>();
	private visualSource: SceneVisualReadModel | undefined;
	private placementSource: SceneVisualReadModel<SceneAddMemberChoice> | undefined;
	private visualCatalogRevision = -1;
	public constructor(public readonly authoring: SceneAuthoringContext, private readonly catalog: WorkspaceSourceCatalog) {
		this.images = new WorkspaceImageAssets(catalog);
		this.modelAssets = new WorkspaceModelAssets(catalog);
		this.canvas = new SceneViewportCanvas(this.images); this.placementCanvas = new SceneViewportCanvas(this.images);
		this.geometry = new SceneViewportGeometry(this.modelAssets, this.canvas); this.placementGeometry = new SceneViewportGeometry(this.modelAssets, this.placementCanvas);
		this.unbindCamera = this.camera.onDidChange(() => {
			if (this.camera.mode === '2d' && this.navigationTool === 'orbit') this.navigationTool = 'select';
			for (const listener of this.listeners) listener();
		});
	}
	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	public get assetGeneration(): number { return this.catalog.revision; }
	public layout(bounds: Readonly<RectBounds>, lineHeight: number): void {
		if (this.bounds.left === bounds.left && this.bounds.top === bounds.top && this.bounds.right === bounds.right && this.bounds.bottom === bounds.bottom && this.lineHeight === lineHeight) return;
		copy_rect_bounds(this.bounds, bounds); this.lineHeight = lineHeight; this.allocationRevision++;
		if (bounds.left < bounds.right && bounds.top < bounds.bottom) this.camera.setViewport(bounds.right - bounds.left, bounds.bottom - bounds.top);
	}
	/** Attached controls publish annotation content before paint. Source and
	 * pointer motion only change the rows they actually represent. */
	public prepareControls(placement: Readonly<SceneViewportPlacement> | undefined): void {
		const caption = this.caption, lines = caption.lines;
		caption.warningLine = -1;
		if (placement === undefined) {
			if (this.source === undefined) { lines[0] = 'SCENE UNAVAILABLE'; lines.length = 1; }
			else lines.length = 0;
		} else {
			lines[0] = placement.definitionLabel;
			lines[1] = this.camera.mode === '3d' ? placement.located ? 'Click: place on XZ' : 'Point at XZ plane' : 'Click: place';
			lines[2] = 'Esc: cancel';
			const empty = (this.camera.mode === '2d' ? this.placementCanvas.items.length : this.placementGeometry.scene.instances.length) === 0;
			if (empty) { lines[3] = 'No preview'; caption.warningLine = 3; }
			lines.length = empty ? 4 : 3;
		}
		caption.layout(Math.max(0, this.bounds.right - this.bounds.left - 8));
		const font = editorViewState.font.renderFont();
		this.navigationActions.items[0].label = this.camera.mode === '2d' ? '2D' : '3D';
		layoutWorkbenchActionBar(this.navigationActions, this.bounds.right - 4, this.bounds.top + 4, this.bounds.top + font.lineHeight + 8,
			measureText, font, this.bounds.left + 4, 'start');
		if (this.labelFont !== font) {
			this.labelFont = font;
			for (let axis = 0; axis < TRANSLATE_AXIS_LABELS.length; axis++) this.axisLabelWidths[axis] = font.measure(TRANSLATE_AXIS_LABELS[axis]);
		}
	}
	public refresh(): void {
		if (this.disposed) return;
		this.authoring.refresh();
		if (this.disposed) return;
		this.source = this.authoring.spatialScene;
		const selection = this.authoring.selection;
		if (this.disposed) return;
		this.selected = selection?.kind === 'member' && selection.entry.kind === 'object' ? selection.entry : undefined;
		const visuals = this.authoring.visualScene;
		if (this.disposed) return;
		const placement = this.placementPreview, placementVisuals = placement?.visuals;
		if (this.visualSource !== visuals || this.placementSource !== placementVisuals || this.visualCatalogRevision !== this.catalog.revision) {
			this.visualSource = visuals; this.placementSource = placementVisuals; this.visualCatalogRevision = this.catalog.revision;
			this.imageIds.clear();
			this.modelIds.clear();
			if (visuals !== undefined) for (const visual of visuals.canvas) {
				if (visual.kind === 'sprite') this.imageIds.add(visual.image);
				else if (visual.kind === 'text') collectSceneTextImages(visual, this.imageIds);
			}
			if (placementVisuals !== undefined) for (const visual of placementVisuals.canvas) {
				if (visual.kind === 'sprite') this.imageIds.add(visual.image);
				else if (visual.kind === 'text') collectSceneTextImages(visual, this.imageIds);
			}
			if (visuals !== undefined) for (const visual of visuals.models) this.modelIds.add(visual.model);
			if (placementVisuals !== undefined) for (const visual of placementVisuals.models) this.modelIds.add(visual.model);
			this.images.update(this.authoring.workingCopy.identity.contextId, this.imageIds);
			this.modelAssets.update(this.authoring.workingCopy.identity.contextId, this.modelIds);
		}
		this.canvas.prepare(visuals, this.transformPreview); this.geometry.prepare(visuals, this.transformPreview);
		if (this.modeSource !== this.source) {
			this.modeSource = this.source; this.sourceMode = undefined;
			if (this.source !== undefined) for (const entry of this.source.entries) {
				const world = this.source.worlds.get(entry);
				if (world !== undefined) { this.sourceMode = world.family; break; }
			}
		}
		if (this.camera.automaticMode && this.sourceMode !== undefined) this.camera.initializeMode(this.sourceMode);
		if (this.disposed) return;
		const width = this.bounds.right - this.bounds.left, height = this.bounds.bottom - this.bounds.top;
		if (this.camera.initial && width > 0 && height > 0
			&& (this.initialSource !== this.source || this.initialVisuals !== visuals || this.initialWidth !== width || this.initialHeight !== height
				|| this.initialCatalogRevision !== this.catalog.revision || this.initialMode !== this.camera.mode
				|| this.initialCameraRevision !== this.camera.revision)) {
			this.initialSource = this.source; this.initialVisuals = visuals; this.initialWidth = width; this.initialHeight = height;
			this.initialCatalogRevision = this.catalog.revision; this.initialMode = this.camera.mode;
			this.frame(undefined, 'initial'); this.initialCameraRevision = this.camera.revision; if (this.disposed) return;
		}
		if (this.geometry.project(this.camera, this.bounds)) this.projectionRevision++;
		if (this.canvas.project(this.camera, this.bounds, this.allocationRevision, this.selected)) this.projectionRevision++;
		this.projectPlacement();
		const preview = this.transformPreview, previewRevision = preview?.revision ?? -1;
		const selectedWorld = this.selected === undefined ? undefined : preview?.worlds.has(this.selected)
			? preview.worlds.get(this.selected) : this.source?.worlds.get(this.selected);
		const editable = this.selected !== undefined && this.authoring.canTranslateSelectedMember();
		if (this.disposed) return;
		this.gizmo.project(editable ? selectedWorld : undefined, previewRevision, this.camera, this.bounds, this.allocationRevision, this.lineHeight);
		if (this.projectedSource === this.source && this.projectedCamera === this.camera.revision && this.projectedAllocation === this.allocationRevision
			&& this.projectedPreview === preview && this.projectedPreviewRevision === previewRevision) return;
		this.projectedSource = this.source; this.projectedCamera = this.camera.revision; this.projectedAllocation = this.allocationRevision;
		this.projectedPreview = preview; this.projectedPreviewRevision = previewRevision;
		let count = 0; this.canFrameAll = false;
		const camera = this.camera, centerX = (this.bounds.left + this.bounds.right) / 2, centerY = (this.bounds.top + this.bounds.bottom) / 2;
		if (this.source !== undefined) for (const entry of this.source.entries) {
			const world = preview?.worlds.has(entry) ? preview.worlds.get(entry) : this.source.worlds.get(entry);
			if (world === undefined || camera.mode === '2d' && world.family !== '2d') continue;
			this.canFrameAll = true;
			const signY = camera.mode === '3d' && world.family === '2d' ? -1 : 1;
			const index = count * SCENE_VIEWPORT_POINT_STRIDE, x = world.ox, y = world.oy * signY, z = world.family === '3d' ? world.oz : 0;
			if (camera.mode === '3d' && camera.depth(x, y, z) < camera.near) continue;
			this.entries[count++] = entry;
			this.points[index] = centerX + camera.projectX(x, y, z); this.points[index + 1] = centerY + camera.projectY(x, y, z);
			// Diagnostic helpers use screen units; zoom fits the actual geometry, not giant helper arms.
			this.points[index + 2] = this.points[index] + camera.horizontal(world.xx, world.xy * signY, world.family === '3d' ? world.xz : 0) * AXIS_UNIT_PIXELS;
			this.points[index + 3] = this.points[index + 1] + camera.vertical(world.xx, world.xy * signY, world.family === '3d' ? world.xz : 0) * AXIS_UNIT_PIXELS;
			this.points[index + 4] = this.points[index] + camera.horizontal(world.yx, world.yy * signY, world.family === '3d' ? world.yz : 0) * AXIS_UNIT_PIXELS;
			this.points[index + 5] = this.points[index + 1] + camera.vertical(world.yx, world.yy * signY, world.family === '3d' ? world.yz : 0) * AXIS_UNIT_PIXELS;
			this.points[index + 6] = world.family === '3d' ? this.points[index] + camera.horizontal(world.zx, world.zy, world.zz) * AXIS_UNIT_PIXELS : this.points[index];
			this.points[index + 7] = world.family === '3d' ? this.points[index + 1] + camera.vertical(world.zx, world.zy, world.zz) * AXIS_UNIT_PIXELS : this.points[index + 1];
		}
		this.entries.length = count; this.points.length = count * SCENE_VIEWPORT_POINT_STRIDE; this.projectionRevision++;
	}
	/** Pointer motion consumes admitted preview resources without re-entering source or asset discovery. */
	public projectPlacement(): void {
		const placement = this.placementPreview, visuals = placement?.visuals;
		this.placementCanvas.prepare(visuals, placement); this.placementGeometry.prepare(visuals, placement);
		this.placementCanvas.project(this.camera, this.bounds, this.allocationRevision);
		this.placementGeometry.project(this.camera, this.bounds);
	}
	public get canFrameSelection(): boolean {
		const world = this.selected === undefined ? undefined : this.source?.worlds.get(this.selected);
		return world !== undefined;
	}
	/** UI helpers are painted over geometry and therefore participate before the mesh depth hit. */
	public pick(x: number, y: number): SceneSourceObject | undefined {
		let picked: SceneSourceObject | undefined, distance = 36;
		const represented = this.camera.mode === '2d' ? this.canvas.represented : this.geometry.represented;
		for (let index = 0; index < this.entries.length; index++) {
			const entry = this.entries[index]; if (entry !== this.selected && represented.has(entry)) continue;
			const offset = index * SCENE_VIEWPORT_POINT_STRIDE, dx = this.points[offset] - x, dy = this.points[offset + 1] - y;
			const squared = dx * dx + dy * dy;
			if (squared <= distance) { distance = squared; picked = entry; }
		}
		if (picked !== undefined) return picked;
		return this.camera.mode === '2d' ? pickViewportCanvas(this.canvas.items, x, y)
			: this.geometry.pick(x - (this.bounds.left + this.bounds.right) / 2, y - (this.bounds.top + this.bounds.bottom) / 2, this.camera)?.entry;
	}
	public frame(selected: SceneSourceObject | undefined, reading: 'initial' | 'manual' = 'manual'): boolean {
		const family = selected === undefined || this.camera.mode === '3d' ? this.camera.mode : this.source?.worlds.get(selected)?.family;
		if (family === undefined) return false;
		this.frameEntries.clear();
		if (selected !== undefined) {
			this.frameEntries.add(selected);
			if (this.source !== undefined) for (const entry of this.source.constructionOrder) {
				const parent = this.source.parents.get(entry);
				if (parent !== undefined && this.frameEntries.has(parent)) this.frameEntries.add(entry);
			}
		}
		const selectedEntries = selected === undefined ? undefined : this.frameEntries;
		let count = 0;
		if (family === '3d') {
			const target = this.modelBounds;
			if (this.geometry.frameBounds(selectedEntries, target)) count++;
			if (this.source !== undefined) for (const entry of this.source.entries) {
				if ((selectedEntries !== undefined && !selectedEntries.has(entry)) || this.geometry.represented.has(entry)) continue;
				const world = this.source.worlds.get(entry); if (world === undefined) continue;
				const worldY = world.family === '2d' ? -world.oy : world.oy, worldZ = world.family === '3d' ? world.oz : 0;
				if (count === 0) { target.originX = world.ox; target.originY = worldY; target.originZ = worldZ; }
				const x = world.ox - target.originX, y = worldY - target.originY, z = worldZ - target.originZ;
				target.minX = Math.min(target.minX, x); target.minY = Math.min(target.minY, y); target.minZ = Math.min(target.minZ, z);
				target.maxX = Math.max(target.maxX, x); target.maxY = Math.max(target.maxY, y); target.maxZ = Math.max(target.maxZ, z); count++;
			}
			if (count === 0) return false;
			this.camera.frame3D(target.minX, target.minY, target.minZ, target.maxX, target.maxY, target.maxZ, target.originX, target.originY, target.originZ, selected !== undefined, reading); return true;
		}
		let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
		const hasVisualBounds = measureViewportCanvas(this.canvas.items, selectedEntries, this.visualBounds);
		if (hasVisualBounds) {
			left = this.visualBounds.left; top = this.visualBounds.top; right = this.visualBounds.right; bottom = this.visualBounds.bottom; count++;
		}
		if (this.source !== undefined) for (const entry of this.source.entries) {
			if ((selectedEntries !== undefined && !selectedEntries.has(entry)) || this.canvas.represented.has(entry)) continue;
			const world = this.source.worlds.get(entry); if (world === undefined || world.family !== '2d') continue;
			left = Math.min(left, world.ox); top = Math.min(top, world.oy); right = Math.max(right, world.ox); bottom = Math.max(bottom, world.oy); count++;
		}
		if (count === 0) return false;
		this.camera.frame2D(left, top, right, bottom, this.bounds.right - this.bounds.left, this.bounds.bottom - this.bounds.top, selected !== undefined, reading); return true;
	}
	public dispose(): void {
		this.disposed = true; this.unbindCamera(); this.listeners.clear(); this.entries.length = this.points.length = 0;
		this.canvas.dispose(); this.placementCanvas.dispose(); this.images.dispose(); this.geometry.dispose(); this.placementGeometry.dispose(); this.modelAssets.dispose(); this.frameEntries.clear();
		this.imageIds.clear(); this.visualSource = undefined; this.placementSource = undefined; this.placementPreview = undefined;
		this.modelIds.clear();
		this.source = this.projectedSource = this.modeSource = this.initialSource = undefined;
		this.initialVisuals = undefined; this.sourceMode = undefined; this.selected = undefined;
		this.transformPreview = this.projectedPreview = undefined; this.gizmo.dispose();
	}
}
