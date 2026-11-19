import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import type { PointerInputSnapshot } from '../../ide/common/models';
import type { DisposableStore, ILifetime } from '../../ide/common/lifecycle';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { insertValue } from '../../ide/editor/ui/inline/text_field';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';

const choices = [
	{ label: 'alpha', description: '', detail: '', id: 1 },
	{ label: 'beta', description: '', detail: '', id: 2 },
];

function fixture(t: TestContext) {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const area = { left: 0, top: 0, right: 384, bottom: 288 };
	const menu = new ContextMenuController(inputFocus, pointerCapture, area);
	const picker = new QuickInputController(menu, undefined, undefined, { scope: inputFocus.workbenchScope, bounds: area, kind: 'workspace' });
	const scope = new InputFocusScope(Symbol('async catalog origin'), inputFocus.workbenchScope);
	const origin = inputFocus.createTarget(null, scope); origin.bindKeyboard(() => {}); origin.focus();
	t.after(() => { picker.dispose(); menu.dispose(); pointerCapture.cancel(); inputFocus.setTarget(null); });
	return { picker, origin, scope };
}

function createOwner() {
	const listeners = new Set<() => void>();
	let disposed = false;
	return {
		get isDisposed() { return disposed; },
		onWillDispose(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		dispose() {
			disposed = true;
			for (const listener of listeners) listener();
			listeners.clear();
		},
		get listenerCount() { return listeners.size; },
	} satisfies ILifetime & { dispose(): void; readonly listenerCount: number };
}

test('async catalog discovery starts after blur and native session admission, then uses the query typed while loading', async t => {
	const { picker, origin } = fixture(t), completion = Promise.withResolvers<TextQuickPickProvider<typeof choices[number]>>();
	let blurred = false, calls = 0, accepted: typeof choices[number] | undefined;
	t.after(origin.onDidBlur(() => { blurred = true; }));
	picker.pick('Catalog', '', prepared => {
		calls++;
		assert.ok(prepared === origin && blurred, 'discovery observes the committed invoking control');
		assert.equal(picker.visible, true); assert.equal(picker.busy, true);
		assert.equal(picker.model.list.rows.length, 0);
		assert.equal(picker.model.viewport.contentHeight, 0, 'the admitted pending session has no stale list input');
		return completion.promise;
	}, item => { accepted = item; });
	assert.equal(calls, 1); assert.ok(inputFocus.admittedTarget === picker.field.focusTarget);
	assert.ok(picker.layout.messageLines.length > 0, 'the native renderer prepares pending feedback before returning to input');
	insertValue(picker.field, 'beta');
	for (const code of ['Enter', 'PageDown', 'ArrowDown']) inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none));
	assert.equal(accepted, undefined); assert.equal(picker.model.list.selectionIndex, -1);
	const provider = new TextQuickPickProvider(choices), subscription = t.mock.method(provider, 'onDidChange');
	assert.equal(subscription.mock.callCount(), 0);
	completion.resolve(provider); await completion.promise;
	assert.equal(picker.busy, false); assert.equal(picker.field.text, 'beta');
	assert.ok(picker.model.items === choices);
	assert.equal(picker.model.list.rows.length, 1); assert.ok(picker.model.list.rows[0].item === choices[1]);
	assert.equal(subscription.mock.callCount(), 1);
	picker.accept(); assert.ok(accepted === choices[1]); assert.equal(picker.visible, false);
});

