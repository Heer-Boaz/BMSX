`timescale 1ns/1ps
// Production SYS initiator, INPUT endpoint, pad sequencer and CRC-checking
// accessory peers. Only externally supplied pad observations are test values.
module io_reservation_tb;
    import pad_protocol_pkg::*;
    reg clk=0;
    always #5 clk=!clk;
    reg reset_n=1;
    reg req_valid=0, req_write=0;
    reg [31:0] req_addr=0, req_wdata=0;
    reg [3:0] req_be_n=0, req_header_be_n=4'hf;
    wire req_ready, rsp_valid, rsp_timeout, bus_busy;
    wire [31:0] rsp_rdata, rsp_fault_code, master_out, target_out;
    wire master_oe, target_oe, ready_low;
    wire bus_as_n, bus_rd_n, bus_wr_n;
    wire [3:0] bus_be_n;
    tri [31:0] bus_ad;
    tri1 bus_ready_n;
    assign bus_ad=master_oe ? master_out : 32'bz;
    assign bus_ad=target_oe ? target_out : 32'bz;
    assign bus_ready_n=ready_low ? 1'b0 : 1'bz;
    system_bus_master master (
        .clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),
        .req_write(req_write),.req_addr(req_addr),.req_wdata(req_wdata),
        .req_be_n(req_be_n),.req_header_be_n(req_header_be_n),.req_meta(32'ha5f08800),
        .req_data_timeout_enable(1'b1),.req_data_wait_last(18'd15),
        .rsp_valid(rsp_valid),.rsp_rdata(rsp_rdata),.rsp_fault_code(rsp_fault_code),
        .rsp_timeout(rsp_timeout),.bus_busy(bus_busy),.bus_ad_in(bus_ad),
        .bus_ad_out(master_out),.bus_ad_oe(master_oe),.bus_as_n(bus_as_n),
        .bus_rd_n(bus_rd_n),.bus_wr_n(bus_wr_n),.bus_be_n(bus_be_n),.bus_ready_n(bus_ready_n)
    );
    wire pad_clk;
    wire [3:0] pad_cmd, pad_select_n, pad_data, packet_valid, link_error;
    wire dispatch_done;
    wire [31:0] dispatch_tag;
    io_controller input_controller (
        .clk(clk),.reset_n(reset_n),.bus_ad_in(bus_ad),.bus_as_n(bus_as_n),
        .bus_rd_n(bus_rd_n),.bus_wr_n(bus_wr_n),.cs_io_n(1'b0),.bus_be_n(bus_be_n),
        .bus_ad_out(target_out),.bus_ad_oe(target_oe),.bus_ready_drive_low(ready_low),
        .vblank_begin(1'b0),.supervisor_request(1'b0),.keyboard_words(256'd0),
        .snapshot_taken(),.supervisor_edge(),.display_context_valid(1'b0),
        .display_width(16'd0),.display_height(16'd0),.display_epoch(32'd0),
        .pad_clk(pad_clk),.pad_cmd(pad_cmd),.pad_select_n(pad_select_n),
        .pad_data(pad_data),.packet_valid(packet_valid),.link_error(link_error),
        .dispatch_done(dispatch_done),.dispatch_tag(dispatch_tag)
    );
    wire [3:0] accessory_oe, accepted;
    wire [127:0] last_tag, last_intensity, last_duration;
    genvar lane;
    generate for(lane=0;lane<4;lane=lane+1) begin: peripherals
        wire data_bit;
        assign pad_data[lane]=accessory_oe[lane] ? data_bit : 1'b1;
        pad_accessory #(.FEATURES(8'h01),.CAPABILITY(32'd1),.STANDARD_POINTER(0)) accessory (
            .clk(clk),.reset_n(reset_n),.pad_clk(pad_clk),.pad_select_n(pad_select_n[lane]),
            .pad_command(pad_cmd[lane]),.pad_data(data_bit),.pad_data_oe(accessory_oe[lane]),
            .pad_words(224'd0),.pointer_words(128'd0),.apply_accepted(accepted[lane]),
            .last_apply_tag(last_tag[lane*32 +:32]),
            .requested_intensity(last_intensity[lane*32 +:32]),
            .requested_duration_ms(last_duration[lane*32 +:32]),.motor_level_q16(),
            .request_accepted(),.remaining_ms(),.context_valid(),.display_width(),
            .display_height(),.display_epoch()
        );
    end endgenerate
    integer frames=0, applies=0, dispatches=0, transfers=0;
    always @(negedge pad_select_n[0]) if(reset_n) frames=frames+1;
    always @(posedge clk) if(reset_n) begin
        if(master_oe && target_oe) $fatal(1,"SYS_AD contention");
        for(integer p=0;p<4;p=p+1) if(accepted[p]) begin
            if(p!=2) $fatal(1,"APPLY reached an unselected accessory");
            applies=applies+1;
        end
        if(dispatch_done) dispatches=dispatches+1;
    end
    task automatic tick; @(posedge clk); #1; endtask
    task automatic transfer(input [3:0] operation,input bit writing,
        input [31:0] address,input [31:0] value,input [3:0] be,
        input [31:0] expected_fault,output [31:0] result);
        @(negedge clk);while(!req_ready) @(negedge clk);
        req_valid=1;req_write=writing;req_addr=address;req_wdata=value;
        req_be_n=be;req_header_be_n=operation;
        tick();@(negedge clk);req_valid=0;
        while(!rsp_valid) tick();
        if(rsp_fault_code!==expected_fault || rsp_timeout)
            $fatal(1,"Reservation packet op=%h addr=%h fault=%h timeout=%b",
                operation,address,rsp_fault_code,rsp_timeout);
        result=rsp_rdata;transfers=transfers+1;
        if(bus_busy) $fatal(1,"Packet did not release SYS at completion");
    endtask
    reg [31:0] word_result, deadline;
    integer saved_frames;
    reg bus_test_done=0;
    initial begin
        #2;reset_n=0;tick();tick();@(negedge clk);reset_n=1;
        repeat(300) tick();
        transfer(4'hf,1,32'h0800010c,2,0,0,word_result);
        transfer(4'hf,1,32'h08000110,32'h11112222,0,0,word_result);
        transfer(4'hf,1,32'h08000114,32'h33334444,0,0,word_result);
        transfer(4'he,0,32'h0800011c,0,0,0,deadline);
        if(deadline==0 || deadline>PAD_FRAME_READY_CYCLES+2)
            $fatal(1,"Busy frame did not return a bounded readiness deadline %d",deadline);
        saved_frames=frames;
        // The query has not submitted an output command. Parameter stores
        // before the eventual APPLY must still determine its actual payload.
        transfer(4'hf,1,32'h08000110,32'h89abcdef,0,0,word_result);
        transfer(4'hf,1,32'h08000114,32'h76543210,0,0,word_result);
        repeat(deadline) tick();
        if(frames!=saved_frames || pad_select_n!==4'hf || applies!=0 || dispatches!=0)
            $fatal(1,"Reservation dispatched/coalesced a command or lost its idle credit");
        transfer(4'he,0,32'h0800011c,0,0,0,word_result);
        if(word_result!==0) $fatal(1,"Reserved deadline did not reach zero");
        repeat(100) tick();
        // Bad transport forms are faults, never hidden architectural stores.
        transfer(4'he,1,32'h0800011c,1,0,1,word_result);
        transfer(4'he,0,32'h08000110,0,0,1,word_result);
        transfer(4'he,0,32'h0800011c,0,4'b1110,1,word_result);
        transfer(4'ha,1,32'h08000110,32'hdeadbeef,0,1,word_result);
        transfer(4'hf,0,32'h08000110,0,0,0,word_result);
        if(word_result!==32'h89abcdef) $fatal(1,"Transport operation mutated architectural data");
        transfer(4'hf,0,32'h0800011c,0,0,0,word_result);
        if(word_result!==0 || frames!=saved_frames) $fatal(1,"Normal CTRL read consumed the reservation");
        transfer(4'hf,1,32'h0800011c,1,0,0,word_result);
        if(frames!=saved_frames+1) $fatal(1,"APPLY failed to consume held frame credit once");
        // Reserve the following frame while this command is already in flight.
        transfer(4'he,0,32'h0800011c,0,0,0,deadline);
        repeat(deadline) tick();
        if(applies!=1 || dispatches!=1 || last_tag[64 +:32]!==1 ||
            last_intensity[64 +:32]!==32'h89abcdef || last_duration[64 +:32]!==32'h76543210)
            $fatal(1,"APPLY did not capture actual-commit operands/tag exactly once");
        saved_frames=frames;
        transfer(4'hd,0,32'h0800011c,0,0,0,word_result);
        if(word_result!==0 || frames!=saved_frames+1)
            $fatal(1,"CANCEL did not release the next automatic POLL");
        transfer(4'he,0,32'h0800011c,0,0,0,deadline);
        repeat(deadline) tick();
        if(pad_select_n!==4'hf) $fatal(1,"Second reservation failed");
        saved_frames=frames;
        @(negedge clk);reset_n=0;tick();tick();@(negedge clk);reset_n=1;
        repeat(6) tick();
        if(frames!=saved_frames+1) $fatal(1,"Board reset retained a stale reservation");
        bus_test_done=1;
    end

    // Isolate the critical IDLE acceptance edge without peeking at FSM state.
    // This is the host's own valid/ready boundary, independently of SYS timing.
    reg direct_reset_n=1, direct_reserve=0, direct_cancel=0, direct_apply=0;
    wire direct_ready, direct_clk, direct_data, direct_data_oe;
    wire [3:0] direct_selects, direct_commands;
    wire [31:0] direct_cycles, direct_tag;
    wire direct_accepted, direct_dispatch;
    integer direct_applies=0, direct_dispatches=0;
    pad_host boundary_host (
        .clk(clk),.reset_n(direct_reset_n),.display_context_valid(1'b0),
        .display_width(16'd0),.display_height(16'd0),.display_epoch(32'd0),
        .apply_valid(direct_apply),.apply_ready(direct_ready),
        .reserve_accept(direct_reserve),.cancel_accept(direct_cancel),
        .apply_ready_cycles(direct_cycles),.apply_port(2'd0),
        .apply_intensity(32'h13572468),.apply_duration_ms(32'hfedcba98),
        .dispatch_done(direct_dispatch),.dispatch_tag(),.packet_valid(),.link_error(),
        .held_reply(),.pad_clk(direct_clk),.pad_cmd(direct_commands),
        .pad_select_n(direct_selects),.pad_data({3'b111,direct_data_oe ? direct_data : 1'b1})
    );
    pad_accessory #(.FEATURES(8'h01),.CAPABILITY(32'd1),.STANDARD_POINTER(0)) boundary_accessory (
        .clk(clk),.reset_n(direct_reset_n),.pad_clk(direct_clk),.pad_select_n(direct_selects[0]),
        .pad_command(direct_commands[0]),.pad_data(direct_data),.pad_data_oe(direct_data_oe),
        .pad_words(224'd0),.pointer_words(128'd0),.apply_accepted(direct_accepted),
        .last_apply_tag(direct_tag),.requested_intensity(),.requested_duration_ms(),
        .motor_level_q16(),.request_accepted(),.remaining_ms(),.context_valid(),
        .display_width(),.display_height(),.display_epoch()
    );
    always @(posedge clk) if(direct_reset_n) begin
        if(direct_accepted) direct_applies=direct_applies+1;
        if(direct_dispatch) direct_dispatches=direct_dispatches+1;
    end
    reg boundary_test_done=0;
    initial begin
        #2;direct_reset_n=0;tick();tick();@(negedge clk);direct_reset_n=1;
        tick();tick();
        if(!direct_ready) $fatal(1,"Host did not expose first idle frame credit");
        @(negedge clk);direct_reserve=1;tick();
        @(negedge clk);direct_reserve=0;
        repeat(100) tick();
        if(!direct_ready || direct_cycles!==0 || direct_selects!==4'hf)
            $fatal(1,"Same-edge idle reservation lost credit to automatic POLL");
        @(negedge clk);direct_apply=1;tick();
        @(negedge clk);direct_apply=0;direct_reserve=1;tick();
        @(negedge clk);direct_reserve=0;
        repeat(PAD_FRAME_READY_CYCLES+4) tick();
        if(direct_applies!=1 || direct_dispatches!=1 || direct_tag!==0 ||
            !direct_ready || direct_cycles!==0 || direct_selects!==4'hf)
            $fatal(1,"Held-idle tags advanced or first actual APPLY was not unique tag zero");
        @(negedge clk);direct_cancel=1;tick();@(negedge clk);direct_cancel=0;tick();
        if(direct_selects!==0) $fatal(1,"Direct cancel did not restart automatic POLL");
        boundary_test_done=1;
    end
    initial begin
        wait(bus_test_done && boundary_test_done);
        $display("PASS io_reservation packets=%0d APPLYs=%0d deadline_max=%0d idle_edge_tag=0 cancel/reset/no-side-effects",transfers,applies,PAD_FRAME_READY_CYCLES+2);
        $finish;
    end
    initial begin #10000000;$fatal(1,"Reservation watchdog");end
endmodule
