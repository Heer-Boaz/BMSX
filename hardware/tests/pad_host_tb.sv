`timescale 1ns/1ps

// Independent byte-oriented CRC oracle; the implementation updates one bit at
// a time. The published CCITT-FALSE check vector also anchors the oracle.
package pad_test_crc;
    function automatic [15:0] crc_body(input [511:0] frame);
        reg [15:0] crc;
        integer byte_index, bit_index;
        begin
            crc = 16'hffff;
            for (byte_index = 0; byte_index < 62; byte_index = byte_index + 1) begin
                crc = crc ^ {frame[byte_index * 8 +: 8], 8'h00};
                for (bit_index = 0; bit_index < 8; bit_index = bit_index + 1)
                    crc = crc[15] ? (crc << 1) ^ 16'h1021 : crc << 1;
            end
            crc_body = crc;
        end
    endfunction

    function automatic [511:0] framed(input [511:0] body);
        reg [15:0] crc;
        begin
            crc = crc_body(body);
            framed = body;
            framed[496 +: 8] = crc[15:8];
            framed[504 +: 8] = crc[7:0];
        end
    endfunction
endpackage

// Electrical peer, not a replacement U7 or a qualified peripheral. Reply data
// freezes on SELECT falling; command side effects occur only at SELECT rising.
module pad_test_peer (
    input wire reset_n, serial_clk, select_n, command,
    input wire present, corrupt_crc,
    input wire [511:0] reply_body,
    output wire data,
    output reg [31:0] apply_count,
    output reg [31:0] last_apply_tag,
    output reg [31:0] intensity,
    output reg [31:0] duration_ms,
    output reg [511:0] last_request
);
    import pad_test_crc::*;
    reg [511:0] tx, rx;
    reg apply_seen;
    integer bit_index, rising_edges;
    wire [8:0] wire_bit = (bit_index / 8) * 8 + 7 - bit_index % 8;
    // Includes peripheral launch/cable delay. With the shortest 1.978 us half
    // phase this leaves 128 ns at U7, exercising the specified 100 ns setup.
    assign #1850 data = present && !select_n ? tx[wire_bit] : 1'bz;

    always @(negedge reset_n) begin
        apply_count = 0;
        last_apply_tag = 0;
        intensity = 0;
        duration_ms = 0;
        last_request = 0;
        apply_seen = 0;
    end

    always @(negedge select_n) begin
        bit_index = 0;
        rising_edges = 0;
        rx = 0;
        tx = framed(reply_body);
        tx[42] = apply_seen;
        tx[96 +: 32] = last_apply_tag;
        tx = framed(tx);
        if (corrupt_crc) tx[504] = ~tx[504];
    end

    always @(posedge serial_clk) if (!select_n) begin
        rx[wire_bit] = command;
        rising_edges = rising_edges + 1;
    end

    always @(negedge serial_clk) if (!select_n && bit_index != 511)
        bit_index = bit_index + 1;

    always @(posedge select_n) begin
        if (reset_n && present && rising_edges == 512 &&
            crc_body(rx) == {rx[496 +: 8], rx[504 +: 8]} &&
            rx[0 +: 32] == 32'h58534d42 && rx[32 +: 8] == 8'h01) begin
            last_request = rx;
            if (rx[40 +: 8] == 8'h01) begin
                apply_count = apply_count + 1;
                last_apply_tag = rx[64 +: 32];
                intensity = rx[96 +: 32];
                duration_ms = rx[128 +: 32];
                apply_seen = 1;
            end
        end
    end
endmodule

module pad_host_tb;
    import pad_protocol_pkg::*;
    import pad_test_crc::*;
    reg clk = 0;
    always #14.762849584278 clk = !clk;
    reg reset_n = 1;
    reg apply_valid = 0;
    wire apply_ready;
    reg [1:0] apply_port = 0;
    reg [31:0] intensity = 0, duration_ms = 0;
    wire dispatch_done;
    wire [31:0] dispatch_tag;
    wire [3:0] packet_valid, link_error;
    wire [2047:0] held_reply;
    wire pad_clk;
    wire [3:0] pad_cmd, pad_select_n;
    tri1 [3:0] pad_data;
    reg [3:0] present = 4'hf, corrupt_crc = 0;
    reg [2047:0] reply_body = 0;
    wire [31:0] apply_count [0:3];
    wire [31:0] last_apply_tag [0:3];
    wire [31:0] received_intensity [0:3], received_duration [0:3];
    wire [511:0] last_request [0:3];
    integer cycle = 0, last_edge_cycle = 0, start_cycle = 0;
    integer previous_release_cycle = 0, accepted_cycle = 0;
    integer edge_count = 0, frame_count = 0, accepted_count = 0;
    integer dispatched_count = 0;
    reg in_frame = 0;
    reg [511:0] saved_reply;
    reg [31:0] first_tag;

    pad_host dut (
        .clk(clk), .reset_n(reset_n), .apply_valid(apply_valid),
        .display_context_valid(1'b0), .display_width(16'd0),
        .display_height(16'd0), .display_epoch(32'd0),
        .apply_ready(apply_ready), .apply_port(apply_port),
        .reserve_accept(1'b0), .cancel_accept(1'b0), .apply_ready_cycles(),
        .apply_intensity(intensity), .apply_duration_ms(duration_ms),
        .dispatch_done(dispatch_done), .dispatch_tag(dispatch_tag),
        .packet_valid(packet_valid), .link_error(link_error), .held_reply(held_reply),
        .pad_clk(pad_clk), .pad_cmd(pad_cmd), .pad_data(pad_data),
        .pad_select_n(pad_select_n)
    );

    genvar lane;
    generate for (lane = 0; lane < 4; lane = lane + 1) begin : peer
        pad_test_peer device (
            .reset_n(reset_n), .serial_clk(pad_clk), .select_n(pad_select_n[lane]),
            .command(pad_cmd[lane]), .present(present[lane]),
            .corrupt_crc(corrupt_crc[lane]), .reply_body(reply_body[lane * 512 +: 512]),
            .data(pad_data[lane]), .apply_count(apply_count[lane]),
            .last_apply_tag(last_apply_tag[lane]),
            .intensity(received_intensity[lane]), .duration_ms(received_duration[lane]),
            .last_request(last_request[lane])
        );
    end endgenerate

    always @(posedge clk) begin
        cycle = cycle + 1;
        if (reset_n && apply_valid && apply_ready) begin
            accepted_cycle = cycle;
            accepted_count = accepted_count + 1;
        end
        if (dispatch_done) dispatched_count = dispatched_count + 1;
    end

    always @(pad_select_n) if (reset_n && pad_select_n != 0 && pad_select_n != 15)
        $fatal(1, "The four lanes must share a frame boundary");

    always @(negedge pad_select_n[0]) begin
        if (previous_release_cycle != 0 &&
            cycle - previous_release_cycle < PAD_SELECT_GAP_CYCLES)
            $fatal(1, "SELECT high preparation gap was shortened");
        in_frame = 1;
        edge_count = 0;
        start_cycle = cycle;
        last_edge_cycle = cycle;
    end

    always @(pad_clk) if (reset_n && in_frame) begin
        if (edge_count == 0 && cycle - last_edge_cycle != 68)
            $fatal(1, "First rising edge must follow 68 source clocks");
        if (cycle - last_edge_cycle != 67 && cycle - last_edge_cycle != 68)
            $fatal(1, "Fractional serial half phase is not 67/68 clocks");
        last_edge_cycle = cycle;
        edge_count = edge_count + 1;
        if (edge_count == 1024 && cycle - start_cycle != 69364)
            $fatal(1, "Fractional divider did not maintain the exact clock target");
    end

    always @(posedge pad_select_n[0]) if (reset_n && in_frame) begin
        if (pad_clk || edge_count != 1024 || cycle - last_edge_cycle != 68)
            $fatal(1, "Frame length/idle level/SELECT trailing hold mismatch");
        if (cycle - start_cycle != 69432)
            $fatal(1, "Selected frame duration changed");
        previous_release_cycle = cycle;
        frame_count = frame_count + 1;
        in_frame = 0;
    end

    task automatic wait_frame;
        begin
            @(posedge pad_select_n[0]);
            repeat (3) @(negedge clk);
        end
    endtask

    task automatic apply(input [1:0] port, input [31:0] level, input [31:0] duration);
        integer asserted_cycle;
        begin
            @(negedge clk);
            apply_port = port;
            intensity = level;
            duration_ms = duration;
            apply_valid = 1;
            asserted_cycle = cycle;
            @(posedge clk);
            while (!apply_ready) @(posedge clk);
            if (cycle - asserted_cycle > 81920)
                $fatal(1, "APPLY exceeded the finite endpoint DATA wait budget");
            @(negedge clk);
            apply_valid = 0;
        end
    endtask

    initial begin : run
        reg [15:0] crc;
        reg [71:0] check_bytes;
        integer byte_index, bit_index, port, word_index;
        #1;
        reset_n = 0;
        check_bytes = 72'h393837363534333231; // 123456789, byte zero first
        crc = 16'hffff;
        for (byte_index = 0; byte_index < 9; byte_index = byte_index + 1) begin
            crc = crc ^ {check_bytes[byte_index * 8 +: 8], 8'h00};
            for (bit_index = 0; bit_index < 8; bit_index = bit_index + 1)
                crc = crc[15] ? (crc << 1) ^ 16'h1021 : crc << 1;
        end
        if (crc != 16'h29b1) $fatal(1, "CRC check vector failed");
        for (port = 0; port < 4; port = port + 1) begin
            reply_body[port * 512 +: 32] = 32'h44415042; // BPAD
            reply_body[port * 512 + 32 +: 8] = 1;
            reply_body[port * 512 + 40 +: 8] = 8'h83;
            reply_body[port * 512 + 48 +: 16] = 16'hb000 + port;
            reply_body[port * 512 + 64 +: 32] = 32'h8000_00ff << port;
            for (word_index = 0; word_index < 11; word_index = word_index + 1)
                reply_body[port * 512 + 128 + word_index * 32 +: 32] =
                    32'h8000_0000 ^ (32'h1234_5678 * (word_index + port * 11));
            // Reserved and feature bits are not a DTO validity filter.
            reply_body[port * 512 + 480 +: 16] = 16'hba5e;
        end
        repeat (3) @(negedge clk);
        if (pad_select_n != 15 || pad_clk || apply_ready || packet_valid)
            $fatal(1, "Reset electrical/storage state mismatch");
        // A command on the first frame legitimately has request tag zero.
        apply_port = 3;
        apply_valid = 1;
        reset_n = 1;
        wait (apply_ready);
        @(posedge clk);
        @(negedge clk);
        apply_valid = 0;
        wait_frame();
        if (packet_valid != 15 || link_error != 0)
            $fatal(1, "Valid parallel replies did not establish all packet latches");
        for (port = 0; port < 4; port = port + 1) begin
            if (held_reply[port * 512 + 128 +: 352] !=
                reply_body[port * 512 + 128 +: 352])
                $fatal(1, "Raw pad/pointer words were altered");
            if (held_reply[port * 512 + 40 +: 56] !=
                reply_body[port * 512 + 40 +: 56])
                $fatal(1, "Raw identity/features/capability words were altered");
        end
        if ({last_request[0][496 +: 8], last_request[0][504 +: 8]} != 16'hd39d)
            $fatal(1, "Tag-zero POLL frame disagrees with golden CRC D39D");
        if (apply_count[3] != 1 || last_apply_tag[3] != 0 || held_reply[3 * 512 + 42])
            $fatal(1, "First-frame tag-zero command or simultaneous receipt flag failed");

        // The remote command commits even if its simultaneous reply is bad.
        corrupt_crc[2] = 1;
        apply(2, 32'hffff_ffff, 32'hffff_ffff);
        first_tag = dut.active_tag;
        // Later producer values cannot alter the in-flight raw command.
        intensity = 0;
        duration_ms = 0;
        wait_frame();
        if (apply_count[2] != 1 || received_intensity[2] != 32'hffff_ffff ||
            received_duration[2] != 32'hffff_ffff || !link_error[2] ||
            last_apply_tag[2] != first_tag || dispatched_count != 2)
            $fatal(1, "APPLY capture/remote commit/error independence failed");
        for (port = 0; port < 4; port = port + 1)
            if (port != 2 && apply_count[port] != (port == 3 ? 1 : 0))
                $fatal(1, "APPLY leaked to another physical port");
        if (!held_reply[3 * 512 + 42] || held_reply[3 * 512 + 96 +: 32] != 0)
            $fatal(1, "APPLY_SEEN did not disambiguate the valid tag-zero receipt");
        if (last_request[2][160 +: 336] != 0)
            $fatal(1, "Reserved request bytes acquired unowned data");

        corrupt_crc[2] = 0;
        // Every accepted APPLY gets its own frame; second request waits rather
        // than overwriting the first, including stop commands and raw extremes.
        apply(2, 32'h8000, 32'h64);
        apply(2, 0, 32'hffff_ffff);
        wait_frame();
        if (apply_count[2] != 3 || received_intensity[2] != 0 ||
            received_duration[2] != 32'hffff_ffff || dispatched_count != 4)
            $fatal(1, "Back-to-back requests were coalesced or stop was altered");
        wait_frame();
        if (apply_count[2] != 3 || held_reply[2 * 512 + 96 +: 32] != last_apply_tag[2])
            $fatal(1, "POLL restarted the output or omitted previous receipt tag");
        if (!held_reply[2 * 512 + 42] || held_reply[0 * 512 + 42])
            $fatal(1, "APPLY_SEEN failed to distinguish no receipt from tag zero");

        // New records arriving mid-frame cannot tear an already frozen reply.
        @(negedge pad_select_n[0]);
        saved_reply = held_reply[0 +: 512];
        reply_body[128 +: 32] = 32'hffff_ffff;
        repeat (100) @(negedge clk);
        if (held_reply[0 +: 512] != saved_reply)
            $fatal(1, "Partially received data escaped into held packet storage");
        wait_frame();
        if (held_reply[128 +: 32] != saved_reply[128 +: 32])
            $fatal(1, "Reply changed after its SELECT capture boundary");
        wait_frame();
        if (held_reply[128 +: 32] != 32'hffff_ffff)
            $fatal(1, "Next complete update failed to publish");

        // Electrical absence and framing faults are separate from neutral input.
        saved_reply = held_reply[0 +: 512];
        present[0] = 0;
        reply_body[1 * 512 +: 32] = 32'hffff_ffff;
        reply_body[3 * 512 + 32 +: 8] = 2;
        wait_frame();
        wait_frame();
        if (link_error != 4'b1011 || packet_valid != 15 ||
            held_reply[0 +: 512] != saved_reply)
            $fatal(1, "Unplugged/foreign/version-mismatched replies altered held state");
        present[0] = 1;
        reply_body[1 * 512 +: 32] = 32'h44415042;
        reply_body[3 * 512 + 32 +: 8] = 1;
        wait_frame();
        wait_frame();
        if (link_error != 0) $fatal(1, "Next valid packet failed to clear link error");

        // Async reset withdraws SELECT during a partial frame. No remote APPLY
        // can commit, and no partial frame becomes a completed packet.
        apply(1, 32'h10000, 0);
        repeat (100) @(negedge clk);
        reset_n = 0;
        in_frame = 0;
        #1;
        if (pad_select_n != 15 || pad_clk || held_reply != 0 || packet_valid != 0)
            $fatal(1, "Reset did not release pins and clear packet storage");
        previous_release_cycle = 0;
        repeat (3) @(negedge clk);
        reset_n = 1;
        wait_frame();
        if (apply_count[1] != 0 || packet_valid != 15)
            $fatal(1, "Reset-aborted command was replayed");
        if (accepted_count != 5 || dispatched_count != 4)
            $fatal(1, "Unexpected accepted/dispatched command lifetime");
        $display("PASS: BMSX-PAD 4-lane framing, CRC, raw words, clock budget, APPLY backpressure, held replies and reset (%0d frames)", frame_count);
        $finish;
    end

    initial begin
        #60000000;
        $fatal(1, "Test did not complete within its finite frame budget");
    end
endmodule
