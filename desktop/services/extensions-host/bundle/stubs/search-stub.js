export class RipgrepTextSearchEngine { provideTextSearchResults() { return { results: [] } } }
export class RipgrepFileSearchEngine { provideFileSearchResults() { return { results: [] } } }
export function spawnRipgrepCmd() { return { cmd: "", args: [] } }
export function spawnRipgrep() { return null }
