/**
 * Renders the app's icons from one palette:
 *
 * - build/icon.png (1024x1024): electron-builder converts it into the Windows
 *   .ico and the macOS .icns. macOS icns generation requires at least 512x512.
 * - electron/trayIconData.ts: the system tray glyph at 1x, 1.5x and 2x, embedded
 *   as base64 so it compiles into the main process and ships without any
 *   packaging rules.
 *
 * Regenerate with `npm run icon` after changing the theme.
 *
 * Hand-rolled PNG encoding so the repo needs no image dependency.
 */
import { deflateSync, crc32 } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Matches the palette in src/index.css.
const BG = [0x1a, 0x12, 0x10]
const PANE = [0x24, 0x1a, 0x16]
const ACCENT = [0xf3, 0xb6, 0xc8]

const root = fileURLToPath(new URL('..', import.meta.url))

/** Signed distance to a rounded rect, negative inside. */
function roundedRectSdf(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius)
  const dy = Math.abs(y - cy) - (halfH - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - radius
}

function over(dst, src, alpha) {
  return [
    Math.round(src[0] * alpha + dst[0] * (1 - alpha)),
    Math.round(src[1] * alpha + dst[1] * (1 - alpha)),
    Math.round(src[2] * alpha + dst[2] * (1 - alpha)),
  ]
}

/** The full app icon: dark body, content pane, and the pink docked ribbon. */
function appIcon(px, py, coverage) {
  const bodyAlpha = coverage(roundedRectSdf(px, py, 128, 128, 116, 116, 34))
  let rgb = BG

  // Content pane on the left, inset.
  const paneAlpha = coverage(roundedRectSdf(px, py, 104, 128, 76, 88, 12))
  rgb = over(rgb, PANE, paneAlpha)

  // Docked ribbon on the right — the app's defining shape.
  const ribbonAlpha = coverage(roundedRectSdf(px, py, 196, 128, 24, 88, 12))
  rgb = over(rgb, ACCENT, ribbonAlpha)

  // Three tab dots down the ribbon.
  let dots = 0
  for (const cy of [92, 128, 164]) {
    dots = Math.max(dots, coverage(Math.hypot(px - 196, py - cy) - 7))
  }
  rgb = over(rgb, BG, dots * ribbonAlpha)

  return [...rgb, bodyAlpha]
}

/**
 * The tray glyph. At 16px the app icon's pane and dots turn to mush, so this is
 * the same idea reduced to what survives: a dark tile (visible on a light
 * taskbar) with a pink frame and docked column (visible on a dark one).
 */
function trayGlyph(px, py, coverage) {
  const tile = roundedRectSdf(px, py, 128, 128, 108, 108, 40)
  const tileAlpha = coverage(tile)
  let rgb = BG

  // Frame band just inside the tile edge; at 16px this is ~1.4px wide.
  const STROKE = 22
  rgb = over(rgb, ACCENT, coverage(Math.abs(tile + STROKE / 2) - STROKE / 2))

  // Filled column meeting the frame's inner edges: the docked sidebar.
  rgb = over(rgb, ACCENT, coverage(roundedRectSdf(px, py, 184, 128, 30, 86, 10)))

  return [...rgb, tileAlpha]
}

/**
 * Rasterises `shade` onto a size x size RGBA canvas. Geometry is authored in a
 * 256-unit design space; coverage converts design-unit SDFs to pixels so the
 * antialiased edge stays one pixel wide at any output size.
 */
function render(size, shade) {
  const scale = size / 256
  const coverage = sdf => Math.min(1, Math.max(0, 0.5 - sdf * scale))

  const raw = Buffer.alloc(size * (size * 4 + 1))
  let p = 0
  for (let y = 0; y < size; y++) {
    raw[p++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = shade((x + 0.5) / scale, (y + 0.5) / scale, coverage)
      raw[p++] = r
      raw[p++] = g
      raw[p++] = b
      raw[p++] = Math.round(a * 255)
    }
  }
  return encodePng(size, raw)
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData) >>> 0)
  return Buffer.concat([len, typeAndData, crc])
}

function encodePng(size, raw) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- App icon ----

const ICON_SIZE = 1024
const iconPath = path.join(root, 'build', 'icon.png')
const icon = render(ICON_SIZE, appIcon)
mkdirSync(path.dirname(iconPath), { recursive: true })
writeFileSync(iconPath, icon)
console.log(`[icon] wrote ${iconPath} (${ICON_SIZE}x${ICON_SIZE}, ${icon.length} bytes)`)

// ---- Tray glyph ----

// Windows sizes tray icons at 16px per 100% of display scaling.
const TRAY_BASE_SIZE = 16
const TRAY_SCALES = [1, 1.5, 2]
const trayPath = path.join(root, 'electron', 'trayIconData.ts')

const trayEntries = TRAY_SCALES.map(scaleFactor => {
  const size = TRAY_BASE_SIZE * scaleFactor
  const png = render(size, trayGlyph)
  console.log(`[icon] tray ${size}x${size} @${scaleFactor}x (${png.length} bytes)`)
  return `  { scaleFactor: ${scaleFactor}, dataURL: 'data:image/png;base64,${png.toString('base64')}' },`
})

writeFileSync(
  trayPath,
  [
    '// Generated by scripts/generate-icon.mjs. Do not edit by hand; run `npm run icon`.',
    '',
    'export const TRAY_ICON_PNGS: ReadonlyArray<{ scaleFactor: number; dataURL: string }> = [',
    ...trayEntries,
    ']',
    '',
  ].join('\n'),
)
console.log(`[icon] wrote ${trayPath}`)
