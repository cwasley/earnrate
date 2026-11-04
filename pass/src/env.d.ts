declare module 'earnrate:pass-bundle' {
  const bundle: unknown
  export default bundle
}

declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}
