`timescale 1ns/1ps
module apu_upload_commit_tb;
    localparam real PERIOD=1000000000.0/33868800.0;
    reg clk=0;
    always #(PERIOD/2.0) clk=~clk;
    reg reset_n=1, power_reset_n=1;
    reg stage_valid=0, start_valid=0, cancel=0;
    reg [3:0] stage_index=0;
    reg [31:0] stage_word=0;
    reg [4:0] start_words=0;
    reg [16:0] live_word_address=0;
    wire start_ready, batch_busy, commit_valid;
    wire publish_valid;
    wire [4:0] publish_words;
    wire [16:0] publish_base;
    wire [4:0] commit_words;
    wire [16:0] commit_base, commit_next_address;
    reg epoch_begin=0, epoch_end=0;
    wire epoch_active;
    wire [6:0] queued_words, epoch_words;
    reg read_valid=0;
    reg [16:0] read_word_address=0;
    wire read_ready, read_rsp_valid;
    wire [31:0] read_rsp_word;
    wire memory_ready;
    wire snapshot_ready, snapshot_overflow;
    wire snapshot_change_valid; wire [16:0] snapshot_change_first, snapshot_change_last;
    wire [4:0] snapshots_pending;
    wire store_req_valid, store_req_ready, store_req_write, store_rsp_valid;
    wire [16:0] store_req_word_address;
    wire [31:0] store_req_wdata, store_rsp_rdata;
    wire [3:0] store_req_be_n;
    wire [17:0] mem_address;
    tri [15:0] mem_data;
    wire mem_ce_n, mem_oe_n, mem_we_n, chip_drives;
    wire [1:0] mem_be_n;
    integer cycle=0, commits=0, published=0, drained=0, reads=0;
    integer peak_queue=0, read_backpressure=0, clear_cycles;
    integer last_dense_write=0, dense_write_clocks=0;
    reg checking_dense_drain=0;
    integer commit_cycles[0:63], commit_counts[0:63];
    integer started, deadline, before_commits, burst_first, full_start;
    integer report;
    string report_path="build/reports/apu-upload-commit.json";
    reg preedge_publish;
    reg [4:0] preedge_words;
    reg [16:0] preedge_base;

    apu_upload_commit dut (.*);
    apu_sample_store store (
        .clk(clk),.reset_n(reset_n),.power_reset_n(power_reset_n),
        .req_valid(store_req_valid),.req_ready(store_req_ready),
        .req_write(store_req_write),.req_word_address(store_req_word_address),
        .req_wdata(store_req_wdata),.req_be_n(store_req_be_n),
        .rsp_valid(store_rsp_valid),.rsp_rdata(store_rsp_rdata),
        .memory_ready(memory_ready),.mem_address(mem_address),.mem_data(mem_data),
        .mem_ce_n(mem_ce_n),.mem_oe_n(mem_oe_n),.mem_we_n(mem_we_n),.mem_be_n(mem_be_n)
    );
    issi_bll_pin_model #(.ADDRESS_WIDTH(18),.PATTERN(16'ha53c)) device (
        .address(mem_address),.data(mem_data),.ce_n(mem_ce_n),.oe_n(mem_oe_n),
        .we_n(mem_we_n),.be_n(mem_be_n),.drive_active(chip_drives)
    );
    always @(posedge clk) begin
        cycle=cycle+1;
        if (reset_n && power_reset_n) begin
            preedge_publish=publish_valid;preedge_words=publish_words;preedge_base=publish_base;
            if (store_rsp_valid && dut.state==1) drained=drained+1;
            if (checking_dense_drain && store_req_valid && store_req_ready && store_req_write) begin
                if (last_dense_write!=0) begin
                    dense_write_clocks=cycle-last_dense_write;
                    if(dense_write_clocks!=9) $fatal(1,"Owner changed physical write cadence to %0d",dense_write_clocks);
                end
                last_dense_write=cycle;
            end
            if (read_valid && !read_ready) read_backpressure=read_backpressure+1;
            #0.001;
            if(commit_valid!==preedge_publish || (commit_valid &&
               (commit_words!==preedge_words || commit_base!==preedge_base)))
                $fatal(1,"Pre-edge publication and registered completion disagree");
            if (commit_valid) begin
                commit_cycles[commits]=cycle; commit_counts[commits]=commit_words;
                commits=commits+1; published=published+commit_words;
            end
            if (queued_words>64 || epoch_words>queued_words)
                $fatal(1,"Publication ring/epoch prefix overflow at%0d",cycle);
            if (queued_words>peak_queue) peak_queue=queued_words;
        end
    end
    always @(mem_data or chip_drives or store.pins.data_drive)
        if (store.pins.data_drive && chip_drives) $fatal(1,"SRAM data drivers overlap");

    task automatic tick;
        begin @(posedge clk);#0.01;end
    endtask
    task automatic until_cycle(input integer target);
        begin while(cycle<target) tick();end
    endtask
    task automatic stage(input integer n,input [31:0] seed);
        begin
            for(integer j=0;j<n;j=j+1) begin
                @(negedge clk);stage_valid=1;stage_index=j;stage_word=seed+j;
            end
            @(negedge clk);stage_valid=0;
        end
    endtask
    task automatic start(input integer n,input [16:0] base,output integer at_cycle);
        begin
            @(negedge clk);start_words=n;live_word_address=base;start_valid=1;
            #0.001;
            while(!start_ready) @(negedge clk);
            tick();at_cycle=cycle;
            @(negedge clk);start_valid=0;
        end
    endtask
    task automatic expect_commit(input integer target,input integer n,input [16:0] base);
        begin
            until_cycle(target);
            if(!commit_valid || commit_words!==n || commit_base!==base ||
               commit_next_address!==((base+n)&17'h1ffff))
                $fatal(1,"Wrong/missing atomic commit at%0d: valid%0d count%0d base%h",cycle,
                    commit_valid,commit_words,commit_base);
        end
    endtask
    task automatic read_word(input [16:0] address,input [31:0] expected);
        begin
            @(negedge clk);read_valid=1;read_word_address=address;
            #0.001;
            while(!read_ready) @(negedge clk);
            tick();
            @(negedge clk);read_valid=0;
            while(!read_rsp_valid) tick();
            if(read_rsp_word!==expected)
                $fatal(1,"Snapshot read%h got%h expected%h at%0d",address,read_rsp_word,expected,cycle);
            reads=reads+1;
        end
    endtask
    task automatic physical_word(input [16:0] address,input [31:0] expected);
        begin
            if({device.words[{address,1'b1}],device.words[{address,1'b0}]}!==expected)
                $fatal(1,"Backing SRAM%h changed outside allowed epoch or lost write",address);
        end
    endtask
    task automatic open_epoch;
        begin @(negedge clk);epoch_begin=1;tick();@(negedge clk);epoch_begin=0;end
    endtask
    task automatic close_epoch;
        begin @(negedge clk);epoch_end=1;tick();@(negedge clk);epoch_end=0;end
    endtask
    task automatic drain;
        begin wait(queued_words==0);@(negedge clk);end
    endtask

    initial begin
        if($value$plusargs("REPORT=%s",report_path)) begin end
        #2;reset_n=0;power_reset_n=0;
        #100;reset_n=1;power_reset_n=1;
        if(start_ready || read_ready) $fatal(1,"Admitted work before physical RAM clear");
        wait(memory_ready);#1;clear_cycles=cycle-3;

        // Retarget through t-1, then publish before cancellation and an opening
        // output epoch/read on t. Original target must remain untouched.
        stage(3,32'h10000000);start(3,17'd100,started);deadline=started+96;
        read_word(100,0);
        until_cycle(deadline-1);@(negedge clk);
        live_word_address=200;cancel=1;epoch_begin=1;read_valid=1;read_word_address=200;
        #0.001;
        if(!read_ready) $fatal(1,"Due-edge forwarding did not admit new epoch read");
        expect_commit(deadline,3,200);
        if(!read_rsp_valid || read_rsp_word!==32'h10000000)
            $fatal(1,"Due publication was not visible on opening epoch edge");
        reads=reads+1;
        @(negedge clk);cancel=0;epoch_begin=0;read_valid=0;
        read_word(201,32'h10000001);read_word(202,32'h10000002);read_word(100,0);
        close_epoch();drain();

        // A mid-render upload is already globally committed, but every word
        // of this old render must still observe the same old memory image.
        open_epoch();stage(3,32'h20000000);start(3,200,started);
        expect_commit(started+96,3,200);
        if(epoch_words!=0 || queued_words!=3) $fatal(1,"Late publication entered old epoch prefix");
        read_word(200,32'h10000000);read_word(201,32'h10000001);
        physical_word(200,32'h10000000);
        @(negedge clk);epoch_end=1;epoch_begin=1;read_valid=1;read_word_address=200;
        tick();
        if(!read_rsp_valid || read_rsp_word!==32'h20000000 || !epoch_active)
            $fatal(1,"Next epoch did not atomically acquire published image");
        reads=reads+1;
        @(negedge clk);epoch_end=0;epoch_begin=0;read_valid=0;
        read_word(202,32'h20000002);close_epoch();drain();physical_word(200,32'h20000000);

        // Cancel at t-1; no partial SRAM writes may have happened.
        before_commits=commits;stage(1,32'h30000000);start(1,300,started);
        until_cycle(started+30);@(negedge clk);cancel=1;tick();
        @(negedge clk);cancel=0;repeat(3) tick();
        if(commits!=before_commits || batch_busy) $fatal(1,"Cancelled batch published");
        read_word(300,0);physical_word(300,0);

        // A point read already accepted before publication is not rewritten
        // by the new shadow value while its real SRAM response is in flight.
        stage(1,32'h31000000);start(1,310,started);
        until_cycle(started+29);read_word(310,0);
        read_word(310,32'h31000000);drain();

        // Both versions can coexist in the ring. The old epoch finds the
        // latest eligible version, while a new epoch includes the newer tail.
        stage(16,32'h32000000);start(16,320,started);
        until_cycle(started+511);@(negedge clk);
        epoch_begin=1;start_valid=1;start_words=1;
        expect_commit(started+512,16,320);deadline=cycle+32;
        @(negedge clk);epoch_begin=0;start_valid=0;live_word_address=335;
        stage(1,32'h32100000);expect_commit(deadline,1,335);
        read_word(335,32'h3200000f);
        @(negedge clk);epoch_end=1;epoch_begin=1;
        tick();@(negedge clk);epoch_end=0;epoch_begin=0;
        read_word(335,32'h32100000);close_epoch();drain();
        physical_word(335,32'h32100000);

        // Word-address wrap and repeated ring wrap retain actual full words.
        stage(3,32'h33000000);start(3,17'h1ffff,started);
        expect_commit(started+96,3,17'h1ffff);drain();
        read_word(17'h1ffff,32'h33000000);read_word(0,32'h33000001);read_word(1,32'h33000002);
        for(integer b=0;b<9;b=b+1) begin
            stage(16,32'h40000000+b*256);start(16,17'h1000+b*16,started);
            expect_commit(started+512,16,17'h1000+b*16);drain();
            for(integer j=0;j<16;j=j+1) physical_word(17'h1000+b*16+j,32'h40000000+b*256+j);
        end

        // Exact global-time variable-size arrivals: 16,16,7 publishes 39 words
        // in one 768-clock half-open window. Keep an intentionally overlong
        // epoch open to exercise the finite64-word queue, not a new guarantee.
        open_epoch();stage(16,32'h50000000);start(16,17'h2000,started);
        until_cycle(started+511);@(negedge clk);start_valid=1;start_words=16;
        expect_commit(started+512,16,17'h2000);burst_first=cycle;
        @(negedge clk);start_valid=0;live_word_address=17'h2100;
        stage(16,32'h60000000);
        until_cycle(burst_first+511);@(negedge clk);start_valid=1;start_words=7;
        expect_commit(burst_first+512,16,17'h2100);
        @(negedge clk);start_valid=0;live_word_address=17'h2200;
        stage(7,32'h70000000);
        until_cycle(burst_first+735);@(negedge clk);start_valid=1;start_words=16;
        expect_commit(burst_first+736,7,17'h2200);
        if(queued_words!=39 || epoch_words!=0) $fatal(1,"Variable-batch39-word burst not retained atomically");
        @(negedge clk);start_valid=0;live_word_address=17'h2300;
        stage(16,32'h80000000);
        until_cycle(burst_first+1247);@(negedge clk);start_valid=1;start_words=9;
        expect_commit(burst_first+1248,16,17'h2300);
        @(negedge clk);start_valid=0;live_word_address=17'h2400;
        stage(9,32'h90000000);
        expect_commit(burst_first+1536,9,17'h2400);
        if(queued_words!=64 || epoch_words!=0) $fatal(1,"Did not reach complete64-word committed pressure");
        read_word(17'h2000,0);read_word(17'h2400,0);physical_word(17'h2000,0);
        stage(1,32'ha0000000);
        @(negedge clk);start_valid=1;start_words=1;live_word_address=17'h2500;
        repeat(5) begin tick();if(start_ready || batch_busy) $fatal(1,"Full ring accepted unreserved publication");end
        full_start=cycle;checking_dense_drain=1;close_epoch();
        while(!start_ready) @(negedge clk);
        tick();started=cycle;@(negedge clk);start_valid=0;
        if(started<=full_start) $fatal(1,"Expected finite-capacity start backpressure");
        expect_commit(started+32,1,17'h2500);drain();checking_dense_drain=0;
        for(integer j=0;j<16;j=j+1) begin
            physical_word(17'h2000+j,32'h50000000+j);
            physical_word(17'h2100+j,32'h60000000+j);
            physical_word(17'h2300+j,32'h80000000+j);
        end
        for(integer j=0;j<7;j=j+1) physical_word(17'h2200+j,32'h70000000+j);
        for(integer j=0;j<9;j=j+1) physical_word(17'h2400+j,32'h90000000+j);
        read_word(17'h2500,32'ha0000000);

        // Three concurrently retained frame fences and two intervening
        // publications, observed through the actual SRAM controller and pins.
        // Word 3000H was not otherwise written after the physical clear.
        open_epoch();
        stage(1,32'h11112222);start(1,17'h3000,started);expect_commit(started+32,1,17'h3000);
        open_epoch();
        stage(1,32'h33334444);start(1,17'h3000,started);expect_commit(started+32,1,17'h3000);
        open_epoch();
        if(snapshots_pending!=3 || snapshot_overflow)$fatal(1,"three physical fences not retained");
        read_word(17'h3000,0);close_epoch();
        read_word(17'h3000,32'h11112222);close_epoch();
        read_word(17'h3000,32'h33334444);close_epoch();drain();
        physical_word(17'h3000,32'h33334444);

        if(published!=drained || peak_queue!=64 || dense_write_clocks!=9 || read_backpressure==0)
            $fatal(1,"Lost publication/drain count or failed to exercise physical backpressure");
        report=$fopen(report_path,"w");
        if(!report) $fatal(1,"Cannot open upload publication report %s",report_path);
        $fdisplay(report,"{\"scope\":\"Physical DMA_WRITE publication and render-epoch memory snapshots; finite queue admission, not APU MMIO, DMA_READ, arithmetic or unconditional playback qualification\",\"exact_deadline_batches\":%0d,\"physical_word_writes\":%0d,\"checked_reads\":%0d,\"physical_clear_clocks\":%0d,\"dense_write_interval_clocks\":%0d,\"read_backpressure_clocks\":%0d,\"variable_batch_words_in_768_clock_window\":39,\"committed_queue_capacity_words\":64,\"snapshot_fence_capacity\":16,\"peak_queued_words\":%0d,\"full_queue_start_backpressure_exercised\":true,\"preedge_publication_equals_registered_completion\":true,\"snapshot_cases\":[\"same_edge_due_and_epoch_begin\",\"mid_epoch_publication_excluded\",\"duplicate_old_new_versions\",\"inflight_precommit_read_returns_old\",\"retarget_through_deadline\",\"due_before_cancel\",\"cancel_before_due\",\"word_and_ring_wrap\",\"three_overlapping_snapshot_fences\"],\"unbounded_epoch_capacity_guaranteed\":false}",commits,published,reads,clear_cycles,dense_write_clocks,read_backpressure,peak_queue);
        $fclose(report);
        $display("PASS apu_upload_commit: %0d exact-deadline batches/%0d physical words, %0d reads; epoch isolation, same-edge publication, retarget/cancel/wrap; 39 words in 768 clocks, peak queue %0d, full-queue admission backpressure; write cadence %0d clocks, read stall clocks %0d, physical clear %0d clocks",commits,published,reads,peak_queue,dense_write_clocks,read_backpressure,clear_cycles);
        $finish;
    end
    initial begin #100000000;$fatal(1,"APU publication watchdog");end
endmodule
