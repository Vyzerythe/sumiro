import { resolveObjectURL } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DataTexture, RGBAFormat, TextureLoader, UnsignedByteType } from 'three';

const decoder = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$source = [System.IO.MemoryStream]::new()
[Console]::OpenStandardInput().CopyTo($source)
$source.Position = 0
$image = [System.Drawing.Bitmap]::new($source)
try {
  $region = [System.Drawing.Rectangle]::new(0, 0, $image.Width, $image.Height)
  $pixels = $image.LockBits($region, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $output = [Console]::OpenStandardOutput()
    $dimensions = [System.BitConverter]::GetBytes($image.Width) + [System.BitConverter]::GetBytes($image.Height)
    $output.Write($dimensions, 0, 8)
    $row = [byte[]]::new($image.Width * 4)
    for ($y = 0; $y -lt $image.Height; $y++) {
      [System.Runtime.InteropServices.Marshal]::Copy([IntPtr]::Add($pixels.Scan0, $y * $pixels.Stride), $row, 0, $row.Length)
      $output.Write($row, 0, $row.Length)
    }
  } finally { $image.UnlockBits($pixels) }
} finally { $image.Dispose(); $source.Dispose() }
`;

function runDecoder(executable, args, bytes) {
  return new Promise((accept, reject) => {
    const process = spawn(executable, args, { windowsHide: true });
    const output = [], errors = [];
    process.stdout.on('data', chunk => output.push(chunk));
    process.stderr.on('data', chunk => errors.push(chunk));
    process.stdin.on('error', reject);
    process.once('error', reject);
    process.once('close', code => {
      if (code !== 0) reject(Error(`${executable} image decode failed: ` + Buffer.concat(errors).toString('utf8')));
      else accept(Buffer.concat(output));
    });
    process.stdin.end(bytes);
  });
}

async function decode(bytes) {
  let width, height, data;
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const pam = await runDecoder('magick', ['-limit', 'thread', '1', 'webp:-', '-alpha', 'on', '-depth', '8', 'pam:-'], bytes);
    const end = pam.indexOf('ENDHDR\n') + 'ENDHDR\n'.length;
    const header = pam.toString('ascii', 0, end);
    width = Number(/^WIDTH (\d+)$/m.exec(header)?.[1]);
    height = Number(/^HEIGHT (\d+)$/m.exec(header)?.[1]);
    if (!header.startsWith('P7\n') || !/^DEPTH 4$/m.test(header) || !/^MAXVAL 255$/m.test(header)) {
      throw Error('WebP decoder did not produce eight-bit RGBA');
    }
    data = pam.subarray(end);
  } else {
    const command = Buffer.from(decoder, 'utf16le').toString('base64');
    const pixels = await runDecoder('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command], bytes);
    width = pixels.readUInt32LE(0);
    height = pixels.readUInt32LE(4);
    data = pixels.subarray(8);
    for (let index = 0; index < data.length; index += 4) [data[index], data[index + 2]] = [data[index + 2], data[index]];
  }
  if (width <= 0 || height <= 0 || data.length !== width * height * 4) throw Error('Image byte count disagrees with dimensions');
  return { width, height, data };
}

/** Decode local textures and embedded GLB images without opening a browser. */
export function installFixtureTextures() {
  const realImages = process.platform === 'win32';
  const original = TextureLoader.prototype.load;
  const decoded = new Map();
  TextureLoader.prototype.load = function (url, onLoad, onProgress, onError) {
    const blob = resolveObjectURL(url);
    if (!blob && !url.startsWith('file:')) return original.call(this, url, onLoad, onProgress, onError);
    const texture = new DataTexture(undefined, 1, 1, RGBAFormat, UnsignedByteType);
    if (!realImages) {
      texture.image = { data: new Uint8Array([128, 128, 128, 255]), width: 1, height: 1 };
      texture.needsUpdate = true;
      queueMicrotask(() => onLoad?.(texture));
      return texture;
    }
    void (blob ? blob.arrayBuffer() : readFile(new URL(url))).then(buffer => {
      const bytes = Buffer.from(buffer);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (!decoded.has(hash)) decoded.set(hash, decode(bytes));
      return decoded.get(hash);
    }).then(image => {
      texture.image = image;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      onLoad?.(texture);
    }).catch(error => onError?.(error));
    return texture;
  };
  return { realImages, restore() { TextureLoader.prototype.load = original; } };
}
