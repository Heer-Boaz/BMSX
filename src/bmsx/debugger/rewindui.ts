// Rewind Debugger UI extracted from bmsxdebugger.ts
// Provides: showRewindDialog, gamePaused, gameResumed

export function showRewindDialog() {
    // Remove any existing rewind overlay
    let rewindOverlay = document.getElementById('rewind-overlay');
    if (rewindOverlay) rewindOverlay.remove();

    // Create overlay
    rewindOverlay = document.createElement('div');
    rewindOverlay.id = 'rewind-overlay';
    Object.assign(rewindOverlay.style, {
        position: 'fixed',
        left: '50%',
        bottom: '32px',
        transform: 'translateX(-50%)',
        zIndex: '9999',
        background: 'rgba(30, 30, 40, 0.92)',
        color: '#fff',
        borderRadius: '18px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
        padding: '32px 36px 28px 36px',
        minWidth: '340px',
        minHeight: '120px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontFamily: 'monospace',
        fontSize: '1.1em',
        gap: '18px',
        userSelect: 'none',
        transition: 'opacity 0.2s',
    });

    // Title
    const title = document.createElement('div');
    title.textContent = '⏪ Rewind (10s)';
    title.style.fontWeight = 'bold';
    title.style.fontSize = '1.3em';
    title.style.marginBottom = '2px';
    rewindOverlay.appendChild(title);

    // Info
    const info = document.createElement('div');
    info.style.marginBottom = '0px';
    rewindOverlay.appendChild(info);

    // Slider row
    const sliderRow = document.createElement('div');
    sliderRow.style.display = 'flex';
    sliderRow.style.alignItems = 'center';
    sliderRow.style.gap = '12px';
    rewindOverlay.appendChild(sliderRow);

    // Back button
    const btnBack = document.createElement('button');
    btnBack.textContent = '⏮️';
    btnBack.title = 'Step back';
    btnBack.style.fontSize = '1.3em';
    btnBack.style.padding = '4px 10px';
    btnBack.style.borderRadius = '8px';
    btnBack.style.border = 'none';
    btnBack.style.background = '#444';
    btnBack.style.color = '#fff';
    btnBack.style.cursor = 'pointer';
    btnBack.onmouseenter = () => btnBack.style.background = '#666';
    btnBack.onmouseleave = () => btnBack.style.background = '#444';
    btnBack.onclick = () => {
        if ((window as any).$ && (window as any).$.canRewind()) {
            (window as any).$.rewindFrame();
            updateInfo();
            (window as any).$.view.drawgame();
        }
    };
    sliderRow.appendChild(btnBack);

    // Slider
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '1';
    slider.max = '1';
    slider.value = '1';
    slider.style.width = '180px';
    slider.style.accentColor = '#6cf';
    slider.oninput = () => {
        const idx = parseInt(slider.value, 10) - 1;
        if ((window as any).$ && (window as any).$.jumpToFrame(idx)) {
            updateInfo();
            (window as any).$.view.drawgame();
        }
    };
    sliderRow.appendChild(slider);

    // Forward button
    const btnForward = document.createElement('button');
    btnForward.textContent = '⏭️';
    btnForward.title = 'Step forward';
    btnForward.style.fontSize = '1.3em';
    btnForward.style.padding = '4px 10px';
    btnForward.style.borderRadius = '8px';
    btnForward.style.border = 'none';
    btnForward.style.background = '#444';
    btnForward.style.color = '#fff';
    btnForward.style.cursor = 'pointer';
    btnForward.onmouseenter = () => btnForward.style.background = '#666';
    btnForward.onmouseleave = () => btnForward.style.background = '#444';
    btnForward.onclick = () => {
        if ((window as any).$ && (window as any).$.canForward()) {
            (window as any).$.forwardFrame();
            updateInfo();
            (window as any).$.view.drawgame();
        }
    };
    sliderRow.appendChild(btnForward);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.title = 'Close';
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '10px';
    closeBtn.style.right = '16px';
    closeBtn.style.background = 'transparent';
    closeBtn.style.border = 'none';
    closeBtn.style.color = '#fff';
    closeBtn.style.fontSize = '1.3em';
    closeBtn.style.cursor = 'pointer';
    closeBtn.onmouseenter = () => closeBtn.style.color = '#f66';
    closeBtn.onmouseleave = () => closeBtn.style.color = '#fff';
    closeBtn.onclick = () => rewindOverlay.remove();
    rewindOverlay.appendChild(closeBtn);

    function updateInfo() {
        if (!(window as any).$) return;
        const frames = (window as any).$.getRewindFrames();
        let idx = (window as any).$.getCurrentRewindFrameIndex();
        const dt = -((frames.length - 1 - idx) * 0.02).toFixed(2); // 50fps = 0.02s per frame
        info.textContent = `Δt: ${dt} s`;
        slider.max = frames.length.toString();
        slider.value = (idx + 1).toString();
    }

    updateInfo();
    document.body.appendChild(rewindOverlay);
}
