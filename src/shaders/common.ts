/** Shared GLSL chunks (display-referred colour; ColorManagement is disabled globally). */
export const NOISE = /* glsl */ `
float hash11(float p){ p = fract(p*.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3 += dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),u.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.02+11.7; a*=.5; } return s; }
// returns (F1, F2-F1)
vec2 voronoi(vec2 x){ vec2 n=floor(x), f=fract(x); float d1=8., d2=8.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(float(i),float(j)); vec2 o=hash22(n+g); vec2 r=g+o-f; float d=dot(r,r);
    if(d<d1){ d2=d1; d1=d; } else if(d<d2){ d2=d; } }
  return vec2(sqrt(d1), sqrt(d2)-sqrt(d1)); }
`;

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;
