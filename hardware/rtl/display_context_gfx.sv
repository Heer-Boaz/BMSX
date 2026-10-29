`timescale 1ns/1ps
// Single extent/epoch owner for the PCRTC's already-presented raw word bank.
// This owner has no programmed bank and never reconstructs a VBlank event.
// Width and height update together, one system edge after the display bank;
// epoch increments exactly when the extent changes. The serial transmitter,
// when used by the legacy U7 route, is a separate physical output owner.
// The sampling of display state as coherent stream metadata follows LiteX:
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/cores/video.py
module display_context_gfx (
    input wire clk, reset_n,
    input wire [703:0] displayed_words,
    output wire context_valid,
    output reg [15:0] display_width, display_height,
    output reg [31:0] display_epoch
);
    wire [31:0] displayed[0:21];
    genvar i;
    generate for (i=0;i<22;i=i+1) begin: display_word
        assign displayed[i]=displayed_words[i*32 +:32];
    end endgenerate
    integer step_x, horizontal_total, vertical_total, crop_x, crop_y;
    integer x1, x2, y1, y2, right1, right2, bottom1, bottom2;
    integer crop_pixel, right_pixel1, right_pixel2;
    reg running;
    reg [1:0] reset_release;
    reg [15:0] next_width, next_height;
    assign context_valid=reset_release[1];

    // Bounds from the raw fields: right<=4095+4096=8191; bottom<=4095.
    // Width/height16 therefore preserve every representable output extent.
    always @* begin
        step_x = displayed[12][24:21];
        horizontal_total = {21'b0,displayed[16][10:0]} + {21'b0,displayed[16][21:11]} +
            {16'b0,displayed[17][26:11]} + {21'b0,displayed[18][10:0]} +
            {16'b0,displayed[18][26:11]};
        vertical_total = {22'b0,displayed[20][9:0]} + {22'b0,displayed[20][19:10]} +
            {20'b0,displayed[20][31:20]} + {22'b0,displayed[21][9:0]} +
            {21'b0,displayed[21][20:10]} + {21'b0,displayed[21][31:21]};
        running = !displayed[12][16] && !displayed[12][17] &&
            horizontal_total != 0 && displayed[12][2:0] != 0 &&
            displayed[12][9:3] != 0 && vertical_total != 0;
        x1=displayed[4][11:0]; x2=displayed[8][11:0];
        y1=displayed[4][22:12]; y2=displayed[8][22:12];
        crop_x=displayed[0][0] ? x1:x2;
        crop_y=displayed[0][0] ? y1:y2;
        if (displayed[0][1:0] == 3) begin
            if (x2<crop_x) crop_x=x2;
            if (y2<crop_y) crop_y=y2;
        end
        right1=x1+{20'b0,displayed[5][11:0]}+1;
        right2=x2+{20'b0,displayed[9][11:0]}+1;
        bottom1=y1-crop_y+{21'b0,displayed[5][22:12]}+1;
        bottom2=y2-crop_y+{21'b0,displayed[9][22:12]}+1;
        next_width=0; next_height=0;
        crop_pixel=0; right_pixel1=0; right_pixel2=0;
        // A zero signal step disables pixel output by the PCRTC datapath rule.
        if (running && step_x != 0 && displayed[0][1:0] != 0) begin
            crop_pixel=(crop_x+step_x-1)/step_x;
            right_pixel1=(right1+step_x-1)/step_x-crop_pixel;
            right_pixel2=(right2+step_x-1)/step_x-crop_pixel;
            if (displayed[0][0]) begin next_width=right_pixel1; next_height=bottom1; end
            if (displayed[0][1]) begin
                if (!displayed[0][0] || right_pixel2>next_width) next_width=right_pixel2;
                if (!displayed[0][0] || bottom2>next_height) next_height=bottom2;
            end
        end
    end

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            reset_release<=0; display_width<=0; display_height<=0; display_epoch<=0;
        end else begin
            reset_release<={reset_release[0],1'b1};
            if (reset_release[1] && (display_width!=next_width || display_height!=next_height)) begin
                display_width<=next_width; display_height<=next_height;
                display_epoch<=display_epoch+1'b1;
            end
        end
    end
endmodule
