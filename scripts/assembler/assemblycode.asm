ORG 0xD000				; Start address for our routine in RAM

KEYS:					EQU #FBE5	; Memory location for the input matrix
RETURN_VALUE:			EQU #F7F8	; Memory location to store the return value for BASIC
CLS:					EQU #00C3	; BIOS call to CLS
INITXT:					EQU #006C	; BIOS call to set text mode (screen 0)
INIT32:					EQU #006F	; BIOS call to set screen mode 32 (screen 1)
INIGRP:					EQU #05D2	; BIOS call to set graphics mode (screen 2)
INIMLT:					EQU #061F	; BIOS call to set multicolor mode (screen 3)
POSIT:					EQU #00C6	; BIOS call to set cursor position (LOCATE X, Y)
CHGMOD:    				EQU #005F	; BIOS call to change screen mode
CHPUT:					EQU #00A2	; BIOS call to print a character on screen
CHGCLR:					EQU #0062	; BIOS call to change screen colors
FORCLR:					EQU #F3E9	; Foreground colour memory location
ERAFNK:					EQU #00CC	; Erase function key display
CLIKSW:					EQU #F3DB	; Key Press Click Switch: 0=Off 1=On
COORD:					EQU #E001	; Memory address to store XY coordinates
MAX_X:					EQU 29		; Maximum X-coordinate (1-based, 40 columns for text mode)
MAX_Y:					EQU 24		; Maximum Y-coordinate (1-based)
MIN_X:					EQU 1		; Minimum X-coordinate
MIN_Y:					EQU 1		; Minimum Y-coordinate
PLAYER_CHAR:			EQU 175		; Character to represent the player on screen

; TESTMEUK:
;     LD HL, 0x4000
;     LD DE, 0x4000
;     LD BC, 0x4000
;     LDIR
;     INC IX
;     DEC IX
;     INC IY
;     DEC IY
;     ADD A,B
;     ADD A,C
;     ADD A,D
;     ADD A,E
;     ADD A,H
;     ADD A,L
;     ADD A,(COORD)
;     ADD A,A
;     ADC A,B
;     ADC A,C
;     ADC A,D
;     ADC A,E
;     ADC A,H
;     ADC A,L
;     ADC A,(COORD)
;     ADC A,A
;     SUB B
;     SUB C
;     SUB D
;     SUB E
;     SUB H
;     SUB L
;     SUB (COORD)
;     SUB A
;     SBC A,B
;     SBC A,C
;     SBC A,D
;     SBC A,E
;     SBC A,H
;     SBC A,L
;     SBC A,(COORD)
;     SBC A,A
;     AND B
;     AND C
;     AND D
;     AND E
;     AND H
;     AND L
;     AND (COORD)
;     AND A
;     XOR B
;     XOR C
;     XOR D
;     XOR E
;     XOR H
;     XOR L
;     XOR (COORD)
;     XOR A
;     OR B
;     OR C
;     OR D
;     OR E
;     OR H
;     OR L
;     OR (COORD)
;     OR A
;     CP B
;     CP C
;     CP D
;     CP E
;     CP H
;     CP L
;     CP (COORD)
;     CP A
;     RET NZ
;     POP BC

START:
    ; Disable key click sound
    XOR A							; Faster than LD A, 0
    LD (CLIKSW), A					; 0 = Click sound off

    CALL ERAFNK						; Disable function key display

    CALL INIT32						; Set screen mode 32 (SCREEN 1)

    ; Change colours
    LD HL,FORCLR					; Load the address of the foreground colour memory location
    LD (HL), 15						; Set the foreground colour to white
    INC HL							; Move to the background colour memory location
    LD (HL), 1						; Set the background colour to black
    INC HL							; Move to the border colour memory location
    LD (HL), 4						; Set the border colour to blue
    CALL CHGCLR						; Call the BIOS to change the screen colours

    LD A, MIN_X                     ; Set the initial X-coordinate
    LD (COORD), A                   ; Store the X-coordinate in memory
    LD A, MIN_Y                     ; Set the initial Y-coordinate
    LD (COORD+1), A                 ; Store the Y-coordinate in memory
    EI								; Enable interrupts

