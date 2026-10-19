#!/usr/bin/env node
// Fails if any file under src/ other than src/renderer/src/theme/tokens.css contains a
// color literal. Colors must come from var(--token) or the token-mapped Tailwind utilities.
// `transparent`, `currentColor` and `inherit` are allowed.
//
// CSS files: hex (#fff, #e0622a, #rrggbbaa), rgb()/rgba()/hsl()/hsla()/hwb()/lab()/lch()/
//   oklab()/oklch()/color(), or a CSS named color (white, black, red, ...) in a declaration.
// TS/TSX files (class strings, inline styles, SVG attributes): hex literals, color
//   functions, Tailwind arbitrary colors such as bg-[#e0622a] or text-[rgb(0_0_0)], and
//   Tailwind default-palette classes such as bg-white or text-red-500.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const srcDir = join(root, 'src')
const allowed = new Set([join(srcDir, 'renderer', 'src', 'theme', 'tokens.css')])

const NAMED = `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson
cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray
darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick
floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey
honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon
lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink
lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow
lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple
mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue
mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen
seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal
thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(/\s+/)

const HEX = /#[0-9a-fA-F]{3,8}\b/g
const FUNC = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/gi
const NAMED_RE = new RegExp(`(?<![-\\w.#'"])(?:${NAMED.join('|')})(?![-\\w(])`, 'gi')

const PALETTE = `slate gray zinc neutral stone red orange amber yellow lime green emerald teal cyan
sky blue indigo violet purple fuchsia pink rose white black`.split(/\s+/)
const TW_PREFIX =
  'bg|text|border(?:-[xytrblse])?|fill|stroke|outline|ring|ring-offset|from|via|to|decoration|shadow|accent|caret|divide|placeholder'
// Matches e.g. bg-[#fff], text-[rgb(1_2_3)], border-[color:red], fill-[hsl(...)].
const TW_ARBITRARY = new RegExp(
  `(?:^|[\\s"'\`:])(?:${TW_PREFIX})-\\[(?:color:)?(?:#|rgba?\\(|hsla?\\(|oklch\\(|oklab\\(|(?:${NAMED.join('|')})\\])`,
  'gi'
)
const TW_PALETTE = new RegExp(
  `(?:^|[\\s"'\`:])(?:${TW_PREFIX})-(?:${PALETTE.join('|')})(?:-\\d{2,3})?(?:\\/\\d+)?(?=$|[\\s"'\`])`,
  'g'
)

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(css|scss|less|ts|tsx|mts|cts|js|jsx|mjs|html|svg)$/.test(name)) out.push(full)
  }
  return out
}

/** Strip block comments and whole-line // comments, preserving line breaks. */
function stripScriptComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, (m) => ' '.repeat(m.length))
}

function checkScript(file, report) {
  const lines = stripScriptComments(readFileSync(file, 'utf8')).split('\n')
  lines.forEach((line, i) => {
    const hits = [
      ...line.matchAll(HEX),
      ...line.matchAll(FUNC),
      ...line.matchAll(TW_ARBITRARY),
      ...line.matchAll(TW_PALETTE)
    ].map((m) => m[0].trim())
    for (const hit of hits) report(file, i + 1, hit)
  })
}

/** Strip comments and string contents, preserving line breaks for line numbers. */
function sanitize(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(['"])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => m[0] + ' '.repeat(m.length - 2) + m[0])
}

const problems = []
const report = (file, line, hit) =>
  problems.push(`${relative(root, file).split(sep).join('/')}:${line}  color literal "${hit}"`)

for (const file of walk(srcDir)) {
  if (allowed.has(file)) continue
  if (!/\.(css|scss|less)$/.test(file)) {
    checkScript(file, report)
    continue
  }
  const lines = sanitize(readFileSync(file, 'utf8')).split('\n')
  lines.forEach((line, i) => {
    // Only check declaration values (after the first colon), not selectors.
    const colon = line.indexOf(':')
    const isDecl = colon !== -1 && !/[{,]\s*$/.test(line) && !/^\s*[.#&:[@]/.test(line)
    const value = isDecl ? line.slice(colon + 1) : ''
    const hits = [...value.matchAll(HEX), ...value.matchAll(FUNC), ...value.matchAll(NAMED_RE)].map(
      (m) => m[0]
    )
    for (const hit of hits) report(file, i + 1, hit)
  })
}

if (problems.length > 0) {
  console.error('lint:colors: hardcoded colors found (use var(--token) from tokens.css):\n')
  for (const p of problems) console.error('  ' + p)
  console.error(`\n${problems.length} problem(s)`)
  process.exit(1)
}
console.log('lint:colors: OK (no color literals in src/ outside src/renderer/src/theme/tokens.css)')
