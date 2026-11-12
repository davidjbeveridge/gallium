// Ray-march the frame and its dark inlay in object space. The opening melt
// feeds into two currents that keep moving around the same tile.
export function createGalliumRenderer(canvas) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false });
  if (!gl) return null;

  const vertex = `
    attribute vec2 position;
    void main() { gl_Position = vec4(position, 0., 1.); }
  `;
  const fragment = `
    precision highp float;
    uniform vec2 resolution;
    uniform vec2 tilt;
    uniform float progress;
    uniform vec3 currents;
    uniform sampler2D lettering;

    mat2 rotation(float a) {
      float c = cos(a), s = sin(a);
      return mat2(c, s, -s, c);
    }

    float roundedBox(vec3 p, vec3 halfSize, float bevel) {
      vec3 q = abs(p) - halfSize + bevel;
      return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.) - bevel;
    }

    float currentCrest(float offset, float tail, float front) {
      float gap = fract(offset + .5) - .5;
      return 1. - smoothstep(0., gap < 0. ? tail : front, abs(gap));
    }

    vec2 surface(vec3 p, float liquid, float head, float circulation) {
      vec3 metal = p;
      float radius = max(abs(p.x), abs(p.y));
      float swell = 0.;
      if (radius > .56 && (liquid > .001 || circulation > .001)) {
        vec2 rim = p.xy / radius;
        float path = .5 - .25 * rim.y;
        if (abs(rim.y) >= abs(rim.x)) {
          float along = .25 * abs(rim.x);
          path = rim.y > 0. ? along : 1. - along;
        }
        float depth = 0.;
        if (liquid > .001) {
          // The opening streams start at the top and meet at the bottom.
          float offset = path - head - .044 * rim.x;
          float leadingEdge = offset / (offset > 0. ? .055 : .09);
          float trailingEdge = (offset + .15) / .13;
          float crest = liquid * exp(-leadingEdge * leadingEdge);
          float wake = liquid * exp(-trailingEdge * trailingEdge);
          swell = crest + .32 * wake;
          depth = .155 * crest + .058 * wake;
        }
        if (circulation > .001) {
          // Join the two halves of the frame into a closed path for steady flow.
          float perimeter = path * (rim.x < 0. ? -.5 : .5);
          float stream = currentCrest(perimeter - currents.x, .10, .049) * (.65 + .20 * currents.z);
          float eddy = currentCrest(currents.y - perimeter, .087, .045) * (.48 - .15 * currents.z);
          float flowingRim = stream + eddy * (1. - stream);
          swell = mix(swell, flowingRim, circulation);
          depth = mix(depth, .138 * flowingRim, circulation);
        }

        // Round the front of the moving metal so the studio reflections roll
        // with the volume. The swell stays attached to the solid frame.
        float profile = 1. - smoothstep(0., .081, abs(radius - .688));
        metal.z -= min(depth * profile, max(metal.z, 0.));
      }
      // A shallow crown on the rim rolls the reflected light across its face.
      float rimWidth = (radius - .688) / .052;
      float crown = max(0., 1. - rimWidth * rimWidth);
      metal.z -= .017 * crown * smoothstep(-.012, .050, metal.z);
      float outer = roundedBox(metal, vec3(vec2(.738 + .018 * swell), .073), .019 + .009 * swell);
      float opening = roundedBox(metal, vec3(vec2(.638 - .047 * swell), .22), .014 + .013 * swell);
      float frame = max(outer, -opening);
      float inlay = roundedBox(p + vec3(0., 0., .043), vec3(.672, .672, .049), .014);
      return vec2(frame, inlay);
    }

    float distanceToTile(vec3 p, float liquid, float head, float circulation) {
      vec2 layers = surface(p, liquid, head, circulation);
      return min(layers.x, layers.y);
    }

    float softbox(vec2 point, vec2 center, vec2 halfSize, float feather) {
      vec2 edge = abs(point - center) - halfSize;
      return 1. - smoothstep(0., feather, max(edge.x, edge.y));
    }

    vec3 studio(vec3 direction) {
      vec2 panel = direction.xy / max(.38, .72 + direction.z * .28);
      float key = softbox(panel, vec2(-.27, .33), vec2(.37, .19), .08);
      float fill = softbox(panel, vec2(.43, -.15), vec2(.105, .58), .09);
      float rim = softbox(panel, vec2(-.71, -.21), vec2(.062, .57), .062);
      float ceiling = softbox(panel, vec2(.10, .79), vec2(.7, .085), .12);
      float horizon = smoothstep(-.23, .41, direction.y);
      return mix(vec3(.047, .054, .065), vec3(.31, .34, .36), horizon)
        + key * vec3(1.23, 1.27, 1.32) + fill * vec3(.62, .69, .74)
        + rim * vec3(.78, .83, .9) + ceiling * vec3(1.15, 1.2, 1.26);
    }

    void main() {
      vec2 screen = (gl_FragCoord.xy - resolution * .5) * (2.02 / resolution.y);
      if (max(abs(screen.x), abs(screen.y)) > .99) {
        gl_FragColor = vec4(0.);
        return;
      }

      float x = tilt.x + .075;
      float y = tilt.y - .21;
      float z = -.115;
      mat2 turnX = rotation(x), turnY = rotation(y), turnZ = rotation(z);
      vec3 origin = vec3(screen, 3.);
      vec3 ray = normalize(vec3(screen * .047, -1.));
      origin.yz = turnX * origin.yz;
      origin.xz = turnY * origin.xz;
      origin.xy = turnZ * origin.xy;
      ray.yz = turnX * ray.yz;
      ray.xz = turnY * ray.xz;
      ray.xy = turnZ * ray.xy;

      float liquid = smoothstep(.025, .135, progress) * (1. - smoothstep(.77, .985, progress));
      float head = mix(-.08, 1.23, progress);
      float circulation = smoothstep(.68, .96, progress);
      float stride = liquid > .001 || circulation > .001 ? .60 : .78;
      float travel = 2.20;
      float nearest = 1.;
      float closest = travel;
      vec3 p;
      float distance = 1.;
      for (int step = 0; step < 40; step++) {
        p = origin + ray * travel;
        distance = distanceToTile(p, liquid, head, circulation);
        if (distance < nearest) { nearest = distance; closest = travel; }
        if (distance < .0007 || travel > 4.15) break;
        travel += max(distance * stride, .0005);
      }
      float edgeWidth = 2.25 / resolution.y;
      float coverage = 1. - smoothstep(.0005, edgeWidth, nearest);
      if (coverage < .01) {
        gl_FragColor = vec4(0.);
        return;
      }

      p = origin + ray * closest;
      vec2 layers = surface(p, liquid, head, circulation);
      vec3 epsilon = vec3(.0015, 0., 0.);
      vec3 normal = normalize(vec3(
        distanceToTile(p + epsilon.xyy, liquid, head, circulation) - distanceToTile(p - epsilon.xyy, liquid, head, circulation),
        distanceToTile(p + epsilon.yxy, liquid, head, circulation) - distanceToTile(p - epsilon.yxy, liquid, head, circulation),
        distanceToTile(p + epsilon.yyx, liquid, head, circulation) - distanceToTile(p - epsilon.yyx, liquid, head, circulation)
      ));
      vec3 reflection = reflect(ray, normal);
      reflection.xy = rotation(-z) * reflection.xy;
      reflection.xz = rotation(-y) * reflection.xz;
      reflection.yz = rotation(-x) * reflection.yz;
      vec3 light = studio(reflection);
      vec3 color = pow(light / (.53 + light), vec3(.69));
      if (layers.y < layers.x) {
        float ink = texture2D(lettering, p.xy / 1.32 + .5).a;
        vec3 enamel = vec3(.016, .020, .025) + min(light, vec3(1.)) * .075;
        vec3 letters = mix(vec3(.68, .73, .76), vec3(.98, .985, 1.), color);
        color = mix(enamel, letters, ink);
      }
      gl_FragColor = vec4(color, coverage);
    }
  `;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  }

  const vertexShader = compile(gl.VERTEX_SHADER, vertex);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, fragment);
  if (!vertexShader || !fragmentShader) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const triangle = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, triangle);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const label = document.createElement('canvas');
  label.width = label.height = 512;
  const ink = label.getContext('2d');
  if (!ink) return null;
  ink.fillStyle = '#fff';
  ink.font = '78px Arial';
  ink.fillText('31', 53, 120);
  ink.font = 'bold 254px Arial';
  ink.textAlign = 'center';
  ink.fillText('Ga', 256, 374);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, label);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.uniform1i(gl.getUniformLocation(program, 'lettering'), 0);

  const resolution = gl.getUniformLocation(program, 'resolution');
  const tilt = gl.getUniformLocation(program, 'tilt');
  const progress = gl.getUniformLocation(program, 'progress');
  const currents = gl.getUniformLocation(program, 'currents');
  return (phase, pitch = 0, yaw = 0, seconds = 0) => {
    // Each current keeps its own pace. Wrap their positions, so the shader
    // retains precision even when the page has been open for a long time.
    const stream = (.29 + seconds * .077 + .021 * Math.sin(seconds * .69)) % 1;
    const eddy = (.60 - seconds * .061 + .018 * Math.sin(seconds * .53)) % 1;
    const strength = .5 + .5 * Math.sin(seconds * .73);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(resolution, canvas.width, canvas.height);
    gl.uniform2f(tilt, pitch, yaw);
    gl.uniform1f(progress, phase);
    gl.uniform3f(currents, stream, eddy, strength);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

const scene = document.querySelector('.hero-media');
const canvas = scene.querySelector('.hero-metal');
const control = scene.querySelector('.motion-toggle');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const openingDuration = 4200;
// Allow for display timing jitter around a 30 fps draw cadence.
const flowFrameInterval = 1000 / 30 - 1;
let reducedMotion = motion.matches;
let visible = !('IntersectionObserver' in window);
let draw;
let paused = false;
let elapsed = 0;
let frame = 0;
let previousTime;
let pitch = 0;
let yaw = 0;
let targetPitch = 0;
let targetYaw = 0;

function canRender() {
  return visible && !document.hidden && !reducedMotion;
}

function updateControl() {
  const label = paused ? 'Play hero animation' : 'Pause hero animation';
  control.dataset.state = paused ? 'play' : 'pause';
  control.setAttribute('aria-label', label);
  control.title = label;
}

function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
  previousTime = undefined;
}

