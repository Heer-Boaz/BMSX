`timescale 1ns/1ps
// U2 -> U7 single-wire context. Both chips use branches of the 33.8688 MHz
// reference; eight source clocks per symbol leave synchronizer/skew margin.
// Every burst captures one whole context; updates during a burst wait for the
// next burst. Idle >=16 clocks, start=0, payload80 LSB-first, CRC16 MSB-first,
// stop=1. Payload: A6, flags(valid bit0), width16, height16, epoch32.
module display_context_tx (
    input wire clk, reset_n,
    input wire context_valid,
    input wire [15:0] display_width, display_height,
    input wire [31:0] display_epoch,
    output reg display_context
);
    import pad_protocol_pkg::*;
    reg [1:0] reset_release;
    reg [1:0] state;
    reg [3:0] count;
    reg [6:0] bit_index;
    reg [79:0] payload;
    reg [15:0] crc;
    localparam IDLE=0, START=1, DATA=2, STOP=3;
    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            reset_release <= 0; state <= IDLE; count <= 15;
            bit_index <= 0; payload <= 0; crc <= 16'hffff;
            display_context <= 1;
        end else begin
            reset_release <= {reset_release[0], 1'b1};
            if (reset_release[1]) case (state)
                IDLE: if (count != 0) count <= count - 1'b1;
                    else begin
                        payload <= {display_epoch, display_height, display_width,
                            7'b0, context_valid, 8'ha6};
                        crc <= 16'hffff;
                        bit_index <= 0; count <= 7;
                        display_context <= 0; state <= START;
                    end
                START: if (count != 0) count <= count - 1'b1;
                    else begin
                        display_context <= payload[0];
                        count <= 7; state <= DATA;
                    end
                DATA: if (count != 0) count <= count - 1'b1;
                    else begin
                        count <= 7;
                        if (bit_index < 80) crc <= pad_crc_bit(crc, payload[bit_index]);
                        if (bit_index == 95) begin
                            display_context <= 1; state <= STOP;
                        end else begin
                            bit_index <= bit_index + 1'b1;
                            if (bit_index < 79) display_context <= payload[bit_index + 1'b1];
                            else if (bit_index == 79)
                                display_context <= pad_crc_bit(crc, payload[79]) >> 15;
                            else display_context <= crc[94 - bit_index];
                        end
                    end
                STOP: if (count != 0) count <= count - 1'b1;
                    else begin count <= 15; state <= IDLE; end
            endcase
        end
    end
endmodule
