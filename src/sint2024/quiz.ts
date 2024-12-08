import { GameObject, StateMachineBlueprint, build_fsm, insavegame, type State } from '../bmsx/bmsx';

const vragen = [
    "Welke club speelde Bobby Charlton?\nA) Liverpool\nB) Manchester United",
    "Welke prijs won Johan Cruijff in 1974?\nA) Europees voetballer van het jaar\nB) Wereldbeker beste speler",
    "Waarom speelde Pelé nooit in Europa?\nA) Hij bleef trouw aan Brazilië\nB) Hij vond Europese competities te moeilijk",
    "Naar wie spelen de voetballers van Oranje altijd de bal zonder te kijken?\nA) Naar voren om daarna op doel te schieten!\nB) Naar de keeper.",
    "Hoe proberen Ajax en Oranje altijd te scoren?\nA) Door direct op doel te schieten vanaf een grote afstand!\nB) Door de bal biologisch te behandelen.",
    "Als een voetballer slecht presteert, wie moet je dan haten?\nA) Hem en Koeman.\nB) Hem en zijn familie.",
    "Wie speelde de hoofdrol in Samson en Delilah?\nA) Victor Mature\nB) Kirk Douglas",
    "Welke film kwam eerder uit?\nA) Samson en Delilah\nB) Ben-Hur",
    "Welke film werd jarenlang de bestverkochte film aller tijden?\nA) Gone with the Wind\nB) Casablanca",
    "In welke epische films speelde Charlton Heston?\nA) Ben-Hur en The Ten Commandments\nB) Cleopatra en Spartacus",
    "Wat betekent de naam van het personage Victor Pivert?\nA) Specht\nB) Eekhoorn",
    "Welk beroemd klassiek stuk speelde Larry Adler op zijn mondharmonica?\nA) Het Zwanenmeer\nB) De Vijfde Symfonie van Beethoven",
    "Welke aanval maakte Big Daddy legendarisch?\nA) De 'belly splash'\nB) De 'flying elbow smash'",
    "Wie zei altijd ‘wil je een koekje, dan krijg je een koekje’?\nA) Fred Rooijers.\nB) Jack van Gelder.",
    "Wat is Toeter?\nA) Een snorkel zoals alle anderen.\nB) Uniek.",
    "Wie is de menselijke kapitein in De Snorkels?\nA) Kapitein Blunderhoofd.\nB) Kapitein Ortega.",
    "De hex Agatha kan Gargamel's naam niet goed onthouden. Hoe noemt ze Gargamel?\nA) Grumel.\nB) Karnemelk.",
    "Welke citaat komt uit de aflevering van Paradijsvogels met de kleurrijke Eli?\nA) Ik laat mij gewoon verdwalen.\nB) Ik sterf liever niet in de winter, want dat vind ik te koud.",
    "Hoe zou Louis van Gaal denken over de beste rol van Sinterklaas in het Nederlands Elftal?\nA) Spits\nB) Coach",
];

const antwoordA = [
    "Hmm, Liverpool is een geweldige club, maar niet de juiste hier. Bobby Charlton was een legende bij Manchester United!", //0
    "Helemaal goed! Johan Cruijff was in 1974 dé ster in Europa!", //1
    "Helemaal goed! Pelé bleef altijd trouw aan Brazilië.", //2
    "Haha, precies! Dat zou Oranje tenminste wat opleveren. Als Sinterklaas coach was, zou ik het ook zo doen!", //3 aangepast
    "Juist! Een beetje actie, dat willen we zien! Maar jij en ik weten allebei dat ze er meestal veel te lang over doen.", //4 aangepast
    "Nee, alleen hem en Koeman? Dat is niet volledig genoeg! Jij zegt altijd 'Ik haat jou én jouw familie!' Een klassieker van jou!", //5 aangepast (fout antwoord bij A, maar hoort in antwoordA)
    "Juist! Victor Mature was de hoofdrolspeler.", //6
    "Heel goed! Samson en Delilah kwam eerder uit.", //7
    "Uitstekend! Gone with the Wind stond jarenlang bovenaan.", //8
    "Uitstekend! Heston schitterde in Ben-Hur en The Ten Commandments.", //9
    "Uitstekend! Pivert betekent 'specht'.", //10
    "Juist! Het prachtige Zwanenmeer werd vertolkt door Larry Adler.", //11
    "Precies! De 'belly splash' van Big Daddy was legendarisch!", //12
    "Juist! Fred Rooijers maakte dit legendarische citaat beroemd – bijna net zo beroemd als Sinterklaas zelf!", //13 aangepast
    "Nee, nee! Toeter is géén snorkel zoals alle anderen. Jij zegt zelf altijd: 'Toeter is uniek!' En daar ben ik het helemaal mee eens.", //14 aangepast (fout antwoord bij A, hoort in antwoordA)
    "Haha, een creatieve keuze, maar helaas fout. Kapitein Ortega is de juiste naam – dat weet zelfs ik!", //15 aangepast (fout bij A)
    "Niet slecht, maar helaas fout. Ze noemt hem Karnemelk – en dat klinkt toch ook wel erg grappig, vind je niet?", //16 aangepast (fout bij A)
    "Juist! Een prachtige uitspraak: 'Ik laat mij gewoon verdwalen.' Dat is bijna poëzie, vind je niet?", //17 aangepast (goed bij A)
    "Haha, Sinterklaas als spits! Hij scoort altijd!", //18 (bonus, ongewijzigd)
];

