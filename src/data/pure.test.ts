import { describe, expect, it } from 'vitest'
import { fitWithin, jpegName, journalShareText, missingIngredients, normName } from './pure'

describe('fitWithin', () => {
  it('keeps small images as they are', () => {
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 })
    expect(fitWithin(2000, 1500)).toEqual({ width: 2000, height: 1500 })
  })
  it('scales the long side down to 2000 keeping the ratio', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000 })
    expect(fitWithin(8000, 10)).toEqual({ width: 2000, height: 3 })
  })
  it('never returns a zero side for a very thin image', () => {
    expect(fitWithin(10000, 1)).toEqual({ width: 2000, height: 1 })
  })
  it('handles empty input', () => {
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 })
  })
  it('accepts a custom limit', () => {
    expect(fitWithin(1000, 500, 500)).toEqual({ width: 500, height: 250 })
  })
})

describe('jpegName', () => {
  it('replaces the extension', () => {
    expect(jpegName('IMG_0001.HEIC')).toBe('IMG_0001.jpg')
    expect(jpegName('note.v2.png')).toBe('note.v2.jpg')
    expect(jpegName('photo')).toBe('photo.jpg')
    expect(jpegName('.png')).toBe('image.jpg')
  })
})

describe('missingIngredients', () => {
  it('ignores whitespace and case when comparing with the open list', () => {
    expect(normName(' 대파 한 단 ')).toBe('대파한단')
    expect(missingIngredients(['대파', '두 부', 'Milk', '양파'], ['두부', 'milk ', '감자'])).toEqual(['대파', '양파'])
  })
  it('drops blanks and repeats inside the ingredient list', () => {
    expect(missingIngredients(['계란', ' 계 란', '', '  '], [])).toEqual(['계란'])
  })
  it('returns nothing when everything is already there', () => {
    expect(missingIngredients(['두부'], ['두부'])).toEqual([])
  })
})

describe('journalShareText', () => {
  it('joins title, range and bullet lines', () => {
    expect(journalShareText('T', 'R', ['a', 'b'])).toBe('T\nR\n\n• a\n• b')
  })
})