for (const source of ['factory', 'promise'] as const)
	for (const outcome of ['resolve', 'reject'] as const)
		for (const end of ['cancel', 'replacement', 'blur', 'origin', 'dispose'] as const)
			test(`${source} catalog ${outcome} cannot publish after session ${end}`, async t => {
				const { picker, scope } = fixture(t), completion = Promise.withResolvers<TextQuickPickProvider<typeof choices[number]>>();
				const provider = new TextQuickPickProvider(choices), subscription = t.mock.method(provider, 'onDidChange');
				const projection = t.mock.method(provider, 'getPicks');
				let retirements = 0;
				picker.pick('Pending', '', source === 'factory' ? () => completion.promise : completion.promise,
					() => assert.fail('retired catalog accepted'), lifetime => lifetime.add({ dispose: () => { retirements++; } }));
				assert.equal(picker.busy, true);
				const replacement = new TextQuickPickProvider(choices.slice(1));
				if (end === 'cancel') inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none));
				else if (end === 'replacement') picker.pick('New owner', '', () => replacement, () => {});
				else if (end === 'blur') inputFocus.createTarget().focus();
				else if (end === 'origin') scope.retireContext();
				else picker.dispose();
				assert.equal(retirements, 1);
				const focus = inputFocus.admittedTarget;
				if (outcome === 'resolve') { completion.resolve(provider); await completion.promise; }
				else { completion.reject(new Error('retired discovery failed')); await completion.promise.then(undefined, () => {}); }
				assert.equal(picker.visible, end === 'replacement'); assert.equal(picker.busy, false);
				assert.ok(inputFocus.admittedTarget === focus, 'late settlement cannot reacquire input');
				assert.equal(subscription.mock.callCount(), 0); assert.equal(projection.mock.callCount(), 0);
				assert.equal(picker.message, '', 'retired errors do not contaminate another presentation');
				if (end === 'replacement') assert.ok(picker.model.items === replacement.items);
				else assert.equal(picker.model.items.length, 0);
			});

for (const outcome of ['resolve', 'reject'] as const)
	test(`an already-started catalog promise is observed when blur vetoes prepare before ${outcome}`, async t => {
		const { picker, origin } = fixture(t), completion = Promise.withResolvers<TextQuickPickProvider<typeof choices[number]>>();
		const replacement = new TextQuickPickProvider(choices.slice(1));
		const unbind = origin.onDidBlur(() => {
			unbind(); picker.pick('New owner', '', () => replacement, () => {});
		}); t.after(unbind);
		picker.pick('Vetoed', '', completion.promise, () => assert.fail('vetoed catalog accepted'));
		assert.ok(picker.model.items === replacement.items);
		const focus = inputFocus.admittedTarget;
		if (outcome === 'resolve') { completion.resolve(new TextQuickPickProvider(choices)); await completion.promise; }
		else { completion.reject(new Error('accepted operation failed')); await completion.promise.then(undefined, () => {}); }
		assert.ok(picker.model.items === replacement.items && inputFocus.admittedTarget === focus);
		assert.equal(picker.message, ''); assert.equal(picker.busy, false);
	});

test('a factory vetoed during blur never starts observational work', t => {
	const { picker, origin } = fixture(t), replacement = new TextQuickPickProvider(choices);
	const unbind = origin.onDidBlur(() => {
		unbind(); picker.pick('Replacement', '', () => replacement, () => {});
	}); t.after(unbind);
	picker.pick('Vetoed', '', () => assert.fail('vetoed discovery started'), () => assert.fail('vetoed pick accepted'));
	assert.ok(picker.model.items === replacement.items); assert.equal(picker.busy, false);
});

test('a direct promised catalog is observed even when the native controller was already disposed', async t => {
	const { picker } = fixture(t); picker.dispose();
	const completion = Promise.withResolvers<TextQuickPickProvider<typeof choices[number]>>();
	picker.pick('Disposed', '', completion.promise, () => assert.fail('disposed catalog accepted'));
	completion.reject(new Error('operation failed after disposal'));
	await completion.promise.then(undefined, () => {});
	assert.equal(picker.visible, false); assert.equal(picker.busy, false); assert.equal(picker.message, '');
});

test('a promise returned after its own factory retires the session is still observed', async t => {
	const { picker } = fixture(t), completion = Promise.withResolvers<TextQuickPickProvider<typeof choices[number]>>();
	const replacement = new TextQuickPickProvider(choices.slice(1));
	picker.pick('Old owner', '', () => {
		picker.pick('New owner', '', () => replacement, () => {});
		return completion.promise;
	}, () => assert.fail('retired factory accepted'));
	completion.reject(new Error('superseded factory failed'));
	await completion.promise.then(undefined, () => {});
	assert.ok(picker.model.items === replacement.items); assert.equal(picker.message, '');
	assert.ok(inputFocus.admittedTarget === picker.field.focusTarget);
});

