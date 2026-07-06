import type { PluginManifest, PluginEngineTopLevel, PluginEngineClass } from "../types"

export const goPluginManifest: PluginManifest = {
  id: "codek-go-intellisense",
  name: "codek-go",
  displayName: "Go IntelliSense",
  version: "1.1.0",
  publisher: "Codek Team",
  description: "Go language code completion with full standard library support.",
  icon: "GO",
  license: "MIT",
  keywords: ["go", "golang", "intellisense", "completion"],
  categories: ["languages"],
  language: "go",
  engines: { codek: "*" },
  activationEvents: ["onLanguage:go"],
  extensionDependencies: [],
  contributes: { languages: [{ id: "go", aliases: ["Go"], extensions: [".go"] }], snippets: {} },
  snippets: [],
  preview: false,
  size: 22 * 1024,
  engineConfig: {
    keywords: getKeywords(),
    types: getTypes(),
    topLevels: getTopLevels(),
    imports: getImports(),
    classes: getClasses() as unknown as Record<string, PluginEngineClass>,
  },
}

function getKeywords(): string[] {
  return [
    "break", "case", "chan", "const", "continue", "default", "defer",
    "else", "fallthrough", "for", "func", "go", "goto", "if",
    "import", "interface", "map", "package", "range", "return",
    "select", "struct", "switch", "type", "var",
    "nil", "true", "false", "iota",
  ]
}

