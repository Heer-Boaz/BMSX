`timescale 1ns/1ps
module keyboard_set2_tb;
    parameter integer CLOCK_HZ=33868800;
    reg clk=0, reset_n=0;
    always #(500000000.0/CLOCK_HZ) clk=~clk;
    reg ps2_clock=1, ps2_data=1, snapshot_taken=0;
    wire [255:0] keys;
    wire frame_error, scan_error;
    integer frame_errors=0, scan_errors=0, frames=0;
    keyboard_set2 #(.CLOCK_HZ(CLOCK_HZ)) dut(.*);
    always @(posedge clk) begin
        if (frame_error) frame_errors=frame_errors+1;
        if (scan_error) scan_errors=scan_errors+1;
    end
    task automatic bit_wire(input reg value);
        begin
            ps2_data=value; #20000; ps2_clock=0; #40000;
            ps2_clock=1; #20000;
        end
    endtask
    task automatic frame(input [7:0] value, input reg corrupt_parity, input reg stop);
        integer i;
        begin
            bit_wire(0);
            for (i=0;i<8;i=i+1) bit_wire(value[i]);
            bit_wire((~^value)^corrupt_parity); bit_wire(stop);
            ps2_data=1; #20000; frames=frames+1;
        end
    endtask
    task automatic byte_wire(input [7:0] value);
        frame(value,0,1);
    endtask
    task automatic check(input reg condition,input [511:0] message);
        if (!condition) $fatal(1,"%0s",message);
    endtask
    initial begin
        #5000; reset_n=1; #5000;
        byte_wire(8'haa);
        byte_wire(8'h1c); byte_wire(8'h12); // A and left shift simultaneously
        check(keys==(256'b1<<4 | 256'b1<<225),"make bitmap loses held key");
        byte_wire(8'h1c); // typematic repeats a level
        check(keys[4]&&keys[225],"typematic clears held key");
        byte_wire(8'hf0); byte_wire(8'h1c);
        check(!keys[4]&&keys[225],"ordinary break");
        byte_wire(8'he0); byte_wire(8'h14);
        check(keys[228]&&!keys[224],"right control collapsed into left control");
        byte_wire(8'he0); byte_wire(8'hf0); byte_wire(8'h14);
        check(!keys[228],"extended break");
        byte_wire(8'h75); byte_wire(8'he0); byte_wire(8'h75);
        check(keys[96]&&keys[82],"keypad up confused with cursor up");
        // PrintScreen's fake shift sequence must not touch real shift state.
        byte_wire(8'he0); byte_wire(8'h12); byte_wire(8'he0); byte_wire(8'h7c);
        check(keys[70]&&keys[225],"PrintScreen make/fake shift");
        byte_wire(8'he0); byte_wire(8'hf0); byte_wire(8'h7c);
        byte_wire(8'he0); byte_wire(8'hf0); byte_wire(8'h12);
        check(!keys[70]&&keys[225],"PrintScreen break cleared real shift");
        byte_wire(8'he1); byte_wire(8'h14); byte_wire(8'h77); byte_wire(8'he1);
        byte_wire(8'hf0); byte_wire(8'h14); byte_wire(8'hf0); byte_wire(8'h77);
        check(keys[72]&&!keys[224]&&!keys[83],"Pause sequence emits fake control/numlock");
        @(negedge clk); snapshot_taken=1;
        @(negedge clk); snapshot_taken=0;
        check(!keys[72],"Pause must release after accepted sample");
        byte_wire(8'hf1); byte_wire(8'hf2);
        check(keys[144]&&keys[145],"make-only language usages");
        @(negedge clk); snapshot_taken=1;
        @(negedge clk); snapshot_taken=0;
        check(!keys[144]&&!keys[145],"make-only language release");
        byte_wire(8'h08); byte_wire(8'h51); byte_wire(8'h6a);
        check(keys[104]&&keys[135]&&keys[137],"extended usage map");
        frame(8'h1c,1,1); check(!keys[4]&&frame_errors==1,"odd-parity rejection");
        frame(8'h1c,0,0); check(!keys[4]&&frame_errors==2,"stop-bit rejection");
        // A partial wire frame times out. It must not turn the next frame into
        // an unrelated usage, and cannot clear already held levels.
        bit_wire(0); bit_wire(1); ps2_data=1; #200000;
        check(frame_errors==3&&keys[225],"partial-frame timeout");
        byte_wire(8'h1c); check(keys[4],"wire resynchronisation");
        byte_wire(8'h00); check(scan_errors==1&&keys[4],"external overrun report changed held bitmap");
        byte_wire(8'haa); check(keys==0,"keyboard BAT clears producer after physical keyboard reset");
        $display("PASS keyboard Set2: %0d wire frames; make/break, modifiers, keypad, PrintScreen, Pause, language, parity/framing/timeout",frames);
        $finish;
    end
    initial begin #100000000; $fatal(1,"keyboard test watchdog"); end
endmodule
