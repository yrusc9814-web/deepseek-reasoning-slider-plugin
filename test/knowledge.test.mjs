import assert from 'node:assert/strict'
import test from 'node:test'

import {
  comparisonLevels,
  displayLevels,
  matchEntry,
  sameEffortMap,
} from '../lib/knowledge.js'

const gpt56 = {
  id: 'gpt-5.6-family',
  provider: '*',
  model: 'gpt-5.6-*',
  note: 'test fixture',
  efforts: {
    off: null,
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  },
}

test('off:null participates in comparison without changing display levels', () => {
  assert.deepEqual(comparisonLevels(gpt56), ['off', 'low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(displayLevels(gpt56), ['low', 'medium', 'high', 'xhigh', 'max'])
})

test('gpt-5.6 wildcard matches luna, sol, and terra', () => {
  for (const model of ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra']) {
    assert.equal(matchEntry([gpt56], 'any-provider', model), gpt56)
  }
})

test('wire mapping errors remain detectable when level keys are unchanged', () => {
  const expected = { low: 'low', high: 'high', max: 'max' }
  assert.equal(sameEffortMap({ low: 'low', high: 'high', max: 'max' }, expected), true)
  assert.equal(sameEffortMap({ low: 'high', high: 'high', max: 'max' }, expected), false)
})

test('provider-specific match outranks provider wildcard even with a broader model pattern', () => {
  const wildcardProviderExactModel = { ...gpt56, id: 'wildcard-provider', model: 'gpt-5.6-sol' }
  const exactProviderWildcardModel = { ...gpt56, id: 'exact-provider', provider: 'private', model: 'gpt-*' }
  assert.equal(
    matchEntry([wildcardProviderExactModel, exactProviderWildcardModel], 'private', 'gpt-5.6-sol'),
    exactProviderWildcardModel,
  )
})
