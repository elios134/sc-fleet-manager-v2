// Thème de fond « Orbite au crépuscule » (validé) : nébuleuse chaude, étoile + reflet
// anamorphique, planète éclairée de côté, caméra qui dérive. Shader de fragment WebGL1
// (uniforms : R = taille du buffer, T = temps en s). Généré, sans image du jeu.
export const ORBITE_FRAG = `
precision highp float;
uniform vec2 R; uniform float T;
float h3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y), f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a*n3(p); p = p*2.02 + vec3(1.7,9.2,3.1); a *= 0.5; } return s; }
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float stars(vec2 uv, float d){ vec2 g = floor(uv*d); vec2 f = fract(uv*d)-0.5; float r = h2(g);
  return step(0.985, r) * smoothstep(0.06, 0.0, length(f)) * (0.5 + 0.5*sin(T*2.0 + r*40.0)); }
vec3 planet(vec2 p, vec2 c0, float rad, vec3 L, vec3 tA, vec3 tB, vec3 atm, float spin, inout float mask){
  vec2 d = (p - c0)/rad; float l = length(d); vec3 col = vec3(0.0);
  if (l < 1.0) {
    vec3 n = vec3(d, sqrt(1.0 - l*l));
    float lon = atan(n.x, n.z) + spin; float lat = n.y;
    float s = fbm(vec3(cos(lon)*2.0, sin(lon)*2.0, lat*3.0) * 1.2);
    float bands = 0.5 + 0.5*sin(lat*18.0 + s*6.0);
    vec3 surf = mix(tA, tB, smoothstep(0.35, 0.75, s*0.7 + bands*0.3));
    float dif = clamp(dot(n, normalize(L)), 0.0, 1.0);
    col = surf * (0.04 + 1.05*pow(dif, 0.9));
    col += atm * pow(1.0 - n.z, 3.0) * (0.25 + dif) * 1.2;
    mask = 1.0;
  }
  float halo = smoothstep(1.07, 1.0, l) * smoothstep(0.97, 1.0, l);
  float lit = clamp(dot(normalize(vec3(d, 0.2)), normalize(L)) * 0.8 + 0.2, 0.0, 1.0);
  col += atm * halo * lit * 1.1;
  return col;
}
void main(){
  vec2 uv = gl_FragCoord.xy / R;
  vec2 p = (gl_FragCoord.xy - 0.5*R) / R.y;
  vec2 cam = vec2(sin(T*0.03), cos(T*0.025))*0.06;
  vec2 pp = p + cam;
  float neb = fbm(vec3(pp*1.4, T*0.02));
  float neb2 = fbm(vec3(pp*3.0 + 4.0, T*0.03));
  vec3 c = vec3(0.012, 0.012, 0.03);
  c += mix(vec3(0.50, 0.10, 0.28), vec3(1.0, 0.48, 0.16), neb2) * pow(neb, 2.2) * 1.5;
  c += vec3(0.05, 0.25, 0.35) * pow(fbm(vec3(pp*0.8 - 3.0, T*0.015)), 4.0) * 1.5;
  c += stars(uv + cam*0.5, 70.0) * 0.9 + stars(uv*1.7 + cam, 120.0) * 0.5;
  vec2 sun = vec2(-0.55, 0.38) - cam*0.3;
  float sd = length(p - sun);
  c += vec3(1.0, 0.75, 0.45) * (exp(-sd*9.0)*1.6 + exp(-sd*2.6)*0.25);
  c += vec3(1.0, 0.6, 0.35) * exp(-abs(p.y - sun.y)*60.0) * exp(-abs(p.x-sun.x)*1.5) * 0.35;
  float m = 0.0;
  vec3 pl = planet(p + cam*1.6, vec2(0.80, -0.48), 0.58, vec3(-1.0, 0.7, 0.55), vec3(0.20, 0.32, 0.38), vec3(0.62, 0.48, 0.30), vec3(0.35, 0.65, 1.0), T*0.012, m);
  c = mix(c, pl, m) + pl*(1.0-m);
  c = 1.0 - exp(-c * 1.25);
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Repli sans WebGL, dans les mêmes teintes. */
export const ORBITE_FALLBACK = "radial-gradient(ellipse at 25% 30%, #4a2a20, #0a0a0f 70%)";