test('current catalog failure replaces loading feedback without acquiring a provider or accepting a row', async t => {
	const { picker } = fixture(t), completion = Promise.withResolvers<TextQuickPickProvider<typeof choices[number]>>();
	picker.pick('Catalog', '', () => completion.promise, () => assert.fail('failed catalog accepted'));
	insertValue(picker.field, 'beta');
	const failure = new Error('Catalog read failed'); completion.reject(failure);
	await completion.promise.then(undefined, () => {});
	assert.equal(picker.visible, true); assert.equal(picker.busy, false);
	assert.equal(picker.message, failure.message, 'the actual producer failure is the presented data');
	assert.ok(picker.layout.messageLines.length > 0); assert.equal(picker.field.text, 'beta');
	assert.equal(picker.model.list.selectionIndex, -1); assert.equal(picker.model.items.length, 0);
	picker.accept(); assert.equal(picker.visible, true);
	insertValue(picker.field, 'a');
	assert.equal(picker.message, failure.message, 'query edits cannot turn a failed catalog into a ready empty catalog');
	picker.pick('Ready', '', () => new TextQuickPickProvider([]), () => assert.fail('empty catalog accepted'));
	assert.equal(picker.message, ''); assert.equal(picker.busy, false); assert.equal(picker.layout.messageLines.length, 0);
	assert.equal(picker.model.list.rows.length, 0, 'ready emptiness uses the ordinary no-matches presentation');
});

test('an empty producer error remains a failed catalog rather than a ready no-matches list', async t => {
	const { picker } = fixture(t), completion = Promise.withResolvers<TextQuickPickProvider<typeof choices[number]>>();
	picker.pick('Catalog', '', completion.promise, () => assert.fail('failed catalog accepted'));
	completion.reject(new Error('')); await completion.promise.then(undefined, () => {});
	assert.equal(picker.failed, true); assert.equal(picker.busy, false); assert.equal(picker.message, '');
	assert.ok(picker.layout.messageLines.length > 0, 'failed phase remains visibly distinct even when its supplied diagnostic is empty');
	assert.equal(picker.model.viewport.height, 0, 'the renderer must not admit the ordinary empty-list viewport for a failed catalog');
});

