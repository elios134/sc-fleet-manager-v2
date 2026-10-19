// Shader commun des fonds : image affichée telle quelle (« cover », point d'intérêt gardé dans
// le cadre) + animation légère selon le fond — tourbillon autour d'un cœur (carte de flux en
// fondu croisé, sans cumul de déformation) et/ou dérive lente (panoramique + zoom doux).
// Uniforms : R = taille du buffer, T = temps (s), TEX = image, IMG = taille de l'image,
// FOCUS / CORE (uv, origine en bas), RADIUS, SQUASH, AMP (tourbillon), DRIFT (dérive).
export const BG_FRAG = `
precision highp float;
uniform vec2 R; uniform float T; uniform sampler2D TEX; uniform vec2 IMG;
uniform vec2 FOCUS; uniform vec2 CORE; uniform float RADIUS; uniform vec2 SQUASH;
uniform float AMP; uniform float DRIFT;
const float PERIOD = 7.0;                // s par cycle de la carte de flux

vec2 coverUV(vec2 frag){
  float sa = R.x / R.y, ia = IMG.x / IMG.y;
  vec2 uv = frag / R;
  if (sa < ia) { float k = sa / ia; uv.x = (uv.x - 0.5) * k + clamp(FOCUS.x, k*0.5, 1.0 - k*0.5); }
  else { float k = ia / sa; uv.y = (uv.y - 0.5) * k + clamp(FOCUS.y, k*0.5, 1.0 - k*0.5); }
  return uv;
}
vec2 swirl(vec2 uv, float ang){
  vec2 asp = vec2(IMG.x / IMG.y, 1.0);
  vec2 q = (uv - CORE) * asp * SQUASH;
  float w = smoothstep(RADIUS, 0.0, length(q));   // décroissance douce du cœur vers les bords
  float a = ang * w;
  float c = cos(a), s = sin(a);
  q = mat2(c, -s, s, c) * q;
  return CORE + q / (asp * SQUASH);
}
vec2 drift(vec2 uv){                      // zoom 1,04–1,08 qui respire + léger panoramique
  float z = 1.06 + 0.02 * sin(T * 0.07);
  vec2 pan = vec2(sin(T * 0.05), cos(T * 0.037)) * 0.012;
  return (uv - FOCUS) / z + FOCUS + pan;
}
void main(){
  vec2 uv = coverUV(gl_FragCoord.xy);
  if (DRIFT > 0.0) uv = mix(uv, drift(uv), DRIFT);
  if (AMP > 0.0) {
    float ph = T / PERIOD;
    float t1 = fract(ph), t2 = fract(ph + 0.5);
    vec3 a = texture2D(TEX, swirl(uv, (t1 - 0.5) * AMP)).rgb;
    vec3 b = texture2D(TEX, swirl(uv, (t2 - 0.5) * AMP)).rgb;
    gl_FragColor = vec4(mix(a, b, abs(2.0 * t1 - 1.0)), 1.0);
  } else {
    gl_FragColor = vec4(texture2D(TEX, uv).rgb, 1.0);
  }
}
`;
