// Synchronous SHA-256 (FIPS 180-4) so asset identity can be checked without async crypto APIs.
const K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
export function sha256(data){
 const n=data.length,len=((n+9+63)>>6)<<6,m=new Uint8Array(len);m.set(data);m[n]=0x80;
 const bits=n*8;for(let i=0;i<8;i++)m[len-1-i]=Math.floor(bits/2**(8*i))&0xff;
 const h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]),w=new Uint32Array(64);
 const r=(x,k)=>x>>>k|x<<(32-k);
 for(let o=0;o<len;o+=64){
  for(let i=0;i<16;i++)w[i]=m[o+i*4]<<24|m[o+i*4+1]<<16|m[o+i*4+2]<<8|m[o+i*4+3];
  for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(r(a,7)^r(a,18)^a>>>3)+w[i-16]+(r(b,17)^r(b,19)^b>>>10)+w[i-7];}
  let [A,Bv,C,D,E,F,G,H]=h;
  for(let i=0;i<64;i++){const t1=H+(r(E,6)^r(E,11)^r(E,25))+(E&F^~E&G)+K[i]+w[i]>>>0,t2=(r(A,2)^r(A,13)^r(A,22))+(A&Bv^A&C^Bv&C)>>>0;H=G;G=F;F=E;E=D+t1>>>0;D=C;C=Bv;Bv=A;A=t1+t2>>>0;}
  h[0]+=A;h[1]+=Bv;h[2]+=C;h[3]+=D;h[4]+=E;h[5]+=F;h[6]+=G;h[7]+=H;
 }
 return [...h].map(x=>x.toString(16).padStart(8,'0')).join('');
}
