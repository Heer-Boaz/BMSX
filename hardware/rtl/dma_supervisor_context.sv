`timescale 1ns/1ps
// Retained cartridge DMA context for the SYSTEM supervisor boundary. The live
// DMA register file remains the owner of programmed state; this bank stores
// the cartridge words while the supervisor uses a fresh live register file.
// Request lines and payload memory are live resources, not context words.
//
// SYSTEM orders producer quiescence, block quiescence and the enter/leave
// pulses. It only exchanges banks at the corresponding DMA boundary, after the
// last completion event has been accepted by the IRQ owner. An admitted block
// drains normally; a channel merely waiting on a request does not block entry.
//
// OpenHW CV32E40P retains independently owned architectural state on privilege
// changes rather than copying payload memory:
// https://github.com/openhwgroup/cv32e40p/blob/master/rtl/cv32e40p_cs_registers.sv
module dma_supervisor_context (
    input wire clk, reset_n,
    input wire control_quiesce, block_quiesce,
    input wire block_active, completion_pending,
    output wire trigger_inhibit, admission_inhibit, boundary_ready,
    input wire enter_context, leave_context,
    input wire [63:0] live_read_address, live_write_address,
    input wire [63:0] live_count, live_control, live_status,
    input wire live_next_channel,
    output wire load_live,
    output wire [63:0] load_read_address, load_write_address,
    output wire [63:0] load_count, load_control, load_status,
    output wire load_next_channel
);
    reg [63:0] user_read_address, user_write_address;
    reg [63:0] user_count, user_control, user_status;
    reg user_next_channel;

    assign trigger_inhibit = control_quiesce;
    assign admission_inhibit = block_quiesce;
    assign boundary_ready = block_quiesce && !block_active && !completion_pending;
    assign load_live = enter_context || leave_context;
    assign load_read_address = leave_context ? user_read_address : 64'd0;
    assign load_write_address = leave_context ? user_write_address : 64'd0;
    assign load_count = leave_context ? user_count : 64'd0;
    assign load_control = leave_context ? user_control : 64'd0;
    assign load_status = leave_context ? user_status : 64'd0;
    assign load_next_channel = leave_context && user_next_channel;

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            user_read_address <= 0; user_write_address <= 0;
            user_count <= 0; user_control <= 0; user_status <= 0;
            user_next_channel <= 0;
        end else if (enter_context) begin
            user_read_address <= live_read_address;
            user_write_address <= live_write_address;
            user_count <= live_count;
            user_control <= live_control;
            user_status <= live_status;
            user_next_channel <= live_next_channel;
        end else if (leave_context) begin
            user_read_address <= 0; user_write_address <= 0;
            user_count <= 0; user_control <= 0; user_status <= 0;
            user_next_channel <= 0;
        end
    end
endmodule
