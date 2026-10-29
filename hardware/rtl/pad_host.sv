`timescale 1ns/1ps
// Serial front end and complete-packet latches, not the complete U7/MMIO unit.
// The MMIO owner holds APPLY operands/valid until ready, then acknowledges the
// write. No output request is overwritten, queued or retried by this component.
// Keyboard, ARM/VBlank publication and system-bus endpoint logic live outside it.
// A transport reservation holds the next frame-start opportunity, not a command
// or its operands. Completion of the in-flight frame and its minimum gap remain
// unchanged. The caller releases SYS while waiting for the returned deadline.
module pad_host (
    input  wire          clk,
    input  wire          reset_n,
    input  wire          display_context_valid,
    input  wire [15:0]   display_width, display_height,
    input  wire [31:0]   display_epoch,
    input  wire          apply_valid,
    output wire          apply_ready,
    input  wire          reserve_accept, cancel_accept,
    output wire [31:0]   apply_ready_cycles,
    input  wire [1:0]    apply_port,
    input  wire [31:0]   apply_intensity,
    input  wire [31:0]   apply_duration_ms,
    output reg           dispatch_done,
    output reg  [31:0]   dispatch_tag,
    output reg  [3:0]    packet_valid,
    output reg  [3:0]    link_error,
    output reg  [2047:0] held_reply,
    output wire          pad_clk,
    output wire [3:0]    pad_cmd,
    input  wire [3:0]    pad_data,
    output wire [3:0]    pad_select_n
);
    reg [31:0] next_tag;
    reg active_apply;
    reg [31:0] active_tag;
    reg [2047:0] request_frames;
    wire serial_ready, serial_done;
    wire [16:0] serial_remaining;
    reg reservation;
    // A query accepted on the current IDLE edge reserves that edge too.
    wire reserved = reservation || reserve_accept;
    wire serial_req_valid = !reserved || apply_valid;
    wire [2047:0] received_frames;
    wire [3:0] crc_ok;
    integer port;

    assign apply_ready = serial_ready;
    assign apply_ready_cycles = serial_ready ? 32'd0 : {15'd0, serial_remaining} + 32'd2;
    always @* begin
        request_frames = 0;
        for (integer lane = 0; lane < 4; lane = lane + 1) begin
            request_frames[lane * 512 +: 32] = 32'h58534d42; // BMSX
            request_frames[lane * 512 + 32 +: 8] = 8'h01;
            request_frames[lane * 512 + 40 +: 8] =
                apply_valid && apply_port == lane ? 8'h01 : 8'h00;
            request_frames[lane * 512 + 48] = display_context_valid;
            request_frames[lane * 512 + 64 +: 32] = next_tag;
            request_frames[lane * 512 + 160 +: 16] = display_width;
            request_frames[lane * 512 + 176 +: 16] = display_height;
            request_frames[lane * 512 + 192 +: 32] = display_epoch;
            if (apply_valid && apply_port == lane) begin
                request_frames[lane * 512 + 96 +: 32] = apply_intensity;
                request_frames[lane * 512 + 128 +: 32] = apply_duration_ms;
            end
        end
    end

    pad_serial_master serial (
        .clk(clk), .reset_n(reset_n), .req_valid(serial_req_valid),
        .req_ready(serial_ready), .req_frames(request_frames),
        .remaining_cycles(serial_remaining),
        .done(serial_done), .rx_frames(received_frames), .rx_crc_ok(crc_ok),
        .pad_clk(pad_clk), .pad_cmd(pad_cmd), .pad_data(pad_data),
        .pad_select_n(pad_select_n)
    );

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            next_tag <= 0;
            reservation <= 0;
            active_tag <= 0;
            active_apply <= 0;
            dispatch_done <= 0;
            dispatch_tag <= 0;
            packet_valid <= 0;
            link_error <= 0;
            held_reply <= 0;
        end else begin
            dispatch_done <= 0;
            if (reserve_accept) reservation <= 1;
            if (cancel_accept || apply_valid && serial_ready) reservation <= 0;
            if (serial_ready && serial_req_valid) begin
                next_tag <= next_tag + 1'b1;
                active_tag <= next_tag;
                active_apply <= apply_valid;
            end
            if (serial_done) begin
                if (active_apply) begin
                    dispatch_done <= 1;
                    dispatch_tag <= active_tag;
                end
                for (port = 0; port < 4; port = port + 1) begin
                    if (crc_ok[port] &&
                        received_frames[port * 512 +: 32] == 32'h44415042 &&
                        received_frames[port * 512 + 32 +: 8] == 8'h01) begin
                        held_reply[port * 512 +: 512] <=
                            received_frames[port * 512 +: 512];
                        packet_valid[port] <= 1;
                        link_error[port] <= 0;
                    end else begin
                        link_error[port] <= 1;
                    end
                end
            end
        end
    end
endmodule
