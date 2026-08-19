import type { SidebarApi } from '../shared/api'

declare global {
  interface Window {
    sidebarApi: SidebarApi
  }
}
