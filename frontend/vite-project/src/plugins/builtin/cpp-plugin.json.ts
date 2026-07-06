import type { PluginManifest, PluginEngineTopLevel, PluginEngineClass } from "../types"

export const cppPluginManifest: PluginManifest = {
  id: "codek-cpp-intellisense",
  name: "codek-cpp",
  displayName: "C/C++ IntelliSense",
  version: "1.0.1",
  publisher: "Codek Team",
  description: "C/C++ code completion with STL and standard library support.",
  icon: "CP",
  license: "MIT",
  keywords: ["c", "cpp", "c++", "intellisense", "completion"],
  categories: ["languages"],
  language: "cpp",
  engines: { codek: "*" },
  activationEvents: ["onLanguage:c", "onLanguage:cpp"],
  extensionDependencies: [],
  contributes: {
    languages: [
      { id: "c", aliases: ["C"], extensions: [".c", ".h"] },
      { id: "cpp", aliases: ["C++", "CPP"], extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hxx"] },
    ],
    snippets: {},
  },
  snippets: [],
  preview: false,
  size: 24 * 1024,
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
    "auto", "break", "case", "catch", "class", "const", "constexpr",
    "continue", "default", "delete", "do", "else", "enum", "explicit",
    "extern", "for", "friend", "goto", "if", "inline", "namespace",
    "new", "noexcept", "operator", "override", "private", "protected",
    "public", "return", "sizeof", "static", "struct", "switch",
    "template", "this", "throw", "try", "typedef", "typeid",
    "typename", "union", "using", "virtual", "void", "volatile",
    "while", "nullptr", "true", "false",
  ]
}

function getTypes(): string[] {
  return ["bool", "char", "wchar_t", "short", "int", "long", "float", "double", "size_t", "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t"]
}

function getTopLevels(): PluginEngineTopLevel[] {
  return [
    { label: "std::cout", insertText: "std::cout << ${1:value}", detail: "standard output", kind: "method" },
    { label: "std::cin", insertText: "std::cin >> ${1:var}", detail: "standard input", kind: "method" },
    { label: "std::cerr", insertText: "std::cerr << ${1:error}", detail: "standard error", kind: "method" },
    { label: "std::endl", insertText: "std::endl", detail: "newline + flush", kind: "method" },
    { label: "std::vector", insertText: "std::vector<${1:T}>", detail: "dynamic array", kind: "class" },
    { label: "std::string", insertText: "std::string", detail: "string", kind: "class" },
    { label: "std::map", insertText: "std::map<${1:K}, ${2:V}>", detail: "ordered map", kind: "class" },
    { label: "std::unordered_map", insertText: "std::unordered_map<${1:K}, ${2:V}>", detail: "hash map", kind: "class" },
    { label: "std::set", insertText: "std::set<${1:T}>", detail: "ordered set", kind: "class" },
    { label: "std::queue", insertText: "std::queue<${1:T}>", detail: "queue", kind: "class" },
    { label: "std::stack", insertText: "std::stack<${1:T}>", detail: "stack", kind: "class" },
    { label: "std::pair", insertText: "std::pair<${1:T1}, ${2:T2}>", detail: "pair", kind: "class" },
    { label: "std::shared_ptr", insertText: "std::shared_ptr<${1:T}>", detail: "shared pointer", kind: "class" },
    { label: "std::unique_ptr", insertText: "std::unique_ptr<${1:T}>", detail: "unique pointer", kind: "class" },
    { label: "std::make_shared", insertText: "std::make_shared<${1:T}>(${2:args})", detail: "make shared", kind: "method" },
    { label: "std::make_unique", insertText: "std::make_unique<${1:T}>(${2:args})", detail: "make unique", kind: "method" },
    { label: "std::move", insertText: "std::move(${1:val})", detail: "move", kind: "method" },
    { label: "std::forward", insertText: "std::forward<${1:T}>(${2:val})", detail: "forward", kind: "method" },
    { label: "printf", insertText: "printf(\"${1:format}\", ${2:args})", detail: "C formatted print", kind: "method" },
    { label: "scanf", insertText: "scanf(\"${1:format}\", ${2:args})", detail: "C formatted scan", kind: "method" },
    { label: "malloc", insertText: "malloc(${1:size})", detail: "C allocate", kind: "method" },
    { label: "free", insertText: "free(${1:ptr})", detail: "C free", kind: "method" },
    { label: "sizeof", insertText: "sizeof(${1:T})", detail: "size of type", kind: "keyword" },
    { label: "int main", insertText: "int main(int argc, char* argv[]) {\n\t${1}\n\treturn 0;\n}", detail: "main function", kind: "snippet" },
  ]
}