function getTypes(): string[] {
  return ["bool", "byte", "complex64", "complex128", "error", "float32", "float64", "int", "int8", "int16", "int32", "int64", "rune", "string", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr"]
}

function getTopLevels(): PluginEngineTopLevel[] {
  return [
    { label: "fmt.Println", insertText: "fmt.Println(${1:args})", detail: "print line", kind: "method" },
    { label: "fmt.Printf", insertText: "fmt.Printf(\"${1:format}\", ${2:args})", detail: "formatted print", kind: "method" },
    { label: "fmt.Sprintf", insertText: "fmt.Sprintf(\"${1:format}\", ${2:args})", detail: "format string", kind: "method" },
    { label: "fmt.Errorf", insertText: "fmt.Errorf(\"${1:format}\", ${2:args})", detail: "error with format", kind: "method" },
    { label: "fmt.Scanf", insertText: "fmt.Scanf(\"${1:format}\", ${2:args})", detail: "scan formatted", kind: "method" },
    { label: "errors.New", insertText: "errors.New(\"${1:message}\")", detail: "new error", kind: "method" },
    { label: "len", insertText: "len(${1:v})", detail: "length of v", kind: "method" },
    { label: "cap", insertText: "cap(${1:v})", detail: "capacity of v", kind: "method" },
    { label: "make", insertText: "make(${1:[]T}, ${2:len})", detail: "allocate and init", kind: "method" },
    { label: "new", insertText: "new(${1:T})", detail: "allocate zero value pointer", kind: "method" },
    { label: "append", insertText: "append(${1:slice}, ${2:elems})", detail: "append to slice", kind: "method" },
    { label: "copy", insertText: "copy(${1:dst}, ${2:src})", detail: "copy slice", kind: "method" },
    { label: "close", insertText: "close(${1:ch})", detail: "close channel", kind: "method" },
    { label: "delete", insertText: "delete(${1:m}, ${2:key})", detail: "delete map entry", kind: "method" },
    { label: "panic", insertText: "panic(${1:v})", detail: "panic", kind: "method" },
    { label: "recover", insertText: "recover()", detail: "recover from panic", kind: "method" },
    { label: "print", insertText: "print(${1:args})", detail: "print (builtin)", kind: "method" },
    { label: "println", insertText: "println(${1:args})", detail: "println (builtin)", kind: "method" },
    { label: "defer", insertText: "defer ${1:func}()", detail: "defer function call", kind: "keyword" },
    { label: "go", insertText: "go ${1:func}()", detail: "start goroutine", kind: "keyword" },
    { label: "if err != nil", insertText: "if err != nil {\n\treturn ${1:err}\n}", detail: "error check", kind: "snippet" },
    { label: "func main", insertText: "func main() {\n\t${1}\n}", detail: "main function", kind: "snippet" },
    { label: "func (r Receiver)", insertText: "func (${1:r} ${2:*T}) ${3:Method}(${4:params}) ${5:returnType} {\n\t${6}\n}", detail: "method on type", kind: "snippet" },
  ]
}

function getImports(): PluginEngineTopLevel[] {
  return [
    { label: "fmt", insertText: "\"fmt\"", detail: "formatted I/O", kind: "module" },
    { label: "net/http", insertText: "\"net/http\"", detail: "HTTP client/server", kind: "module" },
    { label: "encoding/json", insertText: "\"encoding/json\"", detail: "JSON encoding", kind: "module" },
    { label: "os", insertText: "\"os\"", detail: "OS interface", kind: "module" },
    { label: "io", insertText: "\"io\"", detail: "I/O primitives", kind: "module" },
    { label: "strings", insertText: "\"strings\"", detail: "string manipulation", kind: "module" },
    { label: "strconv", insertText: "\"strconv\"", detail: "string conversions", kind: "module" },
    { label: "sync", insertText: "\"sync\"", detail: "synchronization", kind: "module" },
    { label: "context", insertText: "\"context\"", detail: "context", kind: "module" },
    { label: "time", insertText: "\"time\"", detail: "time", kind: "module" },
    { label: "errors", insertText: "\"errors\"", detail: "error handling", kind: "module" },
    { label: "sort", insertText: "\"sort\"", detail: "sorting", kind: "module" },
    { label: "math", insertText: "\"math\"", detail: "math", kind: "module" },
    { label: "bufio", insertText: "\"bufio\"", detail: "buffered I/O", kind: "module" },
    { label: "log", insertText: "\"log\"", detail: "logging", kind: "module" },
    { label: "path/filepath", insertText: "\"path/filepath\"", detail: "file path ops", kind: "module" },
    { label: "crypto/sha256", insertText: "\"crypto/sha256\"", detail: "SHA256 hash", kind: "module" },
    { label: "encoding/base64", insertText: "\"encoding/base64\"", detail: "base64", kind: "module" },
    { label: "net/url", insertText: "\"net/url\"", detail: "URL parsing", kind: "module" },
    { label: "testing", insertText: "\"testing\"", detail: "testing", kind: "module" },
  ]
}

function getClasses(): Record<string, Record<string, unknown>> {
  return {
    "strings": {
      name: "strings", detail: "strings",
      staticFields: [],
      methods: [
        { name: "Contains", params: "(s, substr)", returnType: "static bool", detail: "contains?" },
        { name: "Count", params: "(s, substr)", returnType: "static int", detail: "count occurrences" },
        { name: "HasPrefix", params: "(s, prefix)", returnType: "static bool", detail: "has prefix" },
        { name: "HasSuffix", params: "(s, suffix)", returnType: "static bool", detail: "has suffix" },
        { name: "Index", params: "(s, substr)", returnType: "static int", detail: "first index" },
        { name: "Join", params: "(elems []string, sep)", returnType: "static string", detail: "join" },
        { name: "Replace", params: "(s, old, new, n)", returnType: "static string", detail: "replace" },
        { name: "ReplaceAll", params: "(s, old, new)", returnType: "static string", detail: "replace all" },
        { name: "Split", params: "(s, sep)", returnType: "static []string", detail: "split" },
        { name: "SplitN", params: "(s, sep, n)", returnType: "static []string", detail: "split n" },
        { name: "ToLower", params: "(s)", returnType: "static string", detail: "to lower" },
        { name: "ToUpper", params: "(s)", returnType: "static string", detail: "to upper" },
        { name: "Trim", params: "(s, cutset)", returnType: "static string", detail: "trim" },
        { name: "TrimSpace", params: "(s)", returnType: "static string", detail: "trim space" },
        { name: "TrimPrefix", params: "(s, prefix)", returnType: "static string", detail: "trim prefix" },
        { name: "TrimSuffix", params: "(s, suffix)", returnType: "static string", detail: "trim suffix" },
        { name: "Fields", params: "(s)", returnType: "static []string", detail: "split by whitespace" },
        { name: "Repeat", params: "(s, count)", returnType: "static string", detail: "repeat" },
        { name: "Builder", params: "", returnType: "type", detail: "string builder" },
      ],
    },
    "strconv": {
      name: "strconv", detail: "strconv",
      methods: [
        { name: "Atoi", params: "(s)", returnType: "static (int, error)", detail: "string to int" },
        { name: "Itoa", params: "(i)", returnType: "static string", detail: "int to string" },
        { name: "ParseInt", params: "(s, base, bitSize)", returnType: "static (int64, error)", detail: "parse int" },
        { name: "ParseFloat", params: "(s, bitSize)", returnType: "static (float64, error)", detail: "parse float" },
        { name: "ParseBool", params: "(s)", returnType: "static (bool, error)", detail: "parse bool" },
        { name: "FormatInt", params: "(i, base)", returnType: "static string", detail: "format int" },
        { name: "FormatFloat", params: "(f, fmt, prec, bitSize)", returnType: "static string", detail: "format float" },
        { name: "FormatBool", params: "(b)", returnType: "static string", detail: "format bool" },
      ],
    },
    "sync": {
      name: "sync", detail: "sync",
      methods: [
        { name: "Mutex", params: "", returnType: "type", detail: "mutual exclusion lock" },
        { name: "RWMutex", params: "", returnType: "type", detail: "reader/writer mutex" },
        { name: "WaitGroup", params: "", returnType: "type", detail: "wait for goroutines" },
        { name: "Once", params: "", returnType: "type", detail: "run once" },
        { name: "Map", params: "", returnType: "type", detail: "concurrent map" },
      ],
    },
  }
}