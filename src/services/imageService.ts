export async function compressImage(file: File, maxWidth = 2000, quality = 0.86): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const targetWidth = Math.min(bitmap.width, maxWidth)
  const targetHeight = Math.max(1, Math.round((bitmap.height * targetWidth) / bitmap.width))

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('图片处理失败：无法创建画布上下文')
  }

  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality)
  })

  if (!blob) {
    throw new Error('图片压缩失败')
  }

  return blob
}

export function toObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob)
}
