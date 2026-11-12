// A beveled frame and face, lit by procedural studio softboxes.
window.createGalliumModel = function createGalliumModel(canvas) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false });
  if (!gl) return null;

  const vertex = `
    attribute vec2 position;
    void main() { gl_Position = vec4(position, 0., 1.); }
  `;
  const fragment = `
    precision highp float;
    uniform vec2 pose;
    uniform float rise;
    uniform sampler2D lettering;

    float box(vec3 p, vec3 size, float bevel) {
      vec3 q = abs(p) - size + bevel;
      return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.) - bevel;
    }

    vec3 local(vec3 p) {
      p.y -= -1.66 + 1.77 * rise;
      float a = pose.x;
      float b = pose.y - .18;
      p.yz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.yz;
      p.xz = mat2(cos(b), -sin(b), sin(b), cos(b)) * p.xz;
      p.xy = mat2(.995, -.10, .10, .995) * p.xy;
      return p;
    }

    vec2 surface(vec3 p) {
      vec3 q = local(p);
      float outer = box(q, vec3(.70, .70, .090), .030);
      float inner = box(q, vec3(.616, .616, .20), .020);
      float frame = max(outer, -inner);
      float face = box(q + vec3(0., 0., .038), vec3(.628, .628, .039), .018);
      return frame < face ? vec2(frame, 1.) : vec2(face, 2.);
    }

    vec3 studio(vec3 ray) {
      float key = smoothstep(.72, .91, dot(ray, normalize(vec3(-.5, .8, .85))));
      float strip = exp(-16. * abs(ray.y - .32)) * smoothstep(-.3, .6, ray.x);
      float rim = smoothstep(.83, .98, dot(ray, normalize(vec3(.9, -.35, .42))));
      float frontal = smoothstep(.58, .99, ray.z);
      return vec3(.09,.14,.17) + frontal * vec3(.51,.57,.60) + key * vec3(.88,.94,1.) +
        strip * vec3(.65,.84,.95) + rim * vec3(.55,.67,.73);
    }

    void main() {
      vec2 uv = (gl_FragCoord.xy / vec2(640., 360.) - .5) * vec2(3.84, 2.16);
      vec3 origin = vec3(uv, 3.);
      vec3 ray = normalize(vec3(uv * .047, -1.));
      float distance = 0.;
      vec2 hit = vec2(0.);
      vec3 p;
      for (int i = 0; i < 44; i++) {
        p = origin + ray * distance;
        hit = surface(p);
        if (hit.x < .001 || distance > 5.) break;
        distance += hit.x;
      }
      if (distance > 5. || hit.x >= .001 || p.y < -.89) {
        gl_FragColor = vec4(0.);
        return;
      }
      vec3 e = vec3(.002, 0., 0.);
      vec3 n = normalize(vec3(surface(p+e.xyy).x-surface(p-e.xyy).x,
        surface(p+e.yxy).x-surface(p-e.yxy).x,
        surface(p+e.yyx).x-surface(p-e.yyx).x));
      vec3 q = local(p);
      vec3 reflection = studio(reflect(ray, n));
      float brushed = .94 + .06 * sin(q.y * 270. + q.x * 9.);
      vec3 color = reflection * brushed;
      if (hit.y > 1.5) {
        float ink = texture2D(lettering, q.xy / 1.25 + .5).a;
        color = mix(vec3(.027,.043,.051) + reflection * .15,
          vec3(.69,.79,.82) + reflection * .29, ink);
      }
      gl_FragColor = vec4(clamp(color, 0., 1.), 1.);
    }
  `;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  }

  const vs = compile(gl.VERTEX_SHADER, vertex);
  const fs = compile(gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const label = document.createElement('canvas');
  label.width = label.height = 256;
  const ink = label.getContext('2d');
  ink.fillStyle = '#fff';
  ink.font = '43px Arial';
  ink.fillText('31', 23, 62);
  ink.font = 'bold 130px Arial';
  ink.textAlign = 'center';
  ink.fillText('Ga', 128, 194);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, label);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.uniform1i(gl.getUniformLocation(program, 'lettering'), 0);

  const pose = gl.getUniformLocation(program, 'pose');
  const rise = gl.getUniformLocation(program, 'rise');
  return (height, pitch = 0, yaw = 0) => {
    gl.uniform2f(pose, pitch, yaw);
    gl.uniform1f(rise, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
};
