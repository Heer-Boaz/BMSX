import { $rompack } from './game';

/**
 * Represents a bitmap font used for rendering text.
 */
export class BFont {
    /**
     * The map of font resources.
     */
    protected accessor font_res_map: Record<string, string>;
    public char_width(letter: string): number { return $rompack.img[this.letter_to_img[letter]].imgmeta.width; }
    public char_height(letter: string): number { return $rompack.img[this.letter_to_img[letter]].imgmeta.height; }
    readonly letter_to_img: Record<string, string> = {
        '0': 'letter_0',
        '1': 'letter_1',
        '2': 'letter_2',
        '3': 'letter_3',
        '4': 'letter_4',
        '5': 'letter_5',
        '6': 'letter_6',
        '7': 'letter_7',
        '8': 'letter_8',
        '9': 'letter_9',
        'a': 'letter_a',
        'b': 'letter_b',
        'c': 'letter_c',
        'd': 'letter_d',
        'e': 'letter_e',
        'f': 'letter_f',
        'g': 'letter_g',
        'h': 'letter_h',
        'i': 'letter_i',
        'j': 'letter_j',
        'k': 'letter_k',
        'l': 'letter_l',
        'm': 'letter_m',
        'n': 'letter_n',
        'o': 'letter_o',
        'p': 'letter_p',
        'q': 'letter_q',
        'r': 'letter_r',
        's': 'letter_s',
        't': 'letter_t',
        'u': 'letter_u',
        'v': 'letter_v',
        'w': 'letter_w',
        'x': 'letter_x',
        'y': 'letter_y',
        'z': 'letter_z',
        'A': 'letter_a',
        'B': 'letter_b',
        'C': 'letter_c',
        'D': 'letter_d',
        'E': 'letter_e',
        'F': 'letter_f',
        'G': 'letter_g',
        'H': 'letter_h',
        'I': 'letter_i',
        'J': 'letter_j',
        'K': 'letter_k',
        'L': 'letter_l',
        'M': 'letter_m',
        'N': 'letter_n',
        'O': 'letter_o',
        'P': 'letter_p',
        'Q': 'letter_q',
        'R': 'letter_r',
        'S': 'letter_s',
        'T': 'letter_t',
        'U': 'letter_u',
        'V': 'letter_v',
        'W': 'letter_w',
        'X': 'letter_x',
        'Y': 'letter_y',
        'Z': 'letter_z',
        '¡': 'letter_ij', // Dutch letter 'IJ'
        ',': 'letter_comma',
        '.': 'letter_dot',
        '!': 'letter_exclamation',
        '?': 'letter_question',
        '\'': 'letter_apostroph',
        ' ': 'letter_space',
        ':': 'letter_colon',
        '-': 'letter_streep',
        '–': 'letter_streep',
        '/': 'letter_slash',
        '%': 'letter_percent',
        '[': 'letter_speakstart', // opening square bracket
        ']': 'letter_speakend', // closing square bracket
        '(': 'letter_haakjeopen', // opening parenthesis
        ')': 'letter_haakjesluit', // closing parenthesis
        '+': 'letter_question',
    };

    /**
     * Creates a new instance of the `BFont` class.
     * @param _font_res_map A map of font resources.
     */
    constructor(_font_res_map: Record<string, string>) {
        this.font_res_map = _font_res_map;
    }

    /**
     * Converts a character to an image.
     * @param c The character to convert.
     * @returns The image as a string.
     */
    public char_to_img(c: string): string {
        let letter: string;
        if (c in this.letter_to_img) {
            letter = this.letter_to_img[c];
        } else {
            letter = 'letter_question'; // Default to question mark if character is not found
        }
        return letter;
    }

}
