`timescale 1ns/1ps
// Real CORE fabric/DRAM controller and U7 pin owner. Only the physical memory
// arrays and the not-yet-implemented local/CAD downstream ports are test peers.
// This does not stand in for CPU execution, full DMA/GEO or APU bus ownership.
module core_memory_system_tb;
    reg clk=0;
    always #14.763 clk=!clk;
    reg reset_n=1, power_reset_n=1;
    reg [2:0] req_valid=0, req_write=0, req_hold=0;
    reg geo_raw_memory=1;
    reg flip_geo_after_admission=0;
    reg [31:0] observed_local_address, observed_local_data, observed_local_access;
    reg [7:0] observed_local_signals;
    wire [2:0] req_ready, rsp_valid, rsp_timeout;
    reg [95:0] req_address=0, req_wdata=0, req_access=0;
    reg [8:0] req_size_bytes={3{3'd4}};
    reg [23:0] req_bus_signals=24'h000100;
    reg [2:0] req_data_timeout_enable=3'b111;
    reg [11:0] req_be_n=0;
    reg [53:0] req_data_wait_last={3{18'd15}};
    wire [95:0] rsp_rdata, rsp_fault_code;
    wire memory_ready, block_locked, sys_bus_busy, sys_bus_request;
    reg sys_bus_owned=1;
    tri [31:0] sys_ad, md;
    tri1 sys_ready_n, supervisor_n;
    // U1 integrated control-pad pullups (pad-ring/arbitrator owner in the
    // complete SYS integration); this fixture instantiates only the fabric.
    tri1 sys_as_n, sys_rd_n, sys_wr_n;
    tri1 [3:0] sys_be_n;
    wire [3:0] mcas_n;
    wire cs_rom_n, cs_io_n, cs_gpu_n, cs_pcrtc_n, cs_apu_n;
    wire [9:0] ma;
    wire mras_n, mwe_n, moe_n;
    wire local_valid, cart_valid, local_write, cart_write;
    reg local_ready=1, cart_ready=1;
    wire [31:0] local_address, local_wdata, local_access, cart_address, cart_wdata, cart_access;
    wire [2:0] cart_size_bytes;
    wire cart_data_timeout_enable;
    wire [17:0] cart_data_wait_last;
    reg cart_rsp_timeout=0;
    wire [3:0] local_be_n, cart_be_n;
    wire [7:0] local_bus_signals, cart_bus_signals;
    reg local_rsp_valid=0, cart_rsp_valid=0;
    reg local_inject_fault=0;
    reg [31:0] local_rdata=0, local_fault_code=0, cart_rdata=0, cart_fault_code=0;
    wire cpu_local_withdrawn;
    wire cpu_local_withdraw=1'b0;
    core_memory_system dut(.cpu_private(1'b0),.mras_private_n(),.moe_private_n(),.*);
    is41lv16100_pair_model memory (
        .clk(clk), .power_reset_n(power_reset_n), .ma(ma), .md(md),
        .ras_n(mras_n), .cas_n(mcas_n), .we_n(mwe_n), .oe_n(moe_n)
    );
    reg vblank_evt=0;
    wire pad_clk;
    wire [3:0] pad_cmd, pad_select_n;
    wire [21:0] rom_address;
    wire [15:0] rom_data;
    wire rom_ce_n, rom_oe_n;
    assign #(70,70,20) rom_data = !rom_ce_n && !rom_oe_n
        ? (rom_address[15:0] ^ 16'h1234) : 16'bz;
    io_system_pins io (
        .clk(clk), .reset_n(reset_n && power_reset_n), .cs_io_n(cs_io_n), .cs_rom_n(cs_rom_n),
        .sys_ad(sys_ad), .sys_as_n(sys_as_n), .sys_rd_n(sys_rd_n), .sys_wr_n(sys_wr_n),
        .sys_be_n(sys_be_n), .sys_ready_n(sys_ready_n), .vblank_evt(vblank_evt),
        .supervisor_raw_n(1'b1), .supervisor_n(supervisor_n), .ps2_kbd_clk(1'b1),
        .ps2_kbd_data(1'b1), .display_context(1'b1), .pad_clk(pad_clk), .pad_cmd(pad_cmd),
        .pad_select_n(pad_select_n), .pad_data(4'hf), .rom_data(rom_data),
        .rom_address(rom_address), .rom_ce_n(rom_ce_n), .rom_oe_n(rom_oe_n)
    );
    // Downstream peers test the real handshakes/address preservation, not the
    // operation of any unimplemented GTE or cartridge hardware.
    always @(posedge clk) begin
        local_rsp_valid<=0; cart_rsp_valid<=0;
        if (reset_n) begin
            if (local_valid && local_ready) begin
                local_rsp_valid<=1; local_rdata<=local_address ^ 32'h31415926;
                observed_local_address<=local_address; observed_local_data<=local_wdata;
                observed_local_access<=local_access; observed_local_signals<=local_bus_signals;
                local_fault_code<=local_inject_fault ? 32'd3 : 32'd0;
            end
            if (cart_valid && cart_ready) begin
                cart_rsp_valid<=1; cart_rdata<=cart_address ^ 32'hcafe1200;
                cart_fault_code<=0;
                observed_cart_signals<=cart_bus_signals;
            end
        end
    end
    integer transfers=0, responses=0, rom_cycles=0, rom_cycles_before;
    integer accepted_order[0:2];
    integer seen, k, refresh_before;
    reg [31:0] result;
    reg watch_owners=0;
    reg [2:0] owner_replies=0;
    reg simultaneous_replies=0;
    reg long_io_complete=0;
    reg [31:0] observed_header=0;
    reg [7:0] observed_cart_signals=0;
    reg header_seen=0;
    always @(posedge clk) if (reset_n) begin
        if (req_ready!=0 && (req_ready & (req_ready-1'b1))!=0) $fatal(1,"Multiple client admissions");
        if(rsp_valid[0] && rsp_valid[1]) simultaneous_replies=1;
        for(integer c=0;c<3;c=c+1) if(rsp_valid[c]) begin
            responses=responses+1;
            if(watch_owners) begin
                if(rsp_fault_code[c*32 +:32]!=0 || rsp_timeout[c] ||
                    rsp_rdata[c*32 +:32]!=(32'h10000000+c)) $fatal(1,"Response sent to wrong client");
                owner_replies[c]=1;
            end
        end
        if (!memory_ready && req_ready!=0) $fatal(1,"Client admitted before memory reset completed");
        if(sys_as_n) header_seen=0;
        else if(!header_seen) begin header_seen=1;observed_header=sys_ad;end
        else begin
        if(sys_ad<32'h01000000) rom_cycles=rom_cycles+1;
        case(sys_ad)
            32'h00000000,32'h00800000:
                if({cs_apu_n,cs_pcrtc_n,cs_gpu_n,cs_io_n,cs_rom_n}!==5'b11110)
                    $fatal(1,"ROM chipselect decode");
            32'h08000064,32'h08000068,32'h0800010c,32'h08000110,32'h08000114,32'h0800011c:
                if({cs_apu_n,cs_pcrtc_n,cs_gpu_n,cs_io_n,cs_rom_n}!==5'b11101)
                    $fatal(1,"INPUT chipselect decode");
            32'h08000120:
                if({cs_apu_n,cs_pcrtc_n,cs_gpu_n,cs_io_n,cs_rom_n}!==5'b01111)
                    $fatal(1,"APU chipselect decode");
            32'h0801023c:
                if({cs_apu_n,cs_pcrtc_n,cs_gpu_n,cs_io_n,cs_rom_n}!==5'b11011)
                    $fatal(1,"GPU chipselect decode");
            32'h08010354,32'h080103ac:
                if({cs_apu_n,cs_pcrtc_n,cs_gpu_n,cs_io_n,cs_rom_n}!==5'b10111)
                    $fatal(1,"PCRTC chipselect decode");
            default: if(sys_ad<32'h01000000) begin
                if({cs_apu_n,cs_pcrtc_n,cs_gpu_n,cs_io_n,cs_rom_n}!==5'b11110 ||
                    (!dut.write_word[1] && (sys_ad[1:0]!=0 || sys_be_n!==0)))
                    $fatal(1,"Incorrect scalar ROM bus cycle %h %b",sys_ad,sys_be_n);
            end else $fatal(1,"Unexpected SYS address in fixture %h",sys_ad);
        endcase
        end
    end
    task automatic transfer(input integer client, input reg writing, input [31:0] address,
                            input [31:0] word, input [3:0] mask, input reg hold_owner,
                            input [31:0] expected_fault, input reg expected_timeout);
        begin
            @(negedge clk);
            req_valid[client]=1; req_write[client]=writing; req_hold[client]=hold_owner;
            req_address[client*32 +:32]=address; req_wdata[client*32 +:32]=word;
            req_be_n[client*4 +:4]=mask;
            req_access[client*32 +:32]=(writing ? 32'h2 : 32'h1) |
                (req_size_bytes[client*3 +:3]==1 ? 32'h100 :
                 req_size_bytes[client*3 +:3]==2 ? 32'h200 : 32'h400);
            @(posedge clk);while(!req_ready[client]) @(posedge clk);
            @(negedge clk);
            req_valid[client]=0;
            if(client==2 && flip_geo_after_admission) geo_raw_memory=1;
            // Once admitted, later producer changes cannot alter that word.
            req_address[client*32 +:32]=32'hffffffff;
            req_wdata[client*32 +:32]=32'hffffffff;
            while(!rsp_valid[client]) @(negedge clk);
            if(rsp_fault_code[client*32 +:32]!==expected_fault ||
                rsp_timeout[client]!==expected_timeout)
                $fatal(1,"Client %0d %h fault=%h timeout=%b",client,address,
                       rsp_fault_code[client*32 +:32],rsp_timeout[client]);
            result=rsp_rdata[client*32 +:32];transfers=transfers+1;
        end
    endtask
    task automatic read_check(input integer client,input [31:0] address,input [31:0] word);
        begin
            transfer(client,0,address,0,0,0,0,0);
            if(result!==word) $fatal(1,"Client %0d %h read %h != %h",client,address,result,word);
        end
    endtask
    task automatic blank;
        begin @(negedge clk);vblank_evt=!vblank_evt;repeat(8) @(negedge clk);end
    endtask
    initial begin
        // Arbitrary initial DRAM contents are not cleared by reset. In
        // particular these bytes under CPU I/O differ from retained I/O state.
        #1;reset_n=0;power_reset_n=0;
        memory.words[20'h00081]=32'hdeadbeef;
        memory.words[20'h04081]=32'heebb0066;
        for(k=0;k<16384;k=k+1) dut.retained[k]=32'hffffffff;
        #100;power_reset_n=1;
        #300000;reset_n=1;
        wait(memory_ready);@(negedge clk);
        for(k=0;k<16384;k=k+1) if(dut.retained[k]!==0) $fatal(1,"Retained bank reset missed word %0d",k);
        read_check(0,0,32'h12351234);
        read_check(0,32'h00800000,0);
        read_check(2,0,32'h12351234);read_check(2,32'h00800000,0);
        // CPU byte/halfword and DMA/GEO unaligned scalars use the real U7
        // flash pins, including both SYS reads when a word crosses a lane.
        req_size_bytes[2:0]=1;
        read_check(0,0,32'h34);read_check(0,1,32'h12);
        read_check(0,2,32'h35);read_check(0,3,32'h12);
        req_size_bytes[2:0]=2;
        read_check(0,0,32'h1234);read_check(0,2,32'h1235);
        req_size_bytes[8:6]=2;
        read_check(2,3,32'h3612);
        req_size_bytes[8:6]=4;
        req_size_bytes[2:0]=4;
        rom_cycles_before=rom_cycles;
        read_check(1,1,32'h36123512);
        if(rom_cycles-rom_cycles_before!=2) $fatal(1,"Unaligned ROM scalar did not use exactly two SYS cycles");
        read_check(1,2,32'h12361235);
        read_check(1,3,32'h37123612);read_check(2,3,32'h37123612);
        // Installed-image tail is zero-filled, while the full 16-MiB
        // address-window crossing faults before any SYS read.
        read_check(1,32'h007ffffd,32'h00edcbed);
        read_check(1,32'h007fffff,32'h000000ed);
        req_size_bytes[5:3]=1;
        read_check(1,32'h00ffffff,0);
        transfer(1,1,1,32'hab,0,0,1,0);
        read_check(1,1,32'h12);
        req_size_bytes[5:3]=2;
        rom_cycles_before=rom_cycles;
        transfer(1,0,32'h00ffffff,0,0,0,1,0);
        req_size_bytes[5:3]=4;
        transfer(1,0,32'h00fffffd,0,0,0,1,0);
        if(rom_cycles!=rom_cycles_before) $fatal(1,"Out-of-window ROM access reached SYS");
        // Stall the actual second flash word long enough for the transport
        // deadline, then prove the abandoned read is not retried.
        rom_cycles_before=rom_cycles;
        fork
            transfer(1,0,1,0,0,0,0,1);
            begin
                wait(dut.rom_second && !rom_ce_n);
                force io.firmware.read_clocks=0;
                wait(rsp_valid[1]);
                release io.firmware.read_clocks;
            end
        join
        if(rom_cycles-rom_cycles_before!=2) $fatal(1,"Timed-out ROM scalar was retried");
        read_check(1,0,32'h12351234);
        transfer(0,1,32'h08010214,1,0,0,0,0);
        req_bus_signals[15:8]=8'hf3;
        read_check(1,0,32'h12351234);
        if(observed_header!==32'h000000f3) $fatal(1,"SYS control strobes confused with fault access flags");
        req_bus_signals[15:8]=8'h01;
        read_check(0,32'h08000204,0);read_check(0,32'h08010204,0);
        read_check(2,32'h08000204,32'hdeadbeef);
        read_check(2,32'h08010204,32'heebb0066);
        transfer(0,1,32'h08000204,32'h11223344,0,0,0,0);
        transfer(0,1,32'h08000204,32'hffffffff,4'b1110,0,2,0);
        read_check(0,32'h08000204,32'h11223344);
        transfer(0,1,32'h08010214,1,0,0,0,0);
        req_size_bytes[2:0]=1;
        transfer(0,0,32'h08000204,0,0,0,0,0);
        if(result!==32'h44) $fatal(1,"Aligned IO byte read returned the wrong scalar");
        transfer(0,1,32'h08000204,32'hff,0,0,2,0);
        req_size_bytes[2:0]=2;
        transfer(0,0,32'h08000204,0,0,0,2,0);
        transfer(0,1,32'h08000204,32'hffff,0,0,2,0);
        req_size_bytes[2:0]=4;
        read_check(0,32'h08000204,32'h11223344);
        transfer(0,1,32'h08010214,1,0,0,0,0);
        read_check(2,32'h08000204,32'hdeadbeef);
        transfer(2,1,32'h08000204,32'h55667788,0,0,0,0);
        read_check(0,32'h08000204,32'h11223344);
        // The same GEO port can issue an ordinary mapped summary write.
        // Its access class, like its address, is fixed at admission.
        geo_raw_memory=0; flip_geo_after_admission=1;
        transfer(2,1,32'h08000204,32'hcafebeef,0,0,0,0);
        flip_geo_after_admission=0;
        read_check(0,32'h08000204,32'hcafebeef);
        read_check(2,32'h08000204,32'h55667788);
        geo_raw_memory=0; req_bus_signals[23:16]=8'ha5;
        transfer(2,1,32'h08000000,32'h01234567,0,0,0,0);
        if(observed_local_address!==32'h08000000 || observed_local_data!==32'h01234567 ||
           observed_local_access!==32'h402 || observed_local_signals!==8'ha5)
            $fatal(1,"GEO mapped write did not reach LOCAL with its original payload");
        geo_raw_memory=1; req_bus_signals[23:16]=0;
        transfer(0,1,32'h08010204,32'h76543210,0,0,0,0);
        read_check(2,32'h08010204,32'heebb0066);
        transfer(0,1,32'h08020000,32'ha1b2c3d4,0,0,0,0);
        req_size_bytes[5:3]=1;
        transfer(1,1,32'h08020001,32'hf0,0,0,0,0);
        transfer(1,1,32'h08020003,32'hf0,0,0,0,0);
        req_size_bytes[5:3]=4;
        read_check(0,32'h08020000,32'hf0b2f0d4);
        // The complete scalar crosses the IO aperture, so every byte is RAM.
        transfer(2,1,32'h0801043c,32'h11223344,0,0,0,0);
        transfer(0,1,32'h08010440,32'h55667788,0,0,0,0);
        transfer(1,1,32'h0801043e,32'ha1b2c3d4,0,0,0,0);
        read_check(1,32'h0801043e,32'ha1b2c3d4);
        read_check(2,32'h0801043c,32'hc3d43344);
        read_check(0,32'h08010440,32'h5566a1b2);
        transfer(0,1,32'h083ffffc,32'h89abcdef,0,0,0,0);
        read_check(2,32'h083ffffc,32'h89abcdef);
        transfer(0,0,32'h08400000,0,0,0,1,0);
        if(result!==0) $fatal(1,"Unmapped RAM extent was mirrored");
        read_check(0,32'h08010208,1);read_check(0,32'h0801020c,32'h08400000);
        read_check(0,32'h08010210,32'h401);
        transfer(0,1,32'h08000064,1,4'b1110,0,2,0);
        transfer(0,1,32'h08010208,0,0,0,3,0);
        read_check(0,32'h08010208,1);read_check(0,32'h0801020c,32'h08400000);
        transfer(0,1,32'h08010214,0,0,0,0,0);read_check(0,32'h08010208,1);
        transfer(0,1,32'h08010214,32'hffffffff,0,0,0,0);
        read_check(0,32'h08010208,0);read_check(0,32'h0801020c,0);read_check(0,32'h08010210,0);
        transfer(0,1,32'h08010208,0,0,0,3,0);
        read_check(0,32'h08010208,3);read_check(0,32'h0801020c,32'h08010208);
        read_check(0,32'h08010210,32'h402);
        transfer(0,1,32'h08010214,1,0,0,0,0);
        transfer(0,1,0,32'h76543210,0,0,1,0);read_check(0,0,32'h12351234);
        transfer(0,1,32'h08000064,1,0,0,0,0);blank();
        read_check(0,32'h08000068,1);
        transfer(0,1,32'h08000064,1,4'b1110,0,2,0);blank();
        read_check(0,32'h08000068,1);
        transfer(2,1,32'h08000064,32'h55aa55aa,0,0,0,0);blank();
        read_check(0,32'h08000064,1);read_check(0,32'h08000068,1);
        read_check(2,32'h08000064,32'h55aa55aa);
        transfer(0,1,32'h0800010c,0,0,0,0,0);
        transfer(0,1,32'h08000110,32'h00008000,0,0,0,0);
        transfer(0,1,32'h08000114,1,0,0,0,0);
        // A real long U7 wait must not starve the independent DRAM refresh
        // engine. Request APPLY just after a fresh serial frame has started.
        @(negedge pad_select_n[0]);repeat(10) @(negedge clk);
        req_data_wait_last[17:0]=0;req_data_timeout_enable[0]=0;
        refresh_before=memory.refreshes;long_io_complete=0;
        fork
            begin transfer(0,1,32'h0800011c,1,0,0,0,0);long_io_complete=1;end
            begin
                wait(sys_bus_busy);
                read_check(2,32'h08020000,32'hf0b2f0d4);
                if(long_io_complete) $fatal(1,"GEO stalled until unrelated logical SYS wait completed");
            end
        join
        req_data_wait_last[17:0]=18'd15;req_data_timeout_enable[0]=1;
        if(memory.refreshes-refresh_before<2) $fatal(1,"Long SYS wait starved DRAM refresh");
        // The first byte beyond the I/O aperture reaches RAM, not local MMIO.
        transfer(0,1,32'h08010440,32'hfedcba98,0,0,0,0);
        read_check(0,32'h08010440,32'hfedcba98);
        fork
            begin local_ready=0;repeat(40) @(negedge clk);local_ready=1;end
            read_check(0,32'h08010244,32'h08010244 ^ 32'h31415926);
            begin
                wait(local_valid);
                read_check(2,32'h08020000,32'hf0b2f0d4);
                if(local_ready) $fatal(1,"GEO stalled behind unrelated local-MMIO wait");
            end
        join
        read_check(0,32'h10000000,32'h10000000 ^ 32'hcafe1200);
        read_check(0,32'h30fffffc,32'h30fffffc ^ 32'hcafe1200);
        read_check(2,32'h10000000,32'h10000000 ^ 32'hcafe1200);
        read_check(2,32'h30fffffc,32'h30fffffc ^ 32'hcafe1200);
        req_bus_signals[15:8]=8'hfd;
        read_check(1,32'h10000000,32'h10000000 ^ 32'hcafe1200);
        if(observed_cart_signals!==8'hfd) $fatal(1,"Cartridge socket/master strobes were not preserved");
        req_bus_signals[15:8]=8'h01;
        transfer(0,1,32'h08010214,1,0,0,0,0);
        // No fake APU/GFX endpoint: unanswered packets really time out. Only
        // the addressed native chipselect may assert during those packets.
        transfer(0,0,32'h08000120,0,0,0,0,1);
        transfer(0,0,32'h0801023c,0,0,0,0,1);
        transfer(0,0,32'h08010354,0,0,0,0,1);
        transfer(0,0,32'h080103ac,0,0,0,0,1);
        read_check(0,32'h08010208,0);
        // Distinct words reveal response-owner swaps under simultaneous load.
        for(k=0;k<3;k=k+1) transfer(0,1,32'h08021000+k*4,32'h10000000+k,0,0,0,0);
        read_check(0,0,32'h12351234); // next round-robin priority is DMA1
        @(negedge clk);watch_owners=1;owner_replies=0;seen=0;
        req_valid=3'b111;req_write=0;req_hold=0;
        for(k=0;k<3;k=k+1) begin
            req_address[k*32 +:32]=32'h08021000+k*4;
            req_access[k*32 +:32]=32'h401;
        end
        while(seen<3) begin
            @(posedge clk);
            for(k=0;k<3;k=k+1) if(req_ready[k]) begin accepted_order[seen]=k;seen=seen+1;end
            @(negedge clk);for(k=0;k<seen;k=k+1) req_valid[accepted_order[k]]=0;
        end
        wait(&owner_replies);@(negedge clk);watch_owners=0;
        if(accepted_order[0]!=1 || accepted_order[1]!=2 || accepted_order[2]!=0)
            $fatal(1,"Round-robin admission did not rotate");
        transfer(1,0,32'h08021000,0,0,1,0,0);
        if(!block_locked) $fatal(1,"DMA block owner not retained");
        @(negedge clk);req_valid[0]=1;req_write[0]=0;req_address[31:0]=32'h08021000;
        repeat(10) begin @(negedge clk);if(req_ready[0]) $fatal(1,"CPU entered held DMA block");end
        transfer(1,0,32'h08021004,0,0,1,0,0);
        transfer(1,0,32'h08021008,0,0,0,0,0);
        @(posedge clk);while(!req_ready[0]) @(posedge clk);
        @(negedge clk);req_valid[0]=0;
        while(!rsp_valid[0]) @(negedge clk);
        if(rsp_rdata[31:0]!==32'h10000000) $fatal(1,"CPU response after block release");
        req_bus_signals[15:8]=0;
        transfer(1,1,0,32'hffffffff,0,1,1,0);
        req_bus_signals[15:8]=8'h01;
        if(block_locked) $fatal(1,"Faulting word retained DMA block ownership");
        read_check(0,32'h08010208,1);
        // Arrange two independent completions on the same edge: DMA clears
        // the old fault while CPU's local target reports a fresh READ_ONLY.
        // Both clients must receive their own response; the fresh fault wins
        // over the simultaneous acknowledgement, not over an older pending one.
        local_ready=0;local_inject_fault=1;
        fork
            transfer(0,0,32'h08010244,0,0,0,3,0);
            begin wait(local_valid);transfer(1,1,32'h08010214,1,0,0,0,0);end
            begin
                wait(req_valid[1] && req_address[63:32]==32'h08010214);
                @(posedge clk);while(!req_ready[1]) @(posedge clk);
                @(negedge clk);local_ready=1;
            end
        join
        local_inject_fault=0;@(negedge clk);
        if(!simultaneous_replies) $fatal(1,"Independent target replies were not concurrent");
        read_check(0,32'h08010208,3);read_check(0,32'h0801020c,32'h08010244);
        read_check(0,32'h08010210,32'h401);
        transfer(0,1,32'h08010214,1,0,0,0,0);
        // An accepted logical word may wait for physical ownership; DRAM continues.
        sys_bus_owned=0;
        @(negedge clk);req_valid[0]=1;req_write[0]=0;req_address[31:0]=0;
        transfer(1,0,32'h08021004,0,0,0,0,0);
        if(!sys_bus_request || sys_bus_busy) $fatal(1,"CORE initiated SYS without ownership");
        sys_bus_owned=1;
        @(negedge clk);req_valid[0]=0;
        while(!rsp_valid[0]) @(negedge clk);
        if(rsp_rdata[31:0]!==32'h12351234) $fatal(1,"SYS resume after ownership");
        // Reset while a DRAM write is active does not truncate RAS. The
        // admitted write can finish, but its stale response cannot be replayed.
        @(negedge clk);req_valid[2]=1;req_write[2]=1;
        req_address[95:64]=32'h08030000;req_wdata[95:64]=32'h13579bdf;
        @(posedge clk);while(!req_ready[2]) @(posedge clk);
        @(negedge clk);req_valid=0;
        wait(!mras_n);#7;reset_n=0;
        refresh_before=memory.refreshes;
        repeat(600000) @(negedge clk); // >16 ms with rails/clock still valid
        if(memory.refreshes-refresh_before<1024) $fatal(1,"Soft reset stopped DRAM refresh");
        reset_n=1;wait(memory_ready);@(negedge clk);
        read_check(0,32'h08000204,0);read_check(0,32'h08010204,0);
        read_check(2,32'h08000204,32'h55667788);
        read_check(2,32'h08010204,32'heebb0066);
        read_check(0,32'h08030000,32'h13579bdf);
        read_check(0,32'h08000068,0);read_check(0,32'h08010208,0);
        repeat(2) @(negedge clk);
        if(responses!=transfers+5) $fatal(1,"Lost/duplicate/stale response: %0d directed %0d total",transfers,responses);
        $display("PASS CORE memory integration: %0d directed transfers, %0d replies; raw-vs-mapped RAM, IO-crossing scalars, retained words, ROM/U7, fault latch, ownership, blocks and refresh through reset",transfers,responses);
        $finish;
    end
    initial begin #30000000;$fatal(1,"CORE memory integration watchdog");end
endmodule
