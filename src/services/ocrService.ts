export async function recognizeTextFromImage(image: Blob): Promise<string> {
  // Lazy-load to keep initial bundle small.
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('chi_sim+chi_tra+eng')

  try {
    const { data } = await worker.recognize(image)
    return data.text ?? ''
  } finally {
    await worker.terminate()
  }
}
