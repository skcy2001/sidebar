import { useEffect, useRef } from 'react'
import type { Side } from '../../shared/types'

interface Props {
  side: Side
  collapsed: boolean
}

/** Inner-edge resize (between ribbon and pane): live pane width via IPC (throttled to rAF). */
export function RibbonInnerResizeHandle({ side, collapsed }: Props) {
  const dragging = useRef(false)
  const startScreenX = useRef(0)
  const startWidth = useRef(0)
  const pendingWidth = useRef(0)
  const raf = useRef(0)

  useEffect(() => {
    const flush = () => {
      raf.current = 0
      window.sidebarApi?.tabs.setPaneWidth(pendingWidth.current)
    }

    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const dx = e.screenX - startScreenX.current
      // Inner edge: right dock → drag left widens pane; left dock → drag right widens pane.
      const newWidth =
        side === 'right' ? startWidth.current - dx : startWidth.current + dx
      pendingWidth.current = newWidth
      if (!raf.current) raf.current = requestAnimationFrame(flush)
    }

    const endDrag = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = 0
      window.sidebarApi?.tabs.setPaneWidth(pendingWidth.current)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', endDrag)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', endDrag)
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [side])

  if (collapsed) return null

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startScreenX.current = e.screenX
    // The ribbon and pane are separate windows; use last known pane width from the main process.
    // We approximate start width by reading from the pane window via layout state in main, so
    // during drag we just apply deltas from the value we last sent.
    startWidth.current = pendingWidth.current || 0
    if (!startWidth.current) {
      // Fallback: start from a reasonable default if we haven't resized yet.
      startWidth.current = 320
    }
    pendingWidth.current = startWidth.current
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
  }

  const edgeStyle =
    side === 'right' ? ({ left: 0 } as const) : ({ right: 0 } as const)

  return (
    <div
      className="ribbon-inner-resize-handle"
      style={edgeStyle}
      onMouseDown={onDown}
      aria-hidden="true"
    />
  )
}

