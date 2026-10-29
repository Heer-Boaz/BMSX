`timescale 1ns/1ps
// U7 pin receiver. A complete CRC-valid burst clocks the entire context bank;
// neither individual fields nor a partially received epoch escape the bank.
module display_context_rx (
    input wire clk, reset_n,
    input wire display_context,
    output reg context_valid,
    output reg [15:0] display_width, display_height,
    output reg [31:0] display_epoch,
    output reg context_update
);
    import pad_protocol_pkg::*;
    (* async_reg = "true" *) reg pin_meta, pin_sync;
    reg [1:0] reset_release;
    reg [1:0] state;
    reg [3:0] count;
    reg [6:0] bit_index;
    reg [79:0] payload;
    reg [15:0] crc, received_crc;
    localparam IDLE=0, START=1, DATA=2, STOP=3;
    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            pin_meta <= 1; pin_sync <= 1; reset_release <= 0;
            state <= IDLE; count <= 0; bit_index <= 0;
            payload <= 0; crc <= 16'hffff; received_crc <= 0;
            context_valid <= 0; display_width <= 0; display_height <= 0;
            display_epoch <= 0; context_update <= 0;
        end else begin
            pin_meta <= display_context; pin_sync <= pin_meta;
            reset_release <= {reset_release[0], 1'b1};
            context_update <= 0;
            if (reset_release[1]) case (state)
                IDLE: if (!pin_sync) begin state <= START; count <= 3; end
                START: if (count != 0) count <= count - 1'b1;
                    else if (!pin_sync) begin
                        state <= DATA; count <= 7; bit_index <= 0;
                        crc <= 16'hffff; received_crc <= 0;
                    end else state <= IDLE;
                DATA: if (count != 0) count <= count - 1'b1;
                    else begin
                        count <= 7;
                        if (bit_index < 80) begin
                            payload[bit_index] <= pin_sync;
                            crc <= pad_crc_bit(crc, pin_sync);
                        end else received_crc <= {received_crc[14:0], pin_sync};
                        if (bit_index == 95) state <= STOP;
                        else bit_index <= bit_index + 1'b1;
                    end
                STOP: if (count != 0) count <= count - 1'b1;
                    else begin
                        if (pin_sync && crc == received_crc && payload[7:0] == 8'ha6) begin
                            context_valid <= payload[8];
                            display_width <= payload[31:16];
                            display_height <= payload[47:32];
                            display_epoch <= payload[79:48];
                            context_update <= 1;
                        end
                        state <= IDLE;
                    end
            endcase
        end
    end
endmodule
