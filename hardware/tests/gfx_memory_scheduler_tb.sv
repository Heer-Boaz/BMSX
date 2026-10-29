`timescale 1ns/1ps
// Real scheduler + async_sram + two full-depth ISSI x16 pin models. Producers
// supply addressed RAW jobs; this bench does not substitute a pixel decoder,
// beam generator, renderer or CDC. Read/modify/write below is an external
// consumer of the genuine renderer read-response and subsequent write ports.
module gfx_memory_scheduler_tb;
    localparam integer TAG_WIDTH=12;
    reg clk=0;
    always #9.259259259259 clk=!clk;
    reg power_reset_n=1,reset_n=1,quiesce=0;
    wire quiescent;
    reg [1:0] scan_req_valid=0,scan_rsp_ready=0;
    wire [1:0] scan_req_ready,scan_rsp_valid;
    reg [37:0] scan_req_address=0;
    reg [2*TAG_WIDTH-1:0] scan_req_tag=0;
    wire [63:0] scan_rsp_data;
    wire [2*TAG_WIDTH-1:0] scan_rsp_tag;
    reg render_req_valid=0,render_req_write=1,render_rsp_ready=0;
    wire render_req_ready,render_rsp_valid,render_rsp_write;
    reg [18:0] render_req_address=0;
    reg [31:0] render_req_wdata=0;
    reg [3:0] render_req_be_n=0;
    reg [TAG_WIDTH-1:0] render_req_tag=0;
    wire [31:0] render_rsp_data;
    wire [TAG_WIDTH-1:0] render_rsp_tag;
    tri [31:0] mem_data;
    wire [18:0] mem_address;
    wire mem_ce_n,mem_oe_n,mem_we_n;
    wire [3:0] mem_be_n;
    wire [1:0] chip_drives;
    reg auto_scan=0,auto_render=0,consume=0,random_ready=0;
    reg [1:0] auto_scan_mask=2'b11;
    integer scan_limit=128,render_limit=128;
    integer scan_sent[0:1],scan_received[0:1];
    integer render_sent=0,render_received=0,cycle=0;
    reg [TAG_WIDTH-1:0] wanted_scan_tag[0:1][0:32767];
    reg [31:0] wanted_scan_data[0:1][0:32767];
    integer scan_accept_cycle[0:1][0:127];
    integer max_raw_result_clocks[0:1];
    integer scan_deadline[0:1][0:127];
    reg sampled_pattern=0;
    integer pattern_birth_cycle=0,pattern_raw_latency=0,pattern_delivery_latency=0;
    integer pattern_phases=0,pattern_words=0;
    reg [TAG_WIDTH-1:0] wanted_render_tag[0:8191];
    reg [31:0] wanted_render_data[0:8191];
    reg wanted_render_write[0:8191];
    reg [31:0] physical_words[0:524287];
    reg [1:0] stalled_scan=0;
    reg stalled_render=0;
    reg [63:0] held_scan_data;
    reg [2*TAG_WIDTH-1:0] held_scan_tag;
    reg [31:0] held_render_data,last_render_data;
    reg [TAG_WIDTH-1:0] held_render_tag;
    reg held_render_write;
    integer frame_reads=0,frame_writes=0,frame_read0=0,frame_read1=0;
    reg measure_frame=0;
    integer proven_frames=0,mixed_reads=0,mixed_writes=0;
    integer lone_calendars=0,render_read_calendar=0;
    integer timeout_count,desired;
    reg [31:0] modified;

    gfx_memory_scheduler #(.TAG_WIDTH(TAG_WIDTH)) dut (.*);
    genvar chip;
    generate for(chip=0;chip<2;chip=chip+1) begin : part
        issi_bll_pin_model #(.ADDRESS_WIDTH(19),.PATTERN(chip==0 ? 16'h5a5a:16'ha5a5)) device (
            .address(mem_address),.data(mem_data[chip*16+:16]),
            .ce_n(mem_ce_n),.oe_n(mem_oe_n),.we_n(mem_we_n),
            .be_n(mem_be_n[chip*2+:2]),.drive_active(chip_drives[chip]));
    end endgenerate
    initial begin
        scan_sent[0]=0;scan_sent[1]=0;scan_received[0]=0;scan_received[1]=0;
        max_raw_result_clocks[0]=0;max_raw_result_clocks[1]=0;
        for(integer a=0;a<524288;a=a+1) begin
            physical_words[a][15:0]=16'h5a5a^(a&16'hffff)^(a>>16);
            physical_words[a][31:16]=16'ha5a5^(a&16'hffff)^(a>>16);
        end
    end
    always @(negedge clk) begin
        if(auto_scan) for(integer n=0;n<2;n=n+1) begin
            scan_req_valid[n]=auto_scan_mask[n] && scan_sent[n]<scan_limit;
            scan_req_address[n*19+:19]=(n==0 ? 0:19'h20000)+scan_sent[n];
            scan_req_tag[n*TAG_WIDTH+:TAG_WIDTH]=(n==0 ? 12'ha00:12'h500)^scan_sent[n];
        end
        if(auto_render) begin
            render_req_valid=render_sent<render_limit;
            render_req_write=1;
            render_req_address=19'h40000+render_sent;
            render_req_wdata=32'h87654321^render_sent;
            render_req_be_n=render_sent[3:0];
            render_req_tag=12'hd00^render_sent;
        end
        scan_rsp_ready=consume ? (random_ready ? {cycle%5!=0,cycle%3!=0}:2'b11):2'b00;
        render_rsp_ready=consume && (!random_ready || cycle%7!=0);
    end
    always @(posedge clk) begin
        cycle=cycle+1;
        if(!reset_n || !power_reset_n) begin
            scan_sent[0]=0;scan_sent[1]=0;scan_received[0]=0;scan_received[1]=0;
            render_sent=0;render_received=0;stalled_scan=0;stalled_render=0;
            measure_frame=0;frame_reads=0;frame_writes=0;frame_read0=0;frame_read1=0;
        end else begin
            for(integer n=0;n<2;n=n+1) begin
                if(stalled_scan[n] && (!scan_rsp_valid[n] ||
                    scan_rsp_data[n*32+:32]!==held_scan_data[n*32+:32] ||
                    scan_rsp_tag[n*TAG_WIDTH+:TAG_WIDTH]!==held_scan_tag[n*TAG_WIDTH+:TAG_WIDTH]))
                    $fatal(1,"Backpressure changed scanout head/data/tag");
                stalled_scan[n]=scan_rsp_valid[n] && !scan_rsp_ready[n];
                held_scan_data[n*32+:32]=scan_rsp_data[n*32+:32];
                held_scan_tag[n*TAG_WIDTH+:TAG_WIDTH]=scan_rsp_tag[n*TAG_WIDTH+:TAG_WIDTH];
                if(scan_req_valid[n] && scan_req_ready[n]) begin
                    scan_accept_cycle[n][dut.scan_tail[n]]=cycle;
                    scan_deadline[n][dut.scan_tail[n]]=sampled_pattern ? pattern_birth_cycle+30:0;
                    if(sampled_pattern) pattern_words=pattern_words+1;
                    wanted_scan_tag[n][scan_sent[n]]=scan_req_tag[n*TAG_WIDTH+:TAG_WIDTH];
                    wanted_scan_data[n][scan_sent[n]]=physical_words[scan_req_address[n*19+:19]];
                    scan_sent[n]=scan_sent[n]+1;
                end
                if(scan_rsp_valid[n] && scan_rsp_ready[n]) begin
                    if(scan_deadline[n][dut.scan_head[n]]!=0) begin
                        if(cycle>scan_deadline[n][dut.scan_head[n]])
                            $fatal(1,"Fixed-rate sample words were not delivered within30 local slots");
                        if(cycle-(scan_deadline[n][dut.scan_head[n]]-30)>pattern_delivery_latency)
                            pattern_delivery_latency=cycle-(scan_deadline[n][dut.scan_head[n]]-30);
                    end
                    if(scan_received[n]>=scan_sent[n] ||
                        scan_rsp_tag[n*TAG_WIDTH+:TAG_WIDTH]!==wanted_scan_tag[n][scan_received[n]] ||
                        scan_rsp_data[n*32+:32]!==wanted_scan_data[n][scan_received[n]])
                        $fatal(1,"Scanout%0d result was lost/reordered/torn",n);
                    scan_received[n]=scan_received[n]+1;
                end
                if(scan_sent[n]-scan_received[n]>128 || dut.scan_completed[n]>128)
                    $fatal(1,"Scanout accepted an unreserved result or overran128 entries");
            end
            if(stalled_render && (!render_rsp_valid || render_rsp_tag!==held_render_tag ||
                render_rsp_data!==held_render_data || render_rsp_write!==held_render_write))
                $fatal(1,"Backpressure changed renderer response");
            stalled_render=render_rsp_valid && !render_rsp_ready;
            held_render_tag=render_rsp_tag;held_render_data=render_rsp_data;held_render_write=render_rsp_write;
            if(render_req_valid && render_req_ready) begin
                if(render_req_tag>=12'hf01 && render_req_tag<=12'hf04 &&
                    (dut.scan_unissued[0]==0 || dut.scan_unissued[1]==0))
                    $fatal(1,"RMW stress did not retain both saturated scanout producers");
                wanted_render_tag[render_sent]=render_req_tag;
                wanted_render_write[render_sent]=render_req_write;
                wanted_render_data[render_sent]=render_req_write ? 0:physical_words[render_req_address];
                if(render_req_write) for(integer b=0;b<4;b=b+1) if(!render_req_be_n[b])
                    physical_words[render_req_address][b*8+:8]=render_req_wdata[b*8+:8];
                render_sent=render_sent+1;
            end
            if(render_rsp_valid && render_rsp_ready) begin
                if(render_received>=render_sent || render_rsp_tag!==wanted_render_tag[render_received] ||
                    render_rsp_data!==wanted_render_data[render_received] ||
                    render_rsp_write!==wanted_render_write[render_received])
                    $fatal(1,"Renderer read/write response ownership/order/data failed");
                if(!render_rsp_write) last_render_data=render_rsp_data;
                render_received=render_received+1;
            end
            if(dut.returned && dut.returned_owner<2) begin
                if(scan_deadline[dut.returned_owner][dut.returned_index]!=0) begin
                    if(cycle>scan_deadline[dut.returned_owner][dut.returned_index])
                        $fatal(1,"Fixed-rate sample raw result exceeded30 local slots");
                    if(cycle-(scan_deadline[dut.returned_owner][dut.returned_index]-30)>pattern_raw_latency)
                        pattern_raw_latency=cycle-(scan_deadline[dut.returned_owner][dut.returned_index]-30);
                end
                if(cycle-scan_accept_cycle[dut.returned_owner][dut.returned_index]>
                    (dut.returned_owner==0 ? 258:514))
                    $fatal(1,"A raw scanout job exceeded the128-entry calendar service bound");
                if(cycle-scan_accept_cycle[dut.returned_owner][dut.returned_index]>
                    max_raw_result_clocks[dut.returned_owner])
                    max_raw_result_clocks[dut.returned_owner]=
                        cycle-scan_accept_cycle[dut.returned_owner][dut.returned_index];
            end
            if(render_sent-render_received>128 || dut.inflight>2)
                $fatal(1,"Native result credit/metadata pipeline overflow");
            if(dut.running && dut.slot==0) begin
                measure_frame=dut.scan_unissued[0]>=48 && dut.scan_unissued[1]>=48 &&
                    render_req_valid && render_req_write && dut.render_reserved<120;
                frame_reads=0;frame_writes=0;frame_read0=0;frame_read1=0;
            end
            if(dut.issue) begin
                if(dut.chosen_owner<2) begin
                    if(dut.slot>=48 || dut.sram_req_write)
                        $fatal(1,"Scanout escaped its reserved read calendar");
                    frame_reads=frame_reads+1;
                    if(dut.chosen_owner==0) frame_read0=frame_read0+1;else frame_read1=frame_read1+1;
                end else begin
                    if(dut.slot<49 || dut.slot>62 || (dut.sram_req_write && dut.slot>61))
                        $fatal(1,"Renderer stole scanout/guard slot or overran final write boundary");
                    if(dut.sram_req_write) begin frame_writes=frame_writes+1;mixed_writes=mixed_writes+1;end
                    else mixed_reads=mixed_reads+1;
                end
            end
            if(dut.running && dut.slot==63 && measure_frame) begin
                if(frame_reads!=48 || frame_writes!=7 || frame_read0!=32 || frame_read1!=16)
                    $fatal(1,"Saturated64-slot throughput/2:1 priority failed: %0d/%0d (%0d/%0d)",frame_reads,frame_writes,frame_read0,frame_read1);
                proven_frames=proven_frames+1;
            end
        end
    end
    task automatic drain;
        begin
            timeout_count=0;
            while(!quiescent && timeout_count<8192) begin @(negedge clk);timeout_count=timeout_count+1;end
            if(!quiescent) $fatal(1,"Accepted work/results did not quiesce");
            if(scan_received[0]!=scan_sent[0] || scan_received[1]!=scan_sent[1] || render_received!=render_sent)
                $fatal(1,"Quiescent asserted with outstanding work");
        end
    endtask
    task automatic renderer(input bit writing,input [18:0] address,input [31:0] word,
        input [3:0] mask,input [TAG_WIDTH-1:0] tag);
        begin
            @(negedge clk);render_req_valid=1;render_req_write=writing;
            render_req_address=address;render_req_wdata=word;render_req_be_n=mask;render_req_tag=tag;
            @(posedge clk);while(!render_req_ready) @(posedge clk);
            @(negedge clk);render_req_valid=0;
        end
    endtask
    task automatic wait_renderer;
        begin
            desired=render_sent;while(render_received<desired) @(negedge clk);
        end
    endtask
    task automatic lone_scan_calendar(input integer active_lane);
        integer reads;
        begin
            // Every scanout slot goes to the sole nonempty circuit, including
            // the slots nominally preferring its absent peer. No idle-cycle
            // or request retry is needed to redistribute that capacity.
            quiesce=0;auto_scan=1;auto_scan_mask=2'b01<<active_lane;
            scan_limit=scan_sent[active_lane]+256;
            while(dut.scan_unissued[active_lane]<64) @(negedge clk);
            while(dut.slot!=0) @(negedge clk);
            reads=0;
            repeat(64) begin
                @(posedge clk);
                if(dut.issue) begin
                    if(dut.chosen_owner!=active_lane || dut.sram_req_write)
                        $fatal(1,"Sole scanout circuit lost its work-conserving allocation");
                    reads=reads+1;
                end
                @(negedge clk);
            end
            if(reads!=48) $fatal(1,"Sole scanout circuit received only %0d of48 slots",reads);
            lone_calendars=lone_calendars+1;
            auto_scan=0;scan_req_valid=0;quiesce=1;drain();
        end
    endtask
    task automatic sample_request_pattern(input integer calendar_phase);
        integer start0,start1;
        begin
            // A finite addressed-request pattern, NOT a beam, address decoder
            // or CDC stand-in. Each source-sample epoch supplies two circuit1
            // words on consecutive clocks and one circuit2 word; next epoch is
            // four GFX clocks later. Renderer writes remain continuously ready
            // to use their independent reservation, never scanout time.
            quiesce=0;sampled_pattern=1;auto_render=1;
            render_limit=render_sent+512;
            while(dut.slot!=calendar_phase) @(negedge clk);
            start0=scan_sent[0];start1=scan_sent[1];
            for(integer offset=0;offset<128*4;offset=offset+1) begin
                if(offset%4==0) pattern_birth_cycle=cycle+1;
                scan_req_valid={offset%4==0,offset%4==0 || offset%4==1};
                scan_req_address[18:0]=scan_sent[0];
                scan_req_address[37:19]=19'h20000+scan_sent[1];
                scan_req_tag[TAG_WIDTH-1:0]=12'ha00^scan_sent[0];
                scan_req_tag[2*TAG_WIDTH-1:TAG_WIDTH]=12'h500^scan_sent[1];
                @(posedge clk);
                if((scan_req_ready & scan_req_valid)!=scan_req_valid)
                    $fatal(1,"Fixed-rate sample producer needed retry/admission stretching");
                @(negedge clk);
            end
            scan_req_valid=0;auto_render=0;render_req_valid=0;quiesce=1;drain();
            sampled_pattern=0;
            if(scan_sent[0]-start0!=256 || scan_sent[1]-start1!=128)
                $fatal(1,"Physical sample request pattern lost a source word");
            pattern_phases=pattern_phases+1;
        end
    endtask
    initial begin
        #1;power_reset_n=0;reset_n=0;repeat(5) @(negedge clk);
        power_reset_n=1;reset_n=1;auto_scan=1;auto_render=1;
        // Fill ALL reserved entries with consumers stopped, including native
        // responses in flight. At full no extra job is accepted or overwritten.
        repeat(2048) @(negedge clk);
        if(scan_sent[0]!=128 || scan_sent[1]!=128 || render_sent!=128 ||
            scan_req_ready!=0 || quiescent || !(&scan_rsp_valid) || !render_rsp_valid)
            $fatal(1,"128-entry admission/result reservation failed under backpressure");
        repeat(128) @(negedge clk);
        if(scan_sent[0]!=128 || scan_sent[1]!=128 || render_sent!=128)
            $fatal(1,"Full rings accepted an unreserved memory result");
        // Refill while consuming, wrap each ring several times, and alternate
        // consumer readiness independently without slowing the calendar.
        scan_limit=600;render_limit=300;consume=1;random_ready=1;
        timeout_count=0;
        while((scan_sent[0]<600 || scan_sent[1]<600 || render_sent<300) && timeout_count<8192) begin
            @(negedge clk);timeout_count=timeout_count+1;
        end
        if(timeout_count==8192) $fatal(1,"Saturated producers starved");
        auto_scan=0;auto_render=0;scan_req_valid=0;render_req_valid=0;
        quiesce=1;random_ready=0;drain();
        if(proven_frames==0) $fatal(1,"No full48-read/seven-write calendar was proven");
        // Renderer RMW must progress even with both scanout circuits saturated.
        quiesce=0;auto_scan=1;scan_limit=856;
        repeat(80) @(negedge clk);
        renderer(0,19'h70000,0,15,12'hf01);wait_renderer();
        modified=last_render_data^32'hff000001;
        renderer(1,19'h70000,modified,0,12'hf02);wait_renderer();
        renderer(0,19'h70000,0,15,12'hf03);wait_renderer();
        if(last_render_data!==modified) $fatal(1,"Genuine renderer read/modify/write failed");
        // A renderer read at final service slot62 returns across the period
        // boundary while the next scanout job is already issuing.
        while(dut.slot!=62) @(negedge clk);
        render_req_valid=1;render_req_write=0;render_req_address=19'h70000;render_req_tag=12'hf04;
        @(posedge clk);if(!render_req_ready) $fatal(1,"Renderer read slot62 was not usable");
        @(negedge clk);render_req_valid=0;wait_renderer();
        // Warm reset with queued old jobs and a real active SRAM write: discard
        // old tags/results, but keep legal WE pulse/hold and committed RAM word.
        auto_scan=1;scan_limit=scan_sent[0]+256;consume=0;
        repeat(80) @(negedge clk);
        renderer(1,19'h74000,32'hcafef00d,0,12'he01);
        @(negedge mem_we_n);#1;reset_n=0;auto_scan=0;scan_req_valid=0;render_req_valid=0;
        #1;
        if(mem_we_n || quiescent || scan_rsp_valid || render_rsp_valid || scan_req_ready || render_req_ready)
            $fatal(1,"Warm reset truncated native write or replayed logical results");
        wait(quiescent);repeat(4) @(negedge clk);
        reset_n=1;consume=1;repeat(3) @(negedge clk);
        if(scan_rsp_valid || render_rsp_valid) $fatal(1,"Pre-reset buffered tag escaped after release");
        renderer(0,19'h74000,0,15,12'he02);wait_renderer();
        if(last_render_data!==32'hcafef00d) $fatal(1,"Warm reset rolled back committed renderer write");
        quiesce=1;drain();quiesce=0;
        // Reset after a scanout read is irrevocably issued but before capture.
        @(negedge clk);scan_req_valid=1;scan_req_address=19'd17;scan_req_tag=12'hc01;
        @(posedge clk);while(!scan_req_ready[0]) @(posedge clk);
        @(negedge clk);scan_req_valid=0;
        @(posedge clk);while(!(dut.issue && dut.chosen_owner==0)) @(posedge clk);
        #1;reset_n=0;
        repeat(5) @(negedge clk);reset_n=1;repeat(3) @(negedge clk);
        if(scan_rsp_valid || render_rsp_valid) $fatal(1,"In-flight stale scanout read was replayed");
        @(negedge clk);scan_req_valid=1;scan_req_address=19'd18;scan_req_tag=12'hc02;
        @(posedge clk);while(!scan_req_ready[0]) @(posedge clk);
        @(negedge clk);scan_req_valid=0;quiesce=1;drain();
        lone_scan_calendar(0);lone_scan_calendar(1);
        // All fourteen renderer service slots support actual reads, not only
        // seven writes. The last response drains beyond slot62 and keeps its
        // original tag while the scheduler proceeds into the next calendar.
        quiesce=0;
        while(dut.slot!=49) @(negedge clk);
        render_req_valid=1;render_req_write=0;render_req_be_n=15;
        render_req_address=19'h40000+render_sent;render_req_tag=render_sent;
        repeat(14) begin
            @(posedge clk);
            if(!render_req_ready) $fatal(1,"Consecutive renderer read lost a reserved service slot");
            render_read_calendar=render_read_calendar+1;
            @(negedge clk);
            render_req_address=19'h40000+render_sent;render_req_tag=render_sent;
        end
        render_req_valid=0;wait_renderer();quiesce=1;drain();
        // Quiesce inhibits new work even with all producer valids asserted.
        scan_req_valid=3;render_req_valid=1;
        repeat(5) begin
            @(negedge clk);
            if(scan_req_ready || render_req_ready || !quiescent)
                $fatal(1,"Quiesced idle memory admitted a new producer request");
        end
        scan_req_valid=0;render_req_valid=0;
        // Exercise all64 relative alignments against the actual calendar and
        // physical SRAM controller, with128 output-sample epochs per phase.
        for(integer phase=0;phase<64;phase=phase+1) sample_request_pattern(phase);
        if(pattern_phases!=64 || pattern_words!=64*128*3)
            $fatal(1,"Incomplete physical sample/calendar-phase coverage");
        if(mixed_reads<18 || mixed_writes<20) $fatal(1,"Renderer read and write paths were not exercised");
        $display("PASS: GFX64-slot scheduler,48R+7W throughput,2:1 scanout,128-entry reservation/backpressure/wrap/tags, real renderer RMW/read62, drain and warm-reset in-flight isolation (%0d saturated + %0d sole-circuit calendars, %0d consecutive renderer reads)",proven_frames,lone_calendars,render_read_calendar);
        $display("Raw result deposition observed max %0d/%0d GFX clocks; capacity bounds258/514 clocks are not decoded-pixel deadlines",max_raw_result_clocks[0],max_raw_result_clocks[1]);
        $display("PASS: %0d sample-request/calendar phases x128 epochs, %0d raw words, maximum raw-deposit/delivery latency %0d/%0d local slots (30-slot budget, decode/CDC not implemented)",pattern_phases,pattern_words,pattern_raw_latency,pattern_delivery_latency);
        $finish;
    end
    initial begin #1000000;$fatal(1,"GFX scheduler test timeout");end
endmodule
