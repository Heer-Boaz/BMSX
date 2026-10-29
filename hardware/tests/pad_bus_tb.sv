`timescale 1ns/1ps

// Exercise the actual native bus and pad transport together. Only U7's
// HEADER/ADDRESS decoder, operand registers and READY response are modeled here;
// this is not an implementation of U7 or ARM/VBlank snapshot publication.
module pad_bus_tb;
    import pad_protocol_pkg::*;
    localparam [31:0] OUTPUT_PORT = 32'h0800010c,
        OUTPUT_INTENSITY = 32'h08000110, OUTPUT_DURATION = 32'h08000114,
        OUTPUT_CTRL = 32'h0800011c, UNSELECTED = 32'h08000120;
    // Count system-clock edges here; #5 does not assert physical pin timing.
    // The production divider still uses its 33.8688 MHz reference constants.
    reg clk = 0;
    always #5 clk = !clk;
    reg reset_n = 1;
    reg req_valid = 0;
    wire req_ready, rsp_valid;
    reg req_write = 1;
    reg [31:0] req_addr = 0, req_wdata = 0, req_meta = 0;
    reg [3:0] req_be_n = 0;
    reg [17:0] req_data_wait_last = 18'd15;
    wire [31:0] rsp_rdata, bus_ad_out;
    wire [31:0] rsp_fault_code;
    wire rsp_timeout;
    wire bus_ad_oe, bus_as_n, bus_rd_n, bus_wr_n;
    wire [3:0] bus_be_n;
    wire [31:0] bus_ad_in = 0;
    wire bus_ready_n;

    system_bus_master bus_master (
        .req_header_be_n(4'hf), .bus_busy(),.req_data_timeout_enable(1'b1), .*);

    reg address_slot = 0;
    reg [31:0] endpoint_address = 0;
    reg [31:0] port_word = 0, intensity_word = 0, duration_word = 0;
    reg data_accepted = 0;
    integer response_edges = 0, data_edges = 0;
    integer apply_accepts = 0, max_apply_wait = 0;
    integer completed = 0;
    wire data_write = bus_as_n && bus_rd_n && !bus_wr_n && bus_ad_oe;
    wire response_phase = bus_as_n && !bus_rd_n && !bus_wr_n && !bus_ad_oe;
    wire parameter_address = endpoint_address == OUTPUT_PORT ||
        endpoint_address == OUTPUT_INTENSITY || endpoint_address == OUTPUT_DURATION;
    wire apply_valid = data_write && endpoint_address == OUTPUT_CTRL &&
        bus_ad_out == 32'h00000001 && bus_be_n == 4'b0000;
    wire apply_ready;
    // No DATA acknowledgement precedes the pad frame's operand acceptance.
    // Delaying RESPONSE to its final allowed edge also exercises pin-level
    // acknowledgement precedence, without changing the pad DATA deadline.
    assign bus_ready_n = !((data_write && bus_be_n == 4'b0000 &&
        (parameter_address || (endpoint_address == OUTPUT_CTRL &&
        (!apply_valid || apply_ready)))) ||
        (response_phase && data_accepted && response_edges == 15));

    wire dispatch_done;
    wire [31:0] dispatch_tag;
    wire [3:0] packet_valid, link_error;
    wire [2047:0] held_reply;
    wire pad_clk;
    wire [3:0] pad_cmd, pad_select_n;
    // This output-submission test needs no successful accessory reply.
    wire [3:0] pad_data = 4'hf;
    pad_host host (
        .clk(clk), .reset_n(reset_n),
        .display_context_valid(1'b0), .display_width(16'd0),
        .display_height(16'd0), .display_epoch(32'd0),
        .apply_valid(apply_valid), .apply_ready(apply_ready),
        .reserve_accept(1'b0), .cancel_accept(1'b0), .apply_ready_cycles(),
        .apply_port(port_word[1:0]), .apply_intensity(intensity_word),
        .apply_duration_ms(duration_word), .dispatch_done(dispatch_done),
        .dispatch_tag(dispatch_tag), .packet_valid(packet_valid),
        .link_error(link_error), .held_reply(held_reply),
        .pad_clk(pad_clk), .pad_cmd(pad_cmd), .pad_data(pad_data),
        .pad_select_n(pad_select_n)
    );

    always @(posedge clk) begin
        if (!reset_n) begin
            address_slot <= 0;
            endpoint_address <= 0;
            port_word <= 0;
            intensity_word <= 0;
            duration_word <= 0;
            data_accepted <= 0;
            response_edges <= 0;
            data_edges = 0;
            apply_accepts = 0;
            max_apply_wait = 0;
        end else begin
            if (!bus_as_n && bus_ad_oe) begin
                if (address_slot) endpoint_address <= bus_ad_out;
                else begin
                    data_edges = 0;
                    data_accepted <= 0;
                end
                address_slot <= !address_slot;
            end else address_slot <= 0;
            if (data_write) begin
                data_edges = data_edges + 1;
                if (apply_valid && !apply_ready && !bus_ready_n)
                    $fatal(1, "Busy pad transport acknowledged APPLY before admission");
                if (!bus_ready_n) begin
                    data_accepted <= 1;
                    response_edges <= 0;
                    case (endpoint_address)
                        OUTPUT_PORT: port_word <= bus_ad_out;
                        OUTPUT_INTENSITY: intensity_word <= bus_ad_out;
                        OUTPUT_DURATION: duration_word <= bus_ad_out;
                        OUTPUT_CTRL: if (apply_valid) begin
                            if (!apply_ready || pad_select_n !== 4'hf)
                                $fatal(1, "APPLY acceptance was not a new frame boundary");
                            if (data_edges <= 16 || data_edges > 81920)
                                $fatal(1, "APPLY DATA wait outside busy-link bound: %0d", data_edges);
                            apply_accepts = apply_accepts + 1;
                            if (data_edges > max_apply_wait) max_apply_wait = data_edges;
                        end
                    endcase
                end
            end
            if (response_phase && data_accepted) begin
                if (bus_ready_n) response_edges <= response_edges + 1;
                else data_accepted <= 0;
            end
        end
    end

    reg [1:0] expected_port [0:2];
    reg [31:0] expected_intensity [0:2], expected_duration [0:2];
    reg [2047:0] wire_frames = 0;
    reg [15:0] wire_crc [0:3];
    reg frame_open = 0;
    integer wire_bits = 0, wire_frames_done = 0, wire_applies = 0;
    integer dispatches = 0, last_apply_tag = -1;
    integer lane, serial_bit, flag_count;

    always @(negedge pad_select_n[0]) begin
        if (reset_n) begin
            if (frame_open || pad_select_n !== 4'h0 || pad_clk !== 0)
                $fatal(1, "Incorrect shared-clock frame start");
            frame_open = 1;
            wire_frames = 0;
            wire_bits = 0;
            for (integer p = 0; p < 4; p = p + 1) wire_crc[p] = 16'hffff;
        end
    end

    always @(posedge pad_clk) begin
        if (reset_n) begin
            if (!frame_open || pad_select_n !== 0 || wire_bits >= PAD_FRAME_BITS)
                $fatal(1, "Unexpected serial sample edge");
            serial_bit = (wire_bits / 8) * 8 + 7 - (wire_bits % 8);
            for (integer p = 0; p < 4; p = p + 1) begin
                wire_frames[p * 512 + serial_bit] = pad_cmd[p];
                if (wire_bits < PAD_BODY_BITS)
                    wire_crc[p] = pad_crc_bit(wire_crc[p], pad_cmd[p]);
            end
            wire_bits = wire_bits + 1;
        end
    end

    always @(posedge pad_select_n[0]) begin
        if (reset_n && frame_open) begin
            if (wire_bits != PAD_FRAME_BITS || pad_select_n !== 4'hf || pad_clk !== 0)
                $fatal(1, "Incomplete native wire frame");
            flag_count = 0;
            for (lane = 0; lane < 4; lane = lane + 1) begin
                if (wire_frames[lane * 512 +: 32] !== 32'h58534d42 ||
                    wire_frames[lane * 512 + 32 +: 8] !== 8'h01 ||
                    {wire_frames[lane * 512 + 496 +: 8],
                     wire_frames[lane * 512 + 504 +: 8]} !== wire_crc[lane])
                    $fatal(1, "Wire header or CRC mismatch on lane %0d", lane);
                case (wire_frames[lane * 512 + 40 +: 8])
                    8'h00: begin
                        if (wire_frames[lane * 512 + 96 +: 64] !== 0)
                            $fatal(1, "A poll replayed output operands");
                    end
                    8'h01: begin
                        if (wire_applies >= 3 || lane !== expected_port[wire_applies] ||
                            wire_frames[lane * 512 + 96 +: 32] !== expected_intensity[wire_applies] ||
                            wire_frames[lane * 512 + 128 +: 32] !== expected_duration[wire_applies])
                            $fatal(1, "Raw output words, selected port or request order changed");
                        if (wire_frames[lane * 512 + 64 +: 32] == last_apply_tag)
                            $fatal(1, "Identical APPLY writes reused one dispatch");
                        last_apply_tag = wire_frames[lane * 512 + 64 +: 32];
                        flag_count = flag_count + 1;
                    end
                    default: $fatal(1, "Unexpected output command byte");
                endcase
            end
            if (flag_count > 1) $fatal(1, "One APPLY selected multiple ports");
            wire_applies = wire_applies + flag_count;
            wire_frames_done = wire_frames_done + 1;
            frame_open = 0;
        end
    end

    always @(posedge clk) begin
        if (reset_n && dispatch_done) dispatches = dispatches + 1;
    end

    task automatic tick;
        @(posedge clk);
        #1;
    endtask

    task automatic write_word(input [31:0] address, input [31:0] word,
                              input [17:0] deadline, input bit timeout);
        @(negedge clk);
        if (!req_ready) $fatal(1, "Producer launched without bus readiness");
        req_valid = 1;
        req_addr = address;
        req_wdata = word;
        req_data_wait_last = deadline;
        tick();
        req_valid = 0;
        while (!rsp_valid) tick();
        if (rsp_timeout !== timeout || rsp_fault_code !== 0 || rsp_rdata !== 0)
            $fatal(1, "Native bus completion mismatch address=%h timeout=%b", address, rsp_timeout);
        if (address == UNSELECTED && data_edges != 16)
            $fatal(1, "Ordinary DATA deadline changed: %0d clocks", data_edges);
        completed = completed + 1;
    endtask

    initial begin
        #10000000;
        $fatal(1, "Pad/bus integration watchdog expired");
    end

    initial begin
        expected_port[0] = 3;
        expected_intensity[0] = 32'hffffffff;
        expected_duration[0] = 32'hffffffff;
        expected_port[1] = 1;
        expected_intensity[1] = 32'h80000001;
        expected_duration[1] = 32'h89abcdef;
        expected_port[2] = 1;
        expected_intensity[2] = expected_intensity[1];
        expected_duration[2] = expected_duration[1];
        #2; reset_n = 0;
        tick(); tick();
        reset_n = 1;
        tick(); tick();
        if (!req_ready) $fatal(1, "Bus did not release reset");
        while (pad_select_n != 0) tick();

        // An ordinary stalled endpoint retains its sixteen-clock budget while
        // the pad engine is already polling; only exact APPLY uses the long one.
        write_word(UNSELECTED, 0, 18'd15, 1'b1);
        // Zero means one permitted DATA edge: its acknowledgement wins there.
        write_word(OUTPUT_PORT, 32'hffffffff, 18'd0, 1'b0);
        write_word(OUTPUT_INTENSITY, expected_intensity[0], 18'd15, 1'b0);
        write_word(OUTPUT_DURATION, expected_duration[0], 18'd15, 1'b0);
        write_word(OUTPUT_CTRL, 1, 18'd81919, 1'b0);

        write_word(OUTPUT_PORT, 1, 18'd15, 1'b0);
        write_word(OUTPUT_INTENSITY, expected_intensity[1], 18'd15, 1'b0);
        write_word(OUTPUT_DURATION, expected_duration[1], 18'd15, 1'b0);
        write_word(OUTPUT_CTRL, 1, 18'd81919, 1'b0);
        // Next request is admitted directly from DONE, with unchanged operands.
        // It is a distinct command even though its parameter words are identical.
        write_word(OUTPUT_CTRL, 1, 18'd81919, 1'b0);

        while (wire_applies < 3) tick();
        begin : later_polls
            integer before_frames;
            before_frames = wire_frames_done;
            while (wire_frames_done < before_frames + 2) tick();
        end
        if (apply_accepts != 3 || wire_applies != 3 || dispatches != 3)
            $fatal(1, "APPLY was lost/replayed: bus=%0d wire=%0d dispatch=%0d",
                apply_accepts, wire_applies, dispatches);
        $display("PASS pad_bus completions=%0d applies=%0d frames=%0d max_DATA_wait=%0d limit=81920",
            completed, wire_applies, wire_frames_done, max_apply_wait);
        $finish;
    end
endmodule
