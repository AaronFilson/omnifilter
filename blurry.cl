__kernel void blurry(__global ushort* pixels, __global ushort* pixelsOut, int numRGBElements, int width, int height){

  // pixelsOut[0] = 0;
  // pixelsOut[1] = 0;
  // pixelsOut[2] = 0;
  // pixelsOut[numRGBElements - 1] = 0;
  // pixelsOut[numRGBElements - 2] = 0;
  // pixelsOut[numRGBElements - 3] = 0;

  // for( int i = 3; i < numRGBElements - 4 ; i += 1){
  //   pixelsOut[i] = ((pixels[i - 3] * 0.45) + (pixels[i] * 0.45) + (pixels[i + 3] * 0.45)) ;
  //   if(pixelsOut[i] > 255) pixelsOut[i] = 255;
  //
  // }

  const int i = get_global_id(0);
  pixelsOut[i] = ((pixels[i - 3] * 0.33) + (pixels[i] * 0.33) + (pixels[i + 3] * 0.33));
}
