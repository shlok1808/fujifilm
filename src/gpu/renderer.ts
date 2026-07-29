/**
 * WebGL2 render graph.
 *
 * The decoded image is uploaded once as a linear half-float texture and then
 * re-rendered from that same texture for every recipe. Comparing N recipes
 * therefore costs N draw calls, not N decodes, which is what makes both the
 * live sliders and the N-up compare grid cheap.
 */

import { BLUR_SHADER, DETAIL_SHADER, DEVELOP_SHADER, VERTEX_SHADER } from './shaders';
import type { DecodedImage } from '../decode/decodeRaf';
import type { RenderParams } from '../model/params';

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram()!;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`Program link failed: ${log}`);
  }
  return p;
}

interface Target { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

export class Renderer {
  private gl: WebGL2RenderingContext;
  private develop: WebGLProgram;
  private blur: WebGLProgram;
  private detail: WebGLProgram;
  private quad: WebGLVertexArrayObject;
  private imageTex: WebGLTexture | null = null;
  private lutTex: WebGLTexture | null = null;
  /**
   * A 1x1 3D texture that is bound whenever no LUT is active. WebGL2 rejects a
   * draw where two samplers of different types resolve to the same texture unit,
   * so `uLut` must always point at a real sampler3D even when it goes unused.
   */
  private dummyLut: WebGLTexture;
  private lutSize = 0;
  private targets: Target[] = [];
  private imgW = 0;
  private imgH = 0;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      // export reads pixels back after the draw, so the buffer must survive it
      preserveDrawingBuffer: true,
    } as WebGLContextAttributes) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;

    // Rendering intermediate passes at float precision needs this; without it
    // we would quantise to 8 bits between passes and band the gradients.
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('EXT_color_buffer_float is required but not supported.');
    }
    gl.getExtension('OES_texture_float_linear');

    this.develop = link(gl, VERTEX_SHADER, DEVELOP_SHADER);
    this.blur = link(gl, VERTEX_SHADER, BLUR_SHADER);
    this.detail = link(gl, VERTEX_SHADER, DETAIL_SHADER);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.quad = vao;

    this.dummyLut = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, this.dummyLut);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, 1, 1, 1, 0, gl.RGBA, gl.FLOAT,
      new Float32Array([0, 0, 0, 1]));
  }

  get context() { return this.gl; }

  /** Upload the decoded linear image. Call once per file. */
  setImage(img: DecodedImage) {
    const gl = this.gl;
    if (this.imageTex) gl.deleteTexture(this.imageTex);

    // LibRaw hands us tightly-packed 16-bit RGB; WebGL wants RGBA, and we
    // normalise to 0..1 float here so the shaders can stay in scene-linear.
    const n = img.width * img.height;
    const rgba = new Float32Array(n * 4);
    const src = img.data;
    for (let i = 0, s = 0, d = 0; i < n; i++, s += 3, d += 4) {
      rgba[d] = src[s] / 65535;
      rgba[d + 1] = src[s + 1] / 65535;
      rgba[d + 2] = src[s + 2] / 65535;
      rgba[d + 3] = 1;
    }

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, img.width, img.height, 0,
      gl.RGBA, gl.FLOAT, rgba);

    this.imageTex = tex;
    this.imgW = img.width;
    this.imgH = img.height;
    this.disposeTargets();
  }

  /** Upload a film-simulation LUT as a 3D texture. */
  setLut(lut: { size: number; data: Float32Array } | null) {
    const gl = this.gl;
    if (this.lutTex) { gl.deleteTexture(this.lutTex); this.lutTex = null; this.lutSize = 0; }
    if (!lut) return;

    const rgba = new Float32Array(lut.size ** 3 * 4);
    for (let i = 0, s = 0, d = 0; i < lut.size ** 3; i++, s += 3, d += 4) {
      rgba[d] = lut.data[s];
      rgba[d + 1] = lut.data[s + 1];
      rgba[d + 2] = lut.data[s + 2];
      rgba[d + 3] = 1;
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, lut.size, lut.size, lut.size, 0,
      gl.RGBA, gl.FLOAT, rgba);
    this.lutTex = tex;
    this.lutSize = lut.size;
  }

  /** LibRaw has already applied orientation, so this is just the decoded size. */
  get outputSize(): { width: number; height: number } {
    return { width: this.imgW, height: this.imgH };
  }

  private makeTarget(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, w, h };
  }

  private ensureTargets(w: number, h: number, count: number) {
    if (this.targets.length >= count && this.targets[0]?.w === w && this.targets[0]?.h === h) return;
    this.disposeTargets();
    for (let i = 0; i < count; i++) this.targets.push(this.makeTarget(w, h));
  }

  private disposeTargets() {
    const gl = this.gl;
    for (const t of this.targets) { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex); }
    this.targets = [];
  }

  private drawTo(target: Target | null, w: number, h: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /**
   * Render one recipe into the bound canvas.
   * `viewport` lets the caller place the result inside a larger canvas, which
   * is how the N-up compare grid draws several recipes at once.
   */
  render(params: RenderParams) {
    const gl = this.gl;
    if (!this.imageTex) return;

    const { width: outW, height: outH } = this.outputSize;
    const needsDetail =
      Math.abs(params.sharpness) > 0.001 ||
      Math.abs(params.clarity) > 0.001 ||
      params.noiseReduction > 0.001;

    this.ensureTargets(outW, outH, needsDetail ? 4 : 1);

    // --- develop pass --------------------------------------------------------
    gl.useProgram(this.develop);
    const u = (n: string) => gl.getUniformLocation(this.develop, n);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.uniform1i(u('uImage'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex ?? this.dummyLut);
    gl.uniform1i(u('uLut'), 1);
    gl.uniform1i(u('uHasLut'), this.lutTex ? 1 : 0);
    gl.uniform1f(u('uLutSize'), this.lutSize || 2);
    gl.uniform1f(u('uExposure'), params.exposure);
    gl.uniform1f(u('uWbRed'), params.wbRed);
    gl.uniform1f(u('uWbBlue'), params.wbBlue);
    gl.uniform1f(u('uDrCompress'), params.drCompress);
    gl.uniform1f(u('uHighlight'), params.highlight);
    gl.uniform1f(u('uShadow'), params.shadow);
    gl.uniform1f(u('uColor'), params.color);
    gl.uniform1f(u('uMonoWeights'), params.monochrome ? 1 : 0);
    gl.uniform3fv(u('uMonoMix'), params.monoMix);
    gl.uniform3fv(u('uToneTint'), params.toneTint);
    gl.uniform1f(u('uColorChrome'), params.colorChrome);
    gl.uniform1f(u('uColorChromeBlue'), params.colorChromeBlue);
    gl.uniform1f(u('uGrain'), params.grain);
    gl.uniform1f(u('uGrainSize'), params.grainSize);
    gl.uniform2f(u('uResolution'), outW, outH);
    gl.uniform1f(u('uSeed'), params.seed);

    if (!needsDetail) {
      this.drawTo(null, outW, outH);
      return;
    }
    this.drawTo(this.targets[0], outW, outH);

    // --- blur passes ---------------------------------------------------------
    const blurInto = (src: WebGLTexture, tmp: Target, dst: Target, radius: number) => {
      gl.useProgram(this.blur);
      const bu = (n: string) => gl.getUniformLocation(this.blur, n);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src);
      gl.uniform1i(bu('uImage'), 0);
      gl.uniform2f(bu('uDirection'), radius / outW, 0);
      this.drawTo(tmp, outW, outH);

      gl.bindTexture(gl.TEXTURE_2D, tmp.tex);
      gl.uniform2f(bu('uDirection'), 0, radius / outH);
      this.drawTo(dst, outW, outH);
    };

    blurInto(this.targets[0].tex, this.targets[3], this.targets[1], 1.2);   // small
    blurInto(this.targets[0].tex, this.targets[3], this.targets[2], 12.0);  // large

    // --- detail combine ------------------------------------------------------
    gl.useProgram(this.detail);
    const du = (n: string) => gl.getUniformLocation(this.detail, n);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.targets[0].tex);
    gl.uniform1i(du('uImage'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.targets[1].tex);
    gl.uniform1i(du('uBlurSmall'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.targets[2].tex);
    gl.uniform1i(du('uBlurLarge'), 2);
    gl.uniform1f(du('uSharpness'), params.sharpness);
    gl.uniform1f(du('uClarity'), params.clarity);
    gl.uniform1f(du('uNoiseReduction'), params.noiseReduction);
    this.drawTo(null, outW, outH);
  }

  dispose() {
    const gl = this.gl;
    this.disposeTargets();
    if (this.imageTex) gl.deleteTexture(this.imageTex);
    if (this.lutTex) gl.deleteTexture(this.lutTex);
    gl.deleteTexture(this.dummyLut);
    gl.deleteProgram(this.develop);
    gl.deleteProgram(this.blur);
    gl.deleteProgram(this.detail);
    gl.deleteVertexArray(this.quad);
  }
}
