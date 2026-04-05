// export.js — canvas PNG export and Web Share

const Export = (() => {
  function filename(fmt) {
    return 'BarcodePro_' + fmt + '_' + Date.now() + '.png';
  }

  async function downloadPNG(canvas, fmt) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Canvas empty')); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename(fmt);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        resolve();
      }, 'image/png');
    });
  }

  async function shareImage(canvas, fmt) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async blob => {
        if (!blob) { reject(new Error('Canvas empty')); return; }
        const file = new File([blob], filename(fmt), { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: 'BarcodePro 條碼' });
            resolve();
          } catch (e) {
            if (e.name !== 'AbortError') reject(e);
            else resolve();
          }
        } else {
          // fallback: download
          await downloadPNG(canvas, fmt);
          resolve();
        }
      }, 'image/png');
    });
  }

  return { downloadPNG, shareImage };
})();
