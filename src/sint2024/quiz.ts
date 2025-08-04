import { GameObject, StateMachineBlueprint, build_fsm, insavegame, type State } from '../bmsx/index';
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
export class quiz extends GameObject {
    /**
     * An array of strings used to store text data.
     */
    text: string[] = [];
    /**
     * The index of the current question being displayed.
     * Initialized to 0, indicating the first question.
     */
    currentQuestionIndex = 0;
    /**
     * Represents the currently chosen answer option.
     */
    currentAnswerOptionChosen: 'a' | 'b' = 'a';

    /**
     * An array of strings representing the full text lines.
     */
    fullTextLines: string[] = [];
    /**
     * An array of strings representing the lines that are currently displayed.
     */
    displayedLines: string[] = [];
    /**
     * The index of the current line being shown as the text is being printed on screen character by character.
     */
    currentLineIndex = 0;
    /**
     * Index of the current character being shown as the text is being printed on screen character by character.
     */
    currentCharIndex = 0;

    /**
     * A boolean flag indicating that the text is being printed on screen character by character.
     */
    isTyping = false;
    /**
     * Sets the maximum number of characters allowed per line for text being printed to screen.
     *
     * @param maximum_characters_per_line - The maximum number of characters allowed per line.
     */
    maximum_characters_per_line = maximum_characters_per_line_question;

    private centeredBlockX = 0;

    /**
     * Creates an instance of the quiz class.
     */
    constructor() {
        super('quiz');
    }

    /**
     * Paints the text on the screen.
     *
     * This method overrides the base class's paint method. It calculates the starting
     * Y position based on the character width and iterates over each line of text,
     * drawing it on the screen at the specified X and Y coordinates.
     *
     * @override
     */
    public override paint(): void {
        const charWidth = 8;
        const startY = 2 * charWidth;

        const xOffset = this.centeredBlockX;

        this.text.forEach((line, index) => {
            $.drawText(xOffset, index * charWidth + startY, line, undefined, undefined, undefined, { r: 0, g: 0, b: 0, a: 1 });
        });
    }

    /**
     * Sets the text from an array of lines, wraps the text, and initializes the display properties.
     *
     * @param lines - An array of strings where each string represents a line of text.
     *
     * This method performs the following steps:
     * 1. Combines the lines into a single string with newline characters.
     * 2. Wraps the combined text.
     * 3. Initializes the `fullTextLines` with the wrapped lines.
     * 4. Initializes the `displayedLines` as an array of empty strings with the same length as `fullTextLines`.
     * 5. Resets the `currentLineIndex` and `currentCharIndex` to 0.
     * 6. Sets the `isTyping` flag to true.
     * 7. Calculates the centered block X position.
     * 8. Updates the displayed text.
     */
    private setTextFromLines(lines: string[]) {
        const combined = lines.join('\n');
        const wrappedLines = this.wrapText(combined);

        this.fullTextLines = wrappedLines;
        this.displayedLines = this.fullTextLines.map(() => '');
        this.currentLineIndex = 0;
        this.currentCharIndex = 0;
        this.isTyping = true;

        this.calculateCenteredBlockX();

        this.updateDisplayedText();
    }

    /**
     * Calculates the X coordinate for centering a block of text on the screen.
     *
     * This method determines the longest line of text from `this.fullTextLines`,
     * calculates its width in pixels, and then computes the X coordinate needed
     * to center this line on a screen with a fixed width of 256 pixels.
     *
     * @private
     */
    private calculateCenteredBlockX() {
        const charWidth = 8;
        const screenWidth = 256;

        const longestLine = this.fullTextLines.reduce((a, b) => a.length > b.length ? a : b, '');
        const longestLineWidth = longestLine.length * charWidth;
        this.centeredBlockX = (screenWidth - longestLineWidth) / 2;
    }

    /**
     * Splits a given text into an array of strings, where each string represents a line of text
     * that does not exceed the maximum number of characters per line. The method also respects
     * newline characters in the input text.
     *
     * @param text - The input text to be wrapped into lines.
     * @returns An array of strings, where each string is a line of text.
     */
    private wrapText(text: string): string[] {
        const words = text.match(/(\S+|\n)/g) || [];
        const lines: string[] = [];
        let currentLine = '';

        for (const word of words) {
            if (word === '\n') {
                lines.push(currentLine.trim());
                currentLine = '';
                lines.push('');
            } else {
                const tentativeLine = currentLine ? currentLine + ' ' + word : word;
                if (tentativeLine.length <= this.maximum_characters_per_line) {
                    currentLine = tentativeLine;
                } else {
                    if (currentLine) {
                        lines.push(currentLine.trim());
                        currentLine = word;
                    } else {
                        lines.push(word);
                        currentLine = '';
                    }
                }
            }
        }

        if (currentLine.trim()) {
            lines.push(currentLine.trim());
        }

        return lines;
    }

    /**
     * Handles the typing effect by adding the next character from the current line
     * to the displayed text. If the end of the current line is reached, it moves
     * to the next line. If all lines have been processed, it stops the typing effect.
     *
     * @private
     * @method
     * @returns {void}
     */
    private typeNextCharacter(): void {
        if (!this.isTyping) return;

        if (this.currentLineIndex >= this.fullTextLines.length) {
            this.isTyping = false;
            return;
        }

        const line = this.fullTextLines[this.currentLineIndex];
        if (this.currentCharIndex < line.length) {
            const charToAdd = line[this.currentCharIndex];
            this.displayedLines[this.currentLineIndex] += charToAdd;
            this.currentCharIndex++;
        } else {
            this.currentLineIndex++;
            this.currentCharIndex = 0;
            if (this.currentLineIndex >= this.fullTextLines.length) {
                this.isTyping = false;
            }
        }

        this.updateDisplayedText();
    }

