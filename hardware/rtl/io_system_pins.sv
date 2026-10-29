`timescale 1ns/1ps
// U7 I/O and firmware-flash pad ring. SYS/CLK_IO share the system clock; PS/2 and
// front-button pins cross here. VBLANK_EVT is a level toggle per VBlank entry,
// not a narrow pulse: each recipient synchronizes and detects the changed bit.
// INPUT and ROM endpoints share SYS pins, but decode disjoint address ranges.
// Only the selected endpoint drives data/READY. JTAG remains a separate owner.
module io_system_pins (
    input wire clk, reset_n, cs_io_n, cs_rom_n,
    inout wire [31:0] sys_ad,
    input wire sys_as_n, sys_rd_n, sys_wr_n,
    input wire [3:0] sys_be_n,
    inout wire sys_ready_n,
    input wire vblank_evt, supervisor_raw_n,
    inout wire supervisor_n,
    input wire ps2_kbd_clk, ps2_kbd_data,
    input wire display_context,
    output wire pad_clk,
    output wire [3:0] pad_cmd, pad_select_n,
    input wire [3:0] pad_data,
    input wire [15:0] rom_data,
    output wire [21:0] rom_address,
    output wire rom_ce_n, rom_oe_n
);
    (* async_reg = "true" *) reg vblank_meta, vblank_sync;
    (* async_reg = "true" *) reg supervisor_meta, supervisor_sync;
    reg vblank_seen;
    reg [1:0] reset_release;
    wire local_reset_n = reset_release[1];
    wire vblank_begin = reset_release[1] && (vblank_sync != vblank_seen);
    wire supervisor_request = !supervisor_sync;
    wire [255:0] keyboard_words;
    wire context_valid;
    wire [15:0] display_width, display_height;
    wire [31:0] display_epoch;
    wire snapshot_taken, supervisor_edge;
    wire [31:0] bus_ad_out;
    wire bus_ad_oe, bus_ready_drive_low;
    wire [31:0] rom_bus_ad_out;
    wire rom_bus_ad_oe, rom_bus_ready_drive_low;
    wire keyboard_frame_error, keyboard_scan_error;
    wire [3:0] packet_valid, link_error;
    wire dispatch_done;
    wire [31:0] dispatch_tag;

    assign sys_ad = bus_ad_oe ? bus_ad_out : 32'bz;
    assign sys_ad = rom_bus_ad_oe ? rom_bus_ad_out : 32'bz;
    assign sys_ready_n = (bus_ready_drive_low || rom_bus_ready_drive_low) ? 1'b0 : 1'bz;
    assign supervisor_n = supervisor_edge ? 1'b0 : 1'bz;

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            reset_release<=0; vblank_meta<=0; vblank_sync<=0; vblank_seen<=0;
            supervisor_meta<=1; supervisor_sync<=1;
        end else begin
            reset_release<={reset_release[0],1'b1};
            vblank_meta<=vblank_evt; vblank_sync<=vblank_meta;
            supervisor_meta<=supervisor_raw_n; supervisor_sync<=supervisor_meta;
            if (reset_release[1]) vblank_seen<=vblank_sync;
        end
    end

    // The flash shares the board RESET_N with U7. Its endpoint owns local
    // synchronous release and the external 16-bit read cycle.
    rom_sys_endpoint firmware (
        .clk(clk), .reset_n(reset_n), .cs_rom_n(cs_rom_n),
        .bus_ad_in(sys_ad), .bus_as_n(sys_as_n), .bus_rd_n(sys_rd_n),
        .bus_wr_n(sys_wr_n), .bus_be_n(sys_be_n), .bus_ad_out(rom_bus_ad_out),
        .bus_ad_oe(rom_bus_ad_oe), .bus_ready_drive_low(rom_bus_ready_drive_low),
        .flash_data(rom_data), .flash_address(rom_address),
        .flash_ce_n(rom_ce_n), .flash_oe_n(rom_oe_n)
    );

    // Serial context is a U7 pin transport; INPUT consumes its complete bank.
    display_context_rx context_receiver (
        .clk(clk), .reset_n(local_reset_n), .display_context(display_context),
        .context_valid(context_valid), .display_width(display_width),
        .display_height(display_height), .display_epoch(display_epoch),
        .context_update()
    );
    keyboard_set2 keyboard (
        .clk(clk), .reset_n(local_reset_n), .ps2_clock(ps2_kbd_clk), .ps2_data(ps2_kbd_data),
        .snapshot_taken(snapshot_taken), .keys(keyboard_words),
        .frame_error(keyboard_frame_error), .scan_error(keyboard_scan_error)
    );
    io_controller input_subsystem (
        .clk(clk), .reset_n(local_reset_n), .cs_io_n(cs_io_n),
        .bus_ad_in(sys_ad), .bus_as_n(sys_as_n), .bus_rd_n(sys_rd_n),
        .bus_wr_n(sys_wr_n), .bus_be_n(sys_be_n), .bus_ad_out(bus_ad_out),
        .bus_ad_oe(bus_ad_oe), .bus_ready_drive_low(bus_ready_drive_low),
        .vblank_begin(vblank_begin), .supervisor_request(supervisor_request),
        .keyboard_words(keyboard_words), .snapshot_taken(snapshot_taken),
        .supervisor_edge(supervisor_edge), .display_context_valid(context_valid),
        .display_width(display_width), .display_height(display_height), .display_epoch(display_epoch),
        .pad_clk(pad_clk), .pad_cmd(pad_cmd), .pad_select_n(pad_select_n),
        .pad_data(pad_data), .packet_valid(packet_valid), .link_error(link_error),
        .dispatch_done(dispatch_done), .dispatch_tag(dispatch_tag)
    );
endmodule