GAME_LOOP:
    ; Read X and Y coordinates from BASIC
    LD A, (COORD)					; Load X-coordinate from memory location 0xE001
    LD H, A							; H = Column
    LD A, (COORD+1)					; Load Y-coordinate from memory location 0xE002
    LD L, A							; L = Row

    CALL POSIT						; Call BIOS to set the cursor position
    LD A, ' '						; Character to print at the cursor position
    CALL CHPUT

    ; Handle directional input
    LD C, 0
    LD A, (KEYS+8)					; Get the input matrix
    LD B, 0							; Clear register B to store direction

    BIT 6, A						; Check if Down key is pressed (row 8, bit 6)
    JR NZ, SKIP_DOWN				; If Down key is pressed, skip the next instruction
    INC L							; Move down (increase Y coordinate)
    SET 1, B						; Set bit 1 for Down direction
SKIP_DOWN:

    BIT 5, A						; Check if Up key is pressed (row 8, bit 5)
    JR NZ, SKIP_UP					; If Up key is pressed, skip the next instruction
    DEC L							; Move up (decrease Y coordinate)
    SET 0, B						; Set bit 0 for Up direction
SKIP_UP:

    BIT 4, A						; Check if Left key is pressed (row 8, bit 4)
    JR NZ, SKIP_LEFT				; If Left key is pressed, skip the next instruction
    DEC H							; Move left (decrease X coordinate)
    SET 2, B						; Set bit 2 for Left direction
SKIP_LEFT:

    BIT 7, A						; Check if Right key is pressed (row 8, bit 7)
    JR NZ, SKIP_RIGHT				; If Right key is pressed, skip the next instruction
    INC H							; Move right (increase X coordinate)
    SET 3, B						; Set bit 3 for Right direction
SKIP_RIGHT:

    BIT 0, A						; Check if Space key is pressed (row 8, bit 0)
    JR NZ, SKIP_SPACE				; If Space key is pressed, skip the next instruction
    SET 4, B						; Set bit 3 for Space
    LD C, 1
SKIP_SPACE:

    ; Ensure X and Y are within screen bounds
    LD A, H							; Store X-coordinate in A
    CP MAX_X						; Check if X >= MAX_X
    JR NC, SET_X_MAX				; If X is out of bounds, set to maximum
    CP 1							; Check if X < MIN_X
    JR C, SET_X_MIN					; If X is less than MIN_X, set to minimum
    JR CONTINUE_X					; If X is within bounds, continue

SET_X_MIN:
    LD H, 1							; Set X to minimum
    JR CONTINUE_X					; Continue to check Y
SET_X_MAX:
    LD H, MAX_X						; Set X to maximum
CONTINUE_X:
    LD A, L							; Store Y-coordinate in A
    CP MAX_Y						; Check if Y >= MAX_Y
    JR NC, SET_Y_MAX				; If Y is out of bounds, set to maximum
    CP 1							; Check if Y < MIN_Y
    JR C, SET_Y_MIN					; If Y is less than MIN_Y, set to minimum
    JR CONTINUE_Y					; If Y is within bounds, continue

SET_Y_MIN:
    LD L, 1							; Set Y to minimum
    JR CONTINUE_Y					; Continue to update coordinates
SET_Y_MAX:
    LD L, MAX_Y						; Set Y to maximum
CONTINUE_Y:

    ; Update coordinates in memory
    LD A, H							; Store updated X-coordinate
    LD (COORD), A					; Store the updated X-coordinate in memory
    LD A, L							; Store updated Y-coordinate
    LD (COORD+1), A					; Store the updated Y-coordinate in memory

    CALL POSIT						; Call BIOS to set the cursor position
    LD A, PLAYER_CHAR				; Character to print at the cursor position
    CALL CHPUT						; Print the player character

    LD A, C							; Store the return value in A
    CP 1							; Check if the Space key was pressed
    JR Z, GA_TERUG					; If the Space key was pressed, return to BASIC

    ; Wait for V-Sync
WAIT_VSYNC:
    HALT							; Wait for VSync interrupt

    JP GAME_LOOP					; Loop back to the beginning of the game loop
GA_TERUG:
    ; Set return value for BASIC
    LD A, B							; Move the value from B to A to return the result
    LD (RETURN_VALUE), A			; Store the return value
    DI
    CALL INITXT					    ; Set text mode
    RET								; Return to BASIC

END START							; End of the program and define the entry point