function schedule() {
  if (frame || !draw || paused || !canRender()) return;
  frame = requestAnimationFrame(animate);
}

function render() {
  draw(Math.min(elapsed / openingDuration, 1), pitch, yaw, elapsed / 1000);
}

function animate(time) {
  frame = 0;
  if (!canRender() || paused) {
    previousTime = undefined;
    return;
  }
  const dt = previousTime === undefined ? 0 : time - previousTime;
  const turning = Math.abs(targetPitch - pitch) + Math.abs(targetYaw - yaw) > .001;
  if (elapsed >= openingDuration && !turning && previousTime !== undefined && dt < flowFrameInterval) {
    schedule();
    return;
  }
  previousTime = time;
  elapsed += Math.min(dt, 100);
  if (turning) {
    const settle = 1 - Math.exp(-Math.max(dt, 16) / 90);
    pitch += (targetPitch - pitch) * settle;
    yaw += (targetYaw - yaw) * settle;
  } else {
    pitch = targetPitch;
    yaw = targetYaw;
  }
  render();
  schedule();
}

function resize() {
  if (!draw || !canRender()) return;
  const width = Math.max(384, Math.min(896, Math.round(scene.clientWidth * Math.min(1.5, Math.max(1.3, devicePixelRatio)))));
  const height = Math.round(width * .75);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  render();
}