for (const outcome of ['resolve', 'reject'] as const)
	test(`pending and ${outcome} catalogs retire old row capture and the real scrolling range`, async t => {
		const { picker } = fixture(t), previous = Array.from({ length: 40 }, (_, id) => ({ label: `${id}`, description: '', detail: '', id }));
		let accepted = 0;
		picker.pick('Previous', '', () => new TextQuickPickProvider(previous), () => { accepted++; });
		const viewport = picker.model.viewport;
		assert.equal(viewport.scrollbar.isVisible(), true);
		const snapshot: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true,
			viewportX: viewport.bounds.left + 2, viewportY: viewport.bounds.top + 2,
			pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
		// Layout supplies coordinates only to drive the old physical row gesture.
		picker.handlePointer(snapshot, true); assert.equal(pointerCapture.active, true);
		const completion = Promise.withResolvers<TextQuickPickProvider<typeof choices[number]>>();
		picker.pick('Pending', '', completion.promise, () => { accepted++; });
		assert.equal(pointerCapture.active, false); assert.equal(viewport.contentHeight, 0);
		assert.equal(viewport.scrollbar.isVisible(), false); assert.equal(viewport.scrollbar.getMaximumScroll(), 0);
		assert.equal(picker.model.list.rows.length, 0); assert.equal(picker.model.list.hoverIndex, -1);
		if (outcome === 'resolve') { completion.resolve(new TextQuickPickProvider(choices)); await completion.promise; }
		else { completion.reject(new Error('catalog unavailable')); await completion.promise.then(undefined, () => {}); }
		picker.handlePointer({ ...snapshot, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false);
		assert.equal(accepted, 0, 'releasing the old press cannot accept a newly admitted catalog');
		assert.equal(pointerCapture.active, false);
		if (outcome === 'reject') {
			assert.equal(viewport.contentHeight, 0); assert.equal(viewport.scrollbar.getMaximumScroll(), 0);
		} else assert.ok(picker.model.items === choices);
	});

test('async provider metadata attachment cannot publish over its reentrant replacement', async t => {
	const { picker } = fixture(t), completion = Promise.withResolvers<TextQuickPickProvider<typeof choices[number]>>();
	const provider = new TextQuickPickProvider(choices), replacement = new TextQuickPickProvider(choices.slice(1));
	let unbound = 0;
	t.mock.method(provider, 'onDidChange', () => {
		picker.pick('Replacement', '', () => replacement, () => {});
		return () => { unbound++; };
	});
	picker.pick('Pending', '', completion.promise, () => assert.fail('replaced catalog accepted'));
	completion.resolve(provider); await completion.promise;
	assert.equal(unbound, 1); assert.ok(picker.model.items === replacement.items);
	assert.equal(picker.busy, false); assert.ok(inputFocus.admittedTarget === picker.field.focusTarget);
});

test('synchronous provider bugs still propagate instead of becoming asynchronous catalog failures', t => {
	const { picker } = fixture(t), failure = new Error('provider invariant');
	assert.throws(() => picker.pick('Catalog', '', () => { throw failure; }, () => {}), failure);
	assert.equal(picker.message, '');
});

for (const kind of ['factory', 'promise', 'input'] as const)
	test(`a disposed ${kind} owner cannot replace the current picker or its native context`, async t => {
		const { picker } = fixture(t), owner = createOwner(), current = new TextQuickPickProvider(choices);
		let currentRetirements = 0;
		picker.pick('Current', '', () => current, () => {}, lifetime => lifetime.add({ dispose: () => { currentRetirements++; } }));
		insertValue(picker.field, 'beta');
		const focus = inputFocus.admittedTarget, context = picker.field.focusTarget.commandContext;
		const interaction = picker.field.focusTarget.scope.interactionOrigin, origin = picker.invocationOrigin;
		owner.dispose();
		const completion = Promise.withResolvers<TextQuickPickProvider<typeof choices[number]>>();
		if (kind === 'input') picker.input('Declined', '', '', () => assert.fail('declined operation started'), () => {}, undefined, { owner });
		else picker.pick('Declined', '', kind === 'factory' ? () => assert.fail('declined factory started') : completion.promise,
			() => assert.fail('declined catalog accepted'), () => assert.fail('declined presentation published'), { owner });
		if (kind === 'promise') {
			completion.reject(new Error('accepted operation failed after its owner retired'));
			await completion.promise.then(undefined, () => {});
		}
		assert.ok(picker.model.items === choices && inputFocus.admittedTarget === focus);
		assert.ok(picker.field.focusTarget.commandContext === context && picker.field.focusTarget.scope.interactionOrigin === interaction);
		assert.ok(picker.invocationOrigin === origin); assert.equal(picker.field.text, 'beta');
		assert.equal(currentRetirements, 0); assert.equal(picker.busy, false); assert.equal(picker.message, '');
		assert.equal(owner.listenerCount, 0);
	});

for (const outcome of ['resolve', 'reject'] as const)
	test(`actual resource retirement cancels a pending catalog before its late ${outcome}`, async t => {
		const { picker } = fixture(t), owner = createOwner(), completion = Promise.withResolvers<TextQuickPickProvider<typeof choices[number]>>();
		let resourcesRetired = 0;
		picker.pick('Pending', '', () => completion.promise, () => assert.fail('retired source accepted'),
			lifetime => lifetime.add({ dispose: () => { resourcesRetired++; } }), { owner });
		assert.equal(owner.listenerCount, 1); owner.dispose();
		assert.equal(picker.visible, false); assert.equal(owner.listenerCount, 0); assert.equal(resourcesRetired, 1);
		const focus = inputFocus.admittedTarget;
		if (outcome === 'resolve') { completion.resolve(new TextQuickPickProvider(choices)); await completion.promise; }
		else { completion.reject(new Error('retired source failure')); await completion.promise.then(undefined, () => {}); }
		assert.equal(picker.visible, false); assert.equal(picker.message, ''); assert.ok(inputFocus.admittedTarget === focus);
	});

test('owner retirement is subscribed before presentation callbacks can start discovery', t => {
	const { picker } = fixture(t), owner = createOwner();
	picker.pick('Retired while publishing', '', () => assert.fail('retired presentation started discovery'), () => {}, () => {
		assert.equal(owner.listenerCount, 1); owner.dispose();
	}, { owner });
	assert.equal(picker.visible, false); assert.equal(owner.listenerCount, 0);
});

for (const outcome of ['resolve', 'reject'] as const)
	test(`catalog ${outcome} cannot overwrite a newer picker opened by viewport retirement`, async t => {
		const { picker } = fixture(t), owner = createOwner(), completion = Promise.withResolvers<TextQuickPickProvider<typeof choices[number]>>();
		const replacement = new TextQuickPickProvider(choices.slice(1));
		picker.pick('Pending owner', '', completion.promise, () => assert.fail('retired source accepted'), undefined, { owner });
		const unbind = picker.model.viewport.scrollbar.onDidChangeTrack(() => {
			unbind(); owner.dispose(); picker.pick('Replacement', '', () => replacement, () => {});
		}); t.after(unbind);
		if (outcome === 'resolve') { completion.resolve(new TextQuickPickProvider(choices)); await completion.promise; }
		else { completion.reject(new Error('old catalog failure')); await completion.promise.then(undefined, () => {}); }
		assert.ok(picker.model.items === replacement.items, 'a newer admitted catalog owns the shared model');
		assert.equal(picker.message, ''); assert.equal(picker.busy, false); assert.equal(owner.listenerCount, 0);
		assert.ok(inputFocus.admittedTarget === picker.field.focusTarget);
	});

for (const kind of ['pick', 'input'] as const)
	for (const retireAt of ['resources', 'focus'] as const)
		test(`${kind} source admission survives through ${retireAt} callbacks and blocks a retired followup`, async t => {
			const { picker, origin } = fixture(t), owner = createOwner();
			let actions = 0, submissions = 0;
			const replacement = new TextQuickPickProvider(choices.slice(1));
			if (retireAt === 'focus') {
				const unbind = origin.onDidFocus(() => {
					unbind(); assert.equal(owner.listenerCount, 1); owner.dispose();
					picker.pick('New owner', '', () => replacement, () => {});
				}); t.after(unbind);
			}
			const onWillShow = retireAt === 'resources' ? (lifetime: DisposableStore) => {
				lifetime.add({ dispose: () => { assert.equal(owner.listenerCount, 1); owner.dispose(); } });
			} : undefined;
			if (kind === 'pick') picker.pick('Old source', '', () => new TextQuickPickProvider(choices), () => { actions++; }, onWillShow, { owner });
			else picker.input('Old source', '', '', async value => { submissions++; return value; }, () => { actions++; }, onWillShow, { owner });
			await picker.accept();
			assert.equal(owner.isDisposed, true); assert.equal(owner.listenerCount, 0); assert.equal(actions, 0);
			assert.equal(submissions, kind === 'input' ? 1 : 0, 'an already accepted operation is independent of its followup presentation');
			assert.equal(picker.visible, retireAt === 'focus');
			if (retireAt === 'focus') assert.ok(picker.model.items === replacement.items && inputFocus.admittedTarget === picker.field.focusTarget);
		});

for (const end of ['hide', 'accept', 'replace', 'dispose'] as const)
	test(`session ${end} releases its owner subscription without disposing that resource`, async t => {
		const { picker } = fixture(t), owner = createOwner(), dispose = t.mock.method(owner, 'dispose');
		const operation = Promise.withResolvers<void>(); let started = 0, completed = 0;
		picker.pick('Source', '', () => new TextQuickPickProvider(choices), () => {
			started++; void operation.promise.then(() => { completed++; });
		}, undefined, { owner });
		assert.equal(owner.listenerCount, 1);
		if (end === 'hide') picker.hide();
		else if (end === 'accept') picker.accept();
		else if (end === 'replace') picker.pick('Replacement', '', () => new TextQuickPickProvider(choices.slice(1)), () => {});
		else picker.dispose();
		assert.equal(dispose.mock.callCount(), 0); assert.equal(owner.isDisposed, false); assert.equal(owner.listenerCount, 0);
		operation.resolve(); await operation.promise;
		assert.equal(started, end === 'accept' ? 1 : 0); assert.equal(completed, started);
	});
