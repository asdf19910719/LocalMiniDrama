import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPinia, setActivePinia } from 'pinia'
import { useFilmStore } from '../src/stores/film.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

test('beginDramaLoad clears the prior episode state before installing the loading drama', () => {
  setActivePinia(createPinia())
  const store = useFilmStore()
  store.setDrama({ id: 10, episodes: [{ id: 101 }] })
  store.setCurrentEpisode({ id: 101, script_content: 'old script' })
  store.setStoryInput('old premise')
  store.setScriptContent('old script')

  assert.equal(typeof store.beginDramaLoad, 'function')
  if (typeof store.beginDramaLoad !== 'function') return

  store.beginDramaLoad(20)

  assert.deepEqual(store.drama, { id: 20 })
  assert.equal(store.currentEpisode, null)
  assert.equal(store.storyInput, '')
  assert.equal(store.scriptContent, '')
})

test('creating a project opens its detail page instead of an episode-dependent editor', () => {
  const filmList = read('src/views/FilmList.vue')
  const submitNew = filmList.slice(
    filmList.indexOf('async function submitNew'),
    filmList.indexOf('\nfunction openEditDialog'),
  )

  assert.match(submitNew, /router\.push\('\/drama\/' \+ drama\.id\)/)
  assert.doesNotMatch(submitNew, /router\.push\('\/film\/' \+ drama\.id\)/)
})

test('FilmCreate clears its selected episode and store state before loading a switched project', () => {
  const filmCreate = read('src/views/FilmCreate.vue')
  const routeLoader = filmCreate.slice(
    filmCreate.indexOf('function applyRouteToStore'),
    filmCreate.indexOf('\nonMounted', filmCreate.indexOf('function applyRouteToStore')),
  )

  const selectionReset = routeLoader.indexOf('selectedEpisodeId.value = null')
  const beginLoad = routeLoader.indexOf('store.beginDramaLoad(Number(id))')
  const fetchDrama = routeLoader.indexOf('loadDrama(')
  assert.ok(selectionReset >= 0, 'route switch must clear the selected episode')
  assert.ok(routeLoader.indexOf("storyInput.value = ''") >= 0, 'route switch must clear the local story premise')
  assert.ok(beginLoad > selectionReset, 'store loading state must follow the local selection reset')
  assert.ok(fetchDrama > beginLoad, 'network loading must start after stale episode state is cleared')
})

test('FilmCreate removes an episode query that does not belong to the loaded project', () => {
  const filmCreate = read('src/views/FilmCreate.vue')
  const loadDrama = filmCreate.slice(
    filmCreate.indexOf('async function loadDrama'),
    filmCreate.indexOf('\nconst EMPTY_ARR', filmCreate.indexOf('async function loadDrama')),
  )

  assert.match(loadDrama, /const requestedEpisode = route\.query\.episode != null/)
  assert.match(loadDrama, /list\.find\(\(e\) => Number\(e\.id\) === Number\(route\.query\.episode\)\)/)
  assert.match(loadDrama, /if \(route\.query\.episode != null && !requestedEpisode\)/)
  assert.match(loadDrama, /delete nextQuery\.episode/)
  assert.match(loadDrama, /await router\.replace\(\{ query: nextQuery \}\)\.catch\(\(\) => \{\}\)/)
})

test('FilmCreate invalidates and guards overlapping drama loads with a per-load serial', () => {
  const filmCreate = read('src/views/FilmCreate.vue')
  const loadDrama = filmCreate.slice(
    filmCreate.indexOf('async function loadDrama'),
    filmCreate.indexOf('\nconst EMPTY_ARR', filmCreate.indexOf('async function loadDrama')),
  )
  const routeLoader = filmCreate.slice(
    filmCreate.indexOf('async function applyRouteToStore'),
    filmCreate.indexOf('onMounted', filmCreate.indexOf('async function applyRouteToStore')),
  )

  assert.match(filmCreate, /let dramaLoadSerial = 0/)
  assert.match(loadDrama, /const loadSerial = \+\+dramaLoadSerial/)
  assert.match(filmCreate, /function canApplyDramaLoad\(loadingDramaId, loadSerial\)/)
  assert.ok((loadDrama.match(/canApplyDramaLoad\(loadingDramaId, loadSerial\)/g) || []).length >= 5)
  assert.match(routeLoader, /dramaLoadSerial \+= 1/)
})

test('loadStoryboardMedia guards route-scoped media assignments and selection restoration', () => {
  const filmCreate = read('src/views/FilmCreate.vue')
  const mediaLoader = filmCreate.slice(
    filmCreate.indexOf('async function loadStoryboardMedia'),
    filmCreate.indexOf('\nfunction getGeneratingSetsBag', filmCreate.indexOf('async function loadStoryboardMedia')),
  )
  const restore = filmCreate.slice(
    filmCreate.indexOf('function restoreSelectionsFromBackend'),
    filmCreate.indexOf('\n/** 获取缩略图条数据', filmCreate.indexOf('function restoreSelectionsFromBackend')),
  )

  assert.match(mediaLoader, /async function loadStoryboardMedia\(loadSerial = null, loadingDramaId = null\)/)
  assert.match(mediaLoader, /if \(loadSerial != null && !canApplyDramaLoad\(loadingDramaId, loadSerial\)\) return/)
  assert.match(mediaLoader, /await Promise\.all\([\s\S]*?\n\s*if \(loadSerial != null && !canApplyDramaLoad\(loadingDramaId, loadSerial\)\) return/)
  assert.match(mediaLoader, /restoreSelectionsFromBackend\(loadSerial, loadingDramaId\)/)
  assert.match(restore, /function restoreSelectionsFromBackend\(loadSerial = null, loadingDramaId = null\)/)
  assert.match(restore, /if \(loadSerial != null && !canApplyDramaLoad\(loadingDramaId, loadSerial\)\) return/)
})
