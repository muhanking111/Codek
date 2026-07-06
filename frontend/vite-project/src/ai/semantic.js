export function encode(text) {
    const vec = new Array(128).fill(0)

    const tokens = text.toLowerCase().split(/\W+/)

    for (const t of tokens) {
        let hash = 0
        for (let i = 0; i < t.length; i++) {
            hash = (hash * 31 + t.charCodeAt(i)) % 128
        }

        vec[hash] += 1
    }

    return vec
}