    /**
     * Updates the displayed text by copying the contents of `displayedLines` to `text`.
     * This method ensures that the `text` property reflects the current state of `displayedLines`.
     */
    private updateDisplayedText(): void {
        this.text = [...this.displayedLines];
    }

    /**
     * Switches the current Sint game object to a question state.
     *
     * @param this - The current quiz instance.
     */
    switchSintToQuestion(this: quiz) {
        const sint = $.getGameObject('sint');
        sint.sc.do('vraag', sint);
    }

    /**
     * Switches the Sint game object to the answer state.
     *
     * @param this - The current quiz instance.
     */
    switchSintToAnswer(this: quiz) {
        const sint = $.getGameObject('sint');
        sint.sc.do('antwoord', sint);
    }

    /**
     * Switches the state of the 'sint' game object to 'klaar'.
     *
     * @param this - The current instance of the quiz class.
     */
    switchSintToKlaar(this: quiz) {
        const sint = $.getGameObject('sint');
        sint.sc.do('klaar', sint);
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
        quizItems = $.rom.data[DataId.vragen] as QuizItem[];
        if (!quizItems) {
            throw new Error('Quiz items not loaded. Please ensure the rompack data is available.');
        }

        return {
            states: {
                _start: {
                    enter(this: quiz) {
                        this.maximum_characters_per_line = maximum_characters_per_line_question;
                        this.setTextFromLines(['Beste Eli,', 'Welkom bij deze quiz,', 'Een speelse uitdaging,dat is wat dit is.', 'Met vragen over films,sport en spel,', 'Ben je klaar?', 'Dan beginnen we snel!']);
                    },
                    run(this: quiz, _state: State) {
                        this.typeNextCharacter();
                    },
                    on_input: {
                        '?(a[j!c], b[j!c])': {
                            do() { $.consumeActions(1, 'a', 'b') },
                            to: 'vraag'
                        },
                        'down[j]': 'end',
                    }
                },

                vraag: {
                    tape: Array.from({ length: quizItems.length }, (_, i) => i),
                    auto_reset: 'none',
                    enter(this: quiz, state: State, args: string) {
                        if (args === 'prev') {
                            state.setHeadNoSideEffect(state.head - 2);
                            if (state.head < 0) {
                                state.rewind_tape();
                            }
                        }
                        else if (args === 'next') {
                            // Do nothing
                        }
                        ++state.ticks;
                        this.switchSintToQuestion();

                        const idx = state.current_tape_value;
                        const currentQ = quizItems[idx];
                        if (currentQ.imgid) {
                            $.getGameObject<sint>('sint').setimg(currentQ.imgid);
                        }
                        this.setTextFromLines([
                            `Vraag ${idx + 1}/${quizItems.length}: ${currentQ.question}`,
                            ...currentQ.options
                        ]);
                    },
                    run(this: quiz, _state: State) {
                        this.typeNextCharacter();
                    },
                    next(this: quiz, state: State) {
                        this.currentQuestionIndex = state.current_tape_value;
                    },
                    end(this: quiz) {
                        return 'end';
                    },
                    on_input: {
                        'a[j!c]': {
                            do(this: quiz) {
                                $.consumeAction(1, 'a');
                                this.currentAnswerOptionChosen = 'a';
                                return { state_id: 'antwoord', args: this.currentAnswerOptionChosen };
                            },
                        },
                        'b[j!c]': {
                            do(this: quiz) {
                                $.consumeAction(1, 'b');
                                this.currentAnswerOptionChosen = 'b';
                                return { state_id: 'antwoord', args: this.currentAnswerOptionChosen };
                            },
                        },
                        'left[j!c]': {
                            do(this: quiz) {
                                $.consumeAction(1, 'left');
                                return { state_id: 'vraag', args: 'prev', force_transition_to_same_state: true, transition_type: 'to' };
                            },
                        },
                        'right[j!c]': {
                            do(this: quiz) {
                                $.consumeAction(1, 'right');
                                return { state_id: 'vraag', args: 'next', force_transition_to_same_state: true, transition_type: 'to' };
                            },
                        },
                    },
                },

                antwoord: {
                    enter(this: quiz, _state: State, gekozen_antwoord: string) {
                        this.switchSintToAnswer();
                        const currentQ = quizItems[this.currentQuestionIndex];
                        if (gekozen_antwoord === 'a') {
                            this.setTextFromLines([currentQ.reactionA]);
                        } else {
                            this.setTextFromLines([currentQ.reactionB]);
                        }
                    },
                    run(this: quiz, _state: State) {
                        this.typeNextCharacter();
                    },
                    on_input: {
                        '?(a[j!c], b[j!c])': {
                            do(this: quiz) {
                                $.consumeActions(1, 'a', 'b');
                                if (this.currentQuestionIndex < quizItems.length - 1) {
                                    return 'vraag';
                                } else {
                                    return 'end';
                                }
                            },
                        },
                    },
                },

                end: {
                    guards: {
                        canExit(this: quiz) { return false; }
                    },
                    enter(this: quiz) {
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
                    run(this: quiz, _state: State) {
                        this.typeNextCharacter();
                    }
                }
            }
        };
    }
}
