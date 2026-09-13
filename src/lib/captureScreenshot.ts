import html2canvas from 'html2canvas';

export async function captureScreenshot(): Promise<Blob | null> {
  try {
    const canvas = await html2canvas(document.body, { logging: false, useCORS: true });
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  } catch {
    return null;
  }
}
