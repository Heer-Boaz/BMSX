`timescale 1ns/1ps
// INPUT subsystem: native SYS pins, independent PAD acquisition and one-shot
// publication. The owner supplies the complete display context, keyboard words,
// VBlank and supervisor request in the clk domain; physical input front ends
// own their crossings. Width, height and epoch remain the source register words.
// OpenTitan UART separates serial receive from its consumer-side state:
// https://github.com/lowRISC/opentitan/blob/master/hw/ip/uart/rtl/uart_core.sv
module io_controller (
    input wire clk, reset_n,
    input wire [31:0] bus_ad_in,
    input wire bus_as_n, bus_rd_n, bus_wr_n, cs_io_n,
    input wire [3:0] bus_be_n,
    output wire [31:0] bus_ad_out,
    output wire bus_ad_oe, bus_ready_drive_low,
    input wire vblank_begin, supervisor_request,
    input wire [255:0] keyboard_words,
    output wire snapshot_taken, supervisor_edge,
    input wire display_context_valid,
    input wire [15:0] display_width, display_height,
    input wire [31:0] display_epoch,
    output wire pad_clk,
    output wire [3:0] pad_cmd, pad_select_n,
    input wire [3:0] pad_data,
    output wire [3:0] packet_valid, link_error,
    output wire dispatch_done,
    output wire [31:0] dispatch_tag
);
    wire access_valid, access_write, access_ready;
    wire [5:0] word_index;
    wire [31:0] write_word, read_word, fault_code;
    wire apply_valid, apply_ready;
    wire reserve_accept, cancel_accept;
    wire [31:0] apply_ready_cycles;
    wire [1:0] apply_port;
    wire [31:0] apply_intensity, apply_duration_ms;
    wire [2047:0] held_reply;
    // The live HID bitmap remains game-visible. Either Control and either Alt
    // held with F12 also assert the separate supervisor-request level.
    wire keyboard_supervisor_request = keyboard_words[69] &&
        (keyboard_words[224] || keyboard_words[228]) &&
        (keyboard_words[226] || keyboard_words[230]);
    io_sys_endpoint endpoint (.*);
    io_registerfile registers (
        .supervisor_request(supervisor_request || keyboard_supervisor_request), .*
    );
    pad_host acquisition (
        .clk(clk), .reset_n(reset_n), .display_context_valid(display_context_valid),
        .display_width(display_width), .display_height(display_height),
        .display_epoch(display_epoch), .apply_valid(apply_valid), .apply_ready(apply_ready),
        .reserve_accept(reserve_accept), .cancel_accept(cancel_accept),
        .apply_ready_cycles(apply_ready_cycles),
        .apply_port(apply_port), .apply_intensity(apply_intensity), .apply_duration_ms(apply_duration_ms),
        .dispatch_done(dispatch_done), .dispatch_tag(dispatch_tag),
        .packet_valid(packet_valid), .link_error(link_error), .held_reply(held_reply),
        .pad_clk(pad_clk), .pad_cmd(pad_cmd), .pad_data(pad_data), .pad_select_n(pad_select_n)
    );
endmodule
