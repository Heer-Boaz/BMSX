import assert from 'node:assert/strict';
import test from 'node:test';
import {
	NavigationHistoryEntry, areNavigationEntriesEqual, createNavigationEntry, initializeNavigationState, navigationState,
	pushUniqueNavigationEntry, resetNavigationHistoryState, type PrimaryNavigationLocation,
} from '../../ide/navigation/navigation_history';
import { createActualSourcePanes } from '../helpers/source_panes';
import { inputFocus } from '../../ide/input/focus';

/** Unit-owned source correspondence, deliberately independent of any authoring context or editor input. */
class PrimaryLocation implements PrimaryNavigationLocation {
	private disposed = false;
	private readonly listeners = new Set<() => void>();
	public get isDisposed(): boolean { return this.disposed; }
	public readonly calls: { readonly isCurrent: () => boolean; readonly preserveFocus: boolean }[] = [];
	public constructor(public readonly occurrence: symbol,
		private readonly result: Promise<boolean> = Promise.resolve(true)) {}
	public matches(other: PrimaryNavigationLocation): boolean { return other instanceof PrimaryLocation && other.occurrence === this.occurrence; }
	public onDidRetire(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	public restore(options: { readonly isCurrent: () => boolean; readonly preserveFocus: boolean }): Promise<boolean> {
		this.calls.push(options); return this.result;
	}
	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const listener of this.listeners) listener();
		this.listeners.clear();
	}
}

test.afterEach(() => resetNavigationHistoryState());

test('the frontend captures its actual primary owner without manufacturing a document group', t => {
	const occurrence = Symbol('authored occurrence');
	const owner = { captureNavigationEntry: () => new NavigationHistoryEntry({ kind: 'primary', location: new PrimaryLocation(occurrence) }) };
	t.after(initializeNavigationState(owner));
	const first = createNavigationEntry()!, second = createNavigationEntry()!;
	assert.equal(first.owner, undefined);
	assert.equal(first.target.kind, 'primary');
	assert.equal(areNavigationEntriesEqual(first, second), true);
	pushUniqueNavigationEntry(navigationState.back, first);
	pushUniqueNavigationEntry(navigationState.back, second);
	assert.equal(second.isDisposed, true);
	assert.deepEqual(navigationState.back, [first]);
	assert.equal(first.isDisposed, false);
});

test('source retirement removes only that primary occurrence from both stacks and releases its locations', () => {
	const firstLocation = new PrimaryLocation(Symbol('first'));
	const secondLocation = new PrimaryLocation(Symbol('second'));
	const first = new NavigationHistoryEntry({ kind: 'primary', location: firstLocation });
	const second = new NavigationHistoryEntry({ kind: 'primary', location: secondLocation });
	navigationState.back.push(first, second); navigationState.forward.push(first);
	firstLocation.dispose();
	assert.equal(first.isDisposed, true);
	assert.deepEqual(navigationState.back, [second]);
	assert.deepEqual(navigationState.forward, []);
	assert.equal(secondLocation.isDisposed, false);
	resetNavigationHistoryState();
	assert.equal(secondLocation.isDisposed, true);
});

test('bounded primary history evicts and prunes source bookmarks without retaining authoring consumers', () => {
	const first = new PrimaryLocation(Symbol('first'));
	pushUniqueNavigationEntry(navigationState.back, new NavigationHistoryEntry({ kind: 'primary', location: first }));
	for (let index = 0; index < 64; index++) pushUniqueNavigationEntry(navigationState.back,
		new NavigationHistoryEntry({ kind: 'primary', location: new PrimaryLocation(Symbol('other')) }));
	assert.equal(navigationState.back.length, 64);
	assert.equal(first.isDisposed, true);
});

test('normal history release unsubscribes every primary location before disposing it', () => {
	const first = new PrimaryLocation(Symbol('first')), second = new PrimaryLocation(Symbol('second'));
	navigationState.back.push(new NavigationHistoryEntry({ kind: 'primary', location: first }),
		new NavigationHistoryEntry({ kind: 'primary', location: second }));
	resetNavigationHistoryState();
	assert.equal(first.isDisposed, true); assert.equal(second.isDisposed, true);
	assert.equal(navigationState.back.length, 0);
});

