// Conservative spatial de-dithering for static palette portraits. Not an AI upscaler.
// A blurred guide distinguishes broad edges from alternating single-pixel colors.
export function smoothPortrait(source,width,height){
 if(source.length!==width*height*4)throw Error('Invalid portrait dimensions');
 const guide=new Float32Array(source.length),output=new Uint8ClampedArray(source);
 const at=(x,y)=>(Math.max(0,Math.min(height-1,y))*width+Math.max(0,Math.min(width-1,x)))*4;
 const kernel=[1,2,1];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=at(x,y);for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const q=at(x+i,y+j),w=kernel[i+1]*kernel[j+1]/16;for(let c=0;c<3;c++)guide[p+c]+=source[q+c]*w;}}
 for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
  const p=at(x,y);let oscillation=0;
  for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){const a=at(x-dx,y-dy),b=at(x+dx,y+dy);let dot=0,energy=0;for(let c=0;c<3;c++){const u=source[a+c]-source[p+c],v=source[b+c]-source[p+c];dot+=u*v;energy+=u*u+v*v;}if(energy>1200&&dot>energy*.22)oscillation++;}
  if(oscillation<2)continue;
  let total=0;const sum=[0,0,0];
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const q=at(x+i,y+j);let distance=0;for(let c=0;c<3;c++)distance+=(guide[p+c]-guide[q+c])**2;const w=kernel[i+1]*kernel[j+1]*Math.exp(-distance/(2*38**2));total+=w;for(let c=0;c<3;c++)sum[c]+=source[q+c]*w;}
  const amount=oscillation>=3?1:.75;for(let c=0;c<3;c++)output[p+c]=source[p+c]+(sum[c]/total-source[p+c])*amount;
 }
 return output;
}
export function blendPortrait(original,smoothed,strength){const t=Math.max(0,Math.min(1,Number(strength)||0)),out=new Uint8ClampedArray(original.length);for(let i=0;i<out.length;i++)out[i]=i%4===3?original[i]:original[i]+(smoothed[i]-original[i])*t;return out;}
