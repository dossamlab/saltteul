// Prepares a newsletter photo or PDF for the extractFromFile callable (browser only).
import { fitWithin, IMAGE_QUALITY, jpegName, PDF_MAX_BYTES } from './pure'

export type UploadErrorCode = 'tooLarge' | 'badType' | 'decode'

export class UploadError extends Error {
  constructor(readonly code: UploadErrorCode) {
    super(code)
  }
}

export interface UploadPayload {
  fileName: string
  mimeType: string
  dataBase64: string
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(blob)
  })
}

interface Loaded { source: CanvasImageSource; width: number; height: number; done: () => void }

async function loadImage(file: File): Promise<Loaded> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() }
  } catch {
    // Older Safari: fall back to an <img> element.
  }
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new UploadError('decode')
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
}

async function downscaleToJpeg(file: File): Promise<Blob> {
  const img = await loadImage(file)
  try {
    const size = fitWithin(img.width, img.height)
    if (!size.width || !size.height) throw new UploadError('decode')
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new UploadError('decode')
    ctx.fillStyle = '#ffffff' // transparent PNGs become white, not black
    ctx.fillRect(0, 0, size.width, size.height)
    ctx.drawImage(img.source, 0, 0, size.width, size.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', IMAGE_QUALITY))
    if (!blob) throw new UploadError('decode')
    return blob
  } finally {
    img.done()
  }
}

export async function prepareUpload(file: File): Promise<UploadPayload> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (isPdf) {
    if (file.size > PDF_MAX_BYTES) throw new UploadError('tooLarge')
    return { fileName: file.name, mimeType: 'application/pdf', dataBase64: await toBase64(file) }
  }
  if (!file.type.startsWith('image/')) throw new UploadError('badType')
  const jpeg = await downscaleToJpeg(file)
  return { fileName: jpegName(file.name), mimeType: 'image/jpeg', dataBase64: await toBase64(jpeg) }
}
