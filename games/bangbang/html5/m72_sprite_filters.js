/* Native ColorMatrixFilter presentation for already-composited sprite groups.
 * The WebGL path never reads pixels back to the CPU. Canvas2D is the explicit
 * compatibility path; its small group bitmaps are cached and bounded.
 * AS3 ColorMatrixFilter operates on unmultiplied RGBA, then repremultiplies.
 */
export function colorMatrixPixel(pixel, matrix, out = new Uint8ClampedArray(4)) {
  const [r, g, b, a] = pixel;
  for (let row = 0; row < 4; row++) {
    const at = row * 5;
    out[row] = r * matrix[at] + g * matrix[at + 1]
      + b * matrix[at + 2] + a * matrix[at + 3] + matrix[at + 4];
  }
  return out;
}

export function colorGroupBounds(commands, ratio, viewWidth, viewHeight) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const {options: o} of commands) {
    const cos = Math.cos(o.rotation), sin = Math.sin(o.rotation);
    const a = o.matrix?.[0] ?? cos, b = o.matrix?.[1] ?? sin;
    const c = o.matrix?.[2] ?? -sin, d = o.matrix?.[3] ?? cos;
    const halfX = (Math.abs(o.width * a) + Math.abs(o.height * c)) / 2;
    const halfY = (Math.abs(o.width * b) + Math.abs(o.height * d)) / 2;
    left = Math.min(left, o.x - halfX); right = Math.max(right, o.x + halfX);
    top = Math.min(top, o.y - halfY); bottom = Math.max(bottom, o.y + halfY);
  }
  // Color matrices have no spatial radius. Clipping to the viewport neither
  // loses neighboring samples nor changes any visible filtered pixel.
  left = Math.max(0, Math.floor(left * ratio)); top = Math.max(0, Math.floor(top * ratio));
  right = Math.min(Math.ceil(viewWidth * ratio), Math.ceil(right * ratio));
  bottom = Math.min(Math.ceil(viewHeight * ratio), Math.ceil(bottom * ratio));
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
  return {x: left / ratio, y: top / ratio, width: (right - left) / ratio,
    height: (bottom - top) / ratio, pixelWidth: right - left, pixelHeight: bottom - top, ratio};
}

const MAX_CANVAS_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_CANVAS_CACHE_ENTRIES = 48;
const vertexSource = `attribute vec2 a_position; attribute vec2 a_uv;
  uniform vec2 u_view; varying vec2 v_uv;
  void main() { gl_Position = vec4(a_position.x / u_view.x * 2.0 - 1.0,
    1.0 - a_position.y / u_view.y * 2.0, 0.0, 1.0); v_uv = a_uv; }`;
