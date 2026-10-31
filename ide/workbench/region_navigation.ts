import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../input/focus';
import type { ResourcePanelController } from './contrib/resources/panel/controller';
import type { MainWorkspace } from './main_workspace';
import type { EditorPart } from './services/editor/editor_part';
import type { WorkbenchSurface } from './services/windows/model';
import type { WorkbenchSurfaceService } from './services/windows/service';
import type { WorkbenchStatusBar } from './ui/status_bar/control';

const enum Region { Files, Hierarchy, Viewport, Documents, Details, Activity, Status }
const REGION_COUNT = 7;

/** Outer workbench composition; document groups, local Tab and floating windows keep their own navigation. */
export class WorkbenchRegionNavigation {
	public constructor(private readonly files: ResourcePanelController, private readonly main: MainWorkspace,
		private readonly documents: EditorPart, private readonly status: WorkbenchStatusBar,
		private readonly surfaces: WorkbenchSurfaceService) {}

	public canNavigate(origin: InputFocusTarget | null, direction: 1 | -1): boolean {
		return this.destination(origin, direction) !== undefined;
	}

	public focus(origin: InputFocusTarget | null, direction: 1 | -1): boolean {
		const destination = this.destination(origin, direction);
		if (destination === undefined) return false;
		const scope = this.scope(destination)!, generation = scope.contextGeneration;
		switch (destination) {
			case Region.Files: this.files.setFocused(true); break;
			case Region.Hierarchy: this.main.focusPrimary('hierarchy'); break;
			case Region.Viewport: this.main.focusPrimary('viewport'); break;
			case Region.Documents: this.documents.focus(); break;
			case Region.Details: this.main.focusPrimary('details'); break;
			case Region.Activity: this.main.focusActivity(); break;
			case Region.Status: this.status.focus(); break;
		}
		const focused = inputFocus.admittedTarget;
		return scope.contextGeneration === generation && focused !== null && scope.contains(focused.scope);
	}

	private destination(origin: InputFocusTarget | null, direction: 1 | -1): Region | undefined {
		let current = -1;
		if (origin === null) {
			if (this.surfaces.topBlockingSurface !== null) return;
		} else {
			const surface = this.surfaces.findByScope(origin.scope.surfaceScope);
			if (surface === undefined || !this.surfaces.isFocusAdmitted(surface) || origin.canFocus?.() === false) return;
			// Promoted value editors retain their real owner's family; a floated inspector is a different window.
			let window: WorkbenchSurface | undefined;
			for (let current: WorkbenchSurface | null | undefined = surface; current != null;
				current = current.role === 'transient' && current.lifetimeOwner !== undefined ? current.lifetimeOwner : current.presentationParent) {
				if (current.role === 'modal') return;
				if (window === undefined && current.role === 'window') window = current;
			}
			if (this.files.focusTarget.scope.contains(origin.scope)) current = Region.Files;
			else if (this.status.focusTarget.scope.contains(origin.scope)) current = Region.Status;
			else if (window === this.main.surface) {
				const primary = this.main.primary;
				if (primary?.hierarchy.scope.contains(origin.scope)) current = Region.Hierarchy;
				else if (primary?.viewport.scope.contains(origin.scope)) current = Region.Viewport;
				else if (primary?.details.scope.contains(origin.scope)) current = Region.Details;
				else if (this.documents.scope.contains(origin.scope)) current = Region.Documents;
				else if (this.main.activityPlacement === 'dockedMain' && this.main.activities.scope.contains(origin.scope)) current = Region.Activity;
			}
		}
		let candidate = current === -1 ? direction === 1 ? Region.Files : Region.Status : (current + direction + REGION_COUNT) % REGION_COUNT;
		for (let count = 0; count < REGION_COUNT; count++, candidate = (candidate + direction + REGION_COUNT) % REGION_COUNT) {
			if (candidate === current) return;
			const scope = this.scope(candidate);
			if (scope === undefined) continue;
			const surface = this.surfaces.findByScope(scope.surfaceScope);
			if (surface !== undefined && this.surfaces.isFocusAdmitted(surface)) return candidate;
		}
	}

	private scope(region: Region): InputFocusScope | undefined {
		switch (region) {
			case Region.Files: return this.files.isVisible() ? this.files.focusTarget.scope : undefined;
			case Region.Hierarchy: return this.main.primary?.hierarchy.attached ? this.main.primary.hierarchy.scope : undefined;
			case Region.Viewport: return this.main.primary?.viewport.attached ? this.main.primary.viewport.scope : undefined;
			case Region.Documents: return this.documents.contentPresented && !this.documents.retired && this.documents.operation === 'none' ? this.documents.scope : undefined;
			case Region.Details: return this.main.primary?.details.attached ? this.main.primary.details.scope : undefined;
			case Region.Activity: return this.main.activityPlacement === 'dockedMain' && this.main.activityDisplayed
				&& this.main.activities.attached && this.main.activity?.attached ? this.main.activity.scope : undefined;
			case Region.Status: return this.status.canFocus ? this.status.focusTarget.scope : undefined;
		}
	}
}
