import type { RectBounds } from '../../../../machine/ts/common/rect';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { measureText, truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import * as colors from '../../../common/constants';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import type { MainWorkspaceClient } from '../../main_workspace';
import { updateFullWidthWorkbenchLayout, type FullWidthWorkbenchLayout } from '../../common/layout';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { createWorkbenchActionBar, layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchMenu, type WorkbenchMenuCommandDefinition } from '../../ui/menu/model';
import { WORKBENCH_TEXT_EDITOR_ID } from '../code_editor/editor_input';
import { measureSceneEditorMinimumWidth } from './layout';
import type { ScenePrimaryClientOptions } from './primary_client';
import type { ScenePrimarySnapshot } from './primary_snapshot';

const ACTIONS: readonly WorkbenchMenuCommandDefinition<EditorTextModel | undefined>[] = [
	{ type: 'command', command: 'editor.source', when: model => model !== undefined },
];

/** An unresolved persisted reference remains visible, without inventing an authored context. */
export class UnavailableScenePrimaryClient implements MainWorkspaceClient {
	public readonly scope;
	public readonly commandTarget;
	public readonly consumer = this;
	private readonly copies: readonly EditorTextModel[];
	private readonly bounds: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	private caption = '';
	private readonly actions;
	private readonly actionControl;
	private readonly snapshot: ScenePrimarySnapshot;
	private readonly unbindKeyboard: () => void;
	private attached = false;
	private disposed = false;

	public constructor(snapshot: ScenePrimarySnapshot, model: EditorTextModel | undefined, options: ScenePrimaryClientOptions) {
		this.snapshot = { ...snapshot, subject: { ...snapshot.subject, availability: 'unavailable' } };
		this.scope = options.scope;
		this.copies = model === undefined ? [] : [model];
		this.commandTarget = inputFocus.createTarget(null, this.scope);
		this.commandTarget.canFocus = () => this.attached && !this.disposed;
		this.unbindKeyboard = this.commandTarget.bindKeyboard(() => {});
		if (model !== undefined) {
			this.commandTarget.registerCommand('editor.source', {
				isEnabled: () => this.attached,
				run: () => { void options.navigation.openResource(options.parts.main.activeGroup,
					model.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID }); },
			});
			this.commandTarget.registerCommand('save', {
				isEnabled: () => this.attached && !model.readOnly,
				run: () => options.save(model),
			});
		}
		this.actions = createWorkbenchActionBar(new WorkbenchMenu(ACTIONS, model));
		this.actionControl = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, options.commands,
			this.commandTarget, () => this.focus());
		this.commandTarget.next = this.actionControl.focusTarget;
		this.actionControl.focusTarget.next = this.commandTarget;
		this.actionControl.focusTarget.previous = this.commandTarget;
	}

	public getWorkingCopies(): readonly EditorTextModel[] { return this.copies; }
	public get minimumWidth(): number { return measureSceneEditorMinimumWidth(); }
	public serialize() { return { kind: 'scene' as const, value: JSON.stringify(this.snapshot) }; }
	public onDidChange(): () => void { return () => {}; }
	public captureNavigationLocation() { return undefined; }
	public isCurrent(): boolean { return !this.disposed; }
	public attach(bounds: Readonly<RectBounds>): void {
		this.attached = true; this.actionControl.setInput(this.actions, this.commandTarget); this.layout(bounds);
	}
	public detach(): void { this.attached = false; this.actionControl.clearInput(); this.commandTarget.release(); }
	public layout(bounds: Readonly<RectBounds>): void {
		if (!updateFullWidthWorkbenchLayout(this.bounds, bounds)) return;
		const font = editorViewState.font;
		this.caption = truncateTextToWidth(this.snapshot.source.resource.path, bounds.right - bounds.left - 8);
		layoutWorkbenchActionBar(this.actions, bounds.right - 4, bounds.top, Math.min(bounds.bottom, bounds.top + font.lineHeight + 4),
			measureText, font.renderFont(), bounds.left + 4);
	}
	public update(): void { this.layout(this.bounds); this.actionControl.update(); }
	public draw(): void {
		const b = this.bounds, font = editorViewState.font, rowHeight = font.lineHeight + 4;
		api.pushClipRect(b.left, b.top, b.right, b.bottom);
		api.fill_rect(b.left, b.top, b.right, b.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
		renderWorkbenchActionBar(this.actions, font.renderFont(), colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
		api.blit_text_inline_with_font('SCENE UNAVAILABLE', b.left + 4, b.top + rowHeight + 2, 0, colors.COLOR_CONTENT_WARNING_TEXT, font.renderFont());
		api.blit_text_inline_with_font(this.caption, b.left + 4, b.top + rowHeight * 2 + 2, 0, colors.COLOR_DESCRIPTION_TEXT, font.renderFont());
		api.popClipRect();
	}
	public focus(): void { this.commandTarget.focus(); }
	public handlePointer(snapshot: PointerInputSnapshot): void {
		if (!this.actionControl.handlePointer(snapshot) && (snapshot.justPressedButtons & PointerButton.Primary) !== 0) this.commandTarget.activate();
	}
	public handleWheel(_event: WheelInputSnapshot): void {}
	public drawStatusBar(_bounds: Readonly<RectBounds>, _color: number): void {}
	public dispose(): void {
		this.disposed = true; this.detach(); this.actionControl.dispose(); this.unbindKeyboard();
	}
}
