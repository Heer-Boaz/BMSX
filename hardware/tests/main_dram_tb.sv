`timescale 1ns/1ps
module main_dram_tb;
    // 50ppm faster than nominal: initialization margin does not depend on a
    // particular release phase at the nominal oscillator frequency.
    localparam real PERIOD=(1000000000.0/33868800.0)*0.99995;
    reg clk=0;
    always #(PERIOD/2) clk=!clk;
    reg power_reset_n=1,reset_n=1,req_valid=0,req_write=0;
    wire req_ready,rsp_valid,init_done;
    reg [19:0] req_address=0;
    reg [31:0] req_wdata=0;
    reg [3:0] req_be_n=0;
    wire [31:0] rsp_rdata;
    wire [9:0] ma;
    tri [31:0] md;
    wire ras_n,we_n,oe_n;
    wire [3:0] cas_n;
    main_dram dut(.req_private(1'b0),.ras_private_n(),.oe_private_n(),.*);
    is41lv16100_pair_model memory(.*);
    reg [19:0] addresses[0:63];
    reg [31:0] expected[0:63];
    integer transfers=0,load_sent=0,load_done=0;
    integer proven_refreshes;
    realtime proven_refresh_gap;
    reg [31:0] expected_reply;
    realtime accepted_at;
    task automatic tick;@(posedge clk);#1;endtask
    task automatic apply_expected(input integer slot,input [31:0] value,input [3:0] be);
        for(integer b=0;b<4;b=b+1) if(!be[b]) expected[slot][b*8 +:8]=value[b*8 +:8];
    endtask
    task automatic transfer(input bit writing,input integer slot,input [31:0] value,input [3:0] be);
        integer clocks;
        @(negedge clk);while(!req_ready) @(negedge clk);
        req_valid=1;req_write=writing;req_address=addresses[slot];req_wdata=value;req_be_n=be;
        tick();accepted_at=$realtime;clocks=0;
        @(negedge clk);req_valid=0;
        req_address=~addresses[slot];req_wdata=~value;req_be_n=~be;req_write=!writing;
        while(!rsp_valid) begin tick();clocks=clocks+1;end
        if(clocks!=9) $fatal(1,"Closed-page completion not9clocks: %0d",clocks);
        if(writing) begin
            apply_expected(slot,value,be);
            if(rsp_rdata!==0) $fatal(1,"Write returned read data");
        end else if(rsp_rdata!==expected[slot])
            $fatal(1,"DRAM read %h got%h expected%h",addresses[slot],rsp_rdata,expected[slot]);
        if(memory.words[addresses[slot]]!==expected[slot]) $fatal(1,"Physical byte-lane/row-column data mismatch");
        transfers=transfers+1;
    endtask
    task automatic continuous_load(input integer operations);
        integer slot;
        reg writing;
        reg [31:0] value;
        reg [3:0] be;
        load_sent=0;load_done=0;
        @(negedge clk);
        while(rsp_valid) @(negedge clk);
        while(load_done<operations) begin
            req_valid=load_sent<operations;
            req_write=!load_sent[0];
            slot=(load_sent>>1)&63;
            req_address=addresses[slot];
            req_wdata=32'h91a70000 ^ (load_sent*32'h10204081);
            req_be_n=(load_sent>>1)&15;
            @(posedge clk);
            // Observe real pre-edge ready/valid, including simultaneous prior
            // completion and next acceptance. Valid stays asserted while busy.
            if(rsp_valid) begin
                if(rsp_rdata!==expected_reply) $fatal(1,"Continuous-load response mismatch at%0d",load_done);
                load_done=load_done+1;
            end
            if(req_valid && req_ready) begin
                writing=req_write;value=req_wdata;be=req_be_n;
                slot=(load_sent>>1)&63;
                if(writing) begin apply_expected(slot,value,be);expected_reply=0;end
                else expected_reply=expected[slot];
                load_sent=load_sent+1;
            end
            @(negedge clk);
        end
        req_valid=0;
        transfers=transfers+load_done;
    endtask
    task automatic interrupted(input bit writing);
        integer slot;
        slot=7;
        @(negedge clk);while(!req_ready) @(negedge clk);
        req_valid=1;req_write=writing;req_address=addresses[slot];req_wdata=32'h76543210;req_be_n=0;
        tick();@(negedge clk);req_valid=0;
        @(negedge ras_n);#2;reset_n=0;#1;
        if(ras_n || req_ready || rsp_valid) $fatal(1,"Soft reset truncated RAS or retained client handshake");
        #1000;
        if(!we_n || !oe_n || md!==32'bz || !init_done)
            $fatal(1,"Soft reset did not reach a legal initialized idle boundary");
        if(writing) expected[slot]=32'h76543210; // accepted write may complete
        if(memory.words[addresses[slot]]!==expected[slot]) $fatal(1,"Reset changed committed physical data");
        #3;reset_n=1;transfer(0,slot,0,4'hf);
    endtask
    always @(posedge clk) begin
        if(power_reset_n && !init_done && req_ready) $fatal(1,"Request admitted before physical initialization");
        if(power_reset_n && !reset_n && (req_ready || rsp_valid)) $fatal(1,"Soft reset exposed client handshake");
        if(memory.refreshes>8 && memory.max_refresh_gap>500*PERIOD+0.01)
            $fatal(1,"Continuous requests delayed refresh beyond500clocks");
    end
    initial begin
        for(integer i=0;i<64;i=i+1) begin
            addresses[i]=(i*16411)&20'hfffff;
            expected[i]=32'h10325476 ^ i;
        end
        addresses[0]=0;addresses[1]=20'hfffff;addresses[2]=20'h00400;addresses[3]=1;
        for(integer i=0;i<64;i=i+1) memory.words[addresses[i]]=expected[i];
        #2;power_reset_n=0;reset_n=0;#137;power_reset_n=1;
        req_valid=1;req_write=0;req_address=0;req_be_n=4'hf;
        // Full DRAM init occurs while the board is held in system reset.
        while(!init_done) tick();
        if(memory.refreshes!=8 || req_ready) $fatal(1,"Initialization count/system-reset admission mismatch");
        req_valid=0;#3;reset_n=1;
        for(integer i=0;i<64;i=i+1) transfer(0,i,0,i&15);
        for(integer mask=0;mask<16;mask=mask+1) begin
            transfer(1,mask,32'ha5c37e91 ^ mask,mask);
            transfer(0,mask,0,15-mask);
        end
        continuous_load(60000);
        if(memory.refreshes<1032) $fatal(1,"Load did not cover a complete1024-row refresh pass");
        interrupted(1);interrupted(0);
        // More than one complete retention interval under system reset. Data
        // must survive because refresh is independent of the software reset.
        @(negedge clk);reset_n=0;
        begin: reset_retention
            integer before_refresh;
            before_refresh=memory.refreshes;#17000000;
            if(memory.refreshes-before_refresh<1024 || !init_done)
                $fatal(1,"System reset stopped initialized DRAM refresh");
        end
        #7;reset_n=1;
        for(integer i=0;i<64;i=i+1) transfer(0,i,0,4'hf);
        proven_refreshes=memory.refreshes;proven_refresh_gap=memory.max_refresh_gap;
        // True POR may release pins immediately; no retention promise covers
        // an interrupted power-loss cycle. Reinitialization still does not
        // contain any explicit array-clear operation.
        @(negedge clk);while(!req_ready)@(negedge clk);
        req_valid=1;req_write=0;req_address=0;tick();@(negedge clk);req_valid=0;
        @(negedge ras_n);#3;power_reset_n=0;#1;
        if(!ras_n || cas_n!==4'hf || !we_n || !oe_n || req_ready || rsp_valid || init_done)
            $fatal(1,"Power reset did not release pins/client state immediately");
        #100;power_reset_n=1;while(!init_done)tick();
        if(memory.refreshes!=8) $fatal(1,"TruePOR did not repeat8CBR initialization");
        $display("PASS main_dram transfers=%0d continuous=%0d CBR=%0d max_CBR_gap_ns=%0.3f softreset_retention_ms=17 latency_clocks=9",transfers,load_done,proven_refreshes,proven_refresh_gap);
        $finish;
    end
    initial begin #100000000;$fatal(1,"Main DRAM watchdog");end
endmodule
