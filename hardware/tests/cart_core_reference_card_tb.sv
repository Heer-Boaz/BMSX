`timescale 1ns/1ps
// The actual CORE fabric and shared CAD arbiter connected to socket-level card
// peers. CPU/DMA/GEO execution units are request producers not implemented here.
module cart_core_reference_card_tb;
    reg clk=0;
    always #14.763 clk=!clk;
    reg reset_n=1, power_reset_n=1;
    reg [2:0] req_valid=0, req_write=0, req_hold=0;
    wire [2:0] req_ready, rsp_valid, rsp_timeout;
    reg [95:0] req_address=0, req_wdata=0, req_access=0;
    reg [8:0] req_size_bytes={3{3'd4}};
    reg [23:0] req_bus_signals=0;
    reg [2:0] req_data_timeout_enable=0;
    reg [11:0] req_be_n=0;
    reg [53:0] req_data_wait_last=0;
    wire [95:0] rsp_rdata, rsp_fault_code;
    wire memory_ready, block_locked, sys_bus_busy, sys_bus_request;
    wire sys_bus_owned=0;
    tri [31:0] sys_ad, md;
    wire sys_ready_n=1;
    tri sys_as_n, sys_rd_n, sys_wr_n;
    tri [3:0] sys_be_n;
    wire cs_rom_n, cs_io_n, cs_gpu_n, cs_pcrtc_n, cs_apu_n;
    wire [9:0] ma;
    wire mras_n, mwe_n, moe_n;
    wire [3:0] mcas_n;
    wire local_valid, cart_valid, local_write, cart_write;
    wire local_ready;
    wire cart_ready;
    wire [31:0] local_address, local_wdata, local_access, cart_address, cart_wdata, cart_access;
    wire [3:0] local_be_n, cart_be_n;
    wire [7:0] local_bus_signals, cart_bus_signals;
    wire [2:0] cart_size_bytes;
    wire cart_data_timeout_enable, cart_rsp_timeout;
    wire [17:0] cart_data_wait_last;
    wire local_rsp_valid;
    wire cart_rsp_valid;
    wire [31:0] local_rdata, local_fault_code;
    wire [31:0] cart_rdata, cart_fault_code;
    wire cpu_local_withdrawn;
    wire cpu_local_withdraw=1'b0;
    reg use_real_dma=0, dma_admission_inhibit=1;
    wire dma_valid,dma_write,dma_hold,dma_timed;
    wire [31:0] dma_address,dma_wdata,dma_access;
    wire [2:0] dma_size;
    wire [3:0] dma_be;
    wire [7:0] dma_signals;
    wire [17:0] dma_wait_last;
    wire [2:0] fabric_valid={req_valid[2],use_real_dma ? dma_valid : req_valid[1],req_valid[0]};
    wire [2:0] fabric_write={req_write[2],use_real_dma ? dma_write : req_write[1],req_write[0]};
    wire [2:0] fabric_hold={req_hold[2],use_real_dma ? dma_hold : req_hold[1],req_hold[0]};
    wire [95:0] fabric_address={req_address[95:64],use_real_dma ? dma_address : req_address[63:32],req_address[31:0]};
    wire [95:0] fabric_wdata={req_wdata[95:64],use_real_dma ? dma_wdata : req_wdata[63:32],req_wdata[31:0]};
    wire [95:0] fabric_access={req_access[95:64],use_real_dma ? dma_access : req_access[63:32],req_access[31:0]};
    wire [8:0] fabric_size={req_size_bytes[8:6],use_real_dma ? dma_size : req_size_bytes[5:3],req_size_bytes[2:0]};
    wire [23:0] fabric_signals={req_bus_signals[23:16],use_real_dma ? dma_signals : req_bus_signals[15:8],req_bus_signals[7:0]};
    wire [11:0] fabric_be={req_be_n[11:8],use_real_dma ? dma_be : req_be_n[7:4],req_be_n[3:0]};
    wire [2:0] fabric_timed={req_data_timeout_enable[2],use_real_dma ? dma_timed : req_data_timeout_enable[1],req_data_timeout_enable[0]};
    wire [53:0] fabric_wait={req_data_wait_last[53:36],use_real_dma ? dma_wait_last : req_data_wait_last[35:18],req_data_wait_last[17:0]};
    core_memory_system core(.geo_raw_memory(1'b1),.cpu_private(1'b0),.mras_private_n(),.moe_private_n(),.req_valid(fabric_valid),.req_write(fabric_write),.req_hold(fabric_hold),
        .req_address(fabric_address),.req_wdata(fabric_wdata),.req_access(fabric_access),.req_size_bytes(fabric_size),
        .req_bus_signals(fabric_signals),.req_be_n(fabric_be),.req_data_timeout_enable(fabric_timed),
        .req_data_wait_last(fabric_wait),.*);
    is41lv16100_pair_model memory (.clk(clk),.power_reset_n(power_reset_n),.ma(ma),.md(md),
        .ras_n(mras_n),.cas_n(mcas_n),.we_n(mwe_n),.oe_n(moe_n));

    tri [15:0] cad, card_cad;
    wire cal_lo, cal_hi, cart_clk, crd_n, cwr_n, cart_dir, cart_oe_n;
    wire [1:0] cbe_n, cs_cart_n, cart_ready_n;
    wire drive_to_card, drive_to_core;
    reg [1:0] cart_present_n=0, stalled_cards=0;
    reg selected_socket=0;
    wire [1:0] cad_req_ready, cad_rsp_valid, cad_rsp_timeout;
    wire [63:0] cad_rsp_data, cad_rsp_fault;
    reg peer_valid=0;
    reg [31:0] peer_address=32'h10000000;
    assign cart_ready=cad_req_ready[0];
    assign cart_rsp_valid=cad_rsp_valid[0];
    assign cart_rdata=cad_rsp_data[31:0];
    assign cart_fault_code=cad_rsp_fault[31:0];
    assign cart_rsp_timeout=cad_rsp_timeout[0];
    cart_rom_arbiter bridge (
        .clk(clk),.reset_n(reset_n && power_reset_n),.req_valid({peer_valid,cart_valid}),
        .req_cancel(2'b00),.req_ready(cad_req_ready),.req_address({peer_address,cart_address}),
        .req_write({1'b0,cart_write}),.req_size_bytes({3'd4,cart_size_bytes}),
        .req_wdata({32'd0,cart_wdata}),.req_bus_signals({8'h0c,cart_bus_signals}),
        .selected_socket(selected_socket),.req_data_timeout_enable({1'b0,cart_data_timeout_enable}),
        .req_data_wait_last({18'd0,cart_data_wait_last}),.rsp_valid(cad_rsp_valid),
        .rsp_data(cad_rsp_data),.rsp_fault_code(cad_rsp_fault),.rsp_timeout(cad_rsp_timeout),
        .cad(cad),.cart_ready_n(cart_ready_n),.cart_present_n(cart_present_n),
        .cal_lo(cal_lo),.cal_hi(cal_hi),.cart_clk(cart_clk),.crd_n(crd_n),.cwr_n(cwr_n),
        .cbe_n(cbe_n),.cs_cart_n(cs_cart_n),.cart_dir(cart_dir),.cart_oe_n(cart_oe_n));
    cart_bus_buffer_model buffers (.reset_n(reset_n),.oe_n(cart_oe_n),.dir(cart_dir),
        .cad_core(cad),.cad_card(card_cad),.drive_to_card(drive_to_card),.drive_to_core(drive_to_core));
    wire [1:0] irq_n, dreq_r, dreq_w, actual_ready_n;
    genvar s;
    generate for(s=0;s<2;s=s+1) begin: cards
        wire [3:0] rom_address,ram_address;
        wire rom_ce_n,rom_oe_n,ram_ce_n,ram_oe_n,ram_we_n,ram_drive;
        wire [1:0] ram_be_n;
        tri [15:0] rom_data,ram_data;
        wire [7:0] low_byte=8'h10+{rom_address,1'b0};
        wire [7:0] high_byte=8'h11+{rom_address,1'b0};
        assign #(70,70,20) rom_data=!rom_ce_n && !rom_oe_n ? {high_byte,low_byte} : 16'bz;
        assign cart_ready_n[s]=actual_ready_n[s] || stalled_cards[s];
        cart_reference_card #(.ROM_ADDRESS_WIDTH(4),.ROM_BYTES(5),.RAM_ADDRESS_WIDTH(4),.RAM_BYTES(5)) card (
            .clk(clk),.power_reset_n(power_reset_n),.reset_n(reset_n),.cs_n(cs_cart_n[s]),
            .cal_lo(cal_lo),.cal_hi(cal_hi),.rd_n(crd_n),.wr_n(cwr_n),.be_n(cbe_n),.cad(card_cad),
            .ready_n(actual_ready_n[s]),.irq_n(irq_n[s]),.dreq_read(dreq_r[s]),.dreq_write(dreq_w[s]),
            .rom_data(rom_data),.rom_address(rom_address),.rom_ce_n(rom_ce_n),.rom_oe_n(rom_oe_n),
            .ram_data(ram_data),.ram_address(ram_address),.ram_ce_n(ram_ce_n),.ram_oe_n(ram_oe_n),
            .ram_we_n(ram_we_n),.ram_be_n(ram_be_n));
        issi_bll_pin_model #(.ADDRESS_WIDTH(4)) ram (
            .address(ram_address),.data(ram_data),.ce_n(ram_ce_n),.oe_n(ram_oe_n),
            .we_n(ram_we_n),.be_n(ram_be_n),.drive_active(ram_drive));
    end endgenerate
    wire [31:0] card_irq_raise;
    wire [15:0] card_dma_requests;
`ifdef IRQ_LEVEL_CANDIDATE
    // Reuse the unchanged DREQ synchronizers; only IRQ switches to the
    // proposed level-held semantics. This is not the Book III edge contract.
    cart_pin_events card_events(.clk(clk),.reset_n(reset_n && power_reset_n),
        .irq_cart_n(2'b11),.dreq_read(dreq_r),.dreq_write(dreq_w),
        .irq_raise(),.dma_requests(card_dma_requests));
    cart_irq_level_candidate level_events(.clk(clk),.reset_n(reset_n && power_reset_n),
        .irq_cart_n(irq_n),.irq_raise(card_irq_raise));
`elsif IRQ_SYNC_EXPERIMENT
    cart_pin_sync_experiment card_events(.clk(clk),.reset_n(reset_n && power_reset_n),
        .irq_cart_n(irq_n),.dreq_read(dreq_r),.dreq_write(dreq_w),
        .irq_raise(card_irq_raise),.dma_requests(card_dma_requests));
`else
    cart_pin_events card_events(.clk(clk),.reset_n(reset_n && power_reset_n),
        .irq_cart_n(irq_n),.dreq_read(dreq_r),.dreq_write(dreq_w),
        .irq_raise(card_irq_raise),.dma_requests(card_dma_requests));
`endif
    core_local_dma_irq local_irq (
        .clk(clk),.reset_n(reset_n && power_reset_n),.local_valid(local_valid),.local_write(local_write),
        .local_address(local_address),.local_wdata(local_wdata),.local_access(local_access),
        .local_be_n(local_be_n),.local_bus_signals(local_bus_signals),.local_ready(local_ready),
        .local_rsp_valid(local_rsp_valid),.local_rdata(local_rdata),.local_fault_code(local_fault_code),
        .other_valid(),.other_write(),.other_address(),.other_wdata(),.other_access(),.other_be_n(),.other_bus_signals(),
        .other_ready(1'b0),.other_rsp_valid(1'b0),.other_rdata(32'd0),.other_fault_code(32'd0),
        .system_valid(),.system_write(),.system_address(),.system_wdata(),
        .system_ready(1'b0),.system_rsp_valid(1'b0),.system_rdata(32'd0),.system_fault_code(32'd0),
        .external_irq_raise(card_irq_raise),.user_irq_raise(32'd0),.irq_line(),
        .trigger_inhibit(1'b0),.admission_inhibit(dma_admission_inhibit),.enter_supervisor(1'b0),.leave_supervisor(1'b0),
        .supervisor_boundary_ready(),.local_boundary_ready(),.request_lines(card_dma_requests),.port_address(32'd0),
        .owns_read_port(),.owns_write_port(),.block_active(),.active_channel(),.active_read_address(),.active_write_address(),
        .transport_failed(),.transport_write_in_doubt(),.req_valid(dma_valid),.req_write(dma_write),.req_hold(dma_hold),
        .req_ready(use_real_dma && req_ready[1]),.req_address(dma_address),.req_wdata(dma_wdata),.req_access(dma_access),
        .req_size_bytes(dma_size),.req_be_n(dma_be),.req_bus_signals(dma_signals),
        .req_data_timeout_enable(dma_timed),.req_data_wait_last(dma_wait_last),
        .rsp_valid(use_real_dma && rsp_valid[1]),.rsp_timeout(rsp_timeout[1]),.rsp_rdata(rsp_rdata[63:32]));
    integer selects=0, cases=0, waiting_cycles=0, dma_transfers=0;
    reg measure_irq_rearm=0;
    realtime irq_release_time=0, irq_high_interval=0;
    always @(posedge irq_n[0]) if(measure_irq_rearm) irq_release_time=$realtime;
    always @(negedge irq_n[0]) if(measure_irq_rearm) irq_high_interval=$realtime-irq_release_time;
    always @(posedge clk) if(use_real_dma && dma_valid && req_ready[1]) dma_transfers=dma_transfers+1;
    reg watch_waiting=0;
    always @(negedge cs_cart_n[0] or negedge cs_cart_n[1]) selects=selects+1;
    always @(posedge clk) if(reset_n) begin
        if(drive_to_card && drive_to_core) $fatal(1,"CAD bus contention");
        if(watch_waiting && cart_valid && !cart_ready) begin
            waiting_cycles=waiting_cycles+1;
            if(cart_address!==32'h30000001 || cart_wdata!==32'h76543210 ||
               cart_size_bytes!==4 || !cart_write || cart_bus_signals!==8'h04 ||
               cart_data_wait_last!==27 || cart_data_timeout_enable!==0)
                $fatal(1,"CORE scalar fields changed before arbiter admission");
        end
    end
    task automatic access(input integer client,input bit writing,input [2:0] size,
                          input [31:0] address,value,flags,input [7:0] signals,
                          input bit timed,input [17:0] last,input [31:0] expected,
                          input [31:0] fault,input bit timeout);
        integer clocks;
        begin
            @(negedge clk);req_valid[client]=1;req_write[client]=writing;
            req_address[client*32 +:32]=address;req_wdata[client*32 +:32]=value;
            req_access[client*32 +:32]=flags;req_size_bytes[client*3 +:3]=size;
            req_bus_signals[client*8 +:8]=signals;req_be_n[client*4 +:4]=0;
            req_data_timeout_enable[client]=timed;req_data_wait_last[client*18 +:18]=last;
            clocks=0;do begin @(posedge clk);clocks=clocks+1;if(clocks>300) $fatal(1,"admission timeout");end while(!req_ready[client]);
            @(negedge clk);req_valid[client]=0;
            req_address[client*32 +:32]=32'hffffffff;req_wdata[client*32 +:32]=32'hffffffff;
            req_size_bytes[client*3 +:3]=0;req_bus_signals[client*8 +:8]=0;
            req_data_wait_last[client*18 +:18]=0;req_data_timeout_enable[client]=0;
            clocks=0;do begin @(negedge clk);clocks=clocks+1;if(clocks>1000) $fatal(1,"response timeout");end while(!rsp_valid[client]);
            if(rsp_fault_code[client*32 +:32]!==fault || rsp_timeout[client]!==timeout ||
               (!timeout && !writing && rsp_rdata[client*32 +:32]!==expected))
                $fatal(1,"client%0d addr=%h size=%0d result=%h fault=%h timeout=%b expected=%h/%h/%b",
                    client,address,size,rsp_rdata[client*32 +:32],rsp_fault_code[client*32 +:32],rsp_timeout[client],expected,fault,timeout);
            if(timeout && (rsp_valid!==(3'b001 << client) ||
                           (rsp_timeout & rsp_valid)!==(3'b001 << client)))
                $fatal(1,"timeout response reached a different owner");
            cases=cases+1;
        end
    endtask
    integer n_before;
    initial begin
        #2;reset_n=0;power_reset_n=0;repeat(20) @(negedge clk);power_reset_n=1;reset_n=1;
        wait(memory_ready);repeat(4) @(negedge clk);
        access(0,1,4,32'h30000001,32'h11223344,32'h402,8'h04,0,0,0,0,0);
        access(0,0,4,32'h30000001,0,32'h401,8'h04,0,0,32'h11223344,0,0);
        access(0,0,1,32'h30000004,0,32'h101,8'h04,0,0,32'h11,0,0);
        access(1,0,2,32'h30000003,0,32'h201,8'h0c,0,0,0,0,0);
        access(1,1,2,32'h30000003,32'h5566,32'h202,8'h0c,0,0,0,0,0);
        access(1,0,2,32'h30000003,0,32'h201,8'h0c,0,0,32'h5566,0,0);
        access(2,0,4,32'h30000001,0,32'h401,8'h04,0,0,32'h11223344,0,0);
        access(0,1,4,32'h30f00000,32'h89abcdef,32'h402,8'h04,0,0,0,0,0);
        access(0,0,4,32'h30f00001,0,32'h401,8'h04,0,0,32'h89abcdef,0,0);
        access(0,0,2,32'h30f00001,0,32'h201,8'h04,0,0,32'hcdef,0,0);
        access(0,0,1,32'h30ffffff,0,32'h101,8'h04,0,0,0,0,0);
        access(0,0,2,32'h30fffffe,0,32'h201,8'h04,0,0,0,0,0);
        access(0,0,4,32'h30fffffc,0,32'h2001,8'h04,0,0,0,0,0);
        n_before=selects;
        access(0,0,2,32'h30ffffff,0,32'h201,8'h04,0,0,0,1,0);
        access(1,1,4,32'h30fffffd,32'haabbccdd,32'h402,8'h0c,0,0,0,1,0);
        access(2,0,4,32'h30fffffd,0,32'h2001,8'h04,0,0,0,1,0);
        if(selects!=n_before) $fatal(1,"out-of-aperture scalar selected a card");
        // The first fault captures original address/access, not lane-aligned or inferred words.
        access(0,0,4,32'h0801020c,0,32'h401,0,0,0,32'h30ffffff,0,0);
        access(0,0,4,32'h08010210,0,32'h401,0,0,0,32'h201,0,0);
        // The independent second requester holds the CAD owner while CORE has
        // already admitted and latched an unaligned scalar transaction.
        fork
            begin
                @(negedge clk);peer_valid=1;
                do @(posedge clk);while(!cad_req_ready[1]);
                @(negedge clk);peer_valid=0;
                wait(cad_rsp_valid[1]);
                if(cad_rsp_data[63:32]!==32'h13121110 || cad_rsp_fault[63:32]!==0)
                    $fatal(1,"second request owner received incorrect ROM response");
            end
            begin
                wait(!cs_cart_n[1]);watch_waiting=1;
                access(0,1,4,32'h30000001,32'h76543210,32'h402,8'h04,0,27,0,0,0);
                watch_waiting=0;
            end
        join
        if(waiting_cycles<3) $fatal(1,"CORE scalar was not tested under arbiter backpressure");
        access(0,0,4,32'h30000001,0,32'h401,8'h04,0,0,32'h76543210,0,0);
        // Transfer the timeout budget through CORE, then expose the real bridge timeout.
        stalled_cards[0]=1;
        access(0,0,4,32'h30000001,0,32'h401,8'h04,1,8,0,0,1);
        access(1,0,4,32'h30000001,0,32'h401,8'h05,1,8,0,0,1);
        access(2,0,4,32'h30000001,0,32'h401,8'h04,1,8,0,0,1);
        stalled_cards[0]=0;repeat(8) @(negedge clk);
        access(0,0,4,32'h30000001,0,32'h401,8'h04,0,0,32'h76543210,0,0);
        // Actual reference ROM pins exercise both legacy and scalar tail reads.
        access(0,0,4,32'h10000000,0,32'h401,8'h04,0,0,32'h13121110,0,0);
        access(0,0,4,32'h10000003,0,32'h401,8'h04,0,0,32'h00001413,0,0);
        access(0,1,4,32'h30f00004,32'h80000007,32'h402,8'h04,0,0,0,0,0);
        if(irq_n[0]!==0 || dreq_r[0]!==1 || dreq_w[0]!==1) $fatal(1,"real mailbox outputs");
        access(0,0,4,32'h08000000,0,32'h401,0,0,0,32'h200,0,0);
        repeat(6) @(negedge clk);
        if(card_dma_requests!==16'h0180) $fatal(1,"slot0 DREQ did not reach native selector lines");
        access(0,0,4,32'h08000000,0,32'h401,0,0,0,32'h200,0,0);
        access(0,1,4,32'h08000004,32'h200,32'h402,0,0,0,0,0,0);
        access(0,1,4,32'h30f00004,32'h80000007,32'h402,8'h04,0,0,0,0,0);
`ifdef IRQ_LEVEL_CANDIDATE
        // A central ACK cannot clear a still-asserted source. Both actual
        // CPU-accessed card and central register owners are in this path.
        access(0,0,4,32'h08000000,0,32'h401,0,0,0,32'h200,0,0);
`else
        access(0,0,4,32'h08000000,0,32'h401,0,0,0,0,0,0);
`endif
        measure_irq_rearm=1;
        access(0,1,4,32'h30f0000c,1,32'h402,8'h04,0,0,0,0,0);
        if(irq_n[0]!==1) $fatal(1,"real mailbox IRQ ack");
`ifdef IRQ_LEVEL_CANDIDATE
        // The central pending bit is retained after source deassertion until
        // central ACK; the actual transaction gap permits sync to settle.
        access(0,0,4,32'h08000000,0,32'h401,0,0,0,32'h200,0,0);
        access(0,1,4,32'h08000004,32'h200,32'h402,0,0,0,0,0,0);
        access(0,0,4,32'h08000000,0,32'h401,0,0,0,0,0,0);
        $display("PASS proposed held-level IRQ with actual card, CAD and central ACK: asserted source wins; local release followed by central ACK clears");
`endif
        // The next mailbox transaction uses the standard access helper with
        // no added IRQ delay. The helper waits until the next falling clock
        // edge before issuing each request; this is not a zero-gap test.
        access(0,1,4,32'h30f00004,7,32'h402,8'h04,0,0,0,0,0);
        measure_irq_rearm=0;
        access(0,0,4,32'h08000000,0,32'h401,0,0,0,32'h200,0,0);
        if(irq_high_interval<=0) $fatal(1,"reference mailbox rearm not measured");
`ifdef IRQ_LEVEL_CANDIDATE
        $display("MEASURE reference mailbox IRQ release-to-retrigger %0.3f ns (includes additional FLAGS/ACK accesses; not a minimum)",irq_high_interval);
`else
        $display("MEASURE reference mailbox IRQ release-to-retrigger %0.3f ns",irq_high_interval);
`endif
        access(0,1,4,32'h30f00004,5,32'h402,8'h0c,0,0,0,0,0);
        repeat(6) @(negedge clk);
        if(card_dma_requests!==16'h0380) $fatal(1,"independent slot DREQ selector bits");
        access(0,0,4,32'h08000000,0,32'h401,0,0,0,32'h600,0,0);
        access(0,1,4,32'h30f0000c,1,32'h402,8'h04,0,0,0,0,0);
        access(0,1,4,32'h30f0000c,1,32'h402,8'h0c,0,0,0,0,0);
        access(0,1,4,32'h08000004,32'h600,32'h402,0,0,0,0,0,0);
        // Real card DREQ0_READ gates an actual DMA source read, through the
        // existing channel owner, CORE/CAD and SRAM/flash pin-level peers.
        access(0,1,4,32'h30f00004,0,32'h402,8'h04,0,0,0,0,0);
        repeat(5) @(negedge clk);
        if(card_dma_requests[8]!==0) $fatal(1,"slot0 DREQ did not clear");
        use_real_dma=1;dma_admission_inhibit=0;
        access(0,1,4,32'h0800000c,32'h10000000,32'h402,0,0,0,0,0,0);
        access(0,1,4,32'h08000010,32'h08020000,32'h402,0,0,0,0,0,0);
        access(0,1,4,32'h08000014,1,32'h402,0,0,0,0,0,0);
        access(0,1,4,32'h08000018,32'h22,32'h402,0,0,0,0,0,0);
        access(0,1,4,32'h08000020,1,32'h402,0,0,0,0,0,0);
        repeat(12) @(negedge clk);
        if(dma_transfers!=0 || local_irq.dma.status[0]!==1) $fatal(1,"DMA ignored cleared card DREQ");
        access(0,1,4,32'h30f00004,2,32'h402,8'h04,0,0,0,0,0);
        wait(local_irq.dma.status[0]==2);repeat(6) @(negedge clk);
        if(dma_transfers!=2 || memory.words[20'h08000]!==32'h13121110)
            $fatal(1,"card DREQ did not admit actual DMA source and RAM write");
        access(0,0,4,32'h08000000,0,32'h401,0,0,0,1,0,0);
        access(0,1,4,32'h08000004,1,32'h402,0,0,0,0,0,0);
        dma_admission_inhibit=1;use_real_dma=0;
        // CORE reset during an accepted odd SRAM write: RAM drains while CORE
        // cancels its old response and reinitializes its own retained storage.
        @(negedge clk);req_valid[0]=1;req_write[0]=1;
        req_address[31:0]=32'h30000001;req_wdata[31:0]=32'hcafebeef;
        req_access[31:0]=32'h402;req_size_bytes[2:0]=4;req_bus_signals[7:0]=8'h04;
        do @(posedge clk);while(!req_ready[0]);
        @(negedge clk);req_valid[0]=0;
        wait(!cards[0].ram_we_n);#1;reset_n=0;
        repeat(3) @(posedge clk);@(negedge clk);reset_n=1;
        wait(!cards[0].card.ram_busy);wait(memory_ready);repeat(5) @(negedge clk);
        access(0,0,4,32'h30000001,0,32'h401,8'h04,0,0,32'hcafebeef,0,0);
        access(0,0,4,32'h30f00004,0,32'h401,8'h04,0,0,0,0,0);
        if(irq_n[0]!==1 || dreq_r[0]!==0 || dreq_w[0]!==0) $fatal(1,"real mailbox reset");
        // Replay the exact live TS/C++ cartridge-owner sequence through the
        // real CORE, CAD, reference card and physical pin models.
        access(0,1,4,32'h30000001,32'h11223344,32'h402,8'h04,0,0,0,0,0);
        access(0,0,4,32'h30000001,0,32'h401,8'h04,0,0,32'h11223344,0,0);$display("ORACLE %08h",rsp_rdata[31:0]);
        access(0,0,2,32'h30000003,0,32'h201,8'h04,0,0,32'h1122,0,0);$display("ORACLE %08h",rsp_rdata[31:0]);
        access(0,0,1,32'h30000004,0,32'h101,8'h04,0,0,32'h11,0,0);$display("ORACLE %08h",rsp_rdata[31:0]);
        access(0,1,4,32'h30000002,32'hff00ff00,32'h402,8'h04,0,0,0,0,0);
        access(0,0,4,32'h30000003,0,32'h401,8'h04,0,0,32'h1122,0,0);$display("ORACLE %08h",rsp_rdata[31:0]);
        access(0,0,4,32'h10000003,0,32'h401,8'h04,0,0,32'h1413,0,0);$display("ORACLE %08h",rsp_rdata[31:0]);
        access(0,1,4,32'h30f00000,32'h89abcdef,32'h402,8'h04,0,0,0,0,0);
        access(0,0,4,32'h30f00001,0,32'h401,8'h04,0,0,32'h89abcdef,0,0);$display("ORACLE %08h",rsp_rdata[31:0]);
        access(0,0,2,32'h30f00001,0,32'h201,8'h04,0,0,32'hcdef,0,0);$display("ORACLE %08h",rsp_rdata[31:0]);
        access(0,0,1,32'h30f00001,0,32'h101,8'h04,0,0,32'hcd,0,0);$display("ORACLE %08h",rsp_rdata[31:0]);
        access(0,1,4,32'h30f00001,32'h11223344,32'h402,8'h04,0,0,0,0,0);
        access(0,1,2,32'h30f00000,32'h1122,32'h202,8'h04,0,0,0,0,0);
        access(0,0,4,32'h30f00000,0,32'h401,8'h04,0,0,32'h89abcdef,0,0);$display("ORACLE %08h",rsp_rdata[31:0]);
        access(0,1,4,32'h30f00004,32'h80000007,32'h402,8'h04,0,0,0,0,0);
        access(0,0,4,32'h30f00004,0,32'h401,8'h04,0,0,32'h80000006,0,0);$display("ORACLE %08h",rsp_rdata[31:0]);
        access(0,0,4,32'h30f00008,0,32'h401,8'h04,0,0,1,0,0);$display("ORACLE %08h",rsp_rdata[31:0]);
        access(0,1,4,32'h30f0000c,0,32'h402,8'h04,0,0,0,0,0);
        access(0,0,4,32'h30f00008,0,32'h401,8'h04,0,0,1,0,0);$display("ORACLE %08h",rsp_rdata[31:0]);
        access(0,1,4,32'h30f0000c,1,32'h402,8'h04,0,0,0,0,0);
        access(0,0,4,32'h30f00008,0,32'h401,8'h04,0,0,0,0,0);$display("ORACLE %08h",rsp_rdata[31:0]);
        $display("PASS CORE -> reference ROM/RAM/mailbox: %0d original-scalar and aperture/timeout operations",cases);
        $finish;
    end
endmodule
