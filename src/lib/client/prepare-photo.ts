/** Make a browser-friendly, metadata-free JPEG before sending a phone photo. */
export async function preparePhoto(file: File): Promise<File> {
  let source: Blob = file;
  // Safari can decode some HEIC photos natively; use the converter only if needed.
  const decode = (blob: Blob) => new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This photo could not be opened.")); };
    image.src = url;
  });
  let image: HTMLImageElement;
  try {
    image = await decode(source);
  } catch {
    if (!/\.(heic|heif)$/i.test(file.name) && !/image\/(heic|heif)/i.test(file.type)) {
      throw new Error("Choose a JPG, PNG, WebP or iPhone photo.");
    }
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    source = Array.isArray(converted) ? converted[0] : converted;
    image = await decode(source);
  }
  const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to prepare this photo. Please try again.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!jpeg || jpeg.size > 2.8 * 1024 * 1024) throw new Error("This photo is too large. Try a smaller photo.");
  return new File([jpeg], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
}
