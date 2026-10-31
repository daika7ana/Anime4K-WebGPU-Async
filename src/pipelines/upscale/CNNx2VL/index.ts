import conv2dtfWGSL from './shaders/conv2dtf.wgsl';
import conv2dtf1WGSL from './shaders/conv2dtf1.wgsl';
import conv2d1tfWGSL from './shaders/conv2d1tf.wgsl';
import conv2d1tf1WGSL from './shaders/conv2d1tf1.wgsl';
import conv2d2tfWGSL from './shaders/conv2d2tf.wgsl';
import conv2d2tf1WGSL from './shaders/conv2d2tf1.wgsl';
import conv2d3tfWGSL from './shaders/conv2d3tf.wgsl';
import conv2d3tf1WGSL from './shaders/conv2d3tf1.wgsl';
import conv2d4tfWGSL from './shaders/conv2d4tf.wgsl';
import conv2d4tf1WGSL from './shaders/conv2d4tf1.wgsl';
import conv2d5tfWGSL from './shaders/conv2d5tf.wgsl';
import conv2d5tf1WGSL from './shaders/conv2d5tf1.wgsl';
import conv2d6tfWGSL from './shaders/conv2d6tf.wgsl';
import conv2d6tf1WGSL from './shaders/conv2d6tf1.wgsl';
import conv2dlasttfWGSL from './shaders/conv2dlasttf.wgsl';
import conv2dlasttf1WGSL from './shaders/conv2dlasttf1.wgsl';
import conv2dlasttf2WGSL from './shaders/conv2dlasttf2.wgsl';

import { Anime4KPipelineDescriptor } from '../../interfaces';
import { ConvNetX2 } from './ConvNet';

export class CNNx2VL extends ConvNetX2 {
  constructor(options: Anime4KPipelineDescriptor) {
    super(options, [
      conv2dtfWGSL,
      conv2dtf1WGSL,
      conv2d1tfWGSL,
      conv2d1tf1WGSL,
      conv2d2tfWGSL,
      conv2d2tf1WGSL,
      conv2d3tfWGSL,
      conv2d3tf1WGSL,
      conv2d4tfWGSL,
      conv2d4tf1WGSL,
      conv2d5tfWGSL,
      conv2d5tf1WGSL,
      conv2d6tfWGSL,
      conv2d6tf1WGSL,
      conv2dlasttfWGSL,
      conv2dlasttf1WGSL,
      conv2dlasttf2WGSL,
    ]);
  }
}
