import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAutoApplyPlan,
  executeAutoApply,
  validateAutoApplyPlan,
} from '../lib/index.js'

const wildcard = {
  id: 'deepseek-v4-flash',
  provider: '*',
  model: 'deepseek-v4-flash',
  note: 'test wildcard',
  efforts: { low: 'low', high: 'high', max: 'max' },
  compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
}

const specific = {
  ...wildcard,
  id: 'deepseek-v4-flash-special',
  provider: 'special-route',
  efforts: { low: 'eco', high: 'pro', max: 'ultra' },
}

function section(providers) {
  return { providers }
}

function applyPlan(user, plan) {
  const providers = { ...user.providers }
  for (const route of plan.routes) {
    providers[route.route] = { ...providers[route.route], models: route.modelsAfter }
  }
  return { ...user, providers }
}

function mockSettings(initial, { corruptFirstWrite = false, advanceRevisionAfterFirstWrite = false } = {}) {
  let user = structuredClone(initial)
  let revision = 1
  let writes = 0
  return {
    writable: true,
    describe() {
      return [{ ns: 'llm-pi-ai', revision, user }]
    },
    async mutate(ns, ops, expectedRevision) {
      assert.equal(ns, 'llm-pi-ai')
      if (expectedRevision !== undefined) assert.equal(expectedRevision, revision)
      writes += 1
      const providers = { ...user.providers }
      for (const op of ops) {
        assert.equal(op.op, 'set')
        const [, route, field] = op.path
        assert.equal(field, 'models')
        let value = structuredClone(op.value)
        if (corruptFirstWrite && writes === 1) {
          value[0].reasoningEfforts.low = 'corrupted'
        }
        providers[route] = { ...providers[route], models: value }
      }
      user = { ...user, providers }
      revision += 1
      if (advanceRevisionAfterFirstWrite && writes === 1) revision += 1
    },
    snapshot: () => structuredClone(user),
    writes: () => writes,
  }
}

test('bare model inherits the wildcard KB effort map', () => {
  const user = section({ custom: { api: 'openai-responses', models: [{ id: 'deepseek-v4-flash' }] } })
  const plan = buildAutoApplyPlan(user, [wildcard])
  assert.ok(plan)
  assert.deepEqual(plan.routes[0].modelsAfter, [{
    id: 'deepseek-v4-flash',
    reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
  }])
  assert.equal(validateAutoApplyPlan(applyPlan(user, plan), plan), true)
})

test('the same wildcard model is filled in every arbitrary provider group', () => {
  const user = section({
    alpha: { models: [{ id: 'deepseek-v4-flash' }] },
    'my-private-group': { models: [{ id: 'deepseek-v4-flash' }] },
  })
  const plan = buildAutoApplyPlan(user, [wildcard])
  assert.ok(plan)
  assert.deepEqual(plan.appliedTo, ['alpha/deepseek-v4-flash', 'my-private-group/deepseek-v4-flash'])
  assert.equal(plan.routes.length, 2)
})

test('provider-specific KB entry takes precedence over provider wildcard', () => {
  const user = section({ 'special-route': { models: [{ id: 'deepseek-v4-flash' }] } })
  // Put the wildcard first to prove this is specificity, not array order.
  const plan = buildAutoApplyPlan(user, [wildcard, specific])
  assert.ok(plan)
  assert.deepEqual(plan.routes[0].modelsAfter[0].reasoningEfforts, specific.efforts)
})

test('explicit reasoningEfforts is never overwritten, including an empty declaration', () => {
  const explicit = { low: 'custom-low', max: 'custom-max' }
  const user = section({
    custom: {
      models: [
        { id: 'deepseek-v4-flash', reasoningEfforts: explicit },
        { id: 'deepseek-v4-flash', reasoningEfforts: {} },
        { id: 'deepseek-v4-flash', reasoningEfforts: false },
      ],
    },
  })
  assert.equal(buildAutoApplyPlan(user, [wildcard]), undefined)
  assert.deepEqual(user.providers.custom.models[0].reasoningEfforts, explicit)
})

test('unknown model leaves settings untouched', () => {
  const user = section({ custom: { models: [{ id: 'unknown-model', name: 'keep me' }] } })
  assert.equal(buildAutoApplyPlan(user, [wildcard]), undefined)
  assert.deepEqual(user, section({ custom: { models: [{ id: 'unknown-model', name: 'keep me' }] } }))
})

