// GLSL for block meshes. Two looks share one vertex shader:
// - blockFragment: Minecraft-style face lighting.
// - complementaryFragment: sun with voxel shadows, sky ambient and ambient occlusion.

export const blockVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vColor;
  varying vec3 vNormal;
  varying vec3 vWorld;

  void main() {
    vUv = uv;
    vColor = color;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const blockFragment = /* glsl */ `
  uniform sampler2D map;
  uniform float uAlphaTest;

  varying vec2 vUv;
  varying vec4 vColor;
  varying vec3 vNormal;
  varying vec3 vWorld;

  void main() {
    vec4 tex = texture2D(map, vUv);
    if (tex.a < uAlphaTest) discard;

    // Minecraft's per-face light: top 1.0, bottom 0.5, north/south 0.8, east/west 0.6.
    // Models with shade: false (vColor.a below 0.75) stay at full brightness.
    vec3 n = normalize(vNormal);
    float light = min(1.0, n.x * n.x * 0.6 + n.z * n.z * 0.8 + (n.y > 0.0 ? n.y * n.y : n.y * n.y * 0.5));
    if (vColor.a < 0.75) light = 1.0;

    vec3 color = tex.rgb * vColor.rgb * light;

    gl_FragColor = vec4(color, tex.a);
  }
`;

export const complementaryFragment = /* glsl */ `
  uniform sampler2D map;
  uniform float uAlphaTest;

  // Block occupancy as a 3D texture: width = x, height = z, depth = y (same order as the grid).
  uniform sampler3D uGrid;
  uniform vec3 uDims;
  uniform float uVoxels;     // 0 when the schematic is too big for a voxel texture
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;    // already scaled by sun height
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;

  varying vec2 vUv;
  varying vec4 vColor;
  varying vec3 vNormal;
  varying vec3 vWorld;

  bool outside(vec3 v) {
    return v.x < 0.0 || v.y < 0.0 || v.z < 0.0 || v.x >= uDims.x || v.y >= uDims.y || v.z >= uDims.z;
  }

  // 1.0 where a non-air block sits at integer voxel v, else 0.0.
  float occupied(vec3 v) {
    if (outside(v)) return 0.0;
    return texelFetch(uGrid, ivec3(v.x, v.z, v.y), 0).r;
  }

  // Walks from the surface towards the sun through the voxel grid; 1.0 if anything blocks it.
  float sunShadow(vec3 p) {
    vec3 o = p;
    for (int i = 0; i < 128; i++) {
      o += uSunDir * 0.5;
      if (outside(o)) return 0.0;
      if (occupied(floor(o)) > 0.5) return 1.0;
    }
    return 0.0;
  }

  // Classic 3-sample voxel AO on the air voxel in front of an axis-aligned face.
  float ambientOcclusion(vec3 p, vec3 n) {
    vec3 an = abs(n);
    vec3 t1 = an.x > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 t2 = an.z > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
    vec3 v = floor(p + n * 0.5);
    vec3 q = fract(p);
    float s1 = dot(q, t1) > 0.5 ? 1.0 : -1.0;
    float s2 = dot(q, t2) > 0.5 ? 1.0 : -1.0;
    float side1 = occupied(v + t1 * s1);
    float side2 = occupied(v + t2 * s2);
    float corner = occupied(v + t1 * s1 + t2 * s2);
    float level = side1 * side2 > 0.5 ? 0.0 : 3.0 - (side1 + side2 + corner);
    return mix(0.45, 1.0, level / 3.0);
  }

  void main() {
    vec4 tex = texture2D(map, vUv);
    if (tex.a < uAlphaTest) discard;

    vec3 n = normalize(vNormal);
    vec3 base = tex.rgb * vColor.rgb;
    vec3 color = base;

    if (vColor.a > 0.75) {
      float occl = uVoxels > 0.5 ? ambientOcclusion(vWorld, n) : 1.0;
      float ndl = max(dot(n, uSunDir), 0.0);
      if (ndl > 0.0 && uVoxels > 0.5) ndl *= 1.0 - sunShadow(vWorld + n * 0.02);
      vec3 sky = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5);
      color = base * (uSunColor * ndl + sky * 0.4 * occl);
    }

    gl_FragColor = vec4(color, tex.a);
  }
`;
