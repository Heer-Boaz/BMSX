import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../../machine/ts/common/rect';
import type { BFont } from '../../../../../machine/ts/render/shared/bitmap_font';
import type { EditorCommandRunner } from '../../../../common/commands';
import { PROBLEMS_PANEL_HEADER_PADDING_X } from '../../../../common/constants';
import { truncateMeasuredText } from '../../../../common/text';
import { measureText, measureTextRange } from '../../../../editor/common/text/layout';
import { inputFocus, type InputFocusTarget } from '../../../../input/focus';
import { pointerCapture } from '../../../../input/pointer/capture';
import { pointerHover } from '../../../../input/pointer/hover';
import type { PointerSnapshot } from '../../../../common/models';
import type { DiagnosticsCoverage } from '../../../services/diagnostics/resource_diagnostics';
import type { WorkbenchSurface } from '../../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../../services/windows/service';
import { createWorkbenchActionBar, layoutWorkbenchActionBar } from '../../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../../ui/action_bar_control';
import { WorkbenchTooltip } from '../../../ui/tooltip';

const EMPTY_COVERAGE: DiagnosticsCoverage = { ready: 0, pending: 0, unsupported: 0, failed: 0 };

/** Diagnostic count and coverage within the container's allocated header. */
export class ProblemsPanelHeader {
	public readonly actions = createWorkbenchActionBar('problems.title');
	public title = '';
	public summary = '';
	public summaryLeft = 0;
	public readonly bounds = create_rect_bounds();
	private readonly feedback = new WorkbenchTooltip();
	public readonly controls: WorkbenchActionBarControl;
	private readonly unbindBlur: () => void;
	private readonly unbindActionBlur: () => void;
	private attached = false;
	private attachmentRevision = 0;
	private diagnosticCount = -1;
	private ready = 0;
	private pending = 0;
	private unsupported = 0;
	private failed = 0;
	private fullTitle = '';
	private fullSummary = '';
	private coverageText = '';
	private revision = 0;
	private measuredRevision = -1;
	private font: BFont | undefined;

	public constructor(private readonly parent: InputFocusTarget, surfaces: WorkbenchSurfaceService,
		owner: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>, commands: EditorCommandRunner) {
		this.setCoverage(0, EMPTY_COVERAGE);
		parent.registerCommand('problems.coverage', { isEnabled: () => this.attached, run: () => {
			this.controls.focusTarget.focus();
		} });
		this.feedback.attach(surfaces, owner, workArea);
		const controls = this.controls = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands,
			this.parent, () => this.parent.focus());
		controls.focusTarget.clipboard = { readOnly: true, copy: () => this.coverageText };
		this.parent.next = this.parent.previous = controls.focusTarget;
		controls.focusTarget.next = controls.focusTarget.previous = this.parent;
		this.unbindBlur = this.parent.onDidBlur(() => this.feedback.hide());
		this.unbindActionBlur = controls.focusTarget.onDidBlur(() => this.feedback.hide());
	}

	public get hasFocus(): boolean { return this.controls.focusTarget.hasFocus; }

	public attach(): void {
		const revision = ++this.attachmentRevision;
		this.attached = true;
		this.controls.clearInput();
		if (revision !== this.attachmentRevision) return;
		this.controls.setInput(this.actions, this.parent);
	}

	public detach(): void {
		this.attachmentRevision++; this.attached = false;
		this.feedback.hide(); this.controls.clearInput();
	}
	public dispose(): void {
		this.detach(); this.controls.dispose(); this.feedback.detach(); this.unbindBlur(); this.unbindActionBlur();
		this.parent.next = this.parent.previous = null;
	}

	public setCoverage(count: number, coverage: DiagnosticsCoverage): void {
		if (this.diagnosticCount === count && this.ready === coverage.ready && this.pending === coverage.pending
			&& this.unsupported === coverage.unsupported && this.failed === coverage.failed) return;
		this.diagnosticCount = count; this.ready = coverage.ready; this.pending = coverage.pending;
		this.unsupported = coverage.unsupported; this.failed = coverage.failed;
		this.fullTitle = `${count}`;
		this.fullSummary = coverage.failed > 0 ? `${coverage.failed} failed`
			: coverage.pending > 0 ? `${coverage.pending} pending`
				: coverage.unsupported > 0 ? `${coverage.unsupported} unsupported`
					: coverage.ready > 0 ? `${coverage.ready} checked` : 'Not checked';
		this.coverageText = `Diagnostics coverage\nChecked: ${coverage.ready}\nPending: ${coverage.pending}\nUnsupported: ${coverage.unsupported}\nFailed: ${coverage.failed}\nUnopened resources are not checked.`;
		this.revision++;
	}

	public layout(font: BFont, left: number, top: number, right: number, bottom: number): void {
		if (this.font !== font || this.measuredRevision !== this.revision || this.bounds.left !== left || this.bounds.top !== top
			|| this.bounds.right !== right || this.bounds.bottom !== bottom) {
			this.font = font; this.measuredRevision = this.revision;
			write_rect_bounds(this.bounds, left, top, right, bottom);
			const textLeft = left + PROBLEMS_PANEL_HEADER_PADDING_X;
			layoutWorkbenchActionBar(this.actions, right - PROBLEMS_PANEL_HEADER_PADDING_X, top + 1, bottom - 1, measureText, font, textLeft);
			const textRight = this.actions.bounds.left - PROBLEMS_PANEL_HEADER_PADDING_X;
			this.title = truncateMeasuredText(this.fullTitle, textRight - textLeft, measureTextRange);
			this.summary = truncateMeasuredText(this.fullSummary, textRight - textLeft - PROBLEMS_PANEL_HEADER_PADDING_X - measureText(this.title), measureTextRange);
			this.summaryLeft = textRight - measureText(this.summary);
			if (this.attached) this.controls.update();
		}
	}

	public updateFeedback(): void {
		if (!this.attached) return;
		if (this.controls.tooltipItem !== undefined)
			this.feedback.show(this.coverageText, this.actions.bounds, this.font!, measureTextRange, measureText, this.workArea);
		else this.feedback.hide();
	}

	public handlePointer(snapshot: PointerSnapshot): boolean { return this.attached && this.controls.handlePointer(snapshot); }
	public onPointerLeave(): void { this.feedback.hide(); }
}
