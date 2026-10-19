// Shader commun des fonds : image affichée telle quelle (« cover », point d'intérêt gardé dans
// le cadre), sans zoom, animée selon sa scène (SCENE, cf. SCENE_INDEX dans backgrounds.ts) :
// 0 vortex qui tourne (carte de flux en fondu croisé), 1 Aurora (soleil, rayons, poussière,
// feux), 2 Constellation (nuages qui défilent autour du vaisseau détouré, réacteurs),
// 3 Cutlass (étoiles, anneaux, soleil). Coordonnées en uv de l'image, origine en bas à gauche.
export const BG_FRAG = `
precision highp float;
uniform vec2 R; uniform float T; uniform sampler2D TEX; uniform vec2 IMG;
uniform vec2 FOCUS; uniform int SCENE;   // SCENE_INDEX (backgrounds.ts)
// Tourbillon (scène 0)
uniform vec2 CORE; uniform float RADIUS; uniform vec2 SQUASH; uniform float AMP;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

vec2 coverUV(vec2 frag){
  float sa = R.x / R.y, ia = IMG.x / IMG.y;
  vec2 uv = frag / R;
  if (sa < ia) { float k = sa / ia; uv.x = (uv.x - 0.5) * k + clamp(FOCUS.x, k*0.5, 1.0 - k*0.5); }
  else { float k = ia / sa; uv.y = (uv.y - 0.5) * k + clamp(FOCUS.y, k*0.5, 1.0 - k*0.5); }
  return uv;
}
// distance en « hauteurs d'image » (corrige l'étirement horizontal)
float dist(vec2 a, vec2 b){ vec2 d = (a - b) * vec2(IMG.x / IMG.y, 1.0); return length(d); }
vec3 glow(vec2 uv, vec2 at, float r, vec3 col){ float d = dist(uv, at); return col * exp(-d * d / (r * r)); }

/* ── 0 · Vortex : tourbillon autour du cœur ── */
vec2 swirl(vec2 uv, float ang){
  vec2 asp = vec2(IMG.x / IMG.y, 1.0);
  vec2 q = (uv - CORE) * asp * SQUASH;
  float w = smoothstep(RADIUS, 0.0, length(q));
  float a = ang * w; float c = cos(a), s = sin(a);
  q = mat2(c, -s, s, c) * q;
  return CORE + q / (asp * SQUASH);
}
vec3 vortex(vec2 uv){
  float ph = T / 7.0; float t1 = fract(ph), t2 = fract(ph + 0.5);
  vec3 a = texture2D(TEX, swirl(uv, (t1 - 0.5) * AMP)).rgb;
  vec3 b = texture2D(TEX, swirl(uv, (t2 - 0.5) * AMP)).rgb;
  return mix(a, b, abs(2.0 * t1 - 1.0));
}

/* ── 1 · Aurora : soleil qui respire, rayons, poussière dorée, feux de navigation ── */
vec3 aurora(vec2 uv){
  vec3 c = texture2D(TEX, uv).rgb;
  vec2 sun = vec2(0.468, 0.605);
  float L = lum(c);
  // halo du soleil qui respire
  c += glow(uv, sun, 0.09, vec3(1.0, 0.85, 0.55)) * (0.10 + 0.08 * sin(T * 0.9));
  // rayons qui ondulent (seulement sur le ciel lumineux, pas sur les silhouettes)
  vec2 d = (uv - sun) * vec2(IMG.x / IMG.y, 1.0);
  float ang = atan(d.y, d.x), r = length(d);
  float rays = pow(0.5 + 0.5 * sin(ang * 13.0 + sin(ang * 5.0 + T * 0.2) * 1.5 + T * 0.05), 2.5);
  c += vec3(1.0, 0.82, 0.5) * rays * exp(-r * 3.5) * smoothstep(0.35, 0.75, L) * 0.06;
  // poussière dorée qui flotte dans la lumière
  vec2 p = uv * vec2(IMG.x / IMG.y, 1.0) * 70.0 + vec2(T * 0.35, T * 0.12);
  vec2 cell = floor(p), f = fract(p) - 0.5;
  float h = hash(cell);
  vec2 jit = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
  float spark = step(0.86, h) * smoothstep(0.09, 0.0, length(f - jit * 0.6));
  spark *= 0.5 + 0.5 * sin(T * 2.0 + h * 40.0);
  c += vec3(1.0, 0.85, 0.55) * spark * exp(-r * 1.6) * smoothstep(0.2, 0.6, L) * 0.55;
  // feux de navigation rouges (bout d'aile, nez) : éclair court toutes les 1,6 s
  float blink = smoothstep(0.0, 0.04, fract(T / 1.6)) * smoothstep(0.16, 0.08, fract(T / 1.6));
  c += glow(uv, vec2(0.964, 0.573), 0.007, vec3(1.0, 0.18, 0.12)) * blink * 1.6;
  c += glow(uv, vec2(0.8865, 0.4565), 0.007, vec3(1.0, 0.18, 0.12)) * smoothstep(0.0, 0.04, fract(T / 1.6 - 0.5)) * smoothstep(0.16, 0.08, fract(T / 1.6 - 0.5)) * 1.6;
  return c;
}

/* ── 2 · Constellation : les nuages défilent autour du vaisseau (immobile), réacteurs qui pulsent ── */
// contour du vaisseau (polygone tracé sur l'image) : distance signée en hauteurs d'image
void edge(vec2 p, vec2 a, vec2 b, inout float d, inout bool inside){
  vec2 k = vec2(IMG.x / IMG.y, 1.0);
  vec2 pa = (p - a) * k, ba = (b - a) * k;
  d = min(d, length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)));
  if ((a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
}
// 1 sur le vaisseau, 0 à plus de 2 % de hauteur d'image de son bord
float shipMask(vec2 p){
  float d = 1e3; bool inside = false;
  edge(p, vec2(0.2625, 0.8533), vec2(0.3500, 0.8756), d, inside);
  edge(p, vec2(0.3500, 0.8756), vec2(0.4400, 0.8711), d, inside);
  edge(p, vec2(0.4400, 0.8711), vec2(0.4800, 0.8444), d, inside);
  edge(p, vec2(0.4800, 0.8444), vec2(0.6500, 0.7467), d, inside);
  edge(p, vec2(0.6500, 0.7467), vec2(0.6850, 0.7618), d, inside);
  edge(p, vec2(0.6850, 0.7618), vec2(0.7700, 0.7351), d, inside);
  edge(p, vec2(0.7700, 0.7351), vec2(0.8300, 0.6729), d, inside);
  edge(p, vec2(0.8300, 0.6729), vec2(0.8740, 0.6311), d, inside);
  edge(p, vec2(0.8740, 0.6311), vec2(0.8740, 0.5867), d, inside);
  edge(p, vec2(0.8740, 0.5867), vec2(0.8600, 0.5556), d, inside);
  edge(p, vec2(0.8600, 0.5556), vec2(0.8950, 0.4933), d, inside);
  edge(p, vec2(0.8950, 0.4933), vec2(0.9675, 0.4684), d, inside);
  edge(p, vec2(0.9675, 0.4684), vec2(0.9225, 0.4116), d, inside);
  edge(p, vec2(0.9225, 0.4116), vec2(0.9525, 0.2578), d, inside);
  edge(p, vec2(0.9525, 0.2578), vec2(0.8900, 0.3156), d, inside);
  edge(p, vec2(0.8900, 0.3156), vec2(0.8600, 0.3378), d, inside);
  edge(p, vec2(0.8600, 0.3378), vec2(0.7500, 0.3067), d, inside);
  edge(p, vec2(0.7500, 0.3067), vec2(0.7425, 0.2444), d, inside);
  edge(p, vec2(0.7425, 0.2444), vec2(0.7025, 0.0711), d, inside);
  edge(p, vec2(0.7025, 0.0711), vec2(0.6800, 0.0756), d, inside);
  edge(p, vec2(0.6800, 0.0756), vec2(0.6900, 0.2356), d, inside);
  edge(p, vec2(0.6900, 0.2356), vec2(0.6200, 0.1778), d, inside);
  edge(p, vec2(0.6200, 0.1778), vec2(0.5500, 0.1511), d, inside);
  edge(p, vec2(0.5500, 0.1511), vec2(0.5275, 0.1778), d, inside);
  edge(p, vec2(0.5275, 0.1778), vec2(0.4500, 0.2222), d, inside);
  edge(p, vec2(0.4500, 0.2222), vec2(0.4250, 0.3022), d, inside);
  edge(p, vec2(0.4250, 0.3022), vec2(0.3400, 0.3200), d, inside);
  edge(p, vec2(0.3400, 0.3200), vec2(0.3390, 0.3778), d, inside);
  edge(p, vec2(0.3390, 0.3778), vec2(0.3500, 0.4222), d, inside);
  edge(p, vec2(0.3500, 0.4222), vec2(0.3200, 0.4978), d, inside);
  edge(p, vec2(0.3200, 0.4978), vec2(0.2925, 0.5556), d, inside);
  edge(p, vec2(0.2925, 0.5556), vec2(0.2775, 0.7067), d, inside);
  edge(p, vec2(0.2775, 0.7067), vec2(0.2600, 0.7778), d, inside);
  edge(p, vec2(0.2600, 0.7778), vec2(0.2625, 0.8533), d, inside);
  return inside ? 1.0 : smoothstep(0.02, 0.006, d);
}
vec3 constellation(vec2 uv){
  vec3 base = texture2D(TEX, uv).rgb;
  float ship = shipMask(uv);
  if (ship > 0.999) {
    // réacteurs et hublots bleus qui pulsent
    float blue = smoothstep(0.82, 0.97, base.b) * smoothstep(0.12, 0.3, base.b - base.r);
    return base * (1.0 + blue * (0.18 + 0.18 * sin(T * 3.1)));
  }
  // nuages = clairs et peu saturés
  float sat = max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b));
  float cloud = smoothstep(0.28, 0.45, lum(base)) * smoothstep(0.22, 0.10, sat) * (1.0 - ship);
  if (cloud < 0.001) return base;
  // carte de flux en fondu croisé ; un échantillon qui tomberait sur le vaisseau est remplacé par le pixel d'origine
  vec2 dir = vec2(0.030, 0.018);
  float ph = T / 8.0; float t1 = fract(ph), t2 = fract(ph + 0.5);
  vec2 u1 = uv + dir * (t1 - 0.5), u2 = uv + dir * (t2 - 0.5);
  vec3 a = mix(texture2D(TEX, u1).rgb, base, shipMask(u1));
  vec3 b = mix(texture2D(TEX, u2).rgb, base, shipMask(u2));
  return mix(base, mix(a, b, abs(2.0 * t1 - 1.0)), cloud);
}

/* ── 3 · Cutlass : étoiles qui scintillent, anneaux qui miroitent, soleil qui respire ── */
vec3 cutlass(vec2 uv){
  vec3 c = texture2D(TEX, uv).rgb;
  float L = lum(c);
  vec2 px = 1.0 / IMG;
  float around = (lum(texture2D(TEX, uv + vec2(3.0, 0.0) * px).rgb) + lum(texture2D(TEX, uv - vec2(3.0, 0.0) * px).rgb)
               + lum(texture2D(TEX, uv + vec2(0.0, 3.0) * px).rgb) + lum(texture2D(TEX, uv - vec2(0.0, 3.0) * px).rgb)) * 0.25;
  float sky = smoothstep(0.33, 0.37, uv.y);
  // anneaux = traînées bleutées dans le ciel, à droite
  float ring = smoothstep(0.12, 0.30, L) * smoothstep(0.0, 0.06, c.b - c.r) * sky * smoothstep(0.38, 0.48, uv.x);
  // étoiles = petits points plus clairs que leur voisinage, hors anneaux
  float star = smoothstep(0.06, 0.16, L - around) * sky * (1.0 - ring);
  float tw = 0.55 + 0.45 * sin(T * (1.5 + 3.0 * hash(floor(uv * IMG / 2.0))) + hash(floor(uv * IMG / 2.0) + 9.0) * 6.28);
  c = mix(c, c * (0.35 + 1.1 * tw), star);
  // miroitement le long des anneaux
  vec2 along = normalize(vec2(0.59, 0.64));
  float sh = 0.5 + 0.5 * sin(dot(uv * vec2(IMG.x / IMG.y, 1.0), along) * 38.0 - T * 0.9);
  c *= 1.0 + ring * (sh - 0.5) * 0.28;
  // soleil à l'horizon qui respire
  c += glow(uv, vec2(0.2825, 0.3556), 0.07, vec3(0.85, 0.9, 1.0)) * (0.08 + 0.07 * sin(T * 0.7));
  return c;
}

void main(){
  vec2 uv = coverUV(gl_FragCoord.xy);
  vec3 c = SCENE == 0 ? vortex(uv) : SCENE == 1 ? aurora(uv) : SCENE == 2 ? constellation(uv) : cutlass(uv);
  gl_FragColor = vec4(c, 1.0);
}
`;
