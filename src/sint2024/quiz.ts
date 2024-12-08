import { GameObject, StateMachineBlueprint, build_fsm, insavegame, type State } from '../bmsx/bmsx';
import type { sint } from './sint';
import quizItemsData from './vragen.json';

interface QuizItem {
    question: string;
    imgid?: string;
    options: string[];
    reactionA: string;
    reactionB: string;
}

const quizItems: QuizItem[] = quizItemsData;
const maximum_characters_per_line_question = 28;
// const maximum_characters_per_line_end = 20;

@insavegame
export class quiz extends GameObject {
    text: string[] = [];
    currentQuestionIndex = 0;
    currentAnswerOptionChosen: 'a' | 'b' = 'a';

    fullTextLines: string[] = [];
    displayedLines: string[] = [];
    currentLineIndex = 0;
    currentCharIndex = 0;
    isTyping = false;
    maximum_characters_per_line = maximum_characters_per_line_question;

    // Nieuwe veld om de uitlijning stabiel te houden
    private centeredBlockX = 0;

    constructor() {
        super('quiz');
    }

    public override paint(): void {
        const charWidth = 8;
        const startY = 2 * charWidth;

        // Gebruik 'this.centeredBlockX' i.p.v. opnieuw berekenen
        const xOffset = this.centeredBlockX;

        this.text.forEach((line, index) => {
            $.drawText(xOffset, index * charWidth + startY, line, undefined, undefined, undefined, { r: 0, g: 0, b: 0, a: 1 });
        });
    }

    private setTextFromLines(lines: string[]) {
        const combined = lines.join('\n');
        const wrappedLines = this.wrapText(combined);

        this.fullTextLines = wrappedLines;
        this.displayedLines = this.fullTextLines.map(() => '');
        this.currentLineIndex = 0;
        this.currentCharIndex = 0;
        this.isTyping = true;

        // Bepaal hier de uitlijning op basis van fullTextLines
        this.calculateCenteredBlockX();

        this.updateDisplayedText();
    }

    private calculateCenteredBlockX() {
        const charWidth = 8;
        const screenWidth = 256;

        const longestLine = this.fullTextLines.reduce((a, b) => a.length > b.length ? a : b, '');
        const longestLineWidth = longestLine.length * charWidth;
        this.centeredBlockX = (screenWidth - longestLineWidth) / 2;
    }

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

    private typeNextCharacter() {
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

    private updateDisplayedText() {
        this.text = [...this.displayedLines];
    }

    switchSintToQuestion(this: quiz) {
        const sint = $.getGameObject('sint');
        sint.sc.do('vraag', sint);
    }

    switchSintToAnswer(this: quiz) {
        const sint = $.getGameObject('sint');
        sint.sc.do('antwoord', sint);
    }

    switchSintToKlaar(this: quiz) {
        const sint = $.getGameObject('sint');
        sint.sc.do('klaar', sint);
    }

    @build_fsm()
    public static bouw(): StateMachineBlueprint {
        return {
            states: {
                _start: {
                    enter(this: quiz) {
                        this.maximum_characters_per_line = maximum_characters_per_line_question;
                        this.setTextFromLines(['Beste Eli,', 'Welkom bij deze quiz,', 'Een speelse uitdaging,dat is wat dit is.', 'Met vragen over films,sport en spel,', 'Ben je klaar?','Dan beginnen we snel!']);
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
