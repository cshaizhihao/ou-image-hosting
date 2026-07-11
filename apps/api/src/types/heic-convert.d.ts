declare module "heic-convert" {
  type HeicConvertInput = {
    buffer: Buffer;
    format: "JPEG" | "PNG";
    quality?: number;
  };

  type HeicConvert = ((input: HeicConvertInput) => Promise<Buffer>) & {
    all?: (input: HeicConvertInput) => Promise<Buffer[]>;
  };

  const convert: HeicConvert;
  export default convert;
}
