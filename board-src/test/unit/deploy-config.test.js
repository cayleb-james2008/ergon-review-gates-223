import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))
const rule = (src) => cfg.headers.find((h) => h.source === src)

test('hashed assets are immutable, the unhashed logo files are revalidated, not immutable', () => {
  assert.match(rule('/assets/(.*)').headers[0].value, /immutable/)
  const logo = rule('/rhl-logo(.*).svg')
  assert.ok(logo, 'logo cache rule present')
  const v = logo.headers[0].value
  assert.match(v, /stale-while-revalidate/)
  assert.doesNotMatch(v, /immutable/)
  // the rule pattern must match both shipped logo files
  const re = new RegExp('^' + logo.source.replace('(.*)', '.*').replace('.svg', '\\.svg') + '$')
  assert.ok(re.test('/rhl-logo.svg') && re.test('/rhl-logo-light.svg'))
})
