; bios call to print a character on screen
CHPUT:      equ 0x00a2

            ; the address of our program
            org 0xD000

start:
            ld hl, message
mainLoop:   ld a, (hl)
            cp 0
            ret z
            call CHPUT
            inc hl
            jr mainLoop

message:
            db "Hello world!",0

            ; use the label "start" as the entry point
            end start