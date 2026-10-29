`timescale 1ns/1ps
// Real CORE fabric, U4 source router/reader, local upload and ISSI SRAM pins,
// U7 pins, shared SYS/CAD arbiters and memory controllers. Only physical
// memory/card devices are modeled. Path and socket binding are fixture inputs;
// no voice engine, source binder, decoder or beam pipeline is substituted.
module apu_rom_integration_tb;
    reg clk=0;
    always #14.763 clk=!clk;
    reg reset_n=1, power_reset_n=1;
    reg [2:0] req_valid=0, req_write=0, req_hold=0;
    wire [2:0] req_ready, rsp_valid, rsp_timeout;
    reg [95:0] req_address=0, req_wdata=0, req_access=0;
    reg [8:0] req_size_bytes={3{3'd4}};
    reg [23:0] req_bus_signals=24'h000100;
    reg [2:0] req_data_timeout_enable=3'b111;
    reg [11:0] req_be_n=0;
    reg [53:0] req_data_wait_last={3{18'd15}};
    wire [95:0] rsp_rdata, rsp_fault_code;
    wire memory_ready, block_locked, sys_bus_busy, sys_bus_request;
    wire sys_bus_owned;
    tri [31:0] sys_ad, md;
    tri1 ready_pad, supervisor_n;
    wire sys_ready_n;
    tri sys_as_n, sys_rd_n, sys_wr_n;
    tri [3:0] sys_be_n;
    wire [3:0] mcas_n;
    wire cs_rom_n, cs_io_n, cs_gpu_n, cs_pcrtc_n, cs_apu_n;
    wire [9:0] ma;
    wire mras_n, mwe_n, moe_n;
    wire local_valid, cart_valid, local_write, cart_write;
    reg local_ready=1;
    wire cart_ready;
    wire [31:0] local_address, local_wdata, local_access, cart_address, cart_wdata, cart_access;
    wire [2:0] cart_size_bytes;
    wire cart_data_timeout_enable;
    wire [17:0] cart_data_wait_last;
    wire cart_rsp_timeout;
    wire [3:0] local_be_n, cart_be_n;
    wire [7:0] local_bus_signals, cart_bus_signals;
    reg local_rsp_valid=0, cart_rsp_valid=0;
    reg local_inject_fault=0;
    reg [31:0] local_rdata=0, local_fault_code=0, cart_rdata=0, cart_fault_code=0;
    wire core_cs_rom_n;
    wire cpu_local_withdrawn;
    wire cpu_local_withdraw=1'b0;
    core_memory_system dut(.geo_raw_memory(1'b1),.cpu_private(1'b0),.mras_private_n(),.moe_private_n(),.cs_rom_n(core_cs_rom_n), .*);
    is41lv16100_pair_model memory (
        .clk(clk), .power_reset_n(power_reset_n), .ma(ma), .md(md),
        .ras_n(mras_n), .cas_n(mcas_n), .we_n(mwe_n), .oe_n(moe_n)
    );
    reg vblank_evt=0;
    reg isolate_cancel=0;
    wire io_selected_n=cs_io_n || isolate_cancel && active_operation==4'hd;
    wire [3:0] pad_data;
    wire pad_clk;
    wire [3:0] pad_cmd, pad_select_n;
    wire [21:0] rom_address;
    wire [15:0] rom_data;
    wire rom_ce_n, rom_oe_n;
    assign #(70,70,20) rom_data = !rom_ce_n && !rom_oe_n
        ? (rom_address[15:0] ^ 16'h1234) : 16'bz;
    io_system_pins io (
        .clk(clk), .reset_n(reset_n && power_reset_n), .cs_io_n(io_selected_n), .cs_rom_n(cs_rom_n),
        .sys_ad(sys_ad), .sys_as_n(sys_as_n), .sys_rd_n(sys_rd_n), .sys_wr_n(sys_wr_n),
        .sys_be_n(sys_be_n), .sys_ready_n(ready_pad), .vblank_evt(vblank_evt),
        .supervisor_raw_n(1'b1), .supervisor_n(supervisor_n), .ps2_kbd_clk(1'b1),
        .ps2_kbd_data(1'b1), .display_context(1'b1), .pad_clk(pad_clk), .pad_cmd(pad_cmd),
        .pad_select_n(pad_select_n), .pad_data(pad_data), .rom_data(rom_data),
        .rom_address(rom_address), .rom_ce_n(rom_ce_n), .rom_oe_n(rom_oe_n)
    );
    // The own-ASIC READY release + one lumped RC corner is deliberately not
    // instantaneous: 10ns pad +2ns board +28.6ns to0.7VDD. Falling ACK uses12ns.
    // The native470R/50pF budget is independently checked from the netlist.
    reg drop_query_reply=0, drop_apply_reply=0;
    reg [3:0] active_operation=4'hf;
    reg [31:0] active_address=0;
    reg address_next=0;
    wire suppress_reply = !sys_rd_n && !sys_wr_n &&
        (drop_query_reply && active_operation==4'he ||
         drop_apply_reply && active_operation==4'hf && active_address==32'h0800011c);
    assign #(40.6,12) sys_ready_n = suppress_reply ? 1'b1 : ready_pad;
    wire req_apu, gnt_apu, apu_cs_rom_n, apu_cs_cart_n;
    assign cs_rom_n = core_cs_rom_n && apu_cs_rom_n;
    system_bus_arbiter arbitration (
        .clk(clk),.reset_n(reset_n && power_reset_n),.core_request(sys_bus_request),
        .core_busy(sys_bus_busy),.apu_request(req_apu),.core_owned(sys_bus_owned),.apu_grant(gnt_apu),
        .sys_ad(sys_ad),.sys_as_n(sys_as_n),.sys_rd_n(sys_rd_n),.sys_wr_n(sys_wr_n),
        .sys_be_n(sys_be_n),.apu_cs_rom_n(apu_cs_rom_n),.apu_cs_cart_n(apu_cs_cart_n)
    );
    reg source_valid=0, source_rsp_ready=1,source_local=0;
    reg [31:0] source_address=0;
    reg [7:0] source_signals=0;
    wire source_ready, source_rsp_valid, source_timeout;
    wire [31:0] source_data, source_fault;
    wire rom_req,rom_ready,rom_rsp,rom_rsp_ready,rom_timeout;
    wire [31:0] rom_req_address,rom_result,rom_fault;
    wire [7:0] rom_req_signals;wire rom_timeout_enable;wire [17:0] rom_wait_last;
    wire local_read,local_read_ready,local_read_rsp;wire [16:0] local_read_address;
    wire [31:0] local_read_word;
    apu_source_word_router source_router (
        .clk(clk),.reset_n(reset_n && power_reset_n),.req_valid(source_valid),.req_ready(source_ready),
        .req_local(source_local),.req_local_word(source_address[18:2]),.req_rom_address(source_address),.req_rom_signals(source_signals),
        .req_timeout_enable(1'b0),.req_wait_last(18'd0),.local_valid(local_read),.local_ready(local_read_ready),.local_word(local_read_address),
        .local_rsp_valid(local_read_rsp),.local_rsp_data(local_read_word),
        .rom_valid(rom_req),.rom_ready(rom_ready),.rom_address(rom_req_address),.rom_signals(rom_req_signals),
        .rom_timeout_enable(rom_timeout_enable),.rom_wait_last(rom_wait_last),
        .rom_rsp_valid(rom_rsp),.rom_rsp_ready(rom_rsp_ready),.rom_rsp_data(rom_result),.rom_rsp_fault(rom_fault),.rom_rsp_timeout(rom_timeout),
        .rsp_valid(source_rsp_valid),.rsp_ready(source_rsp_ready),.rsp_data(source_data),.rsp_fault(source_fault),.rsp_timeout(source_timeout)
    );
    apu_rom_fetch apu (
        .clk(clk),.reset_n(reset_n && power_reset_n),.req_valid(rom_req),.req_ready(rom_ready),
        .req_address(rom_req_address),.req_bus_signals(rom_req_signals),
        .req_data_timeout_enable(rom_timeout_enable),.req_data_wait_last(rom_wait_last),
        .rsp_valid(rom_rsp),.rsp_ready(rom_rsp_ready),.rsp_data(rom_result),
        .rsp_fault_code(rom_fault),.rsp_timeout(rom_timeout),.req_apu(req_apu),.gnt_apu(gnt_apu),
        .sys_ad(sys_ad),.sys_as_n(sys_as_n),.sys_rd_n(sys_rd_n),.sys_wr_n(sys_wr_n),
        .sys_be_n(sys_be_n),.sys_ready_n(sys_ready_n)
    );
    // The local path is the same publication owner and external ISSI SRAM
    // used for sample playback; this fixture supplies upload and frame events.
    reg upload_stage=0,upload_start=0;reg [31:0] upload_data=0;reg [16:0] upload_address=0;
    wire upload_ready,upload_busy,upload_publish,upload_memory_ready;
    wire sample_req,sample_req_ready,sample_write,sample_rsp;
    wire [16:0] sample_word_address;wire [31:0] sample_write_data,sample_read_data;wire [3:0] sample_be_n;
    wire [17:0] sample_address;tri [15:0] sample_data;wire sample_ce_n,sample_oe_n,sample_we_n;wire [1:0] sample_byte_n;
    apu_upload_commit upload (
        .clk(clk),.reset_n(reset_n),.power_reset_n(power_reset_n),.stage_valid(upload_stage),.stage_index(4'd0),.stage_word(upload_data),
        .start_valid(upload_start),.start_ready(upload_ready),.start_words(5'd1),.cancel(1'b0),.live_word_address(upload_address),
        .batch_busy(upload_busy),.publish_valid(upload_publish),.publish_words(),.publish_base(),.commit_valid(),.commit_words(),.commit_base(),.commit_next_address(),
        .epoch_begin(1'b0),.epoch_end(1'b0),.epoch_active(),.snapshot_ready(),.snapshot_overflow(),.snapshots_pending(),
        .snapshot_change_valid(),.snapshot_change_first(),.snapshot_change_last(),.queued_words(),.epoch_words(),
        .read_valid(local_read),.read_ready(local_read_ready),.read_word_address(local_read_address),.read_rsp_valid(local_read_rsp),.read_rsp_word(local_read_word),
        .memory_ready(upload_memory_ready),.store_req_valid(sample_req),.store_req_ready(sample_req_ready),.store_req_write(sample_write),
        .store_req_word_address(sample_word_address),.store_req_wdata(sample_write_data),.store_req_be_n(sample_be_n),.store_rsp_valid(sample_rsp),.store_rsp_rdata(sample_read_data)
    );
    apu_sample_store sample_store (
        .clk(clk),.reset_n(reset_n),.power_reset_n(power_reset_n),.req_valid(sample_req),.req_ready(sample_req_ready),.req_write(sample_write),
        .req_word_address(sample_word_address),.req_wdata(sample_write_data),.req_be_n(sample_be_n),.rsp_valid(sample_rsp),.rsp_rdata(sample_read_data),
        .memory_ready(upload_memory_ready),.mem_address(sample_address),.mem_data(sample_data),.mem_ce_n(sample_ce_n),.mem_oe_n(sample_oe_n),.mem_we_n(sample_we_n),.mem_be_n(sample_byte_n)
    );
    issi_bll_pin_model #(.ADDRESS_WIDTH(18)) sample_ram (
        .address(sample_address),.data(sample_data),.ce_n(sample_ce_n),.oe_n(sample_oe_n),.we_n(sample_we_n),.be_n(sample_byte_n),.drive_active()
    );
    wire [31:0] cart_endpoint_out;
    wire cart_endpoint_oe, cart_endpoint_ack, source_cart_valid, source_cart_ready, source_cart_cancel;
    wire [31:0] source_cart_address;
    wire [7:0] source_cart_signals;
    wire [1:0] cad_req_ready, cad_rsp_valid, cad_rsp_timeout;
    wire [63:0] cad_rsp_data, cad_rsp_fault;
    assign sys_ad=cart_endpoint_oe ? cart_endpoint_out : 32'bz;
    assign ready_pad=cart_endpoint_ack ? 1'b0 : 1'bz;
    assign source_cart_ready=cad_req_ready[1];
    assign cart_ready=cad_req_ready[0];
    assign cart_rsp_timeout=cad_rsp_timeout[0];
    cart_sys_endpoint cart_target (
        .clk(clk),.reset_n(reset_n && power_reset_n),.cs_cart_n(apu_cs_cart_n),
        .bus_ad_in(sys_ad),.bus_as_n(sys_as_n),.bus_rd_n(sys_rd_n),.bus_wr_n(sys_wr_n),
        .bus_be_n(sys_be_n),.bus_ad_out(cart_endpoint_out),.bus_ad_oe(cart_endpoint_oe),
        .bus_ready_drive_low(cart_endpoint_ack),.cart_valid(source_cart_valid),.cart_ready(source_cart_ready),
        .cart_address(source_cart_address),.cart_bus_signals(source_cart_signals),.cart_cancel(source_cart_cancel),
        .cart_rsp_valid(cad_rsp_valid[1]),.cart_rdata(cad_rsp_data[63:32]),.cart_fault_code(cad_rsp_fault[63:32])
    );
    tri [15:0] cad, card_cad;
    wire cal_lo, cal_hi, cart_clk, crd_n, cwr_n, cart_dir, cart_oe_n;
    wire [1:0] cbe_n, cs_cart_n, cart_ready_n;
    reg selected_socket=0;
    reg [1:0] cart_present_n=0, stalled_cards=0;
    wire drive_to_card, drive_to_core;
    cart_bus_buffer_model buffers (
        .reset_n(reset_n),.oe_n(cart_oe_n),.dir(cart_dir),.cad_core(cad),.cad_card(card_cad),
        .drive_to_card(drive_to_card),.drive_to_core(drive_to_core)
    );
    cart_rom_arbiter cart_memory (
        .clk(clk),.reset_n(reset_n && power_reset_n),.req_valid({source_cart_valid,cart_valid}),
        .req_cancel({source_cart_cancel,1'b0}),.req_ready(cad_req_ready),
        .req_address({source_cart_address,cart_address}),.req_bus_signals({source_cart_signals,cart_bus_signals}),
        .req_write({1'b0,cart_write}),.req_size_bytes({3'd4,cart_size_bytes}),.req_wdata({32'd0,cart_wdata}),
        .selected_socket(selected_socket),.req_data_timeout_enable({1'b0,cart_data_timeout_enable}),
        .req_data_wait_last({18'd0,cart_data_wait_last}),
        .rsp_valid(cad_rsp_valid),.rsp_data(cad_rsp_data),.rsp_fault_code(cad_rsp_fault),.rsp_timeout(cad_rsp_timeout),
        .cad(cad),.cart_ready_n(cart_ready_n),.cart_present_n(cart_present_n),
        .cal_lo(cal_lo),.cal_hi(cal_hi),.cart_clk(cart_clk),.crd_n(crd_n),.cwr_n(cwr_n),
        .cbe_n(cbe_n),.cs_cart_n(cs_cart_n),.cart_dir(cart_dir),.cart_oe_n(cart_oe_n)
    );
    always @* begin cart_rsp_valid=cad_rsp_valid[0];cart_rdata=cad_rsp_data[31:0];cart_fault_code=cad_rsp_fault[31:0];end
    genvar socket;
    generate for(socket=0;socket<2;socket=socket+1) begin: cards
        cart_rom_card_peer #(.SOCKET(socket),.TRACE_WORDS(16384)) card (
            .reset_n(reset_n),.cs_n(cs_cart_n[socket]),.cal_lo(cal_lo),.cal_hi(cal_hi),
            .rd_n(crd_n),.wr_n(cwr_n),.be_n(cbe_n),.stalled(stalled_cards[socket]),
            .cad(card_cad),.ready_n(cart_ready_n[socket])
        );
    end endgenerate
    wire apply_accepted;
    wire [31:0] requested_intensity, requested_duration;
    wire accessory_data;
    assign pad_data={3'b111,accessory_data};
    pad_accessory #(.STANDARD_POINTER(0)) accessory (
        .clk(clk),.reset_n(reset_n),.pad_clk(pad_clk),.pad_select_n(pad_select_n[0]),.pad_command(pad_cmd[0]),
        .pad_data(accessory_data),.pad_data_oe(),.pad_words(224'd0),.pointer_words(128'd0),
        .request_accepted(),.apply_accepted(apply_accepted),.last_apply_tag(),
        .requested_intensity(requested_intensity),.requested_duration_ms(requested_duration),
        .motor_level_q16(),.remaining_ms(),.context_valid(),.display_width(),.display_height(),.display_epoch()
    );
    integer clocks=0, apu_words=0, queries=0, cancels=0, applies=0, accessory_applies=0, dram_words=0;
    integer parked_rom_words=0, parked_cart_words=0, first_query_clock=0, actual_apply_clock=0;
    reg cpu_waiting=0, cpu_finished=0;
    reg split_watch=0;
    integer split_packets=0;
    always @(posedge clk) begin
        clocks=clocks+1;
        if(reset_n) begin
            if(sys_bus_owned && gnt_apu) $fatal(1,"Both physical SYS initiators enabled");
            if(!sys_as_n) begin
                if(!address_next) active_operation=sys_be_n;
                else begin
                    active_address=sys_ad;
                    if(split_watch) begin
                        case(split_packets)
                            0: if(!sys_bus_owned || sys_ad!==32'h00000000)
                                $fatal(1,"Split CORE first packet not owned/addressed correctly");
                            1: if(!gnt_apu || sys_ad!==32'h00000020)
                                $fatal(1,"APU did not take SYS between CORE ROM words");
                            2: if(!sys_bus_owned || sys_ad!==32'h00000004)
                                $fatal(1,"Split CORE second packet not owned/addressed correctly");
                            default: $fatal(1,"Split ROM transaction emitted a duplicate packet");
                        endcase
                        split_packets=split_packets+1;
                    end
                end
                address_next=!address_next;
            end else address_next=0;
            if((!sys_as_n || !sys_rd_n || !sys_wr_n) && ^{sys_as_n,sys_rd_n,sys_wr_n,sys_be_n}===1'bx)
                $fatal(1,"SYS control-driver contention");
            if(!ready_pad && sys_as_n && (sys_rd_n!=sys_wr_n) && !cs_io_n) begin
                if(active_operation==4'he) begin queries=queries+1;if(first_query_clock==0) first_query_clock=clocks;end
                if(active_operation==4'hd) cancels=cancels+1;
                if(active_operation==4'hf && !sys_wr_n && active_address==32'h0800011c && sys_ad==1) begin
                    applies=applies+1;actual_apply_clock=clocks;
                end
            end
            if(source_rsp_valid && source_rsp_ready) apu_words=apu_words+1;
            if(apply_accepted) accessory_applies=accessory_applies+1;
            if(rsp_valid[2]) dram_words=dram_words+1;
        end
    end
    function automatic [31:0] flash_word(input [31:0] address);
        reg [15:0] half_address;
        begin half_address=address[16:1];flash_word={(half_address+16'd1)^16'h1234,half_address^16'h1234};end
    endfunction
    function automatic [31:0] card_word(input [31:0] address,input chosen_socket);
        reg [31:0] next_address;
        reg [15:0] salt;
        begin salt=chosen_socket ? 16'hb137 : 16'h42a5;next_address=address+2;
            card_word={next_address[15:0]^next_address[31:16]^salt,address[15:0]^address[31:16]^salt};end
    endfunction
    task automatic core_word(input integer client,input writing,input [31:0] address,input [31:0] value,input timeout_expected);
        begin
            @(negedge clk);req_valid[client]=1;req_write[client]=writing;
            req_address[client*32+:32]=address;req_wdata[client*32+:32]=value;
            @(posedge clk);while(!req_ready[client]) @(posedge clk);
            @(negedge clk);req_valid[client]=0;
            while(!rsp_valid[client]) @(negedge clk);
            if(rsp_fault_code[client*32+:32]!==0 || rsp_timeout[client]!==timeout_expected)
                $fatal(1,"COREword fault/timeout %h/%b expectedtimeout%b",rsp_fault_code[client*32+:32],rsp_timeout[client],timeout_expected);
        end
    endtask
    task automatic fetch(input [31:0] address,input [7:0] signals,input [31:0] expected,input integer hold_reply);
        reg [31:0] held_data;
        begin
            @(negedge clk);while(!source_ready) @(negedge clk);
            source_valid=1;source_local=0;source_address=address;source_signals=signals;source_rsp_ready=0;
            @(posedge clk);if(!source_ready) $fatal(1,"APUsource admissionchanged");
            @(negedge clk);source_valid=0;source_address=~address;source_signals=~signals;
            selected_socket=!selected_socket;
            while(!source_rsp_valid) @(negedge clk);
            if(source_data!==expected || source_fault!==0 || source_timeout)
                $fatal(1,"APUsourceword addr%h got%h/%h/%b expected%h",address,source_data,source_fault,source_timeout,expected);
            held_data=source_data;
            repeat(hold_reply) begin
                @(negedge clk);
                if(!source_rsp_valid || source_data!==held_data || req_apu)
                    $fatal(1,"APUresponse backpressure retained SYS or changedword");
            end
            source_rsp_ready=1;
            @(negedge clk);
        end
    endtask
    integer before_applies, before_queries, before_cancels, refresh_before, start_clock, flash_period, cart_period;
    integer count;
    initial begin #35000000;$fatal(1,"APU integration watchdog");end
    initial begin
        #2;reset_n=0;power_reset_n=0;repeat(20) @(negedge clk);power_reset_n=1;reset_n=1;
        wait(memory_ready);@(negedge clk);
        req_data_timeout_enable=0;
        // Request the U4 fetch while the first CORE ROM word is on the real
        // pins. U1 must yield SYS at the packet boundary and later re-acquire
        // it for the second word without replaying either initiator.
        split_packets=0;split_watch=1;
        fork
            begin
                core_word(1,0,32'h00000001,0,0);
                if(rsp_rdata[63:32]!==32'h36123512)
                    $fatal(1,"Split CORE value corrupted by APU interleaving");
            end
            begin
                wait(!rom_ce_n && sys_bus_owned);
                fetch(32'h00000020,0,flash_word(32'h00000020),0);
            end
        join
        @(negedge clk);split_watch=0;
        if(split_packets!=3) $fatal(1,"Expected exactly CORE/APU/CORE SYS packets, got %0d",split_packets);
        core_word(0,1,32'h0800010c,0,0);
        core_word(0,1,32'h08000110,32'h12345678,0);
        core_word(0,1,32'h08000114,32'h87654321,0);
        refresh_before=memory.refreshes;cpu_waiting=1;
        fork
            begin core_word(0,1,32'h0800011c,1,0);cpu_finished=1;cpu_waiting=0;end
            begin
                count=0;
                while(!cpu_finished) begin
                    if(count[0]) begin
                        fetch(32'h10000000+(count*4),8'hfc,card_word(32'h10000000+(count*4),1),count==1 ? 8 : 0);
                        if(!cpu_finished) parked_cart_words=parked_cart_words+1;
                    end else begin
                        fetch(count*4,8'ha0,flash_word(count*4),0);
                        if(!cpu_finished) parked_rom_words=parked_rom_words+1;
                    end
                    count=count+1;
                end
            end
            begin
                for(integer n=0;n<64;n=n+1) begin
                    core_word(2,1,32'h08020000+n*4,32'h76540000+n,0);
                    core_word(2,0,32'h08020000+n*4,0,0);
                    if(rsp_rdata[95:64]!==32'h76540000+n) $fatal(1,"GEO/DRAM word corrupted duringIOwait");
                end
            end
        join
        if(queries!=2 || applies!=1 || cancels!=0 || parked_rom_words<100 || parked_cart_words<100)
            $fatal(1,"No deadline-based park or concurrentROM progress queries%0d applies%0d flash%0d card%0d",queries,applies,parked_rom_words,parked_cart_words);
        if(memory.refreshes<=refresh_before+50) $fatal(1,"DRAMrefresh stopped duringlongIOwait");
        if(actual_apply_clock-first_query_clock<50000) $fatal(1,"Expected realserialframewait missing");
        wait(accessory_applies==1);@(negedge clk);
        if(requested_intensity!==32'h12345678 || requested_duration!==32'h87654321)
            $fatal(1,"Actualaccessory didnotreceivecommittedoperands");
        req_bus_signals[23:16]=8'h04; // Bound CORE source: socket0, independentofSELECT.
        // CPU/GEO cartridge requests share the very same physical CAD bridge
        // while U4 is granted SYS; neither is a test-only memory return peer.
        fork
            begin
                for(integer n=0;n<12;n=n+1) begin
                    core_word(2,0,32'h10001000+n*4,0,0);
                    if(rsp_rdata[95:64]!==card_word(32'h10001000+n*4,0)) $fatal(1,"CORECADresponseowner");
                end
            end
            begin for(integer n=0;n<12;n=n+1) fetch(32'h10002000+n*4,8'h0c,card_word(32'h10002000+n*4,1),0);end
        join
        // QUERY can reserve before its response is lost. One CANCEL releases
        // that resource; the failed architectural write never starts a frame.
        before_applies=applies;before_queries=queries;before_cancels=cancels;drop_query_reply=1;
        core_word(0,1,32'h0800011c,1,1);drop_query_reply=0;
        if(applies!=before_applies || queries!=before_queries+1 || cancels!=before_cancels+1)
            $fatal(1,"FailedQUERY wascommitted/retried/notcancelled");
        if(io.input_subsystem.acquisition.reservation) $fatal(1,"CANCEL leftframecreditreserved");
        // By contrast a committed APPLY survives a lost RESPONSE and is not
        // retried or cancelled. The real accessory sees exactly one command.
        before_applies=applies;before_cancels=cancels;drop_apply_reply=1;
        core_word(0,1,32'h0800011c,1,1);drop_apply_reply=0;
        if(applies!=before_applies+1 || cancels!=before_cancels) $fatal(1,"CommittedAPPLYwasretried/cancelled");
        wait(accessory_applies==2);repeat(20) @(negedge clk);
        if(accessory_applies!=2) $fatal(1,"Duplicateaccessorycommand");
        // Measure this exact one-word REQ/GNT source reader, without claiming
        // a voice/cache or arbitrary-ROM bandwidth guarantee.
        start_clock=clocks;
        for(integer n=0;n<64;n=n+1) fetch(n*4,0,flash_word(n*4),0);
        flash_period=clocks-start_clock;start_clock=clocks;
        for(integer n=0;n<64;n=n+1) fetch(32'h10003000+n*4,8'h0c,card_word(32'h10003000+n*4,1),0);
        cart_period=clocks-start_clock;
        // Broken cancellation is not silently reported as a released credit.
        // Then exercise explicit board-reset recovery during a live APU read.
        drop_query_reply=1;isolate_cancel=1;
        core_word(0,1,32'h0800011c,1,1);
        drop_query_reply=0;isolate_cancel=0;
        if(!io.input_subsystem.acquisition.reservation) $fatal(1,"BrokenCANCELwaspretendedsuccessful");
        @(negedge clk);while(!source_ready) @(negedge clk);
        source_valid=1;source_address=32'h80;source_signals=0;
        @(posedge clk);@(negedge clk);source_valid=0;
        wait(!rom_ce_n);#3;reset_n=0;
        repeat(30) @(negedge clk);
        if(source_rsp_valid || req_apu || gnt_apu) $fatal(1,"ResetretainedAPUgrant/reply");
        reset_n=1;
        repeat(100) begin
            @(negedge clk);
            if(source_rsp_valid || rsp_valid!=0) $fatal(1,"Oldreplysurvivedboardreset");
        end
        if(io.input_subsystem.acquisition.reservation) $fatal(1,"Resetdidnotclearframecredit");
        wait(memory_ready);
        fetch(32'h80,0,flash_word(32'h80),0);
        // After reset, wait for the real 512-KiB clear then publish one word.
        // Reuse the SAME router for local and selected cartridge reads.
        wait(upload_memory_ready);@(negedge clk);
        upload_address=17'h10019;upload_data=32'h87654321;upload_stage=1;
        @(negedge clk);upload_stage=0;while(!upload_ready)@(negedge clk);upload_start=1;
        @(negedge clk);upload_start=0;wait(upload_publish);@(negedge clk);
        while(!source_ready)@(negedge clk);
        source_local=1;source_address=32'h40040064;source_valid=1;source_rsp_ready=0;
        @(negedge clk);source_valid=0;source_local=0;source_address=0;
        while(!source_rsp_valid)begin if(req_apu)$fatal(1,"local sample requested SYS");@(negedge clk);end
        if(source_data!==32'h87654321 || source_fault!=0 || source_timeout)$fatal(1,"local SRAM route failed %h",source_data);
        source_rsp_ready=1;@(negedge clk);
        fetch(32'h10000400,8'h0c,card_word(32'h10000400,1),0);
        fetch(32'h10000404,8'h04,card_word(32'h10000404,0),0);
        $display("PASS apu_rom_integration local upload/SRAM, flash, both cartridge sockets, parked_FLASH=%0d parked_CART=%0d COREmemory_words=%0d QUERY=%0d CANCEL=%0d APPLY=%0d actual_accessory=%0d",parked_rom_words,parked_cart_words,dram_words,queries,cancels,applies,accessory_applies);
        $display("MEASURE source_reader64words systemROM_clocks=%0d cartridgeROM_clocks=%0d (80nsdata/120nsREADYcard; includesonewordgrant/handovers/frontend)",flash_period,cart_period);
        $finish;
    end
endmodule
