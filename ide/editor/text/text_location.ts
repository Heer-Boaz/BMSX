import { resourceIdentityEquals, type ResourceIdentity } from '../../common/resource';
import { mapTrackedTextRange, type EditorTextChange, type TrackedTextRange } from './text_change';

/** Half-open UTF-16 coordinates in one working copy, not workspace-global offsets. */
export type TrackedTextLocation = TrackedTextRange & { readonly resource: ResourceIdentity };

export function mapTrackedTextLocation(location: TrackedTextLocation, resource: ResourceIdentity, changes: readonly EditorTextChange[]): void {
	if (resourceIdentityEquals(location.resource, resource)) mapTrackedTextRange(location, changes);
}

export function trackedTextLocationsEqual(left: TrackedTextLocation, right: TrackedTextLocation): boolean {
	return resourceIdentityEquals(left.resource, right.resource) && left.start === right.start && left.end === right.end;
}
