`timescale 1ns/1ps
// The actual CORE fabric and shared CAD arbiter connected to socket-level card
// peers. CPU/DMA/GEO execution units are request producers not implemented here.
module cart_core_scalar_tb;
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
    wire local_ready=1;
    wire cart_ready;
    wire [31:0] local_address, local_wdata, local_access, cart_address, cart_wdata, cart_access;
    wire [3:0] local_be_n, cart_be_n;
    wire [7:0] local_bus_signals, cart_bus_signals;
    wire [2:0] cart_size_bytes;
    wire cart_data_timeout_enable, cart_rsp_timeout;
    wire [17:0] cart_data_wait_last;
    wire local_rsp_valid=0;
    wire cart_rsp_valid;
    wire [31:0] local_rdata=0, local_fault_code=0;
    wire [31:0] cart_rdata, cart_fault_code;
    wire cpu_local_withdrawn;
    wire cpu_local_withdraw=1'b0;
    core_memory_system core(.geo_raw_memory(1'b1),.cpu_private(1'b0),.mras_private_n(),.moe_private_n(),.*);
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
    wire [1:0] irq_n, dreq_r, dreq_w;
    genvar s;
    generate for(s=0;s<2;s=s+1) begin: cards
        cart_scalar_card_peer #(.RAM_BYTES(5),.ROM_BYTES(5)) card (
            .clk(clk),.reset_n(reset_n),.cs_n(cs_cart_n[s]),.cal_lo(cal_lo),.cal_hi(cal_hi),
            .rd_n(crd_n),.wr_n(cwr_n),.be_n(cbe_n),.stall(stalled_cards[s]),
            .cad(card_cad),.ready_n(cart_ready_n[s]),.irq_n(irq_n[s]),
            .dreq_read(dreq_r[s]),.dreq_write(dreq_w[s]));
    end endgenerate
    integer selects=0, cases=0, waiting_cycles=0;
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
        $display("PASS CORE -> CAD: %0d original-scalar and aperture/timeout operations",cases);
        $finish;
    end
endmodule
