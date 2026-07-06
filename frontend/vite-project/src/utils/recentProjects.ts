interface RecentProject {
  name: string
  path: string
}

const RECENT_KEY = 'codek.recentProjects'
const MAX_RECENT = 8

function loadRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item: unknown): item is RecentProject =>
        typeof item === 'object' && item !== null && typeof (item as RecentProject).name === 'string' && typeof (item as RecentProject).path === 'string'
      )
      .slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

function addRecentProject(name: string, path: string): void {
  const projects = loadRecentProjects()
  const filtered = projects.filter((p) => p.path !== path)
  filtered.unshift({ name, path })
  const sliced = filtered.slice(0, MAX_RECENT)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(sliced))
  } catch {
    // ignore
  }
}

function getRecentProjects(): RecentProject[] {
  return loadRecentProjects()
}

export type { RecentProject }
export { addRecentProject, getRecentProjects, MAX_RECENT }