function getImports(): PluginEngineTopLevel[] {
  return [
    { label: "#include <iostream>", insertText: "#include <iostream>", detail: "I/O streams", kind: "module" },
    { label: "#include <vector>", insertText: "#include <vector>", detail: "vector container", kind: "module" },
    { label: "#include <string>", insertText: "#include <string>", detail: "std::string", kind: "module" },
    { label: "#include <map>", insertText: "#include <map>", detail: "map container", kind: "module" },
    { label: "#include <set>", insertText: "#include <set>", detail: "set container", kind: "module" },
    { label: "#include <algorithm>", insertText: "#include <algorithm>", detail: "algorithms", kind: "module" },
    { label: "#include <memory>", insertText: "#include <memory>", detail: "smart pointers", kind: "module" },
    { label: "#include <fstream>", insertText: "#include <fstream>", detail: "file streams", kind: "module" },
    { label: "#include <sstream>", insertText: "#include <sstream>", detail: "string streams", kind: "module" },
    { label: "#include <thread>", insertText: "#include <thread>", detail: "threading", kind: "module" },
    { label: "#include <mutex>", insertText: "#include <mutex>", detail: "mutex", kind: "module" },
    { label: "#include <queue>", insertText: "#include <queue>", detail: "queue/stack", kind: "module" },
    { label: "#include <cmath>", insertText: "#include <cmath>", detail: "math functions", kind: "module" },
    { label: "#include <cstdio>", insertText: "#include <cstdio>", detail: "C stdio", kind: "module" },
    { label: "#include <cstdlib>", insertText: "#include <cstdlib>", detail: "C stdlib", kind: "module" },
    { label: "#include <cstring>", insertText: "#include <cstring>", detail: "C string", kind: "module" },
    { label: "#include <unordered_map>", insertText: "#include <unordered_map>", detail: "hash map", kind: "module" },
    { label: "#include <unordered_set>", insertText: "#include <unordered_set>", detail: "hash set", kind: "module" },
    { label: "#include <functional>", insertText: "#include <functional>", detail: "std::function", kind: "module" },
    { label: "#include <chrono>", insertText: "#include <chrono>", detail: "time", kind: "module" },
  ]
}

function getClasses(): Record<string, Record<string, unknown>> {
  return {
    "std::vector": {
      name: "std::vector<T>", detail: "Dynamic array",
      methods: [
        { name: "push_back", params: "(T)", returnType: "void", detail: "add to end" },
        { name: "pop_back", params: "()", returnType: "void", detail: "remove last" },
        { name: "size", params: "()", returnType: "size_t", detail: "size" },
        { name: "empty", params: "()", returnType: "bool", detail: "is empty" },
        { name: "clear", params: "()", returnType: "void", detail: "clear" },
        { name: "at", params: "(size_t)", returnType: "T&", detail: "element at" },
        { name: "front", params: "()", returnType: "T&", detail: "first" },
        { name: "back", params: "()", returnType: "T&", detail: "last" },
        { name: "begin", params: "()", returnType: "iterator", detail: "begin iterator" },
        { name: "end", params: "()", returnType: "iterator", detail: "end iterator" },
        { name: "insert", params: "(iterator, T)", returnType: "iterator", detail: "insert" },
        { name: "erase", params: "(iterator)", returnType: "iterator", detail: "erase" },
        { name: "reserve", params: "(size_t)", returnType: "void", detail: "reserve capacity" },
      ],
    },
    "std::string": {
      name: "std::string", detail: "String",
      methods: [
        { name: "size", params: "()", returnType: "size_t", detail: "size" },
        { name: "length", params: "()", returnType: "size_t", detail: "length" },
        { name: "empty", params: "()", returnType: "bool", detail: "is empty" },
        { name: "clear", params: "()", returnType: "void", detail: "clear" },
        { name: "substr", params: "(size_t, size_t)", returnType: "string", detail: "substring" },
        { name: "find", params: "(string)", returnType: "size_t", detail: "find" },
        { name: "append", params: "(string)", returnType: "string&", detail: "append" },
        { name: "c_str", params: "()", returnType: "const char*", detail: "C string" },
        { name: "compare", params: "(string)", returnType: "int", detail: "compare" },
        { name: "replace", params: "(size_t, size_t, string)", returnType: "string&", detail: "replace" },
      ],
    },
    "std::map": {
      name: "std::map<K,V>", detail: "Ordered map",
      methods: [
        { name: "size", params: "()", returnType: "size_t", detail: "size" },
        { name: "empty", params: "()", returnType: "bool", detail: "is empty" },
        { name: "clear", params: "()", returnType: "void", detail: "clear" },
        { name: "insert", params: "(pair<K,V>)", returnType: "pair<iterator,bool>", detail: "insert" },
        { name: "erase", params: "(K)", returnType: "size_t", detail: "erase" },
        { name: "find", params: "(K)", returnType: "iterator", detail: "find" },
        { name: "contains", params: "(K)", returnType: "bool", detail: "contains (C++20)" },
        { name: "count", params: "(K)", returnType: "size_t", detail: "count" },
        { name: "begin", params: "()", returnType: "iterator", detail: "begin" },
        { name: "end", params: "()", returnType: "iterator", detail: "end" },
      ],
    },
    "std::set": {
      name: "std::set<T>", detail: "Ordered set",
      methods: [
        { name: "insert", params: "(T)", returnType: "pair<iterator,bool>", detail: "insert" },
        { name: "erase", params: "(T)", returnType: "size_t", detail: "erase" },
        { name: "find", params: "(T)", returnType: "iterator", detail: "find" },
        { name: "contains", params: "(T)", returnType: "bool", detail: "contains (C++20)" },
        { name: "size", params: "()", returnType: "size_t", detail: "size" },
        { name: "empty", params: "()", returnType: "bool", detail: "is empty" },
        { name: "clear", params: "()", returnType: "void", detail: "clear" },
      ],
    },
    "std::queue": {
      name: "std::queue<T>", detail: "FIFO queue",
      methods: [
        { name: "push", params: "(T)", returnType: "void", detail: "enqueue" },
        { name: "pop", params: "()", returnType: "void", detail: "dequeue" },
        { name: "front", params: "()", returnType: "T&", detail: "front element" },
        { name: "back", params: "()", returnType: "T&", detail: "back element" },
        { name: "size", params: "()", returnType: "size_t", detail: "size" },
        { name: "empty", params: "()", returnType: "bool", detail: "is empty" },
      ],
    },
  }
}