const antwoordB = [
    "Precies! Bobby Charlton was een legende bij Manchester United!", //0
    "In 1974 won Cruijff Europees voetballer van het jaar, niet de wereldbeker beste speler.", //1
    "Pelé had de Europese competities zeker aankunnen! Hij bleef echter trouw aan zijn thuisland.", //2
    "Oh nee, naar de keeper, zonder te kijken? Dat is precies waar jij je altijd aan ergert – en gelijk heb je! Zelfs Amerigo zou dat beter doen!", //3 aangepast
    "Biologisch behandelen? Dat klinkt alsof ze pepernoten proberen te bakken! Jij weet net als ik dat het soms eeuwig duurt voordat er echt geschoten wordt.", //4 aangepast
    "Juist! 'Ik haat jou en jouw familie!' zeg je altijd als je boos bent. Ik weet niet of het aardig is, maar het is wel heel herkenbaar!", //5 aangepast (goed bij B)
    "Kirk Douglas is een groot acteur, maar hier was het Victor Mature.", //6
    "Ben-Hur is episch, maar Samson en Delilah was eerder.", //7
    "Casablanca is prachtig, maar niet de bestverkochte.", //8
    "Logische keuze, maar Heston speelde in Ben-Hur en The Ten Commandments.", //9
    "Pivert betekent 'specht', niet eekhoorn.", //10
    "Beethoven is mooi, maar Larry Adler speelde het Zwanenmeer.", //11
    "Spectaculair, maar niet juist. Big Daddy's move was de 'belly splash'!", //12
    "Oh nee! Jack van Gelder mag veel gezegd hebben, maar dit koekjescitaat komt toch echt van Fred Rooijers.", //13 aangepast (fout bij B)
    "Juist! 'Toeter is uniek,' zoals jij altijd zegt. Sinterklaas heeft dat zelf in zijn grote boek geschreven. Een prachtige uitspraak!", //14 aangepast (goed bij B)
    "Precies! Kapitein Ortega is dé menselijke kapitein in De Snorkels. Jij en ik weten dat natuurlijk allang!", //15 aangepast (goed bij B)
    "Juist! Karnemelk is inderdaad hoe Agatha hem noemt. Zelfs Sinterklaas moet daar altijd om lachen!", //16 aangepast (goed bij B)
    "Ook goed! 'Ik sterf liever niet in de winter' is minstens zo kleurrijk als Eli zelf. Beide passen perfect!", //17 aangepast (ook goed bij B)
    "Precies! Sinterklaas als coach: altijd tactisch en met surprises!", //18 (bonus B ongewijzigd)
];

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
                        canEnter(this: quiz, state: State) { return !state.at_tapeend },
                    },
                    tape: Array.from({ length: vragen.length }, (_, i) => i),
                    auto_reset: 'none',
                    enter(this: quiz, state: State) {
                        ++state.ticks;
                        this.switchSintToQuestion();
                        this.setText(`Vraag ${(state.current_tape_value + 1)}/${vragen.length}:${vragen[state.current_tape_value]}`);
                    },
                    next(this: quiz, state: State) {
                        this.currentQuestionIndex = state.current_tape_value;
                        console.log(this.currentQuestionIndex);
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
                                $.consumeAction(1, 'b')
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
                                if (this.currentQuestionIndex < vragen.length - 1) {
                                    return 'vraag';
                                } else {
                                    return 'end';
                                }
                            },
                        },
                    },
                    enter(this: quiz, _state: State, gekozen_antwoord: string) {
                        this.switchSintToAnswer();
                        switch (gekozen_antwoord) {
                            case 'a':
                                this.setText(antwoordA[this.currentQuestionIndex]);
                                break;
                            case 'b':
                                this.setText(antwoordB[this.currentQuestionIndex]);
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
