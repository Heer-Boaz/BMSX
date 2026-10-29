`timescale 1ns/1ps
// Four independent full-duplex BMSX-PAD lanes, clocked in parallel. Only the
// system clock clocks storage; the fractional divider generates output enables.
// Request capture owns the entire frame until done; there is no pending FIFO.
module pad_serial_master (
    input  wire          clk,
    input  wire          reset_n,
    input  wire          req_valid,
    output wire          req_ready,
    output wire [16:0]   remaining_cycles,
    input  wire [2047:0]  req_frames,
    output reg           done,
    output reg  [2047:0]  rx_frames,
    output reg  [3:0]     rx_crc_ok,
    output reg           pad_clk,
    output wire [3:0]     pad_cmd,
    input  wire [3:0]     pad_data,
    output reg  [3:0]     pad_select_n
);
    import pad_protocol_pkg::*;
    localparam [2:0] IDLE = 0, LOW = 1, HIGH = 2, HOLD = 3, GAP = 4;
    reg [2:0] state;
    reg [1:0] reset_release;
    reg [25:0] phase;
    wire [26:0] phase_sum = {1'b0, phase} + PAD_HALF_EDGE_HZ;
    reg [13:0] delay_count;
    reg [16:0] ready_count;
    reg [8:0] bit_index;
    reg [2047:0] tx_frames, rx_shift;
    reg [15:0] tx_crc [0:3];
    reg [15:0] rx_crc [0:3];
    (* async_reg = "true" *) reg [3:0] data_meta, data_sync;
    integer port;

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            reset_release <= 0;
            data_meta <= 4'hf;
            data_sync <= 4'hf;
        end else begin
            reset_release <= {reset_release[0], 1'b1};
            data_meta <= pad_data;
            data_sync <= data_meta;
        end
    end

    assign req_ready = reset_release[1] && state == IDLE;
    assign remaining_cycles = req_ready ? 17'd0 : ready_count;
    genvar lane;
    generate for (lane = 0; lane < 4; lane = lane + 1) begin : command
        wire [8:0] serial_bit = {bit_index[8:3], 3'b000} +
            {6'b000000, ~bit_index[2:0]};
        assign pad_cmd[lane] = pad_select_n[lane] ? 1'b1 :
            bit_index < PAD_BODY_BITS ? tx_frames[lane * 512 + serial_bit] :
            tx_crc[lane][511 - bit_index];
    end endgenerate

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            state <= IDLE;
            phase <= 0;
            delay_count <= 0;
            ready_count <= 0;
            bit_index <= 0;
            tx_frames <= 0;
            rx_shift <= 0;
            rx_frames <= 0;
            rx_crc_ok <= 0;
            done <= 0;
            pad_clk <= 0;
            pad_select_n <= 4'hf;
            for (port = 0; port < 4; port = port + 1) begin
                tx_crc[port] <= 16'hffff;
                rx_crc[port] <= 16'hffff;
            end
        end else if (!reset_release[1]) begin
            state <= IDLE;
        end else begin
            done <= 0;
            if (req_ready && req_valid)
                ready_count <= PAD_FRAME_READY_CYCLES;
            else if (ready_count != 0)
                ready_count <= ready_count - 1'b1;
            case (state)
                IDLE: if (req_valid) begin
                    tx_frames <= req_frames;
                    rx_shift <= 0;
                    bit_index <= 0;
                    phase <= 0;
                    pad_select_n <= 0;
                    for (port = 0; port < 4; port = port + 1) begin
                        tx_crc[port] <= 16'hffff;
                        rx_crc[port] <= 16'hffff;
                    end
                    state <= LOW;
                end
                LOW, HIGH: begin
                    if (phase_sum >= PAD_REFERENCE_HZ) begin
                        phase <= phase_sum - PAD_REFERENCE_HZ;
                        if (state == LOW) begin
                            pad_clk <= 1;
                            for (port = 0; port < 4; port = port + 1) begin
                                rx_shift[port * 512 + {bit_index[8:3], 3'b000}
                                    + {6'b000000, ~bit_index[2:0]}] <= data_sync[port];
                                if (bit_index < PAD_BODY_BITS) begin
                                    tx_crc[port] <= pad_crc_bit(tx_crc[port], pad_cmd[port]);
                                    rx_crc[port] <= pad_crc_bit(rx_crc[port], data_sync[port]);
                                end
                            end
                            state <= HIGH;
                        end else begin
                            pad_clk <= 0;
                            if (bit_index == 511) begin
                                delay_count <= PAD_SELECT_HOLD_CYCLES - 1;
                                state <= HOLD;
                            end else begin
                                bit_index <= bit_index + 1'b1;
                                state <= LOW;
                            end
                        end
                    end else begin
                        phase <= phase_sum[25:0];
                    end
                end
                HOLD: if (delay_count == 0) begin
                    pad_select_n <= 4'hf;
                    rx_frames <= rx_shift;
                    for (port = 0; port < 4; port = port + 1)
                        rx_crc_ok[port] <= rx_crc[port] ==
                            {rx_shift[port * 512 + 496 +: 8],
                             rx_shift[port * 512 + 504 +: 8]};
                    done <= 1;
                    delay_count <= PAD_SELECT_GAP_CYCLES - 1;
                    state <= GAP;
                end else delay_count <= delay_count - 1'b1;
                GAP: if (delay_count == 0) state <= IDLE;
                    else delay_count <= delay_count - 1'b1;
                // Reset is the only recovery from an unassigned stored state.
            endcase
        end
    end
endmodule
