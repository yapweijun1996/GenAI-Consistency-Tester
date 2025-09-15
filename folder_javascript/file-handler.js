import { formatBytes } from './utils.js';

const MAX_SIZE_KB = 100;

async function compressImage(file, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('Canvas to Blob failed'));

        const compressedFile = new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() });

        if (compressedFile.size > MAX_SIZE_KB * 1024 && quality > 0.1) {
          resolve(await compressImage(file, quality - 0.1));
        } else {
          resolve(compressedFile);
        }
      }, 'image/jpeg', quality);
    };
    img.onerror = reject;
  });
}

async function handlePdfFile(file) {
  const loadingTask = pdfjsLib.getDocument(URL.createObjectURL(file));
  const pdf = await loadingTask.promise;
  const newFiles = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport: viewport }).promise;
    
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
    const newFile = new File([blob], `${file.name}-p${i}.jpg`, { type: 'image/jpeg' });
    newFiles.push(newFile);
  }
  return newFiles;
}

export async function processFiles(files, uploadedFiles, statusEl) {
  statusEl.textContent = 'Processing files...';

  const MAX_FILES = 16;

  for (let file of files) {
    if (uploadedFiles.length >= MAX_FILES) {
      alert(`You can only upload a maximum of ${MAX_FILES} files.`);
      break;
    }

    let filesToAdd = [];
    if (file.type === 'application/pdf') {
      try {
        filesToAdd = await handlePdfFile(file);
      } catch (err) {
        console.error("PDF processing failed:", err);
        alert(`Failed to process PDF: ${file.name}`);
      }
    } else {
      filesToAdd.push(file);
    }

    for (let f of filesToAdd) {
      if (f.size > MAX_SIZE_KB * 1024) {
        try {
          const compressedFile = await compressImage(f);
          if (compressedFile.size < f.size) {
            compressedFile.compressed = true;
            uploadedFiles.push(compressedFile);
          } else {
            uploadedFiles.push(f);
          }
        } catch (err) {
          console.error("Compression failed:", err);
          uploadedFiles.push(f);
        }
      } else {
        uploadedFiles.push(f);
      }
    }
  }
  
  statusEl.textContent = 'Idle.';
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result.split(',')[1]);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

export async function filesToInlineParts(fileList) {
  const files = Array.from(fileList || []);
  const parts = [];
  for (const f of files) {
    const b64 = await fileToBase64(f);
    parts.push({ inline_data: { mime_type: f.type || 'application/octet-stream', data: b64 } });
  }
  return parts;
}