import { GameObject, StateMachineBlueprint, build_fsm, insavegame, type State } from '../bmsx/bmsx';
import quizItemsData from './vragen.json';

interface QuizItem {
    question: string;
    options: string[];
    reactionA: string;
    reactionB: string;
}

// Gebruik de geïmporteerde JSON-gegevens
const quizItems: QuizItem[] = quizItemsData;

@insavegame
export class quiz extends GameObject {
    text: string[] = [];
    currentQuestionIndex = 0;
    currentAnswerOptionChosen: 'a' | 'b' = 'a';

    constructor() {
        super('quiz');
    }

    public override paint(): void {
        const screenWidth = 256;
        const charWidth = 8;
        const startY = 2 * charWidth;

        // Find the longest line to calculate the centered block width
        const longestLine = this.text.reduce((a, b) => a.length > b.length ? a : b, '');
        const longestLineWidth = longestLine.length * charWidth;
        const centeredBlockX = (screenWidth - longestLineWidth) / 2;

        this.text.forEach((line, index) => {
            const x = centeredBlockX;
            $.drawText(x, index * charWidth + startY, line);
        });
    }

    private setTextFromLines(lines: string[]) {
        const combined = lines.join('\n');
        this.setText(combined);
    }

    private setText(text: string) {
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
                if (tentativeLine.length <= 24) {
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

        this.text = lines;
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
                        this.setText("Welkom bij de quiz! Laten we beginnen.");
                    },
                    on_input: {
                        '?(a[j!c], b[j!c])': {
                            do() { $.consumeActions(1, 'a', 'b') },
                            to: 'vraag',
                        }
                    }
                },

                vraag: {
                    guards: {
                        canEnter(this: quiz, state: State) { return !state.at_tapeend; },
                    },
                    // Gebruik de lengte van quizItems in plaats van vragen.length
                    tape: Array.from({ length: quizItems.length }, (_, i) => i),
                    auto_reset: 'none',
                    enter(this: quiz, state: State) {
                        ++state.ticks;
                        this.switchSintToQuestion();

                        const idx = state.current_tape_value;
                        const currentQ = quizItems[idx];
                        // Gebruik nu setTextFromLines om de vraag en opties te tonen.
                        this.setTextFromLines([
                            `Vraag ${idx + 1}/${quizItems.length}: ${currentQ.question}`,
                            ...currentQ.options
                        ]);
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
                    },
                },

                antwoord: {
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
                    enter(this: quiz, _state: State, gekozen_antwoord: string) {
                        this.switchSintToAnswer();
                        const currentQ = quizItems[this.currentQuestionIndex];
                        switch (gekozen_antwoord) {
                            case 'a':
                                this.setText(currentQ.reactionA);
                                break;
                            case 'b':
                                this.setText(currentQ.reactionB);
                                break;
                            default:
                                throw new Error('Verwachte antwoord A of B');
                        }
                    },
                },

                end: {
                    enter(this: quiz) {
                        this.switchSintToKlaar();
                        this.setText("Gefeliciteerd! Je bent geniaal!!");
                    }
                }
            }
        };
    }
}
