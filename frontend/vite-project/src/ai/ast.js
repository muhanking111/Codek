export function parseAST(code) {
    return {
        functions: [...code.matchAll(/function\s+(\w+)/g)].map(m => m[1]),
        arrows: [...code.matchAll(/const\s+(\w+)\s*=\s*\(/g)].map(m => m[1]),
        imports: [...code.matchAll(/import.*from\s+['"](.*)['"]/g)].map(m => m[1]),
        variables: [...code.matchAll(/(let|const|var)\s+(\w+)/g)].map(m => m[2]),
        lines: code.split("\n").length
    }
}