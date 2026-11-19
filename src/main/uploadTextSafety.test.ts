import { describe, expect, it } from 'vitest'
import { decodeBundleText } from './uploadTextSafety'

describe('binary-safe text preparation', () => {
  it('preserves valid UTF-8 including Arabic and BOM', () => {
    const input = '\ufeffالسلام عليكم\nhello\n'
    expect(decodeBundleText('file.ts', Buffer.from(input))).toBe(input)
  })
  it.each(['image.PNG', 'clip.mp4', 'doc.docx', 'sheet.xls', 'slide.pptx', 'file.pdf'])('rejects known binary extensions: %s', (name) => {
    expect(() => decodeBundleText(name, Buffer.from('looks like text'))).toThrow(/dedicated upload route/)
  })
  it('rejects unrecognized binary and invalid UTF-8', () => {
    expect(() => decodeBundleText('unknown', Buffer.from([65, 0, 66]))).toThrow()
    expect(() => decodeBundleText('unknown', Buffer.from([0xff, 0xfe]))).toThrow(/UTF-8/)
  })
  it('allows an empty text file', () => {
    expect(decodeBundleText('empty.txt', Buffer.alloc(0))).toBe('')
  })
})
