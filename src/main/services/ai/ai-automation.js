let lastMouseX = 0;
let lastMouseY = 0;

async function moveMouseHumanized(dbg, startX, startY, endX, endY) {
  // Generate a control point for natural curved trajectory
  const controlX = startX + (endX - startX) / 2 + (Math.random() - 0.5) * 150;
  const controlY = startY + (endY - startY) / 2 + (Math.random() - 0.5) * 150;
  
  const steps = 15;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Quadratic Bezier formula
    const x = Math.round((1 - t) * (1 - t) * startX + 2 * (1 - t) * t * controlX + t * t * endX);
    const y = Math.round((1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * endY);
    
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await new Promise(r => setTimeout(r, 10 + Math.random() * 8)); // minor delay between move steps
  }
}

async function cdpClick(webContents, x, y) {
  const dbg = webContents.debugger;
  const isAttached = dbg.isAttached();
  if (!isAttached) {
    dbg.attach();
  }
  try {
    // Humanized Bezier pathing to coordinate
    await moveMouseHumanized(dbg, lastMouseX, lastMouseY, x, y);
    lastMouseX = x;
    lastMouseY = y;

    // Press down
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    // Hold click (50ms - 80ms)
    await new Promise(r => setTimeout(r, 50 + Math.random() * 30));
    // Release click
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    return true;
  } catch (err) {
    console.error('CDP click failed:', err);
    return false;
  } finally {
    if (!isAttached) {
      try { dbg.detach(); } catch (e) {}
    }
  }
}

async function cdpType(webContents, text) {
  const dbg = webContents.debugger;
  const isAttached = dbg.isAttached();
  if (!isAttached) {
    dbg.attach();
  }
  try {
    // Typist Jitter Simulator (50ms - 150ms delays with keydown/keyup events)
    for (const char of text) {
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: char,
        unmodifiedText: char,
        key: char
      });
      await dbg.sendCommand('Input.insertText', { text: char });
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: char
      });
      await new Promise(r => setTimeout(r, 45 + Math.random() * 85));
    }
    return true;
  } catch (err) {
    console.error('CDP type failed:', err);
    return false;
  } finally {
    if (!isAttached) {
      try { dbg.detach(); } catch (e) {}
    }
  }
}

async function cdpPressKey(webContents, key) {
  const dbg = webContents.debugger;
  const isAttached = dbg.isAttached();
  if (!isAttached) {
    dbg.attach();
  }
  try {
    let windowsVirtualKeyCode = 0;
    let text = '';
    let code = '';
    let useChar = false;

    if (key === 'Enter') {
      windowsVirtualKeyCode = 13;
      text = '\r';
      code = 'Enter';
      useChar = true;
    } else if (key === 'Backspace') {
      windowsVirtualKeyCode = 8;
      code = 'Backspace';
    } else if (key === 'Tab') {
      windowsVirtualKeyCode = 9;
      code = 'Tab';
    } else if (key === 'Escape') {
      windowsVirtualKeyCode = 27;
      code = 'Escape';
    } else if (key === 'ArrowDown') {
      windowsVirtualKeyCode = 40;
      code = 'ArrowDown';
    } else if (key === 'ArrowUp') {
      windowsVirtualKeyCode = 38;
      code = 'ArrowUp';
    } else if (key === 'ArrowLeft') {
      windowsVirtualKeyCode = 37;
      code = 'ArrowLeft';
    } else if (key === 'ArrowRight') {
      windowsVirtualKeyCode = 39;
      code = 'ArrowRight';
    }

    if (useChar) {
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        windowsVirtualKeyCode,
        key,
        code,
        text,
        unmodifiedText: text
      });
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'char',
        windowsVirtualKeyCode,
        key,
        code,
        text,
        unmodifiedText: text
      });
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        windowsVirtualKeyCode,
        key,
        code
      });
    } else {
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        windowsVirtualKeyCode,
        key,
        code,
        text,
        unmodifiedText: text
      });
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        windowsVirtualKeyCode,
        key,
        code
      });
    }
    return true;
  } catch (err) {
    console.error('CDP press key failed:', err);
    return false;
  } finally {
    if (!isAttached) {
      try { dbg.detach(); } catch (e) {}
    }
  }
}

module.exports = {
  cdpClick,
  cdpType,
  cdpPressKey
};