const fragmentSource = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  varying vec2 v_uv; uniform sampler2D u_image; uniform float u_alpha;
  uniform vec4 u_row0; uniform vec4 u_row1; uniform vec4 u_row2; uniform vec4 u_row3;
  uniform vec4 u_offset;
  void main() {
    vec4 premult = texture2D(u_image, v_uv);
    vec4 rgba = vec4(premult.a > 0.0 ? premult.rgb / premult.a : vec3(0.0), premult.a);
    vec4 filtered = clamp(vec4(dot(u_row0, rgba), dot(u_row1, rgba),
      dot(u_row2, rgba), dot(u_row3, rgba)) + u_offset, 0.0, 1.0);
    gl_FragColor = vec4(filtered.rgb * filtered.a, filtered.a) * u_alpha;
  }`;

export class NativeColorFilterRenderer {
  constructor(surface) {
    this.surface = surface; this.passes = 0; this.framePasses = 0; this.failures = 0;
    this.canvasPixelReads = 0; this.cacheHits = 0; this.frame = 0;
    this.cache = new Map(); this.cacheBytes = 0; this.imageIds = new WeakMap(); this.nextImageId = 1;
    this.target = null; this.program = null; this.lastError = null;
  }

  beginFrame() {
    this.frame += 1; this.framePasses = 0;
    for (const [key, entry] of this.cache) if (this.frame - entry.frame > 120) this.evict(key);
  }

  snapshot() {
    return {backend: this.surface.gl ? 'WebGL' : 'Canvas2D', passes: this.passes,
      framePasses: this.framePasses, failures: this.failures, lastError: this.lastError,
      gpuReadbacks: 0, canvasPixelReads: this.canvasPixelReads, cacheHits: this.cacheHits,
      cacheEntries: this.cache.size, targetBytes: this.target
        ? this.target.width * this.target.height * 4 : this.cacheBytes};
  }

  render(commands, matrix, {alpha = 1, key = ''} = {}) {
    if (!Array.isArray(matrix) || matrix.length !== 20 || matrix.some(value => !Number.isFinite(value)))
      throw new TypeError('A finite native 4 by 5 color matrix is required');
    const surface = this.surface;
    const bounds = colorGroupBounds(commands, surface.pixelRatio || 1, surface.width, surface.height);
    if (!bounds || alpha <= 0 || surface.lost) return {drawn: false, applied: false, backend: surface.backend};
    try {
      if (surface.gl) this.renderGL(commands, matrix, bounds, alpha);
      else this.renderCanvas(commands, matrix, bounds, alpha, key);
      this.passes += 1; this.framePasses += 1;
      return {drawn: true, applied: true, backend: surface.backend};
    } catch (error) {
      this.failures += 1; this.lastError = String(error.message || error);
      // Keep the battle usable if a driver refuses a temporary target. The
      // explicit failure marker prevents this frame from claiming parity.
      if (surface.gl) this.restoreGL();
      for (const command of commands) surface.drawTransformed(command.image,
        {...command.options, alpha: command.options.alpha * alpha});
      return {drawn: commands.length > 0, applied: false, backend: surface.backend, error: this.lastError};
    }
  }

  initializeGL() {
    if (this.program) return;
    const gl = this.surface.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(error);
      }
      return shader;
    };
    let vertex, fragment, program;
    try {
      vertex = compile(gl.VERTEX_SHADER, vertexSource); fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      this.position = gl.getAttribLocation(program, 'a_position'); this.uv = gl.getAttribLocation(program, 'a_uv');
      this.uniforms = Object.fromEntries(['u_view', 'u_image', 'u_alpha', 'u_row0', 'u_row1', 'u_row2', 'u_row3', 'u_offset']
        .map(name => [name, gl.getUniformLocation(program, name)]));
      this.program = program;
    } catch (error) {
      if (program) gl.deleteProgram(program); throw error;
    } finally {
      if (vertex) gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment);
    }
  }

  targetFor(width, height) {
    const gl = this.surface.gl;
    if (width > this.surface.maxTextureSize || height > this.surface.maxTextureSize)
      throw new Error('Filtered sprite group exceeds the driver texture limit');
    if (this.target && this.target.width >= width && this.target.height >= height) return this.target;
    const previous = this.target;
    width = Math.min(this.surface.maxTextureSize, Math.ceil(Math.max(width, previous?.width || 0) / 16) * 16);
    height = Math.min(this.surface.maxTextureSize, Math.ceil(Math.max(height, previous?.height || 0) / 16) * 16);
    const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('Filtered sprite framebuffer is incomplete');
    } catch (error) {
      gl.deleteTexture(texture); gl.deleteFramebuffer(framebuffer); throw error;
    }
    if (previous) { gl.deleteTexture(previous.texture); gl.deleteFramebuffer(previous.framebuffer); }
    return this.target = {texture, framebuffer, width, height};
  }

  restoreGL() {
    const s = this.surface, gl = s.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, s.canvas.width, s.canvas.height);
    gl.useProgram(s.program); gl.bindBuffer(gl.ARRAY_BUFFER, s.vertexBuffer);
    gl.enableVertexAttribArray(s.positionAttribute); gl.enableVertexAttribArray(s.uvAttribute);
    gl.vertexAttribPointer(s.positionAttribute, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(s.uvAttribute, 2, gl.FLOAT, false, 16, 8);
    gl.uniform2f(s.viewUniform, s.width, s.height);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.clearColor(0.035, 0.055, 0.07, 1);
  }

  renderGL(commands, matrix, bounds, alpha) {
    const s = this.surface, gl = s.gl;
    this.initializeGL(); const target = this.targetFor(bounds.pixelWidth, bounds.pixelHeight);
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.viewport(0, 0, target.width, target.height);
      gl.useProgram(s.program); gl.bindBuffer(gl.ARRAY_BUFFER, s.vertexBuffer);
      gl.enableVertexAttribArray(s.positionAttribute); gl.enableVertexAttribArray(s.uvAttribute);
      gl.vertexAttribPointer(s.positionAttribute, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(s.uvAttribute, 2, gl.FLOAT, false, 16, 8);
      gl.uniform2f(s.viewUniform, target.width / bounds.ratio, target.height / bounds.ratio);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      for (const command of commands) s.drawTransformed(command.image,
        {...command.options, x: command.options.x - bounds.x, y: command.options.y - bounds.y});
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, s.canvas.width, s.canvas.height);
      gl.useProgram(this.program); gl.bindBuffer(gl.ARRAY_BUFFER, s.vertexBuffer);
      gl.enableVertexAttribArray(this.position); gl.enableVertexAttribArray(this.uv);
      gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(this.uv, 2, gl.FLOAT, false, 16, 8);
      gl.uniform2f(this.uniforms.u_view, s.width, s.height); gl.uniform1i(this.uniforms.u_image, 0);
      gl.uniform1f(this.uniforms.u_alpha, alpha);
      for (let row = 0; row < 4; row++) gl.uniform4f(this.uniforms[`u_row${row}`], ...matrix.slice(row * 5, row * 5 + 4));
      gl.uniform4f(this.uniforms.u_offset, matrix[4] / 255, matrix[9] / 255, matrix[14] / 255, matrix[19] / 255);
      gl.bindTexture(gl.TEXTURE_2D, target.texture); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const x1 = bounds.x + bounds.width, y1 = bounds.y + bounds.height;
      const u1 = bounds.pixelWidth / target.width, v1 = 1 - bounds.pixelHeight / target.height;
      // FBO rows run bottom-up relative to DOM image uploads. The composed
      // group occupies the top-left of a reusable target which may be larger.
      s.vertexData.set([bounds.x,bounds.y,0,1, x1,bounds.y,u1,1, x1,y1,u1,v1,
        bounds.x,bounds.y,0,1, x1,y1,u1,v1, bounds.x,y1,0,v1]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.vertexData); s.vertexUpdates += 1; s.drawCalls += 1;
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } finally { this.restoreGL(); }
  }

  signature(commands, matrix, bounds) {
    const values = [bounds.pixelWidth, bounds.pixelHeight, bounds.ratio, ...matrix];
    for (const {image, options: o} of commands) {
      if (!this.imageIds.has(image)) this.imageIds.set(image, this.nextImageId++);
      values.push(this.imageIds.get(image), o.sx, o.sy, o.sw, o.sh, o.x - bounds.x, o.y - bounds.y,
        o.width, o.height, o.rotation, o.alpha, o.flipX, o.flipY, o.additive, ...(o.matrix || []), '|');
      if(o.bitmapSmoothing===false)values.push('nearest');
    }
    return values.join(',');
  }

  evict(key) {
    const entry = this.cache.get(key); if (!entry) return;
    this.cacheBytes -= entry.bytes; entry.canvas.width = entry.canvas.height = 1; this.cache.delete(key);
  }

  renderCanvas(commands, matrix, bounds, alpha, key) {
    const s = this.surface, signature = this.signature(commands, matrix, bounds);
    let entry = this.cache.get(key);
    if (entry && entry.signature === signature) this.cacheHits += 1;
    else {
      const bytes = bounds.pixelWidth * bounds.pixelHeight * 4;
      if (bytes > MAX_CANVAS_CACHE_BYTES) throw new Error('Filtered sprite exceeds the compatibility cache limit');
      if (entry) this.evict(key);
      while (this.cache.size >= MAX_CANVAS_CACHE_ENTRIES || this.cacheBytes + bytes > MAX_CANVAS_CACHE_BYTES) {
        const oldest = [...this.cache].sort((a, b) => a[1].frame - b[1].frame)[0];
        if (!oldest) break; this.evict(oldest[0]);
      }
      const canvas = s.canvas.ownerDocument.createElement('canvas');
      canvas.width = bounds.pixelWidth; canvas.height = bounds.pixelHeight;
      const context = canvas.getContext('2d', {alpha: true, willReadFrequently: true});
      if (!context) throw new Error('Compatibility filter bitmap unavailable');
      context.setTransform(bounds.ratio, 0, 0, bounds.ratio, 0, 0);
      for (const {image, options: o} of commands) {
        context.save(); context.globalAlpha = o.alpha;
        if(o.bitmapSmoothing===false)context.imageSmoothingEnabled=false;
        context.globalCompositeOperation = o.additive ? 'lighter' : 'source-over';
        context.translate(o.x - bounds.x, o.y - bounds.y);
        if (o.matrix) context.transform(...o.matrix, 0, 0); else context.rotate(o.rotation);
        context.scale(o.flipX ? -1 : 1, o.flipY ? -1 : 1);
        context.drawImage(image, o.sx, o.sy, o.sw, o.sh, -o.width / 2, -o.height / 2, o.width, o.height);
        context.restore();
      }
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height); this.canvasPixelReads += 1;
      const data = pixels.data, pixel = new Uint8ClampedArray(4);
      for (let i = 0; i < data.length; i += 4) {
        pixel[0] = data[i]; pixel[1] = data[i + 1]; pixel[2] = data[i + 2]; pixel[3] = data[i + 3];
        colorMatrixPixel(pixel, matrix, pixel); data.set(pixel, i);
      }
      context.putImageData(pixels, 0, 0);
      entry = {canvas, bytes, signature, frame: this.frame}; this.cache.set(key, entry); this.cacheBytes += bytes;
    }
    entry.frame = this.frame;
    const c = s.context; c.save(); c.globalAlpha = alpha; c.globalCompositeOperation = 'source-over';
    c.drawImage(entry.canvas, bounds.x, bounds.y, bounds.width, bounds.height); c.restore(); s.drawCalls += 1;
  }

  dispose({lost = false} = {}) {
    const gl = this.surface.gl;
    if (gl && !lost) {
      if (this.target) { gl.deleteTexture(this.target.texture); gl.deleteFramebuffer(this.target.framebuffer); }
      if (this.program) gl.deleteProgram(this.program);
    }
    this.target = null; this.program = null;
    for (const key of this.cache.keys()) this.evict(key);
  }
}
