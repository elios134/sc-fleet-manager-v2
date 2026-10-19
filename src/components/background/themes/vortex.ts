// Thème de fond « Vortex cosmique » (image fournie par l'utilisateur, public/imgs),
// affichée telle quelle ; seul le vortex tourne (carte de flux en fondu croisé, sans
// cumul de déformation). Uniforms : R = taille du buffer, T = temps (s), TEX = image,
// IMG = taille de l'image en pixels.
import image from "../../../assets/vortex.jpg";

export const VORTEX_IMAGE: string = image;

export const VORTEX_FRAG = `
precision highp float;
uniform vec2 R; uniform float T; uniform sampler2D TEX; uniform vec2 IMG;
const vec2 CORE = vec2(0.506, 0.560);   // cœur du vortex dans l'image (uv, origine en bas)
const float RADIUS = 0.90;              // rayon d'influence (en hauteur d'image) : presque toute l'image
const vec2 SQUASH = vec2(1.0, 0.85);    // anneau un peu plus haut que large (ellipse)
const float PERIOD = 7.0;               // s par cycle de la carte de flux
const float AMP = 0.55;                 // rad parcourus par cycle au centre

vec2 coverUV(vec2 frag){                 // image en « cover », cœur gardé dans le cadre
  float sa = R.x / R.y, ia = IMG.x / IMG.y;
  vec2 uv = frag / R;
  if (sa < ia) { float k = sa / ia; uv.x = (uv.x - 0.5) * k + clamp(CORE.x, k*0.5, 1.0 - k*0.5); }
  else { float k = ia / sa; uv.y = (uv.y - 0.5) * k + 0.5; }
  return uv;
}
vec2 swirl(vec2 uv, float ang){
  vec2 asp = vec2(IMG.x / IMG.y, 1.0);
  vec2 q = (uv - CORE) * asp * SQUASH;
  float r = length(q);
  float w = smoothstep(RADIUS, 0.0, r);              // décroissance douce : les nuages loin du cœur tournent aussi
  float a = ang * w;
  float c = cos(a), s = sin(a);
  q = mat2(c, -s, s, c) * q;
  return CORE + q / (asp * SQUASH);
}
void main(){
  vec2 uv = coverUV(gl_FragCoord.xy);
  float ph = T / PERIOD;
  float t1 = fract(ph), t2 = fract(ph + 0.5);
  vec3 a = texture2D(TEX, swirl(uv, (t1 - 0.5) * AMP)).rgb;
  vec3 b = texture2D(TEX, swirl(uv, (t2 - 0.5) * AMP)).rgb;
  float m = abs(2.0 * t1 - 1.0);         // fondu croisé : rotation continue sans cumul
  gl_FragColor = vec4(mix(a, b, m), 1.0);
}
`;

/** Repli sans WebGL : l'image fixe, cadrée sur le vortex. */
export const VORTEX_FALLBACK = `#0a0a0f url(${image}) 50.6% 44% / cover no-repeat`;
