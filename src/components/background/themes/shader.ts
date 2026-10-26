// Shader du Vortex cosmique : image affichée telle quelle (« cover », point d'intérêt gardé dans
// le cadre), sans zoom ; le tourbillon tourne autour de son cœur (carte de flux en fondu croisé).
// Coordonnées en uv de l'image, origine en bas à gauche.
export const BG_FRAG = `
precision highp float;
uniform vec2 R; uniform float T; uniform sampler2D TEX; uniform vec2 IMG;
uniform vec2 FOCUS;
// Tourbillon
uniform vec2 CORE; uniform float RADIUS; uniform vec2 SQUASH; uniform float AMP;

vec2 coverUV(vec2 frag){
  float sa = R.x / R.y, ia = IMG.x / IMG.y;
  vec2 uv = frag / R;
  if (sa < ia) { float k = sa / ia; uv.x = (uv.x - 0.5) * k + clamp(FOCUS.x, k*0.5, 1.0 - k*0.5); }
  else { float k = ia / sa; uv.y = (uv.y - 0.5) * k + clamp(FOCUS.y, k*0.5, 1.0 - k*0.5); }
  return uv;
}
/* Tourbillon autour du cœur */
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

void main(){
  gl_FragColor = vec4(vortex(coverUV(gl_FragCoord.xy)), 1.0);
}
`;
