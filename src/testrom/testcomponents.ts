import { Component, componenttags_preprocessing, insavegame, subscribesToParentScopedEvent, subscribesToSelfScopedEvent } from 'bmsx';


@insavegame
@componenttags_preprocessing('test')
export class TestComponent extends Component {
	// Implement virtual methods
	override postprocessingUpdate() {
	}

	// Implement event handlers
	@subscribesToParentScopedEvent('testEvent')
	onTestEvent() {
	}

	@subscribesToSelfScopedEvent('testEvent2')
	onTestEvent2() {
	}

	onTestEvent3() {
	}
}

@insavegame
export class DerivedTestComponent extends TestComponent {
	override postprocessingUpdate() {
		super.postprocessingUpdate();
	}
}