test('an already-retired primary destination has no live history lifetime', () => {
	const location = new PrimaryLocation(Symbol('unavailable')); location.dispose();
	const entry = new NavigationHistoryEntry({ kind: 'primary', location });
	assert.equal(entry.isDisposed, true);
});

test('background document movement and close preserve the active primary navigation owner behind Files', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const owner = { captureNavigationEntry: () => new NavigationHistoryEntry({ kind: 'primary',
		location: new PrimaryLocation(Symbol('retained subject')) }) };
	f.editor.resourcePanel.show(); f.update();
	assert.ok(inputFocus.target === f.editor.resourcePanel.focusTarget);
	parts.activate(parts.main, owner);
	assert.equal(parts.moveGroup(f.firstGroup, { kind: 'group', group: f.secondGroup }), true);
	assert.ok(navigationState.activeOwner === owner && parts.activePart === parts.main);
	assert.equal(await parts.close(f.secondPart), true);
	assert.ok(navigationState.activeOwner === owner && parts.activePart === parts.main);
	assert.ok(inputFocus.target === f.editor.resourcePanel.focusTarget);
});

for (const accepted of [false, true]) test(`primary history ${accepted ? 'consumption' : 'refusal'} uses the same real navigation owner and document departure`, async t => {
	const f = createActualSourcePanes(t); f.first.focus(); resetNavigationHistoryState();
	const departure = createNavigationEntry()!;
	const location = new PrimaryLocation(Symbol('primary subject'), Promise.resolve(accepted));
	const target = new NavigationHistoryEntry({ kind: 'primary', location });
	navigationState.back.push(target);
	await f.editor.navigation.goBackward();
	assert.equal(location.calls.length, 1);
	assert.equal(location.calls[0].preserveFocus, false);
	assert.equal(location.isDisposed, accepted);
	assert.equal(target.isDisposed, accepted);
	if (accepted) {
		assert.equal(navigationState.back.length, 0);
		assert.equal(navigationState.forward.length, 1);
		assert.equal(areNavigationEntriesEqual(navigationState.forward[0], departure), true);
	} else {
		assert.equal(navigationState.back.length, 1);
		assert.ok(navigationState.back[0] === target);
		assert.equal(navigationState.forward.length, 0);
		assert.equal(location.calls[0].isCurrent(), false, 'the abandoned borrow cannot later consume its still-live destination');
	}
	assert.equal(f.firstInput.workingCopy.buffer.getText(), f.source);
	assert.equal(f.firstInput.workingCopy.dirty, false);
	departure.dispose();
});

test('a pending primary history restore cannot consume a destination superseded by another navigation', async t => {
	const f = createActualSourcePanes(t); f.first.focus(); resetNavigationHistoryState();
	const completion = Promise.withResolvers<boolean>();
	const location = new PrimaryLocation(Symbol('primary subject'), completion.promise);
	const target = new NavigationHistoryEntry({ kind: 'primary', location });
	navigationState.back.push(target);
	const pending = f.editor.navigation.goBackward();
	assert.equal(location.calls.length, 1);
	assert.equal(location.calls[0].isCurrent(), true);
	const newer = createNavigationEntry()!;
	navigationState.back.push(newer);
	assert.equal(location.calls[0].isCurrent(), false);
	completion.resolve(true); await pending;
	assert.equal(navigationState.back.length, 2);
	assert.ok(navigationState.back[0] === target && navigationState.back[1] === newer);
	assert.equal(navigationState.forward.length, 0);
	assert.equal(target.isDisposed, false);
});

test('source retirement during primary history restore revokes the borrowed operation immediately', async t => {
	const f = createActualSourcePanes(t); f.first.focus(); resetNavigationHistoryState();
	const completion = Promise.withResolvers<boolean>();
	const location = new PrimaryLocation(Symbol('primary subject'), completion.promise);
	const target = new NavigationHistoryEntry({ kind: 'primary', location });
	navigationState.back.push(target);
	const pending = f.editor.navigation.goBackward();
	location.dispose();
	assert.equal(location.calls[0].isCurrent(), false);
	completion.resolve(true); await pending;
	assert.equal(navigationState.back.length, 0);
	assert.equal(navigationState.forward.length, 0);
	assert.equal(target.isDisposed, true);
});
