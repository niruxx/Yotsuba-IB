// Oekaki drawings become ordinary PNG attachments; nothing is uploaded until the post is submitted.
(() => {
  'use strict';
  const text = (key) => String(globalThis.YOTSUBA_I18N?.[key] || key).replace(/[&<>"']/g, (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]));
  const editors = new WeakMap();
  function createEditor(workbench, form) {
    workbench.innerHTML = `<div class="oekaki-tools">
      <label>${text('Brush color')} <input type="color" class="oekaki-color" value="#243653"></label>
      <label>${text('Brush size')} <input type="range" class="oekaki-size" min="1" max="40" value="6"></label>
      <label>${text('Tool')} <select class="oekaki-tool"><option value="brush">${text('Brush')}</option><option value="eraser">${text('Eraser')}</option></select></label>
      <button type="button" data-draw="undo">${text('Undo')}</button><button type="button" data-draw="redo">${text('Redo')}</button>
      <button type="button" data-draw="clear">${text('Clear canvas')}</button>
    </div><canvas width="640" height="480" tabindex="0" aria-label="Drawing canvas, 640 by 480 pixels. Draw with a mouse, pen or touch. Control Z undoes a stroke."></canvas>
    <div class="oekaki-tools"><button type="button" data-draw="attach">${text('Attach drawing to post')}</button><button type="button" data-draw="download">${text('Download PNG')}</button><button type="button" data-draw="close">${text('Hide drawing tools')}</button></div>
    <p class="oekaki-status" role="status">Draw with a mouse, pen or touch, then attach your artwork. Existing selected files are kept.</p>`;
    const canvas = workbench.querySelector('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const status = workbench.querySelector('.oekaki-status');
    const undo = [], redo = [];
    let pointer = null, dirty = false;
    const white = () => { context.save(); context.globalCompositeOperation = 'source-over'; context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.restore(); };
    white();
    const snapshot = () => context.getImageData(0, 0, canvas.width, canvas.height);
    const update = () => {
      workbench.querySelector('[data-draw="undo"]').disabled = !undo.length;
      workbench.querySelector('[data-draw="redo"]').disabled = !redo.length;
    };
    const remember = () => { undo.push(snapshot()); if (undo.length > 8) undo.shift(); redo.length = 0; dirty = true; update(); };
    const point = (event) => {
      const bounds = canvas.getBoundingClientRect();
      return { x: (event.clientX - bounds.left) * canvas.width / bounds.width, y: (event.clientY - bounds.top) * canvas.height / bounds.height };
    };
    canvas.addEventListener('pointerdown', (event) => {
      if (pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault(); canvas.focus(); remember();
      pointer = event.pointerId; canvas.setPointerCapture(pointer);
      const start = point(event);
      context.globalCompositeOperation = workbench.querySelector('.oekaki-tool').value === 'eraser' ? 'destination-out' : 'source-over';
      context.strokeStyle = workbench.querySelector('.oekaki-color').value;
      context.lineWidth = Number(workbench.querySelector('.oekaki-size').value);
      context.lineCap = 'round'; context.lineJoin = 'round'; context.beginPath(); context.moveTo(start.x, start.y); context.lineTo(start.x + .01, start.y); context.stroke();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointer) return;
      event.preventDefault(); const current = point(event); context.lineTo(current.x, current.y); context.stroke();
    });
    const stop = (event) => { if (event.pointerId === pointer) { pointer = null; context.closePath(); } };
    canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop); canvas.addEventListener('lostpointercapture', stop);
    const history = (backwards) => {
      const from = backwards ? undo : redo, to = backwards ? redo : undo;
      if (!from.length || pointer !== null) return;
      to.push(snapshot()); context.putImageData(from.pop(), 0, 0); dirty = true; update();
    };
    canvas.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); history(!event.shiftKey); }
    });
    const blob = () => new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Unable to export drawing.')), 'image/png'));
    workbench.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-draw]');
      if (!button || pointer !== null) return;
      const action = button.dataset.draw;
      if (action === 'undo' || action === 'redo') { history(action === 'undo'); return; }
      if (action === 'clear') { remember(); white(); status.textContent = 'Canvas cleared. Use Undo to restore it.'; return; }
      if (action === 'close') { workbench.hidden = true; form.querySelector('.oekaki-open')?.focus(); return; }
      if (!['attach', 'download'].includes(action)) return;
      button.disabled = true;
      try {
        if (!dirty && action === 'attach') throw new Error('Draw something before attaching the canvas.');
        const image = await blob();
        if (action === 'download') {
          const url = URL.createObjectURL(image), link = document.createElement('a');
          link.href = url; link.download = 'drawing.png'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          status.textContent = 'Drawing downloaded as PNG.';
        } else {
          const input = form.querySelector('input[type="file"][name="file"]');
          const maximum = Number(form.dataset.maxFiles) || 4;
          if (!input) throw new Error('This board does not accept image uploads.');
          if (input.files.length >= maximum) throw new Error(`This post already has ${maximum} files. Remove a selected file first, or download the drawing.`);
          if (typeof DataTransfer !== 'function') throw new Error('Your browser cannot attach drawings directly. Download the PNG and select it using the file picker.');
          const transfer = new DataTransfer();
          for (const file of input.files) transfer.items.add(file);
          transfer.items.add(new File([image], `drawing-${Date.now()}.png`, { type: 'image/png' }));
          input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
          status.textContent = `Drawing attached. ${input.files.length} of ${maximum} files selected. Submit the post when you are ready.`;
        }
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    });
    update(); return { canvas };
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('.oekaki-open');
    if (!button) return;
    const form = button.closest('form'), workbench = form.querySelector('.oekaki-workbench');
    workbench.hidden = false;
    if (!editors.has(workbench)) editors.set(workbench, createEditor(workbench, form));
    editors.get(workbench).canvas.focus();
  });
})();
