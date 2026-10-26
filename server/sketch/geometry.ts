export type Affine=[number,number,number,number,number,number];
export function inverse(m:Affine):Affine {
  const determinant=m[0]*m[3]-m[1]*m[2];
  if(Math.abs(determinant)<1e-10)throw Error('图层变换不可逆');
  const [a,b,c,d]=[m[3]/determinant,-m[1]/determinant,-m[2]/determinant,m[0]/determinant];
  return [a,b,c,d,-a*m[4]-c*m[5],-b*m[4]-d*m[5]];
}
