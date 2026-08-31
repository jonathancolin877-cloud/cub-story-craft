declare module "fontkit" {
  const fontkit: { create: (buffer: Uint8Array | ArrayBuffer) => unknown };
  export default fontkit;
}
