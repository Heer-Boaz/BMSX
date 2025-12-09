import { $, TextObject, StateMachineBlueprint, build_fsm, insavegame, type State, type RevivableObjectArgs, CustomVisualComponent } from 'bmsx';
import { create_gameevent } from 'bmsx/core/game_event';
import { DataId } from './resourceids';
import type { sint } from './sint';
// import quizItemsData from './vragen.json';

/**
 * Represents a quiz item with a question, optional image, multiple options, and reactions.
 */
interface QuizItem {
	/**
	 * The question text for the quiz item.
	 */
	question: string;

	/**
	 * Optional image ID associated with the quiz item.
	 */
	imgid?: string;

	/**
	 * The list of options for the quiz item.
	 */
	options: string[];

	/**
	 * The reaction text for the first option.
	 */
	reactionA: string;

	/**
	 * The reaction text for the second option.
	 */
	reactionB: string;
}

/**
 * An array of quiz items.
 *
 * This array is populated with data from `quizItemsData`.
 *
 * @type {QuizItem[]}
 */
let quizItems: QuizItem[] = null;
/**
 * The maximum number of characters allowed per line in a question.
 */
const maximum_characters_per_line_question = 28;

@insavegame
export class quiz extends TextObject {
	currentQuestionIndex = 0;
	currentAnswerOptionChosen: 'a' | 'b' = 'a';
	override maximum_characters_per_line = maximum_characters_per_line_question;

	/**
	 * Creates an instance of the quiz class.
	 */
	constructor(opts?: RevivableObjectArgs) {
		super({ id: 'quiz', ...opts });
		this.add_component(new CustomVisualComponent({
			parent_or_id: this, producer: ({ rc }) => {
				const charWidth = this.characterWidth;
				const startY = 2 * charWidth;

				const xOffset = this.textOffsetX;

				this.text.forEach((line, index) => {
					rc.submit_glyphs({ x: xOffset, y: index * charWidth + startY, glyphs: line, background_color: { r: 0, g: 0, b: 0, a: 1 } });
				});
			}
		}));
	}

	/**
	 * Switches the current Sint world object to a question state.
	 *
	 * @param this - The current quiz instance.
	 */
	switchSintToQuestion(this: quiz) {
		const sint = $.get_worldobject('sint');
		const event = create_gameevent({ type: 'vraag', emitter: sint });
		sint.sc.dispatch_event(event);
	}

	/**
	 * Switches the Sint world object to the answer state.
	 *
	 * @param this - The current quiz instance.
	 */
	switchSintToAnswer(this: quiz) {
		const sint = $.get_worldobject('sint');
		const event = create_gameevent({ type: 'antwoord', emitter: sint });
		sint.sc.dispatch_event(event);
	}

	/**
	 * Switches the state of the 'sint' world object to 'klaar'.
	 *
	 * @param this - The current instance of the quiz class.
	 */
	switchSintToKlaar(this: quiz) {
		const sint = $.get_worldobject('sint');
		const event = create_gameevent({ type: 'klaar', emitter: sint });
		sint.sc.dispatch_event(event);
	}

	private presentQuestion(nav?: 'prev' | 'next'): void {
		if (nav === 'prev') {
			this.currentQuestionIndex = Math.max(0, this.currentQuestionIndex - 1);
		} else if (nav === 'next') {
			this.currentQuestionIndex = Math.min(quizItems.length - 1, this.currentQuestionIndex + 1);
		} else {
			this.currentQuestionIndex = Math.min(this.currentQuestionIndex, quizItems.length - 1);
		}
		this.switchSintToQuestion();

		const idx = this.currentQuestionIndex;
		const currentQ = quizItems[idx];
		if (currentQ.imgid) {
			$.get_worldobject<sint>('sint').setimg(currentQ.imgid);
		}
		this.setTextFromLines([
			`Vraag ${idx + 1}/${quizItems.length}: ${currentQ.question}`,
			...currentQ.options
		]);
	}

