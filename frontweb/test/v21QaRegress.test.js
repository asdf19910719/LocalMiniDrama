import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// QA 回归：Options API 组件中，computed/模板读取的 this._xxx 私有状态必须在 data() 中声明，
// 否则赋值为非响应式属性，computed 永不重算（QA-003/004：素材列表与已归档列表恒为空的根因）。

const viewDirs = [
  join(process.cwd(), 'src', 'views', 'productionStudio'),
  join(process.cwd(), 'src', 'views', 'productionStudio', 'studio'),
]

function collectFiles(dir, acc = []) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name)
    if (f.isDirectory()) collectFiles(p, acc)
    else if (f.name.endsWith('.vue')) acc.push(p)
  }
  return acc
}

test('生产视图内 this._x 读取均有 data() 声明（防非响应式回归）', () => {
  const problems = []
  for (const dir of viewDirs) {
    for (const file of collectFiles(dir)) {
      const src = readFileSync(file, 'utf8')
      // 跳过没有 data() 的文件
      if (!/data\(\)\s*\{/.test(src)) continue
      const declared = new Set()
      const dataMatch = src.match(/data\(\)\s*\{[\s\S]*?\n  \},/)
      if (dataMatch) {
        for (const m of dataMatch[0].matchAll(/[_$a-zA-Z][\w$]*\s*:/g)) declared.add(m[0].replace(/[\s:]/g, ''))
      }
      // 读取点：this._xxx（排除赋值左侧单独判断——赋值未声明同样有问题，因此统一要求声明）
      for (const m of src.matchAll(/this\.(_[a-zA-Z][\w$]*)/g)) {
        const key = m[1]
        if (key === '__qa') continue
        if (!declared.has(key)) {
          problems.push(`${file.replace(process.cwd(), '')}: this.${key} 未在 data() 声明`)
        }
      }
    }
  }
  assert.deepEqual(problems, [], `发现非响应式私有状态：\n${problems.join('\n')}`)
})
