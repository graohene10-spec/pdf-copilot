import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MANIFOLDS, MANIFOLD_IDS, THEOREMS, buildMesh, nextManifold } from '../src/sketch/manifolds.ts'
import { defaultPreferences, normalizePreferences, preferenceErrors } from '../src/settings/model.ts'

test('every manifold builds a finite wireframe that fits around the unit sphere', () => {
  for (const manifold of MANIFOLDS) {
    const mesh = buildMesh(manifold)
    assert.equal(mesh.lines.length, mesh.closed.length)
    let max = 0
    for (let k = 0; k < mesh.points.length; k += 3) {
      assert.ok(Number.isFinite(mesh.points[k]) && Number.isFinite(mesh.points[k + 1]) && Number.isFinite(mesh.points[k + 2]), manifold.id)
      max = Math.max(max, Math.hypot(mesh.points[k], mesh.points[k + 1], mesh.points[k + 2]))
    }
    assert.ok(max >= .99 && max < 1.6, `${manifold.id} radius ${max}`)
    for (const line of mesh.lines) for (const index of line) assert.ok(index < mesh.points.length / 3)
    // 参数函数与网格一致：曲面或曲线至少有一种，用来在流形上画切平面等示意。
    assert.ok(mesh.surface.length + mesh.curves.length > 0, manifold.id)
    for (const [k, f] of mesh.surface.entries()) { const { u, v } = mesh.domains[k]; assert.ok(f((u[0] + u[1]) / 2, (v[0] + v[1]) / 2).every(Number.isFinite), manifold.id) }
  }
})

test('theorems: a mix of statements, several drawn on the manifold', () => {
  assert.ok(THEOREMS.length >= 20)
  const drawn = new Set(THEOREMS.filter(item => item.visual).map(item => item.visual))
  for (const visual of ['tangent', 'basis', 'normal', 'metric', 'chart', 'stokes', 'field', 'curve']) assert.ok(drawn.has(visual), visual)
})

test('the next manifold differs from the current one when there is a choice', () => {
  assert.equal(nextManifold(['klein'], 'klein'), 'klein')
  for (let k = 0; k < 20; k++) assert.notEqual(nextManifold(['klein', 'boy'], 'klein'), 'klein')
  assert.equal(nextManifold(['nope'], undefined), undefined)
})

test('manifold preferences: shown in the library, hidden while reading, all shapes by default; at least one shape kept', () => {
  assert.deepEqual(defaultPreferences().appearance.manifold, { show: true, reader: false, shapes: MANIFOLD_IDS })
  const custom = normalizePreferences({ appearance: { manifold: { show: false, reader: true, shapes: ['klein', 'boy', 'boy', 'sphere'] } } })
  assert.deepEqual(custom.appearance.manifold, { show: false, reader: true, shapes: ['klein', 'boy'] })
  assert.deepEqual(normalizePreferences({ appearance: { manifold: { shapes: ['sphere'] } } }).appearance.manifold.shapes, MANIFOLD_IDS)
  assert.deepEqual(preferenceErrors(custom), [])
  assert.ok(preferenceErrors({ ...custom, appearance: { ...custom.appearance, manifold: { show: true, reader: false, shapes: [] } } }).includes('请至少选择一种流形。'))
})

test('neural networks build finite graphs and rotate with the manifolds; every note is in English', async () => {
  const { NETWORKS, ML_FACTS } = await import('../src/sketch/networks.ts')
  const { SCENES } = await import('../src/sketch/manifolds.ts')
  assert.deepEqual(SCENES.map(item => item.id), [...MANIFOLDS.map(item => item.id), ...NETWORKS.map(item => item.id)])
  assert.deepEqual(MANIFOLD_IDS, SCENES.map(item => item.id))
  for (const network of NETWORKS) {
    const graph = network.build()
    const count = graph.nodes.length / 3
    assert.ok(graph.nodes.every(Number.isFinite), network.id)
    assert.equal(graph.edges.length / 2, graph.stage.length)
    assert.equal(graph.bend.length, graph.stage.length)
    for (const index of graph.edges) assert.ok(index < count, network.id)
    for (const stage of graph.stage) assert.ok(stage < graph.stages, network.id)
    let max = 0
    for (let k = 0; k < graph.nodes.length; k += 3) max = Math.max(max, Math.hypot(graph.nodes[k], graph.nodes[k + 1], graph.nodes[k + 2]))
    assert.ok(max > .99 && max < 1.01, `${network.id} radius ${max}`)
  }
  assert.ok(NETWORKS.find(item => item.id === 'transformer').build().attention)
  assert.ok(NETWORKS.find(item => item.id === 'cnn').build().kernel.outputs.every(patch => patch.length === 9))
  const texts = [...THEOREMS.map(item => item.text), ...MANIFOLDS.flatMap(item => item.facts), ...NETWORKS.flatMap(item => item.facts), ...ML_FACTS]
  for (const text of texts) assert.ok(!/[一-鿿]/.test(text), text)
})