test('compat is added only to openai-completions and never openai-responses', () => {
  const user = section({
    completions: { api: 'openai-completions', models: [{ id: 'deepseek-v4-flash' }] },
    responses: { api: 'openai-responses', models: [{ id: 'deepseek-v4-flash' }] },
    unspecified: { models: [{ id: 'deepseek-v4-flash' }] },
  })
  const plan = buildAutoApplyPlan(user, [wildcard])
  assert.ok(plan)
  const after = applyPlan(user, plan)
  assert.deepEqual(after.providers.completions.models[0].compat, wildcard.compat)
  assert.equal(after.providers.responses.models[0].compat, undefined)
  assert.equal(after.providers.unspecified.models[0].compat, undefined)
})

test('a second startup is idempotent and produces no mutation', () => {
  const user = section({ custom: { models: [{ id: 'deepseek-v4-flash', name: 'preserved' }] } })
  const first = buildAutoApplyPlan(user, [wildcard])
  assert.ok(first)
  const after = applyPlan(user, first)
  assert.equal(buildAutoApplyPlan(after, [wildcard]), undefined)
  assert.equal(after.providers.custom.models[0].name, 'preserved')
})

test('executed auto-apply is idempotent across repeated startups', async () => {
  const initial = section({ custom: { models: [{ id: 'deepseek-v4-flash' }] } })
  const settings = mockSettings(initial)
  const store = { entries: [wildcard] }
  assert.deepEqual(await executeAutoApply(settings, store), ['custom/deepseek-v4-flash'])
  assert.deepEqual(await executeAutoApply(settings, store), [])
  assert.equal(settings.writes(), 1)
})

test('failed post-write validation rolls the changed arrays back', async () => {
  const initial = section({ custom: { models: [{ id: 'deepseek-v4-flash', name: 'original' }] } })
  const settings = mockSettings(initial, { corruptFirstWrite: true })
  await assert.rejects(
    executeAutoApply(settings, { entries: [wildcard] }),
    /original model entries were restored/u,
  )
  assert.deepEqual(settings.snapshot(), initial)
  assert.equal(settings.writes(), 2)
})

test('post-write mismatch never rolls back across a concurrent revision', async () => {
  const initial = section({ custom: { models: [{ id: 'deepseek-v4-flash' }] } })
  const settings = mockSettings(initial, {
    corruptFirstWrite: true,
    advanceRevisionAfterFirstWrite: true,
  })
  await assert.rejects(
    executeAutoApply(settings, { entries: [wildcard] }),
    /rollback skipped because the revision is no longer safe/u,
  )
  assert.equal(settings.writes(), 1)
})

test('invalid user KB effort maps are rejected and never mutate settings', async () => {
  const invalidEntries = [
    { ...wildcard, id: 'empty', efforts: {} },
    { ...wildcard, id: 'unknown-level', efforts: { turbo: 'turbo' } },
    { ...wildcard, id: 'null-non-off', efforts: { low: null } },
    { ...wildcard, id: 'empty-wire', efforts: { low: '' } },
    { ...wildcard, id: 'off-only', efforts: { off: null } },
  ]
  for (const entry of invalidEntries) {
    const initial = section({ custom: { models: [{ id: 'deepseek-v4-flash' }] } })
    const settings = mockSettings(initial)
    await assert.rejects(
      executeAutoApply(settings, { entries: [entry] }),
      /user knowledge contains an invalid entry/u,
    )
    assert.equal(settings.writes(), 0)
    assert.deepEqual(settings.snapshot(), initial)
  }

  // An invalid override must not fall through to a matching built-in entry.
  const builtinCollision = section({ custom: { models: [{ id: 'glm-5.2' }] } })
  const settings = mockSettings(builtinCollision)
  await assert.rejects(
    executeAutoApply(settings, { entries: [{ ...invalidEntries[0], model: 'glm-5.2' }] }),
    /user knowledge contains an invalid entry/u,
  )
  assert.equal(settings.writes(), 0)
  assert.deepEqual(settings.snapshot(), builtinCollision)
})

test('planner explicitly rejects invalid KB input before producing mutations', () => {
  const user = section({ custom: { models: [{ id: 'deepseek-v4-flash' }] } })
  assert.throws(
    () => buildAutoApplyPlan(user, [{ ...wildcard, efforts: { low: null } }]),
    /knowledge contains an invalid entry/u,
  )
})

test('pre/post structural validation detects malformed and partial states', () => {
  assert.throws(
    () => buildAutoApplyPlan(section({ broken: { models: {} } }), [wildcard]),
    /models must be an array/u,
  )
  const user = section({ custom: { models: [{ id: 'deepseek-v4-flash' }] } })
  const plan = buildAutoApplyPlan(user, [wildcard])
  assert.ok(plan)
  assert.equal(validateAutoApplyPlan(user, plan, 'before'), true)
  assert.equal(validateAutoApplyPlan(user, plan, 'after'), false)
  assert.equal(validateAutoApplyPlan(applyPlan(user, plan), plan, 'after'), true)
})
