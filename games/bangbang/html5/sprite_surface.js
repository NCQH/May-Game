import {NativeColorFilterRenderer} from './m72_sprite_filters.js';

/** A small textured-quad renderer; it has no game or collision logic.
 * Both backends draw the same source rectangles, pivots, opacity and rotation.
 * WebGL is preferred; Canvas2D is a supported fallback when GL is unavailable.
 */
export function rendererPreference(storage) {
  try { return (storage ?? globalThis.localStorage)?.getItem('bb-renderer') === 'canvas' ? 'canvas' : 'auto'; }
  catch { return 'auto'; }
}

export function saveRendererPreference(value, storage) {
  if (!['auto', 'canvas'].includes(value)) throw new Error('Chế độ đồ họa không hợp lệ.');
  try { (storage ?? globalThis.localStorage)?.setItem('bb-renderer', value); }
  catch { throw new Error('Trình duyệt chưa cho lưu cài đặt đồ họa.'); }
}

export class SpriteSurface {
  constructor(canvas, {forceCanvas = false, onContextLost = () => {}} = {}) {
    this.canvas = canvas;
    this.width = 1; this.height = 1; this.drawCalls = 0; this.textureBytes = 0;
    this.textures = new Map(); this.lost = false; this.fallbackReason = forceCanvas ? 'user-compatibility' : null;
    this.uploadStats={count:0,bytes:0,totalMs:0,maxMs:0,warmCount:0,warmBytes:0,warmMs:0};
    this.transform = {scale: 1, x: 0, y: 0};
    this.vertexData = new Float32Array(24); this.cornerData = new Float32Array(16);
    this.cornerOrder = [0, 1, 2, 0, 2, 3];
    this.bufferAllocations = 0; this.vertexUpdates = 0;
    this.requestedAttributes = {alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: true, preserveDrawingBuffer: false,
      powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false};
    try { this.gl = !forceCanvas && canvas.getContext('webgl', this.requestedAttributes); }
    catch { this.gl = null; this.fallbackReason = 'webgl-creation-failed'; }
    if (this.gl) {
      try { this.initializeGL(); }
      catch {
        // A canvas cannot change context type after acquiring WebGL. Replace
        // only this still-unbound drawing node before BattleInput attaches.
        try { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* Fall back even if the driver is lost. */ }
        const replacement = canvas.cloneNode(false); canvas.replaceWith(replacement);
        this.canvas = canvas = replacement; this.gl = null;
        this.fallbackReason = 'webgl-initialization-failed';
      }
    }
    if (this.gl) {
      this.backend = 'WebGL'; this.readDriverInfo();
      canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault(); this.lost = true; this.colorFilters?.dispose({lost: true}); onContextLost();
      });
      canvas.addEventListener('webglcontextrestored', () => {
        try {
          this.textures.clear(); this.textureBytes = 0; this.initializeGL();
          this.lost = false; this.restoreError = null; this.readDriverInfo();
          this.resize(this.width, this.height, this.pixelRatio || 1);
        } catch {
          // Keep the DOM/settings usable if this driver cannot restore. The
          // compatibility selector reconnects on a fresh Canvas2D surface.
          this.lost = true; this.restoreError = 'webgl-restoration-failed';
          onContextLost({reason: this.restoreError});
        }
      });
    } else {
      this.backend = 'Canvas2D';
      this.fallbackReason ||= 'webgl-unavailable';
      this.context = canvas.getContext('2d', {alpha: false});
      if (!this.context) throw new Error('Trình duyệt không tạo được bề mặt hiển thị trận.');
      this.driver = {acceleration: 'browser-managed', renderer: null, vendor: null};
    }
  }

  readDriverInfo() {
    const gl = this.gl;
    let vendor = null, renderer = null;
    try {
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      if (extension) {
        vendor = gl.getParameter(extension.UNMASKED_VENDOR_WEBGL);
        renderer = gl.getParameter(extension.UNMASKED_RENDERER_WEBGL);
      }
    } catch { /* Privacy settings may hide the driver. Rendering still works. */ }
    const software = /swiftshader|llvmpipe|softpipe|lavapipe|swrast|software|basic render driver/i.test(renderer || '');
    this.driver = {vendor, renderer, acceleration: software ? 'software-reported'
      : renderer ? 'gpu-reported' : 'unknown'};
    this.contextAttributes = gl.getContextAttributes();
  }

  snapshot() {
    return {backend: this.backend, preference: this.fallbackReason === 'user-compatibility' ? 'canvas' : 'auto',
      fallbackReason: this.fallbackReason, contextLost: this.lost, ...this.driver,
      restoreError: this.restoreError || null,
      requestedAttributes: {...this.requestedAttributes}, contextAttributes: this.contextAttributes || null,
      maxTextureSize: this.maxTextureSize || null, textureBytes: this.textureBytes,
      uploads:{...this.uploadStats},prewarm:this.prewarmResult?{...this.prewarmResult}:null,
      drawCalls: this.drawCalls, vertexUpdates: this.vertexUpdates, bufferAllocations: this.bufferAllocations,
      colorFilter: this.colorFilters?.snapshot() || {backend: this.backend, passes: 0, framePasses: 0,
        failures: 0, lastError: null, gpuReadbacks: 0, canvasPixelReads: 0, cacheHits: 0,
        cacheEntries: 0, targetBytes: 0}};
  }

  withTransform(x, y, scale, draw) {
    const old = this.transform;
    this.transform = {scale: old.scale * scale,
      x: old.x + old.scale * x * (1 - scale), y: old.y + old.scale * y * (1 - scale)};
    try { return draw(); } finally { this.transform = old; }
  }

  withColorMatrix(matrix, draw, {alpha = 1, key = ''} = {}) {
    if (this.groupCapture) throw new Error('Nested native color filters are not supported');
    const commands = []; this.groupCapture = commands;
    try { draw(); } finally { this.groupCapture = null; }
    this.colorFilters ??= new NativeColorFilterRenderer(this);
    return this.colorFilters.render(commands, matrix, {alpha, key});
  }

  initializeGL() {
    const gl = this.gl;
    const shader = (type, source) => {
      const value = gl.createShader(type); gl.shaderSource(value, source); gl.compileShader(value);
      if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value));
      return value;
    };
    const vertex = shader(gl.VERTEX_SHADER, `
      attribute vec2 a_position; attribute vec2 a_uv;
      uniform vec2 u_view; varying vec2 v_uv;
      void main() { gl_Position = vec4(a_position.x / u_view.x * 2.0 - 1.0,
        1.0 - a_position.y / u_view.y * 2.0, 0.0, 1.0); v_uv = a_uv; }
    `);
    const fragment = shader(gl.FRAGMENT_SHADER, `
      precision mediump float; varying vec2 v_uv;
      uniform sampler2D u_image; uniform float u_alpha;
      void main() { gl_FragColor = texture2D(u_image, v_uv) * u_alpha; }
    `);
    const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    this.program = program; gl.useProgram(program);
    this.vertexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.byteLength, gl.STREAM_DRAW); this.bufferAllocations += 1;
    const position = gl.getAttribLocation(program, 'a_position');
    const uv = gl.getAttribLocation(program, 'a_uv');
    this.positionAttribute = position; this.uvAttribute = uv;
    gl.enableVertexAttribArray(position); gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
    this.viewUniform = gl.getUniformLocation(program, 'u_view');
    this.alphaUniform = gl.getUniformLocation(program, 'u_alpha');
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.clearColor(0.035, 0.055, 0.07, 1);
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  }

  resize(width, height, pixelRatio = Math.min(devicePixelRatio || 1, 2)) {
    this.width = Math.max(1, width); this.height = Math.max(1, height); this.pixelRatio = pixelRatio;
    const w = Math.round(this.width * pixelRatio), h = Math.round(this.height * pixelRatio);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    if (this.gl) {
      this.gl.viewport(0, 0, w, h);
      this.gl.uniform2f(this.viewUniform, this.width, this.height);
    } else this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  clear() {
    this.drawCalls = 0; this.vertexUpdates = 0;
    this.colorFilters?.beginFrame();
    if (this.lost) return;
    if (this.gl) this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    else {
      this.context.globalAlpha = 1; this.context.globalCompositeOperation = 'source-over';
      this.context.fillStyle = '#090e12'; this.context.fillRect(0, 0, this.width, this.height);
    }
  }

  texture(image, {warm=false}={}) {
    let value = this.textures.get(image);
    if (value) return value;
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    if (width > this.maxTextureSize || height > this.maxTextureSize) {
      throw new Error(`Ảnh ${width}×${height} vượt giới hạn texture của trình duyệt.`);
    }
    const gl = this.gl, begun=performance.now();
    value = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, value);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    this.textures.set(image, value); this.textureBytes += width * height * 4;
    const elapsed=performance.now()-begun,bytes=width*height*4,s=this.uploadStats;
    s.count++;s.bytes+=bytes;s.totalMs+=elapsed;s.maxMs=Math.max(s.maxMs,elapsed);
    if(warm){s.warmCount++;s.warmBytes+=bytes;s.warmMs+=elapsed;}
    return value;
  }

  async prepareTextures(urls,images,{current=()=>true,progress=()=>{},
    maxBytes=384*1024*1024,batchMs=4}={}) {
    // Only already verified/decoded pages belonging to this roster/map. This
    // creates no new downloads, image copies, or unbounded atlas-page cache.
    const begun=performance.now(),result={count:0,bytes:0,skipped:0,cancelled:false,elapsedMs:0};
    if(!this.gl||this.lost){this.prewarmResult=result;return result;}
    let bytes=this.textureBytes;
    const queue=[];
    for(const url of new Set(urls||[])){
      const image=images.get(url);if(!image)continue;
      const size=(image.naturalWidth||image.width)*(image.naturalHeight||image.height)*4;
      if(this.textures.has(image))continue;
      if(bytes+size>maxBytes){result.skipped++;continue;}
      bytes+=size;queue.push({url,image,size});
    }
    let index=0;progress({stage:'graphics',completed:0,total:queue.length});
    const nextFrame=()=>new Promise(resolve=>{
      let frame,timer;const done=()=>{cancelAnimationFrame(frame);clearTimeout(timer);resolve();};
      frame=requestAnimationFrame(done);timer=setTimeout(done,50);
    });
    while(index<queue.length){
      await nextFrame();
      if(!current()||this.lost){result.cancelled=true;break;}
      const batch=performance.now();
      do{
        const item=queue[index++];
        if(images.get(item.url)!==item.image){result.skipped++;continue;}
        this.texture(item.image,{warm:true});result.count++;result.bytes+=item.size;
      }while(index<queue.length&&performance.now()-batch<batchMs);
      this.gl.flush();progress({stage:'graphics',completed:index,total:queue.length});
    }
    result.elapsedMs=performance.now()-begun;
    if(current())this.prewarmResult=result;
    return result;
  }

  draw(image, {sx = 0, sy = 0, sw, sh, x, y, width = sw, height = sh,
    rotation = 0, alpha = 1, flipX = false, flipY = false, additive = false, matrix = null, bitmapSmoothing}) {
    if (!image || !sw || !sh || !width || !height || alpha <= 0 || this.lost) return;
    x = x * this.transform.scale + this.transform.x; y = y * this.transform.scale + this.transform.y;
    width *= this.transform.scale; height *= this.transform.scale;
    const options = {sx, sy, sw, sh, x, y, width, height, rotation, alpha, flipX, flipY, additive, matrix,
      ...(bitmapSmoothing===false?{bitmapSmoothing:false}:{})};
    if (this.groupCapture) { this.groupCapture.push({image, options}); return; }
    this.drawTransformed(image, options);
  }

  drawTransformed(image, {sx, sy, sw, sh, x, y, width, height,
    rotation, alpha, flipX, flipY, additive, matrix, bitmapSmoothing}) {
    this.drawCalls += 1;
    if (!this.gl) {
      const c = this.context; c.save(); c.globalAlpha = alpha;
      if(bitmapSmoothing===false)c.imageSmoothingEnabled=false;
      c.globalCompositeOperation = additive ? 'lighter' : 'source-over';
      c.translate(x, y);
      if (matrix) c.transform(...matrix, 0, 0); else c.rotate(rotation);
      c.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      c.drawImage(image, sx, sy, sw, sh, -width / 2, -height / 2, width, height); c.restore();
      return;
    }
    const gl = this.gl, iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const a = matrix?.[0] ?? cos, b = matrix?.[1] ?? sin;
    const c = matrix?.[2] ?? -sin, d = matrix?.[3] ?? cos;
    const u0 = (sx + (flipX ? sw : 0)) / iw, v0 = (sy + (flipY ? sh : 0)) / ih;
    const u1 = (sx + (flipX ? 0 : sw)) / iw, v1 = (sy + (flipY ? 0 : sh)) / ih;
    const corners = this.cornerData, vertices = this.vertexData;
    for (let i = 0; i < 4; i++) {
      const right = i === 1 || i === 2, bottom = i >= 2;
      const dx = (right ? width : -width) / 2, dy = (bottom ? height : -height) / 2, offset = i * 4;
      corners[offset] = x + dx * a + dy * c; corners[offset + 1] = y + dx * b + dy * d;
      corners[offset + 2] = right ? u1 : u0; corners[offset + 3] = bottom ? v1 : v0;
    }
    for (let i = 0; i < 6; i++) {
      const source = this.cornerOrder[i] * 4, target = i * 4;
      for (let j = 0; j < 4; j++) vertices[target + j] = corners[source + j];
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture(image));
    // These quads are submitted immediately (there is no deferred GL batch).
    // Restore LINEAR after the native nearest draw so a shared texture's next
    // inherited consumer cannot accidentally retain this frame's filter.
    const nearest=bitmapSmoothing===false;
    if(nearest){
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    }
    try{
      gl.blendFunc(gl.ONE, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(this.alphaUniform, alpha);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices); this.vertexUpdates += 1;
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }finally{
      if(nearest){
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      }
    }
  }

  dispose() {
    this.colorFilters?.dispose();
    if (!this.gl) return;
    for (const texture of this.textures.values()) this.gl.deleteTexture(texture);
    this.textures.clear(); this.textureBytes = 0;
  }

  releaseTexture(image) {
    const texture = this.textures.get(image);
    if (!texture || !this.gl) return;
    this.gl.deleteTexture(texture); this.textures.delete(image);
    this.textureBytes = Math.max(0, this.textureBytes
      - (image.naturalWidth || image.width) * (image.naturalHeight || image.height) * 4);
  }
}
