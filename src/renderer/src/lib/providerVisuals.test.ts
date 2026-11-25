import { describe, expect, it } from 'vitest'
import {
  providerColorFor,
  providerColorMap,
  providerIconFor,
  providerLabelFor,
  providerVisual
} from './providerVisuals'

const SVG = '<svg viewBox="0 0 24 24"><path d="M2 2h20" /></svg>'

const models = [
  { key: 'glm', label: 'Z.ai · GLM', icon: SVG, color: '#fdfdfc' },
  { key: 'chatgpt', label: 'ChatGPT' },
  { key: 'kimi', label: 'Kimi', icon: 'not markup' }
]

describe('providerVisuals — one answer for every surface', () => {
  it('uses the configured colour before the brand colour', () => {
    expect(providerColorFor('glm', models)).toBe('#fdfdfc')
    // …and the brand colour when nothing is configured.
    expect(providerColorFor('chatgpt', models)).toBe('#10a37f')
    // A provider nobody configured still gets its brand colour, not a hole.
    expect(providerColorFor('claude', models)).toMatch(/^#/)
  })

  it('returns the configured SVG, sanitised, or nothing when it is not markup', () => {
    expect(providerIconFor('glm', models)).toContain('<svg')
    // "not markup" is a field someone typed; it must not reach the DOM as raw text.
    expect(providerIconFor('kimi', models)).toBeUndefined()
    expect(providerIconFor('chatgpt', models)).toBeUndefined()
  })

  it('strips executable markup on the way through', () => {
    const nasty = '<svg onload="alert(1)"><script>alert(2)</script><circle r="3" /></svg>'
    const icon = providerIconFor('x', [{ key: 'x', icon: nasty }]) ?? ''
    expect(icon).toContain('<circle')
    expect(icon).not.toContain('script')
    expect(icon.toLowerCase()).not.toContain('onload')
  })

  it('is case- and whitespace-insensitive about the provider key', () => {
    expect(providerColorFor('  GLM ', models)).toBe('#fdfdfc')
    expect(providerLabelFor('Glm', models)).toBe('Z.ai · GLM')
  })

  it('falls back to the built-in name for a provider with no label', () => {
    expect(providerLabelFor('deepseek', models)).toBe('DeepSeek')
    expect(providerLabelFor('brand-new-thing', models)).toBe('Brand-new-thing')
  })

  it('reports whether the colour was configured', () => {
    expect(providerVisual('glm', models)).toMatchObject({
      color: '#fdfdfc',
      customColor: true,
      label: 'Z.ai · GLM'
    })
    expect(providerVisual('chatgpt', models).customColor).toBe(false)
    expect(providerVisual('chatgpt', models).icon).toBeUndefined()
  })

  it('builds the map the tab components take', () => {
    expect(providerColorMap(models)).toMatchObject({ glm: '#fdfdfc', chatgpt: '#10a37f' })
    // A tab whose provider is not in the list yet must not crash the map.
    expect(providerColorMap(undefined)).toEqual({})
  })
})
