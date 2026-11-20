// Stand-in for Node built-ins that the WebAssembly glue of the DICOM
// codecs references behind an `ENVIRONMENT_IS_NODE` guard (#674). It is
// never executed in the browser; it only has to resolve. Wired in
// `next.config.ts` under `turbopack.resolveAlias`.
export {};