function showStill() {
  stop();
  scene.removeAttribute('data-rendered');
  canvas.hidden = true;
  control.hidden = true;
}

function sync() {
  if (!canRender()) {
    if (reducedMotion) showStill();
    else stop();
    return;
  }
  if (draw === undefined) draw = createGalliumRenderer(canvas);
  if (!draw) return;
  resize();
  canvas.hidden = false;
  control.hidden = false;
  scene.setAttribute('data-rendered', '');
  updateControl();
  schedule();
}

control.addEventListener('click', () => {
  paused = !paused;
  updateControl();
  if (paused) stop();
  else schedule();
});

function center() {
  targetPitch = targetYaw = 0;
  schedule();
}

scene.addEventListener('pointermove', (event) => {
  if (!draw || !finePointer.matches || event.pointerType !== 'mouse' || event.target === control || reducedMotion) return;
  const bounds = scene.getBoundingClientRect();
  targetPitch = (.5 - (event.clientY - bounds.top) / bounds.height) * .64;
  targetYaw = ((event.clientX - bounds.left) / bounds.width - .5) * .88;
  schedule();
}, { passive: true });
scene.addEventListener('pointerleave', center);
finePointer.addEventListener('change', center);
motion.addEventListener('change', (event) => {
  reducedMotion = event.matches;
  sync();
});
document.addEventListener('visibilitychange', sync);
window.addEventListener('resize', resize, { passive: true });

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  draw = null;
  showStill();
});
canvas.addEventListener('webglcontextrestored', () => {
  draw = undefined;
  sync();
});

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (!visible) center();
    sync();
  });
  observer.observe(scene);
} else {
  sync();
}
