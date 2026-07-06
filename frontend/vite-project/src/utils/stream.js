// src/utils/stream.js

export async function readStream(res, onData) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()

    let buffer = ""

    while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split("\n")
        buffer = lines.pop()

        for (const line of lines) {
            if (!line.trim()) continue

            try {
                const json = JSON.parse(line)
                const content = json.message?.content

                if (content) onData(content)
            } catch { /* JSON parse failure — ignore malformed chunks */ }
        }
    }
}