	@build_fsm()
	/**
	 * Constructs and returns a StateMachineBlueprint for the quiz.
	 *
	 * The state machine consists of the following states:
	 *
	 * - `_start`: The initial state where the quiz introduction text is set and displayed.
	 * - `vraag`: The state where a quiz question is presented to the user.
	 * - `antwoord`: The state where the feedback is given to the user's answer.
	 * - `end`: The final state where the quiz completion message is displayed.
	 *
	 * @returns {StateMachineBlueprint} The blueprint of the state machine for the quiz.
	 */
	public static bouw(): StateMachineBlueprint {
		// Load quiz items from the rompack data
		quizItems = $.rompack.data[DataId.vragen] as QuizItem[];
		if (!quizItems) {
			throw new Error('Quiz items not loaded. Please ensure the rompack data is available.');
		}

		return {
			states: {
				_start: {
					entering_state(this: quiz) {
						this.maximum_characters_per_line = maximum_characters_per_line_question;
						this.setTextFromLines(['Beste Eli,', 'Welkom bij deze quiz,', 'Een speelse uitdaging,dat is wat dit is.', 'Met vragen over films,sport en spel,', 'Ben je klaar?', 'Dan beginnen we snel!']);
					},
					tick(this: quiz, _state: State) {
						this.typeNextCharacter();
					},
					input_event_handlers: {
						'?(a[jp], b[jp])': { // Handle both answer options
							go() {
								$.consume_actions(1, 'a', 'b');
								return '/vraag';
							},
						},
						'down[jp]': '/end', // Handle quiz end on "down"
					}
				},

				vraag: {
					entering_state(this: quiz) {
						this.presentQuestion();
					},
					tick(this: quiz, _state: State) {
						this.typeNextCharacter();
					},
					input_event_handlers: {
						'a[jp]': { // Handle answer option A
							go(this: quiz): string {
								$.consume_action(1, 'a');
								this.currentAnswerOptionChosen = 'a';
								return '/antwoord';
							},
						},
						'b[jp]': { // Handle answer option B
							go(this: quiz): string {
								$.consume_action(1, 'b');
								this.currentAnswerOptionChosen = 'b';
								return '/antwoord';
							},
						},
						'left[jp]': { // Handle previous question on "left"
							go(this: quiz) {
								$.consume_action(1, 'left');
								this.presentQuestion('prev');
							},
						},
						'right[jp]': { // Handle next question on "right"
							go(this: quiz): string | void {
								$.consume_action(1, 'right');
								if (this.currentQuestionIndex >= quizItems.length - 1) {
									return '/end';
								}
								this.presentQuestion('next');
							},
						},
					},
				},

				antwoord: {
					entering_state(this: quiz, _state: State) {
						this.switchSintToAnswer();
						const currentQ = quizItems[this.currentQuestionIndex];
						if (this.currentAnswerOptionChosen === 'a') {
							this.setTextFromLines([currentQ.reactionA]);
						} else {
							this.setTextFromLines([currentQ.reactionB]);
						}
					},
					tick(this: quiz, _state: State) {
						this.typeNextCharacter();
					},
					input_event_handlers: {
						'?(a[jp], b[jp])': { // Handle both answer options
							go(this: quiz) {
								$.consume_actions(1, 'a', 'b');
								if (this.currentQuestionIndex < quizItems.length - 1) {
									this.currentQuestionIndex++;
									return '/vraag';
								} else {
									return '/end';
								}
							},
						},
					},
				},

				end: {
					transition_guards: {
						can_exit(this: quiz) { return false; }
					},
					entering_state(this: quiz) {
						// this.maximum_characters_per_line = maximum_characters_per_line_end;
						this.switchSintToKlaar();
						this.setTextFromLines([
							'Gefeliciteerd!Je bent geniaal!Jouw diepgaande kennis is fenomenaal!',
							'Dat je zou winnen,daarover twijfelde ik niet,Ondanks de moeilijke vragen van mijn quizmasterpiet!',
							'',
							'',
							'',
							'',
							'Het was weer een grote eer,\nen zien je graag terug,een volgende keer!'
						]);
					},
					tick(this: quiz, _state: State) {
						this.typeNextCharacter();
					}
				}
			}
		};
	}
}
