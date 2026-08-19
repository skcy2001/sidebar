import { useEffect, useRef } from 'react'
import type { Side } from '../../shared/types'

interface Props {
  side: Side
  collapsed: boolean
}

/** Outer-edge drag: live pane width via IPC (throttled to one send per animation frame). */
export function PaneResizeHandle({ side, collapsed }: Props) {
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
      // Outer edge away from ribbon: right dock → left edge of pane widens left.
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
    startWidth.current = window.innerWidth
    pendingWidth.current = window.innerWidth
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
  }

  const edgeStyle =
    side === 'right' ? ({ left: 0 } as const) : ({ right: 0 } as const)

  return (
    <div
      className="pane-outer-resize-handle"
      style={edgeStyle}
      onMouseDown={onDown}
      aria-hidden="true"
    />
  )
}
