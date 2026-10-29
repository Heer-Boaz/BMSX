`timescale 1ns/1ps
// PS/2 Set-2 receive datapath. External pins are sampled through two flops;
// keyboard bits use HID page 07, directly matching the input snapshot bitmap.
// The console does not send keyboard commands: power-on Set 2 is the wire mode.
module keyboard_set2 #(
    parameter integer CLOCK_HZ = 33868800
) (
    input wire clk, reset_n,
    input wire ps2_clock, ps2_data,
    input wire snapshot_taken,
    output reg [255:0] keys,
    output reg frame_error,
    output reg scan_error
);
    localparam integer GAP_CYCLES = CLOCK_HZ * 3 / 20000; // 150 us inter-edge limit
    localparam integer GAP_BITS = $clog2(GAP_CYCLES + 1);
    (* async_reg = "true" *) reg [1:0] clock_sync, data_sync;
    reg clock_previous;
    reg [GAP_BITS-1:0] gap;
    reg [3:0] bit_index;
    reg [8:0] shift;
    reg byte_valid;
    reg [7:0] received;
    reg extended, breaking;
    reg [2:0] pause_remaining;
    reg [55:0] pause_shift;
    wire falling = clock_previous && !clock_sync[1];

    // One physical scan-code decoder, including distinct keypad/extended keys.
    // Valid is separate from usage zero; unassigned external codes have no key.
    function automatic [8:0] decode(input [8:0] code);
        case (code)
            9'h001: decode = {1'b1,8'd66};
            9'h003: decode = {1'b1,8'd62};
            9'h004: decode = {1'b1,8'd60};
            9'h005: decode = {1'b1,8'd58};
            9'h006: decode = {1'b1,8'd59};
            9'h007: decode = {1'b1,8'd69};
            9'h008: decode = {1'b1,8'd104};
            9'h009: decode = {1'b1,8'd67};
            9'h00a: decode = {1'b1,8'd65};
            9'h00b: decode = {1'b1,8'd63};
            9'h00c: decode = {1'b1,8'd61};
            9'h00d: decode = {1'b1,8'd43};
            9'h00e: decode = {1'b1,8'd53};
            9'h00f: decode = {1'b1,8'd103};
            9'h010: decode = {1'b1,8'd105};
            9'h011: decode = {1'b1,8'd226};
            9'h012: decode = {1'b1,8'd225};
            9'h014: decode = {1'b1,8'd224};
            9'h015: decode = {1'b1,8'd20};
            9'h016: decode = {1'b1,8'd30};
            9'h018: decode = {1'b1,8'd106};
            9'h01a: decode = {1'b1,8'd29};
            9'h01b: decode = {1'b1,8'd22};
            9'h01c: decode = {1'b1,8'd4};
            9'h01d: decode = {1'b1,8'd26};
            9'h01e: decode = {1'b1,8'd31};
            9'h020: decode = {1'b1,8'd107};
            9'h021: decode = {1'b1,8'd6};
            9'h022: decode = {1'b1,8'd27};
            9'h023: decode = {1'b1,8'd7};
            9'h024: decode = {1'b1,8'd8};
            9'h025: decode = {1'b1,8'd33};
            9'h026: decode = {1'b1,8'd32};
            9'h028: decode = {1'b1,8'd108};
            9'h029: decode = {1'b1,8'd44};
            9'h02a: decode = {1'b1,8'd25};
            9'h02b: decode = {1'b1,8'd9};
            9'h02c: decode = {1'b1,8'd23};
            9'h02d: decode = {1'b1,8'd21};
            9'h02e: decode = {1'b1,8'd34};
            9'h030: decode = {1'b1,8'd109};
            9'h031: decode = {1'b1,8'd17};
            9'h032: decode = {1'b1,8'd5};
            9'h033: decode = {1'b1,8'd11};
            9'h034: decode = {1'b1,8'd10};
            9'h035: decode = {1'b1,8'd28};
            9'h036: decode = {1'b1,8'd35};
            9'h038: decode = {1'b1,8'd110};
            9'h03a: decode = {1'b1,8'd16};
            9'h03b: decode = {1'b1,8'd13};
            9'h03c: decode = {1'b1,8'd24};
            9'h03d: decode = {1'b1,8'd36};
            9'h03e: decode = {1'b1,8'd37};
            9'h040: decode = {1'b1,8'd111};
            9'h041: decode = {1'b1,8'd54};
            9'h042: decode = {1'b1,8'd14};
            9'h043: decode = {1'b1,8'd12};
            9'h044: decode = {1'b1,8'd18};
            9'h045: decode = {1'b1,8'd39};
            9'h046: decode = {1'b1,8'd38};
            9'h048: decode = {1'b1,8'd112};
            9'h049: decode = {1'b1,8'd55};
            9'h04a: decode = {1'b1,8'd56};
            9'h04b: decode = {1'b1,8'd15};
            9'h04c: decode = {1'b1,8'd51};
            9'h04d: decode = {1'b1,8'd19};
            9'h04e: decode = {1'b1,8'd45};
            9'h050: decode = {1'b1,8'd113};
            9'h051: decode = {1'b1,8'd135};
            9'h052: decode = {1'b1,8'd52};
            9'h054: decode = {1'b1,8'd47};
            9'h055: decode = {1'b1,8'd46};
            9'h057: decode = {1'b1,8'd114};
            9'h058: decode = {1'b1,8'd57};
            9'h059: decode = {1'b1,8'd229};
            9'h05a: decode = {1'b1,8'd40};
            9'h05b: decode = {1'b1,8'd48};
            9'h05d: decode = {1'b1,8'd49};
            9'h05f: decode = {1'b1,8'd115};
            9'h061: decode = {1'b1,8'd100};
            9'h066: decode = {1'b1,8'd42};
            9'h069: decode = {1'b1,8'd89};
            9'h06a: decode = {1'b1,8'd137};
            9'h06b: decode = {1'b1,8'd92};
            9'h06c: decode = {1'b1,8'd95};
            9'h070: decode = {1'b1,8'd98};
            9'h071: decode = {1'b1,8'd99};
            9'h072: decode = {1'b1,8'd90};
            9'h073: decode = {1'b1,8'd93};
            9'h074: decode = {1'b1,8'd94};
            9'h075: decode = {1'b1,8'd96};
            9'h076: decode = {1'b1,8'd41};
            9'h077: decode = {1'b1,8'd83};
            9'h078: decode = {1'b1,8'd68};
            9'h079: decode = {1'b1,8'd87};
            9'h07a: decode = {1'b1,8'd91};
            9'h07b: decode = {1'b1,8'd86};
            9'h07c: decode = {1'b1,8'd85};
            9'h07d: decode = {1'b1,8'd97};
            9'h07e: decode = {1'b1,8'd71};
            9'h083: decode = {1'b1,8'd64};
            9'h0f1: decode = {1'b1,8'd145};
            9'h0f2: decode = {1'b1,8'd144};
            9'h111: decode = {1'b1,8'd230};
            9'h114: decode = {1'b1,8'd228};
            9'h11f: decode = {1'b1,8'd227};
            9'h127: decode = {1'b1,8'd231};
            9'h12f: decode = {1'b1,8'd101};
            9'h137: decode = {1'b1,8'd102};
            9'h14a: decode = {1'b1,8'd84};
            9'h15a: decode = {1'b1,8'd88};
            9'h169: decode = {1'b1,8'd77};
            9'h16b: decode = {1'b1,8'd80};
            9'h16c: decode = {1'b1,8'd74};
            9'h170: decode = {1'b1,8'd73};
            9'h171: decode = {1'b1,8'd76};
            9'h172: decode = {1'b1,8'd81};
            9'h174: decode = {1'b1,8'd79};
            9'h175: decode = {1'b1,8'd82};
            9'h17a: decode = {1'b1,8'd78};
            9'h17c: decode = {1'b1,8'd70};
            9'h17d: decode = {1'b1,8'd75};
            9'h17e: decode = {1'b1,8'd72};
            default: decode = 9'b0;
        endcase
    endfunction
    wire [8:0] usage = decode({extended,received});

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            clock_sync<=3; data_sync<=3; clock_previous<=1;
            gap<=0; bit_index<=0; shift<=0; received<=0;
            byte_valid<=0; frame_error<=0;
        end else begin
            clock_sync<={clock_sync[0],ps2_clock};
            data_sync<={data_sync[0],ps2_data};
            clock_previous<=clock_sync[1];
            byte_valid<=0; frame_error<=0;
            if (falling) begin
                gap<=0;
                if (bit_index==0) begin
                    if (!data_sync[1]) bit_index<=1;
                    else frame_error<=1;
                end else if (bit_index==10) begin
                    bit_index<=0;
                    if (data_sync[1] && ^shift) begin
                        received<=shift[7:0]; byte_valid<=1;
                    end else frame_error<=1;
                end else begin
                    shift[bit_index-1]<=data_sync[1];
                    bit_index<=bit_index+1'b1;
                end
            end else if (bit_index!=0) begin
                if (gap==GAP_CYCLES-1) begin
                    bit_index<=0; gap<=0; frame_error<=1;
                end else gap<=gap+1'b1;
            end
        end
    end

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            keys<=0; extended<=0; breaking<=0;
            pause_remaining<=0; pause_shift<=0; scan_error<=0;
        end else begin
            scan_error<=0;
            // These Set-2 keys have make-only sequences. Hold the event through
            // a publication, then release at its producer, not in the ICU latch.
            if (snapshot_taken) begin keys[72]<=0; keys[144]<=0; keys[145]<=0; end
            if (frame_error) begin
                extended<=0; breaking<=0; pause_remaining<=0;
            end else if (byte_valid) begin
                if (received==8'haa) begin // keyboard power-on self-test complete
                    keys<=0; extended<=0; breaking<=0; pause_remaining<=0;
                end else if (pause_remaining!=0) begin
                    pause_shift<={pause_shift[47:0],received};
                    pause_remaining<=pause_remaining-1'b1;
                    if (pause_remaining==1) begin
                        if ({pause_shift[47:0],received}==56'h1477e1f014f077) keys[72]<=1;
                        else scan_error<=1;
                    end
                end else if (received==8'he1) begin
                    pause_remaining<=7; pause_shift<=0;
                    extended<=0; breaking<=0;
                end else if (received==8'he0) extended<=1;
                else if (received==8'hf0) breaking<=1;
                else begin
                    extended<=0; breaking<=0;
                    if (received==0 || received==8'hff || received==8'hfc) scan_error<=1;
                    else if (usage[8]) keys[usage[7:0]]<=!breaking;
                end
            end
        end
    end
endmodule
