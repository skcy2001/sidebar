/**
 * Renders build/icon.png — the source image electron-builder converts into the
 * Windows .ico and the macOS .icns. Regenerate with `npm run icon` after changing
 * the theme. macOS icns generation requires at least 512x512.
 *
 * Hand-rolled PNG encoding so the repo needs no image dependency.
 */
import { deflateSync, crc32 } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 1024
// Geometry below is authored in 256-unit design space; S maps it onto SIZE.
const S = SIZE / 256
// Matches the palette in src/index.css.
const BG = [0x1a, 0x12, 0x10]
const PANE = [0x24, 0x1a, 0x16]
const ACCENT = [0xf3, 0xb6, 0xc8]

const root = fileURLToPath(new URL('..', import.meta.url))
const outPath = path.join(root, 'build', 'icon.png')

/** Signed distance to a rounded rect, negative inside. */
function roundedRectSdf(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius)
  const dy = Math.abs(y - cy) - (halfH - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - radius
}

/**
 * Antialiased coverage from an SDF given in design units: 1 well inside, 0 well
 * outside. Scaling to pixels here keeps the soft edge one pixel wide at any SIZE.
 */
function coverage(sdf) {
  return Math.min(1, Math.max(0, 0.5 - sdf * S))
}

function over(dst, src, alpha) {
  return [
    Math.round(src[0] * alpha + dst[0] * (1 - alpha)),
    Math.round(src[1] * alpha + dst[1] * (1 - alpha)),
    Math.round(src[2] * alpha + dst[2] * (1 - alpha)),
  ]
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
let p = 0

for (let y = 0; y < SIZE; y++) {
  raw[p++] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) {
    const px = (x + 0.5) / S
    const py = (y + 0.5) / S

    // App body: rounded square filling most of the canvas.
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

    raw[p++] = rgb[0]
    raw[p++] = rgb[1]
    raw[p++] = rgb[2]
    raw[p++] = Math.round(bodyAlpha * 255)
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData) >>> 0)
  return Buffer.concat([len, typeAndData, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // colour type: RGBA
ihdr[10] = 0 // deflate
ihdr[11] = 0 // adaptive filtering
ihdr[12] = 0 // no interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(path.dirname(outPath), { recursive: true })
writeFileSync(outPath, png)
console.log(`[icon] wrote ${outPath} (${SIZE}x${SIZE}, ${png.length} bytes)`)
