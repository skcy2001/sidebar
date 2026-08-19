import { useState, useEffect, useCallback } from 'react'
import { DEFAULT_SIDE, type TabInfo, type TabAction, type Side, type PinnedSiteInfo } from '../../shared/types'

export function useTabs() {
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [pinnedSites, setPinnedSites] = useState<PinnedSiteInfo[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [side, setSide] = useState<Side>(DEFAULT_SIDE)

  useEffect(() => {
    const api = window.sidebarApi
    if (!api) return

    api.tabs.getState().then(setTabs)
    api.tabs.getPinnedSites().then(setPinnedSites)
    api.tabs.getCollapsed().then(setCollapsed)
    api.tabs.getSide().then(setSide)

    const unsub = api.tabs.onChange(setTabs)
    const unsubPinnedSites = api.tabs.onPinnedSitesChange(setPinnedSites)
    const unsubCollapsed = api.tabs.onCollapsedChange(setCollapsed)
    const unsubSide = api.tabs.onSideChange(setSide)

    return () => {
      unsub()
      unsubPinnedSites()
      unsubCollapsed()
      unsubSide()
    }
  }, [])

  const dispatch = useCallback((action: TabAction) => {
    window.sidebarApi?.tabs.dispatch(action)
  }, [])

  const activeTab = tabs.find(t => t.isActive) ?? null

  return { tabs, pinnedSites, activeTab, collapsed, side, dispatch }
}
